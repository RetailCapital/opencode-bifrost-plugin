#!/usr/bin/env node
import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"

import { runSetup } from "./setup.js"

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
