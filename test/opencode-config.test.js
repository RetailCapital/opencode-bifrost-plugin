import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  addPluginEntry,
  analyzeConfig,
  defaultConfigDir,
  pluginSpecFor,
  registerPlugin,
} from "../src/opencode-config.js"
import { runSetup } from "../src/setup.js"

const SPEC = "file:///home/me/bifrost/src/index.js"
// String-aware JSONC reader, independent of the code under test.
function strip(text) {
  const plain = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ""))
  return JSON.parse(plain.replace(/,(\s*[}\]])/g, "$1"))
}
const tempDir = () => mkdtemp(join(tmpdir(), "bifrost-config-"))

test("adds to an existing plugin array, keeping comments and layout", () => {
  const text = `{
  // my settings
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    // keep me
    "other-plugin@1.0.0", /* inline */
    ["tuple-plugin", { "a": 1 }]
  ],
  "model": "x" // trailing
}
`
  const result = addPluginEntry(text, SPEC)
  assert.ok(result.includes("// my settings") && result.includes("// keep me") && result.includes("/* inline */"))
  assert.ok(result.includes("// trailing"))
  assert.deepEqual(strip(result).plugin, [SPEC, "other-plugin@1.0.0", ["tuple-plugin", { a: 1 }]])
  assert.equal(strip(result).model, "x")
})

test("adds to an empty or single-line plugin array", () => {
  assert.deepEqual(strip(addPluginEntry('{ "plugin": [] }', SPEC)).plugin, [SPEC])
  assert.deepEqual(strip(addPluginEntry('{ "plugin": [ ] }', SPEC)).plugin, [SPEC])
  assert.deepEqual(strip(addPluginEntry('{ "plugin": ["a", "b"] }', SPEC)).plugin, [SPEC, "a", "b"])
})

test("creates the plugin key when absent, with or without other keys", () => {
  const withKeys = addPluginEntry('{\n  "model": "x",\n  "disabled_providers": ["a"]\n}\n', SPEC)
  assert.deepEqual(strip(withKeys), { plugin: [SPEC], model: "x", disabled_providers: ["a"] })
  assert.deepEqual(strip(addPluginEntry("{}", SPEC)), { plugin: [SPEC] })
  assert.deepEqual(strip(addPluginEntry("{\n}\n", SPEC)), { plugin: [SPEC] })
  assert.deepEqual(strip(addPluginEntry('// only a comment\n{\n  // nothing yet\n}\n', SPEC)), { plugin: [SPEC] })
})

test("is not fooled by plugin-like text in strings, comments, or nested objects", () => {
  const text = `{
  // "plugin": ["decoy"]
  "note": "\\"plugin\\": [",
  "provider": { "plugin": ["nested"] },
  "plugin": ["real"]
}`
  const result = addPluginEntry(text, SPEC)
  const parsed = strip(result.replace(/.*decoy.*\n/, ""))
  assert.deepEqual(parsed.plugin, [SPEC, "real"])
  assert.deepEqual(parsed.provider, { plugin: ["nested"] })
})

test("handles trailing commas and tabs", () => {
  const result = addPluginEntry('{\n\t"plugin": [\n\t\t"a",\n\t],\n}\n', SPEC)
  assert.deepEqual(strip(result).plugin, [SPEC, "a"])
  assert.ok(result.includes('\n\t\t"file:'))
})

test("rejects files it cannot safely edit", () => {
  assert.throws(() => addPluginEntry("[]", SPEC), /not a JSON object/)
  assert.throws(() => addPluginEntry("", SPEC), /not a JSON object/)
  assert.throws(() => addPluginEntry('{ "plugin": "x" }', SPEC), /not an array/)
  assert.throws(() => addPluginEntry('{ "plugin": [ }', SPEC))
  assert.throws(() => analyzeConfig('{ "a": 1 '))
})

test("defaultConfigDir honors XDG_CONFIG_HOME", () => {
  assert.equal(defaultConfigDir({}, "/home/u"), "/home/u/.config/opencode")
  assert.equal(defaultConfigDir({ XDG_CONFIG_HOME: "/x" }, "/home/u"), "/x/opencode")
})

test("pluginSpecFor uses the package spec when installed, a file URL from a checkout", () => {
  const pkg = { name: "@retailcapital/bifrost-opencode-plugin", version: "1.2.3" }
  assert.equal(
    pluginSpecFor("/h/.npm/_npx/abc/node_modules/@retailcapital/bifrost-opencode-plugin/src/index.js", pkg),
    "@retailcapital/bifrost-opencode-plugin@1.2.3",
  )
  assert.equal(pluginSpecFor("/h/work/plugin/src/index.js", pkg), "file:///h/work/plugin/src/index.js")
})

test("creates a config when none exists, after confirmation", async () => {
  const configDir = join(await tempDir(), "nested", "opencode")
  const result = await registerPlugin({ configDir, spec: SPEC, confirm: async () => true })
  assert.equal(result.status, "added")
  assert.deepEqual(JSON.parse(await readFile(join(configDir, "opencode.json"), "utf8")).plugin, [SPEC])
})

