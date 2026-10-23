import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

import { createBifrostPlugin, mergeMemento, mergeProvider } from "../src/plugin.js"

function clientWithLogs(logs) {
  return {
    app: {
      log: async ({ body }) => logs.push(body),
    },
  }
}

test("injects provider and Memento configuration after successful discovery", async () => {
  const logs = []
  const plugin = createBifrostPlugin({
    env: {
      BIFROST_URL: "http://bifrost.internal",
      BIFROST_API_KEY: "test-key",
    },
    discover: async () => ({
      "openai/gpt-5.6-sol": { name: "GPT-5.6 Sol" },
    }),
  })
  const hooks = await plugin({ client: clientWithLogs(logs) })
  const config = {}

  await hooks.config(config)

  assert.deepEqual(config.provider.bifrost, {
    npm: "@ai-sdk/openai-compatible",
    api: "http://bifrost.internal/v1",
    name: "Bifrost",
    options: { apiKey: "test-key" },
    models: { "openai/gpt-5.6-sol": { name: "GPT-5.6 Sol" } },
  })
  assert.deepEqual(config.mcp.memento_memory, {
    type: "remote",
    url: "http://bifrost.internal/mcp",
    oauth: false,
    headers: { "x-bf-vk": "test-key" },
  })
  assert.equal(logs.at(-1).level, "info")
})

test("registers the bundled skills directory only when setup runs", async () => {
  const withEnv = createBifrostPlugin({
    env: { BIFROST_URL: "http://bifrost.internal", BIFROST_API_KEY: "test-key" },
    discover: async () => ({}),
  })
  const config = {}
  await (await withEnv({ client: clientWithLogs([]) })).config(config)

  // Object form: the only shape OpenCode <= 1.19 accepts.
  assert.equal(config.skills.paths.length, 1)
  const skill = await readFile(join(config.skills.paths[0], "bifrost-usage", "SKILL.md"), "utf8")
  assert.match(skill, /^name: bifrost-usage$/m)

  const withoutEnv = createBifrostPlugin({ env: {}, discover: async () => ({}) })
  const skipped = {}
  await (await withoutEnv({ client: clientWithLogs([]) })).config(skipped)
  assert.equal(skipped.skills, undefined)
})

test("appends to existing skills config in either supported form", async () => {
  const plugin = createBifrostPlugin({
    env: { BIFROST_URL: "http://bifrost.internal", BIFROST_API_KEY: "test-key" },
    discover: async () => ({}),
  })

  // Array form is only extended when already present (i.e. the running
  // OpenCode accepted it); the plugin never introduces it.
  const listForm = { skills: ["/some/other/skills"] }
  await (await plugin({ client: clientWithLogs([]) })).config(listForm)
  assert.equal(listForm.skills.length, 2)

  const objectForm = { skills: { paths: ["/some/other/skills"] } }
  await (await plugin({ client: clientWithLogs([]) })).config(objectForm)
  assert.equal(objectForm.skills.paths.length, 2)

  const urlsOnly = { skills: { urls: ["https://example.com/skills/"] } }
  await (await plugin({ client: clientWithLogs([]) })).config(urlsOnly)
  assert.equal(urlsOnly.skills.paths.length, 1)
  assert.equal(urlsOnly.skills.urls.length, 1)
})

test("preserves explicit model, provider, and disabled MCP settings", async () => {
  const plugin = createBifrostPlugin({
    env: {
      BIFROST_URL: "http://bifrost.internal",
      BIFROST_API_KEY: "test-key",
    },
    discover: async () => ({
      "openai/gpt-5.6-sol": { name: "Discovered name" },
      "openai/gpt-6-sol": { name: "GPT-6 Sol" },
    }),
  })
  const hooks = await plugin({ client: clientWithLogs([]) })
  const config = {
    provider: {
      bifrost: {
        name: "Company Bifrost",
        options: { timeout: 60_000 },
        models: {
          "openai/gpt-5.6-sol": { name: "Configured name", reasoning: true },
        },
      },
    },
    mcp: {
      memento_memory: { enabled: false },
    },
  }

  await hooks.config(config)

  assert.equal(config.provider.bifrost.name, "Company Bifrost")
  assert.deepEqual(config.provider.bifrost.options, {
    apiKey: "test-key",
    timeout: 60_000,
  })
  assert.deepEqual(config.provider.bifrost.models["openai/gpt-5.6-sol"], {
    name: "Configured name",
    reasoning: true,
  })
  assert.equal(config.provider.bifrost.models["openai/gpt-6-sol"].name, "GPT-6 Sol")
  assert.equal(config.mcp.memento_memory.enabled, false)
})

test("does not mutate configuration when discovery fails", async () => {
  const logs = []
  const plugin = createBifrostPlugin({
    env: {
      BIFROST_URL: "http://bifrost.internal",
      BIFROST_API_KEY: "test-key",
    },
    discover: async () => {
      throw new Error("Bifrost is not reachable")
    },
  })
  const hooks = await plugin({ client: clientWithLogs(logs) })
  const config = { provider: { existing: { name: "Existing" } } }

  await hooks.config(config)

  assert.deepEqual(config, { provider: { existing: { name: "Existing" } } })
  assert.equal(logs.length, 1)
  assert.equal(logs[0].level, "warn")
  assert.match(logs[0].message, /not reachable/)
})

test("does not expose credentials in logs", async () => {
  const logs = []
  const plugin = createBifrostPlugin({ env: {} })
  const hooks = await plugin({ client: clientWithLogs(logs) })

  await hooks.config({})

  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs[0].message, /key|token/i)
})

test("merge helpers preserve explicit overrides", () => {
  assert.equal(
    mergeProvider(
      "http://bifrost.internal",
      "default-key",
      { discovered: { name: "Discovered" } },
      { api: "http://custom/v1", models: { explicit: { name: "Explicit" } } },
    ).api,
    "http://custom/v1",
  )
  assert.deepEqual(
    mergeMemento("http://bifrost.internal", "default-key", {
      headers: { "x-bf-vk": "override-key" },
    }).headers,
    { "x-bf-vk": "override-key" },
  )
})
