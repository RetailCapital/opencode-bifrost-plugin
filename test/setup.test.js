import assert from "node:assert/strict"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import {
  BLOCK_END,
  BLOCK_START,
  findConflictingLines,
  findLoginShellIssue,
  readBlockValues,
  renderBlock,
  runSetup,
  shellQuote,
  sourcesBashrc,
  upsertBlock,
  validateApiKey,
  validateUrl,
} from "../src/setup.js"

const answers = (list) => {
  const queue = [...list]
  return async () => queue.shift() ?? ""
}

async function tempBashrc(content) {
  const dir = await mkdtemp(join(tmpdir(), "bifrost-setup-"))
  const path = join(dir, ".bashrc")
  if (content !== undefined) await writeFile(path, content)
  return path
}

test("shellQuote escapes single quotes", () => {
  assert.equal(shellQuote("a'b"), `'a'\\''b'`)
})

test("validators reject empty, malformed, and non-http values", () => {
  assert.ok(validateUrl("").error)
  assert.ok(validateUrl("not a url").error)
  assert.ok(validateUrl("ftp://host").error)
  assert.equal(validateUrl(" http://bifrost.internal ").value, "http://bifrost.internal")
  assert.ok(validateApiKey("").error)
  assert.ok(validateApiKey("has space").error)
  assert.equal(validateApiKey(" sk-123 ").value, "sk-123")
})

test("upsertBlock appends once and replaces in place afterwards", () => {
  const first = upsertBlock("alias x=y\n", renderBlock({ url: "http://a", apiKey: "k1" }))
  assert.match(first, /alias x=y\n\n# >>>/)
  const second = upsertBlock(first + "alias z=w\n", renderBlock({ url: "http://b", apiKey: "k2" }))
  assert.equal(second.split(BLOCK_START).length, 2)
  assert.ok(second.includes("alias z=w"))
  assert.deepEqual(readBlockValues(second), { url: "http://b", apiKey: "k2" })
})

test("block round-trips values containing single quotes", () => {
  const text = upsertBlock("", renderBlock({ url: "http://a", apiKey: "k'ey" }))
  assert.equal(readBlockValues(text).apiKey, "k'ey")
})

test("findConflictingLines ignores the managed block and comments", () => {
  const text = [
    "export BIFROST_URL=old",
    "# export BIFROST_API_KEY=commented",
    renderBlock({ url: "http://a", apiKey: "k" }),
  ].join("\n")
  assert.deepEqual(findConflictingLines(text), ["export BIFROST_URL=old"])
})

test("runSetup creates a private .bashrc and never prints the key", async () => {
  const bashrcPath = await tempBashrc()
  const output = []
  await runSetup({
    bashrcPath,
    env: {},
    out: (m) => output.push(m),
    ask: answers(["http://bifrost.internal"]),
    askSecret: answers(["secret-key"]),
  })

  const text = await readFile(bashrcPath, "utf8")
  assert.ok(text.includes("export BIFROST_URL='http://bifrost.internal'"))
  assert.ok(text.includes("export BIFROST_API_KEY='secret-key'"))
  assert.ok(text.includes(BLOCK_END))
  assert.equal((await stat(bashrcPath)).mode & 0o077, 0)
  assert.ok(!output.join("\n").includes("secret-key"))
})

test("runSetup is idempotent and keeps stored values on empty answers", async () => {
  const bashrcPath = await tempBashrc("# mine\n")
  const options = { bashrcPath, env: {}, out: () => {} }
  await runSetup({ ...options, ask: answers(["http://a"]), askSecret: answers(["k1"]) })
  await runSetup({ ...options, ask: answers([""]), askSecret: answers([""]) })

  const text = await readFile(bashrcPath, "utf8")
  assert.equal(text.split(BLOCK_START).length, 2)
  assert.ok(text.startsWith("# mine\n"))
  assert.deepEqual(readBlockValues(text), { url: "http://a", apiKey: "k1" })
})

test("runSetup re-prompts after invalid input and warns about conflicts", async () => {
  const bashrcPath = await tempBashrc("export BIFROST_API_KEY=old-secret\n")
  const output = []
  await runSetup({
    bashrcPath,
    env: {},
    out: (m) => output.push(m),
    ask: answers(["nope", "https://b"]),
    askSecret: answers(["k2"]),
  })

  const log = output.join("\n")
  assert.match(log, /valid http\(s\) URL/)
  assert.match(log, /outside the managed block/)
  assert.ok(!log.includes("old-secret"))
})

test("runSetup does nothing and does not prompt when both variables are set", async () => {
  const bashrcPath = await tempBashrc("# mine\n")
  const prompt = async () => assert.fail("must not prompt")
  const output = []
  const result = await runSetup({
    bashrcPath,
    env: { BIFROST_URL: "http://x", BIFROST_API_KEY: "k" },
    out: (m) => output.push(m),
    ask: prompt,
    askSecret: prompt,
  })

  assert.equal(result.changed, false)
  assert.equal(await readFile(bashrcPath, "utf8"), "# mine\n")
})

test("runSetup does not create .bashrc when nothing is missing", async () => {
  const bashrcPath = await tempBashrc()
  await runSetup({
    bashrcPath,
    env: { BIFROST_URL: "http://x", BIFROST_API_KEY: "k" },
    out: () => {},
    ask: async () => assert.fail("must not prompt"),
    askSecret: async () => assert.fail("must not prompt"),
  })
  await assert.rejects(readFile(bashrcPath, "utf8"), { code: "ENOENT" })
})

test("runSetup prompts only for the missing key and saves only that", async () => {
  const bashrcPath = await tempBashrc()
  const asked = []
  await runSetup({
    bashrcPath,
    env: { BIFROST_URL: "http://from-env" },
    out: () => {},
    ask: async () => assert.fail("must not prompt for the URL"),
    askSecret: async (q) => (asked.push(q), "new-key"),
  })

  const text = await readFile(bashrcPath, "utf8")
  assert.equal(asked.length, 1)
  assert.ok(text.includes("export BIFROST_API_KEY='new-key'"))
  assert.ok(!text.includes("BIFROST_URL"))
})

test("runSetup prompts only for the missing URL and saves only that", async () => {
  const bashrcPath = await tempBashrc()
  await runSetup({
    bashrcPath,
    env: { BIFROST_API_KEY: "from-env" },
    out: () => {},
    ask: answers(["http://new"]),
    askSecret: async () => assert.fail("must not prompt for the key"),
  })

  const text = await readFile(bashrcPath, "utf8")
  assert.ok(text.includes("export BIFROST_URL='http://new'"))
  assert.ok(!text.includes("BIFROST_API_KEY"))
  assert.ok(!text.includes("from-env"))
})

test("sourcesBashrc recognises common forms and ignores comments", () => {
  for (const line of [
    "source ~/.bashrc",
    ". ~/.bashrc",
    '. "$HOME/.bashrc"',
    "[ -f ~/.bashrc ] && . ~/.bashrc",
    'if [ -n "$BASH_VERSION" ]; then\n  if [ -f "$HOME/.bashrc" ]; then\n    . "$HOME/.bashrc"\n  fi\nfi',
    "test -r ~/.bashrc && source ~/.bashrc",
  ]) {
    assert.equal(sourcesBashrc(line), true, line)
  }
  for (const line of ["# source ~/.bashrc", "export PATH=$PATH:~/bin", "echo .bashrc", ""]) {
    assert.equal(sourcesBashrc(line), false, line)
  }
})

test("findLoginShellIssue: warns when no login file exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bifrost-login-"))
  assert.match(await findLoginShellIssue(dir), /no ~\/.bash_profile/)
})