test("prefers opencode.jsonc and preserves its mode and symlink", async () => {
  const dir = await tempDir()
  const real = join(dir, "dotfiles-opencode.jsonc")
  await writeFile(real, '{\n  // hi\n  "model": "x"\n}\n', { mode: 0o640 })
  const configDir = join(dir, "cfg")
  await mkdir(configDir)
  await writeFile(join(configDir, "opencode.json"), "{}")
  await symlink(real, join(configDir, "opencode.jsonc"))

  const result = await registerPlugin({ configDir, spec: SPEC, confirm: async () => true })
  assert.equal(result.status, "added")
  assert.equal(result.path, join(configDir, "opencode.jsonc"))
  assert.ok((await readFile(real, "utf8")).includes("// hi"))
  assert.deepEqual(strip(await readFile(real, "utf8")).plugin, [SPEC])
  assert.equal((await stat(real)).mode & 0o777, 0o640)
  assert.equal(await readFile(join(configDir, "opencode.json"), "utf8"), "{}")
})

test("does nothing when already registered in any form, and does not prompt", async () => {
  const forms = [
    `["${SPEC}"]`,
    '["@retailcapital/bifrost-opencode-plugin@0.1.1"]',
    '["@retailcapital/bifrost-opencode-plugin"]',
    '[["@retailcapital/bifrost-opencode-plugin@0.0.9", { "timeoutMs": 1 }]]',
  ]
  for (const form of forms) {
    const configDir = await tempDir()
    const text = `{ "plugin": ${form} }`
    await writeFile(join(configDir, "opencode.json"), text)
    const result = await registerPlugin({
      configDir,
      spec: SPEC,
      confirm: async () => assert.fail("must not prompt"),
    })
    assert.equal(result.status, "present", form)
    assert.equal(await readFile(join(configDir, "opencode.json"), "utf8"), text)
  }
})

test("recognizes another checkout of this plugin by its package name", async () => {
  const dir = await tempDir()
  await mkdir(join(dir, "other", "src"), { recursive: true })
  await writeFile(
    join(dir, "other", "package.json"),
    JSON.stringify({ name: "@retailcapital/bifrost-opencode-plugin" }),
  )
  const configDir = join(dir, "cfg")
  await mkdir(configDir)
  await writeFile(
    join(configDir, "opencode.jsonc"),
    `{ "plugin": ["file://${join(dir, "other", "src", "index.js")}"] }`,
  )
  const result = await registerPlugin({
    configDir,
    spec: SPEC,
    confirm: async () => assert.fail("must not prompt"),
  })
  assert.equal(result.status, "present")
})

test("declining leaves the config untouched", async () => {
  const configDir = await tempDir()
  await writeFile(join(configDir, "opencode.json"), "{}")
  const result = await registerPlugin({ configDir, spec: SPEC, confirm: async () => false })
  assert.equal(result.status, "declined")
  assert.equal(await readFile(join(configDir, "opencode.json"), "utf8"), "{}")
})

test("falls back to manual instructions for unparsable configs, leaving them untouched", async () => {
  const configDir = await tempDir()
  const text = '{ "plugin": [ '
  await writeFile(join(configDir, "opencode.jsonc"), text)
  const result = await registerPlugin({
    configDir,
    spec: SPEC,
    confirm: async () => assert.fail("must not prompt"),
  })
  assert.equal(result.status, "manual")
  assert.equal(await readFile(join(configDir, "opencode.jsonc"), "utf8"), text)
})

test("runSetup registers the plugin even when the env vars are already set", async () => {
  const dir = await tempDir()
  const configDir = join(dir, "cfg")
  const output = []
  const result = await runSetup({
    bashrcPath: join(dir, ".bashrc"),
    env: { BIFROST_URL: "http://x", BIFROST_API_KEY: "k" },
    out: (m) => output.push(m),
    ask: async (question) => (assert.match(question, /Add the plugin/), ""),
    askSecret: async () => assert.fail("must not prompt"),
    opencode: { configDir, spec: SPEC },
  })
  assert.equal(result.changed, false)
  assert.equal(result.plugin.status, "added")
  assert.deepEqual(JSON.parse(await readFile(join(configDir, "opencode.json"), "utf8")).plugin, [SPEC])
  assert.match(output.join("\n"), /Restart OpenCode/)
})

test("runSetup never touches OpenCode config unless asked to", async () => {
  const dir = await tempDir()
  const result = await runSetup({
    bashrcPath: join(dir, ".bashrc"),
    env: { BIFROST_URL: "http://x", BIFROST_API_KEY: "k" },
    out: () => {},
    ask: async () => assert.fail("must not prompt"),
    askSecret: async () => assert.fail("must not prompt"),
  })
  assert.equal(result.plugin, undefined)
})
