import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { registerPlugin } from "./opencode-config.js"

export const BLOCK_START = "# >>> bifrost-opencode-plugin >>>"
export const BLOCK_END = "# <<< bifrost-opencode-plugin <<<"

const EXPORT_LINE = /^\s*export\s+BIFROST_(?:URL|API_KEY)=/

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

export function renderBlock({ url, apiKey }) {
  return [
    BLOCK_START,
    "# Managed by the Bifrost OpenCode plugin setup. Re-run the setup to change.",
    ...(url ? [`export BIFROST_URL=${shellQuote(url)}`] : []),
    ...(apiKey ? [`export BIFROST_API_KEY=${shellQuote(apiKey)}`] : []),
    BLOCK_END,
  ].join("\n")
}

export function validateUrl(value) {
  const url = String(value ?? "").trim()
  if (!url) return { error: "The Bifrost URL is required" }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { error: "The Bifrost URL must be a valid http(s) URL" }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "The Bifrost URL must start with http:// or https://" }
  }
  return { value: url }
}

export function validateApiKey(value) {
  const key = String(value ?? "").trim()
  if (!key) return { error: "The Bifrost API key is required" }
  if (/\s/.test(key)) return { error: "The Bifrost API key must not contain whitespace" }
  return { value: key }
}

function findBlock(text) {
  const start = text.indexOf(BLOCK_START)
  if (start === -1) return undefined
  const endMarker = text.indexOf(BLOCK_END, start)
  if (endMarker === -1) return undefined
  return { start, end: endMarker + BLOCK_END.length }
}

/** Replace the managed block in place, or append it when absent. */
export function upsertBlock(text, block) {
  const found = findBlock(text)
  if (found) return text.slice(0, found.start) + block + text.slice(found.end)
  const separator = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n"
  return `${text}${separator}${block}\n`
}

/** Read the values stored in the managed block, if any. */
export function readBlockValues(text) {
  const found = findBlock(text)
  if (!found) return {}
  const body = text.slice(found.start, found.end)
  return {
    url: unquote(body.match(/^export BIFROST_URL=(.*)$/m)?.[1]),
    apiKey: unquote(body.match(/^export BIFROST_API_KEY=(.*)$/m)?.[1]),
  }
}

function unquote(raw) {
  if (raw === undefined) return undefined
  return raw.replaceAll(`'\\''`, "'").replace(/^'/, "").replace(/'$/, "")
}

/** Exports of the same variables outside the managed block would fight with it. */
export function findConflictingLines(text) {
  const found = findBlock(text)
  const outside = found ? text.slice(0, found.start) + text.slice(found.end) : text
  return outside.split("\n").filter((line) => EXPORT_LINE.test(line) && !line.trimStart().startsWith("#"))
}

