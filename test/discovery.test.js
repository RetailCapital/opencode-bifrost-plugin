import assert from "node:assert/strict"
import test from "node:test"

import {
  bifrostApiUrl,
  bifrostMcpUrl,
  hasBifrostVpnRoute,
  isAgenticModel,
  modelCatalogUrl,
  parseModelCatalog,
  parseRouteInterface,
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

test("recognizes Linux VPN routes", async () => {
  const dnsLookup = async () => ({ address: "10.16.100.85" })
  assert.equal(parseRouteInterface("10.16.100.85 dev ppp0 src 10.20.245.3"), "ppp0")
  assert.equal(
    await hasBifrostVpnRoute(
      "bifrost.internal",
      async () => "10.16.100.85 dev ppp0 src 10.20.245.3",
      "linux",
      dnsLookup,
    ),
    true,
  )
  assert.equal(
    await hasBifrostVpnRoute(
      "bifrost.internal",
      async () => "10.16.100.85 dev wlp2s0 src 192.168.1.2",
      "linux",
      dnsLookup,
    ),
    false,
  )
})

test("normalizes Bifrost service URLs", () => {
  assert.equal(modelCatalogUrl("http://bifrost.internal"), "http://bifrost.internal/v1/models")
  assert.equal(modelCatalogUrl("http://bifrost.internal/v1"), "http://bifrost.internal/v1/models")
  assert.equal(bifrostApiUrl("http://bifrost.internal/"), "http://bifrost.internal/v1")
  assert.equal(bifrostMcpUrl("http://bifrost.internal/v1"), "http://bifrost.internal/mcp")
})
