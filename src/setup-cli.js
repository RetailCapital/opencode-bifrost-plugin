#!/usr/bin/env node
import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { defaultConfigDir, pluginSpecFor } from "./opencode-config.js"
import { runSetup } from "./setup.js"

const entryPath = fileURLToPath(new URL("./index.js", import.meta.url))
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

if (!process.stdin.isTTY) {
  console.error("Setup is interactive and needs a terminal.")
  process.exit(1)
}

let muted = false
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk)
    callback()
  },
})
const rl = createInterface({ input: process.stdin, output, terminal: true })

try {
  await runSetup({
    opencode: { configDir: defaultConfigDir(), spec: pluginSpecFor(entryPath, manifest) },
    ask: (question) => rl.question(question),
    askSecret: async (question) => {
      process.stdout.write(question)
      muted = true
      try {
        return await rl.question("")
      } finally {
        muted = false
        process.stdout.write("\n")
      }
    },
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  rl.close()
}