const LOGIN_FILES = [".bash_profile", ".bash_login", ".profile"]
const SOURCES_BASHRC = /(?:^|[\s;&|(])(?:source|\.)\s+["']?(?:~|\$HOME|\$\{HOME\}|[^\s"']*)\/?\.bashrc\b/

/** True when a login-shell startup file loads ~/.bashrc (ignoring comments). */
export function sourcesBashrc(text) {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .some((line) => SOURCES_BASHRC.test(line))
}

/**
 * Bash login shells skip ~/.bashrc and read only the first existing of
 * ~/.bash_profile, ~/.bash_login, ~/.profile. Returns a warning when that file
 * (or the absence of all of them) means login shells will not see the exports.
 */
export async function findLoginShellIssue(homeDir) {
  for (const name of LOGIN_FILES) {
    let text
    try {
      text = await readFile(join(homeDir, name), "utf8")
    } catch (error) {
      if (error?.code === "ENOENT") continue
      throw error
    }
    if (sourcesBashrc(text)) return undefined
    const shadowed = LOGIN_FILES.slice(LOGIN_FILES.indexOf(name) + 1)
    return (
      `Login shells (SSH, some terminals, macOS Terminal) read ${join(homeDir, name)} instead of .bashrc, ` +
      "and it does not source ~/.bashrc, so they will not see these variables. Add this to it" +
      (shadowed.length > 0 ? ` (it also hides ${shadowed.join(" and ")} from bash)` : "") +
      ':\n  [ -f ~/.bashrc ] && . ~/.bashrc'
    )
  }
  return (
    "Login shells (SSH, some terminals, macOS Terminal) skip ~/.bashrc, and no ~/.bash_profile, " +
    "~/.bash_login or ~/.profile exists, so they will not see these variables. Create ~/.bash_profile containing:\n" +
    "  [ -f ~/.bashrc ] && . ~/.bashrc"
  )
}

/**
 * Saves the Bifrost environment variables and, when `opencode` is given
 * ({ configDir, spec }), registers the plugin in the global OpenCode config.
 */
export async function runSetup({ opencode, ...options }) {
  const result = await setupEnvironment(options)
  if (opencode) result.plugin = await setupPlugin({ ...opencode, ask: options.ask, out: options.out })
  return result
}

async function setupPlugin({ configDir, spec, ask, out = (message) => console.log(message) }) {
  const result = await registerPlugin({
    configDir,
    spec,
    confirm: async (path) => {
      const answer = (await ask(`Add the plugin to ${path}? [Y/n]: `)).trim().toLowerCase()
      return answer === "" || answer === "y" || answer === "yes"
    },
  })

  if (result.status === "present") out(`The plugin is already registered in ${result.path}.`)
  else if (result.status === "added") out(`Added ${spec} to ${result.path}. Restart OpenCode to load it.`)
  else if (result.status === "declined") out("Skipped registering the plugin with OpenCode.")
  else {
    out(`Could not edit ${result.path} (${result.reason}). Add this to its "plugin" array yourself:`)
    out(`  ${JSON.stringify(spec)}`)
  }
  return result
}

async function setupEnvironment({
  ask,
  askSecret,
  out = (message) => console.log(message),
  bashrcPath = join(homedir(), ".bashrc"),
  env = process.env,
}) {
  let existing = ""
  try {
    existing = await readFile(bashrcPath, "utf8")
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }

  const stored = readBlockValues(existing)
  const present = {
    url: Boolean(env.BIFROST_URL?.trim()),
    apiKey: Boolean(env.BIFROST_API_KEY?.trim()),
  }

  if (present.url && present.apiKey) {
    out("BIFROST_URL and BIFROST_API_KEY are already set in the environment. Nothing to do.")
    return { changed: false, bashrcPath }
  }

  const values = { url: stored.url, apiKey: stored.apiKey }
  if (present.url) out("BIFROST_URL is already set in the environment; skipping.")
  else {
    const fallback = stored.url || ""
    values.url = await promptUntilValid(
      () => ask(fallback ? `Bifrost URL [${fallback}]: ` : "Bifrost URL: "),
      validateUrl,
      fallback,
      out,
    )
  }

  if (present.apiKey) out("BIFROST_API_KEY is already set in the environment; skipping.")
  else {
    const fallback = stored.apiKey || ""
    values.apiKey = await promptUntilValid(
      () =>
        askSecret(
          fallback ? "Bifrost API key [press Enter to keep the saved key]: " : "Bifrost API key: ",
        ),
      validateApiKey,
      fallback,
      out,
    )
  }

  // Persist only what was prompted for; keep other saved block values untouched.
  const toWrite = {
    url: present.url ? stored.url : values.url,
    apiKey: present.apiKey ? stored.apiKey : values.apiKey,
  }
  const conflicts = findConflictingLines(existing).filter(
    (line) =>
      (!present.url && /BIFROST_URL=/.test(line)) ||
      (!present.apiKey && /BIFROST_API_KEY=/.test(line)),
  )
  await writeFile(bashrcPath, upsertBlock(existing, renderBlock(toWrite)), { mode: 0o600 })

  const saved = [!present.url && "BIFROST_URL", !present.apiKey && "BIFROST_API_KEY"].filter(Boolean)
  out(`Saved ${saved.join(" and ")} to ${bashrcPath}`)
  if (conflicts.length > 0) {
    out(
      `Warning: ${bashrcPath} also exports these variables outside the managed block. ` +
        "Later lines take precedence, so remove the duplicates:",
    )
    for (const line of conflicts) out(`  ${line.replace(/(BIFROST_API_KEY=).*/, "$1<redacted>")}`)
  }
  const loginIssue = await findLoginShellIssue(dirname(bashrcPath))
  if (loginIssue) out(`Warning: ${loginIssue}`)
  out(`Open a new shell or run: source ${bashrcPath}`)
  return { changed: true, saved, bashrcPath, conflicts, loginIssue }
}

async function promptUntilValid(read, validate, fallback, out) {
  for (;;) {
    const answer = (await read()).trim() || fallback
    const result = validate(answer)
    if (result.value !== undefined) return result.value
    out(result.error)
  }
}
