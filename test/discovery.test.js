import assert from "node:assert/strict"
import test from "node:test"

import {
  bifrostApiUrl,
  bifrostMcpUrl,
  isAgenticModel,
  modelCatalogUrl,
  parseModelCatalog,
  toOpenCodeCost,
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

test("converts Bifrost per-token pricing to OpenCode per-million-token cost", () => {
  assert.deepEqual(
    toOpenCodeCost({
      prompt: "0.0000030000",
      completion: "0.0000150000",
      web_search: "0.0100000000",
      input_cache_read: "0.0000003000",
      input_cache_write: "0.0000037500",
    }),
    { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  )
  assert.deepEqual(
    toOpenCodeCost({ prompt: "0.0000000500", completion: "0.0000004000", input_cache_read: "0.0000000050" }),
    { input: 0.05, output: 0.4, cache_read: 0.005 },
  )
  assert.deepEqual(toOpenCodeCost({ prompt: "0", completion: "0" }), { input: 0, output: 0 })
})

test("omits cost when Bifrost pricing is missing or unusable", () => {
  assert.equal(toOpenCodeCost(undefined), undefined)
  assert.equal(toOpenCodeCost(null), undefined)
  assert.equal(toOpenCodeCost({}), undefined)
  assert.equal(toOpenCodeCost({ prompt: "0.000001" }), undefined)
  assert.equal(toOpenCodeCost({ prompt: "0.000001", completion: "" }), undefined)
  assert.equal(toOpenCodeCost({ prompt: "abc", completion: "0.000001" }), undefined)
  assert.equal(toOpenCodeCost({ prompt: "-0.000001", completion: "0.000001" }), undefined)
  // Unusable optional cache prices are dropped without discarding the model's cost.
  assert.deepEqual(
    toOpenCodeCost({ prompt: "0.000001", completion: "0.000002", input_cache_read: "n/a" }),
    { input: 1, output: 2 },
  )
})

test("includes cost in discovered model metadata", () => {
  const models = parseModelCatalog({
    data: [
      {
        id: "anthropic/claude-sonnet-5",
        name: "Claude Sonnet 5",
        pricing: { prompt: "0.0000020000", completion: "0.0000100000", input_cache_read: "0.0000002000" },
      },
      { id: "anthropic/claude-opus-5", name: "No pricing" },
    ],
  })
  assert.deepEqual(models["anthropic/claude-sonnet-5"].cost, { input: 2, output: 10, cache_read: 0.2 })
  assert.equal("cost" in models["anthropic/claude-opus-5"], false)
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
