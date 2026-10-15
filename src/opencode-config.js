import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const PACKAGE_NAME = "@retailcapital/bifrost-opencode-plugin"

const CONFIG_NAMES = ["opencode.jsonc", "opencode.json"]
const NEW_CONFIG = (spec) =>
  `{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": [${JSON.stringify(spec)}]\n}\n`

export function defaultConfigDir(env = process.env, home = homedir()) {
  return join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "opencode")
}

/**
 * From a published install (npx or node_modules) OpenCode must fetch the
 * package itself, so register the package spec. From a checkout, register the
 * checkout's entry point.
 */
export function pluginSpecFor(entryPath, pkg) {
  return entryPath.includes(`${sep}node_modules${sep}`)
    ? `${pkg.name}@${pkg.version}`
    : pathToFileURL(entryPath).href
}

// --- Minimal JSONC reading (comments and trailing commas), dependency-free ---

export function tokenize(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i)
      i = newline === -1 ? text.length : newline + 1
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2)
      if (close === -1) throw new Error("unterminated comment")
      i = close + 2
    } else if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1
      if (j >= text.length) throw new Error("unterminated string")
      tokens.push({ type: "string", start: i, end: j + 1, value: JSON.parse(text.slice(i, j + 1)) })
      i = j + 1
    } else if ("{}[]:,".includes(c)) {
      tokens.push({ type: "punct", start: i, end: i + 1, value: c })
      i++
    } else {
      let j = i
      while (
        j < text.length &&
        !/[\s{}[\]:,"]/.test(text[j]) &&
        !(text[j] === "/" && (text[j + 1] === "/" || text[j + 1] === "*"))
      ) {
        j++
      }
      tokens.push({ type: "literal", start: i, end: j })
      i = j
    }
  }
  return tokens
}

const isPunct = (token, ...values) => token?.type === "punct" && values.includes(token.value)

/** Parse tokens as strict JSON (dropping trailing commas) to prove the file is valid. */
function parseTokens(tokens, text) {
  const parts = []
  tokens.forEach((token, index) => {
    if (isPunct(token, ",") && isPunct(tokens[index + 1], "]", "}")) return
    parts.push(text.slice(token.start, token.end))
  })
  return JSON.parse(parts.join(""))
}

function readPluginArray(tokens, open) {
  if (!isPunct(tokens[open], "[")) return { valid: false }
  const names = []
  let first
  let depth = 0
  for (let k = open; k < tokens.length; k++) {
    const token = tokens[k]
    if (isPunct(token, "[", "{")) {
      if (depth === 1) {
        first ??= token
        if (token.value === "[" && tokens[k + 1]?.type === "string") names.push(tokens[k + 1].value)
      }
      depth++
    } else if (isPunct(token, "]", "}")) {
      depth--
      if (depth === 0) return { valid: true, open: tokens[open], first, names }
    } else if (depth === 1 && token.type === "string") {
      first ??= token
      names.push(token.value)
    }
  }
  return { valid: false }
}

export function analyzeConfig(text) {
  const tokens = tokenize(text)
  const document = tokens.length > 0 ? parseTokens(tokens, text) : undefined
  if (!isPunct(tokens[0], "{") || document === null || typeof document !== "object") {
    throw new Error("the file is not a JSON object")
  }

  let depth = 0
  let firstKey
  let plugin
  tokens.forEach((token, k) => {
    if (isPunct(token, "{", "[")) depth++
    else if (isPunct(token, "}", "]")) depth--
    else if (
      depth === 1 &&
      token.type === "string" &&
      isPunct(tokens[k + 1], ":") &&
      isPunct(tokens[k - 1], "{", ",")
    ) {
      firstKey ??= token
      if (token.value === "plugin") plugin = readPluginArray(tokens, k + 2)
    }
  })

  return { rootOpen: tokens[0], firstKey, plugin }
}

function lineIndent(text, position) {
  const prefix = text.slice(text.lastIndexOf("\n", position - 1) + 1, position)
  return /^[ \t]*$/.test(prefix) ? prefix : undefined
}

/** Insert the spec into the "plugin" array, creating it when absent. Comments and layout are kept. */
export function addPluginEntry(text, spec) {
  const entry = JSON.stringify(spec)
  const { rootOpen, firstKey, plugin } = analyzeConfig(text)
  let result

  if (plugin === undefined) {
    const indent = (firstKey && lineIndent(text, firstKey.start)) ?? "  "
    const rest = text.slice(rootOpen.end)
    const tail = firstKey ? "," : /^[ \t]*}/.test(rest) ? "\n" : ""
    result = `${text.slice(0, rootOpen.end)}\n${indent}"plugin": [${entry}]${tail}${rest}`
  } else if (!plugin.valid) {
    throw new Error('the "plugin" setting is not an array')
  } else if (!plugin.first) {
    result = text.slice(0, plugin.open.end) + entry + text.slice(plugin.open.end)
  } else {
    const between = text.slice(plugin.open.end, plugin.first.start)
    const indent = between.includes("\n") ? lineIndent(text, plugin.first.start) ?? "    " : undefined
    const separator = indent === undefined ? ", " : `,\n${indent}`
    result = text.slice(0, plugin.first.start) + entry + separator + text.slice(plugin.first.start)
  }

  const check = analyzeConfig(result)
  if (!check.plugin?.valid || !check.plugin.names.includes(spec)) {
    throw new Error("the edit could not be verified")
  }
  return result
}

// --- Registration ---

async function isThisPlugin(name, spec) {
  if (name === spec) return true
  if (name === PACKAGE_NAME || name.startsWith(`${PACKAGE_NAME}@`)) return true
  if (!name.startsWith("file:")) return false
  try {
    const entry = resolve(fileURLToPath(name))
    if (spec.startsWith("file:") && entry === resolve(fileURLToPath(spec))) return true
    const manifest = JSON.parse(await readFile(join(dirname(entry), "..", "package.json"), "utf8"))
    return manifest.name === PACKAGE_NAME
  } catch {
    return false
  }
}

async function readConfigFiles(configDir) {
  const files = []
  for (const name of CONFIG_NAMES) {
    const path = join(configDir, name)
    try {
      files.push({ path, text: await readFile(path, "utf8") })
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
  return files
}

/** Replace a file without risking a half-written config, following symlinks (dotfile managers). */
async function writeAtomic(path, text) {
  let target = path
  let mode
  try {
    target = await realpath(path)
    mode = (await stat(target)).mode & 0o777
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, text, mode === undefined ? undefined : { mode })
  await rename(temporary, target)
}

/**
 * Add the plugin to the global OpenCode config unless it is already registered.
 * Resolves to { status, path, ... } where status is added | present | declined | manual.
 */
export async function registerPlugin({ configDir, spec, confirm }) {
  const files = await readConfigFiles(configDir)
  const target = files[0]?.path ?? join(configDir, "opencode.json")

  for (const file of files) {
    let info
    try {
      info = analyzeConfig(file.text)
    } catch (error) {
      return { status: "manual", path: file.path, reason: error.message }
    }
    for (const name of info.plugin?.valid ? info.plugin.names : []) {
      if (await isThisPlugin(name, spec)) return { status: "present", path: file.path, name }
    }
  }

  if (!(await confirm(target))) return { status: "declined", path: target }

  try {
    await writeAtomic(target, files.length > 0 ? addPluginEntry(files[0].text, spec) : NEW_CONFIG(spec))
  } catch (error) {
    return { status: "manual", path: target, reason: error.message }
  }
  return { status: "added", path: target }
}
