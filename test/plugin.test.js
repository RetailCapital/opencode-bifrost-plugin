import assert from "node:assert/strict"
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
      throw new Error("Bifrost is not routed through an active VPN interface")
    },
  })
  const hooks = await plugin({ client: clientWithLogs(logs) })
  const config = { provider: { existing: { name: "Existing" } } }

  await hooks.config(config)

  assert.deepEqual(config, { provider: { existing: { name: "Existing" } } })
  assert.equal(logs.length, 1)
  assert.equal(logs[0].level, "warn")
  assert.match(logs[0].message, /VPN interface/)
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