test("findLoginShellIssue: accepts a login file that sources .bashrc", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bifrost-login-"))
  await writeFile(join(dir, ".profile"), "[ -f ~/.bashrc ] && . ~/.bashrc\n")
  assert.equal(await findLoginShellIssue(dir), undefined)
})

test("findLoginShellIssue: only the first existing login file counts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bifrost-login-"))
  await writeFile(join(dir, ".bash_profile"), "export FOO=1\n")
  await writeFile(join(dir, ".profile"), ". ~/.bashrc\n")
  const issue = await findLoginShellIssue(dir)
  assert.match(issue, /\.bash_profile instead of \.bashrc/)
  assert.match(issue, /hides \.bash_login and \.profile/)
})

test("runSetup surfaces the login-shell warning", async () => {
  const bashrcPath = await tempBashrc()
  const output = []
  const result = await runSetup({
    bashrcPath,
    env: {},
    out: (m) => output.push(m),
    ask: answers(["http://a"]),
    askSecret: answers(["k"]),
  })
  assert.ok(result.loginIssue)
  assert.match(output.join("\n"), /Login shells/)
})

test("runSetup omits the warning when login shells already load .bashrc", async () => {
  const bashrcPath = await tempBashrc()
  await writeFile(join(dirname(bashrcPath), ".bash_profile"), "source ~/.bashrc\n")
  const output = []
  await runSetup({
    bashrcPath,
    env: {},
    out: (m) => output.push(m),
    ask: answers(["http://a"]),
    askSecret: answers(["k"]),
  })
  assert.doesNotMatch(output.join("\n"), /Login shells/)
})
