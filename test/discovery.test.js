import assert from "node:assert/strict"
import test from "node:test"

import {
  bifrostApiUrl,
  bifrostMcpUrl,
  isAgenticModel,
  modelCatalogUrl,
  parseModelCatalog,
  discoverBifrostModels,
  probeBifrost,
} from "../src/discovery.js"

test("recognizes supported agentic model families", () => {
  assert.equal(isAgenticModel({ id: "anthropic/claude-sonnet-5" }), true)
  assert.equal(isAgenticModel({ id: "openai/gpt-5.6-sol" }), true)
  assert.equal(isAgenticModel({ id: "dev.meta.ai/muse-spark-1.3" }), true)
  assert.equal(isAgenticModel({ id: "accounts/fireworks/models/kimi-k3" }), true)
  assert.equal(
    isAgenticModel({ id: "gemini/gemini-3.8-flash", supported_methods: ["generateContent"] }),
    true,
  )
})

test("rejects deprecated and non-agentic models", () => {
  assert.equal(isAgenticModel({ id: "openai/gpt-5.3-chat-latest", is_deprecated: true }), false)
  assert.equal(isAgenticModel({ id: "openai/text-embedding-3-small" }), false)
  assert.equal(isAgenticModel({ id: "openai/gpt-image-2" }), false)
  assert.equal(isAgenticModel({ id: "gemini/gemini-3.8-live", supported_methods: ["generateContent"] }), false)
  assert.equal(isAgenticModel({ id: "gemini/gemini-3.8-flash", supported_methods: [] }), false)
})

test("builds OpenCode metadata for compatible models", () => {
  assert.deepEqual(
    parseModelCatalog({
      data: [
        {
          id: "openai/gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          context_length: 400_000,
          max_output_tokens: 128_000,
        },
        { id: "openai/gpt-image-2", name: "GPT Image 2" },
      ],
    }),
    {
      "openai/gpt-5.6-sol": {
        name: "GPT-5.6 Sol",
        limit: { context: 400_000, output: 128_000 },
      },
    },
  )
})

test("rejects malformed catalogs", () => {
  assert.throws(() => parseModelCatalog({}), /invalid model catalog/)
})

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const HEALTH = { components: { db_pings: "ok" }, status: "ok" }
const VK_REQUIRED = { type: "virtual_key_required", is_bifrost_error: false, status_code: 401 }

function bifrostFetch(calls = []) {
  return async (url, init = {}) => {
    calls.push({ url, init })
    const { pathname } = new URL(url)
    if (pathname === "/health") return json(200, HEALTH)
    if (pathname === "/v1/models" && !init.headers) return json(401, VK_REQUIRED)
    if (pathname === "/v1/models") return json(200, { data: [{ id: "anthropic/claude-sonnet-5" }] })
    return json(404, {})
  }
}

test("probe accepts a genuine Bifrost gateway without sending credentials", async () => {
  const calls = []
  await probeBifrost("http://10.0.0.1/v1", { fetchImpl: bifrostFetch(calls) })
  assert.deepEqual(
    calls.map((call) => call.url),
    ["http://10.0.0.1/health", "http://10.0.0.1/v1/models"],
  )
  assert.ok(calls.every((call) => !call.init.headers))
})

test("probe rejects an unreachable address", async () => {
  await assert.rejects(
    probeBifrost("http://10.0.0.1", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed")
      },
    }),
    /not reachable/,
  )
})

test("probe rejects other services answering at the same address", async () => {
  const impostors = {
    "open catalog": async (url) =>
      new URL(url).pathname === "/health" ? json(200, HEALTH) : json(200, { data: [] }),
    "wrong 401 body": async (url) =>
      new URL(url).pathname === "/health" ? json(200, HEALTH) : json(401, { error: "nope" }),
    "unrelated health": async (url) =>
      new URL(url).pathname === "/health" ? json(200, { status: "ok" }) : json(401, VK_REQUIRED),
    "html captive portal": async () =>
      new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } }),
    "redirect": async () => new Response(null, { status: 302, headers: { location: "http://evil/" } }),
  }

  for (const [name, fetchImpl] of Object.entries(impostors)) {
    await assert.rejects(
      probeBifrost("http://10.0.0.1", { fetchImpl }),
      /did not respond like Bifrost/,
      name,
    )
  }
})

test("discovery sends the API key only after the probe passes", async () => {
  const sent = []
  const impostor = async (url, init = {}) => {
    sent.push(init.headers)
    return new Response("<html></html>", { status: 200 })
  }
  await assert.rejects(
    discoverBifrostModels({ baseUrl: "http://10.0.0.1", apiKey: "secret", fetchImpl: impostor }),
  )
  assert.ok(sent.every((headers) => !headers))

  const models = await discoverBifrostModels({
    baseUrl: "http://10.0.0.1",
    apiKey: "secret",
    fetchImpl: bifrostFetch(),
  })
  assert.deepEqual(Object.keys(models), ["anthropic/claude-sonnet-5"])
})

test("normalizes Bifrost service URLs", () => {
  assert.equal(modelCatalogUrl("http://bifrost.internal"), "http://bifrost.internal/v1/models")
  assert.equal(modelCatalogUrl("http://bifrost.internal/v1"), "http://bifrost.internal/v1/models")
  assert.equal(bifrostApiUrl("http://bifrost.internal/"), "http://bifrost.internal/v1")
  assert.equal(bifrostMcpUrl("http://bifrost.internal/v1"), "http://bifrost.internal/mcp")
})
