const EXCLUDED_CAPABILITIES =
  /image|audio|tts|live|transcribe|embedding|robotics|lyria|veo|nano-banana|computer-use|aqa|deep-research|antigravity|omni|realtime|search|moderation|sora|whisper|instruct/i
const OPENAI_AGENTIC_MODEL =
  /^openai\/(?:chat-latest|gpt-3\.5-turbo(?:$|-)|gpt-4(?:$|-|\.)|gpt-4o(?:$|-)|gpt-5(?:$|-|\.)|gpt-6(?:$|-|\.)|o1(?:$|-)|o3(?:$|-)|o4(?:$|-))/
const FIREWORKS_AGENTIC_MODEL =
  /^accounts\/fireworks\/models\/(?:deepseek|glm|kimi|llama|mixtral|qwen)/i
const PROBE_TIMEOUT_MS = 3_000

export function isAgenticModel(model) {
  if (!model || typeof model.id !== "string" || model.is_deprecated === true) return false

  const id = model.id
  if (EXCLUDED_CAPABILITIES.test(id)) return false
  if (id.startsWith("anthropic/")) return true
  if (/^dev\.meta\.ai\/muse-spark-/i.test(id)) return true
  if (FIREWORKS_AGENTIC_MODEL.test(id)) return true
  if (OPENAI_AGENTIC_MODEL.test(id)) return true

  return (
    id.startsWith("gemini/") &&
    Array.isArray(model.supported_methods) &&
    model.supported_methods.includes("generateContent")
  )
}

export function toOpenCodeModel(model) {
  const discovered = {
    name: model.name || model.normalized_name || model.id,
  }
  const context = positiveNumber(model.context_length) || positiveNumber(model.max_input_tokens)
  const output = positiveNumber(model.max_output_tokens)

  if (context && output) discovered.limit = { context, output }

  const cost = toOpenCodeCost(model.pricing)
  if (cost) discovered.cost = cost
  return discovered
}

// Bifrost reports USD per token as decimal strings (e.g. "0.0000030000").
// OpenCode wants USD per million tokens as numbers, and requires both input
// and output, so models without a usable prompt/completion price get no cost
// rather than a misleading partial one. Cache prices are optional.
//
// OpenCode 1.19 keeps the flat `cache_read`/`cache_write` keys but silently
// drops the nested `cache: { read, write }` form, so the flat form is used.
// Bifrost has no per-request fees or context tiers that OpenCode can model
// (web_search, image), so those are intentionally not mapped.
export function toOpenCodeCost(pricing) {
  if (!pricing || typeof pricing !== "object") return undefined

  const input = perMillionTokens(pricing.prompt)
  const output = perMillionTokens(pricing.completion)
  if (input === undefined || output === undefined) return undefined

  const cost = { input, output }
  const cacheRead = perMillionTokens(pricing.input_cache_read)
  const cacheWrite = perMillionTokens(pricing.input_cache_write)
  if (cacheRead !== undefined) cost.cache_read = cacheRead
  if (cacheWrite !== undefined) cost.cache_write = cacheWrite
  return cost
}

function perMillionTokens(value) {
  const perToken = typeof value === "string" ? Number(value.trim() === "" ? NaN : value) : value
  if (typeof perToken !== "number" || !Number.isFinite(perToken) || perToken < 0) return undefined
  // toPrecision removes binary noise such as 3.0000000000000004.
  return Number((perToken * 1_000_000).toPrecision(12))
}

export function parseModelCatalog(payload) {
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Bifrost returned an invalid model catalog")
  }

  return Object.fromEntries(
    payload.data
      .filter(isAgenticModel)
      .map((model) => [model.id, toOpenCodeModel(model)]),
  )
}

export function bifrostRootUrl(baseUrl, path) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/(?:v1)?\/?$/, "")}${path}`.replace(/^\/\//, "/")
  url.search = ""
  url.hash = ""
  return url.toString()
}

// Unauthenticated fingerprint of a real Bifrost gateway. No credentials are
// sent, so a different service answering at the same address learns nothing.
// Both checks must pass: /health reports Bifrost's status document, and the
// model catalog refuses anonymous callers with Bifrost's virtual-key error.
export async function probeBifrost(baseUrl, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const get = async (url) => {
    try {
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      })
      return { response, body: await response.json().catch(() => undefined) }
    } catch {
      throw new Error("Bifrost is not reachable")
    }
  }

  const health = await get(bifrostRootUrl(baseUrl, "/health"))
  const healthy =
    health.response.ok &&
    health.body?.status === "ok" &&
    typeof health.body.components === "object" &&
    health.body.components !== null
  const gated = await get(modelCatalogUrl(baseUrl))
  const rejectsAnonymous =
    gated.response.status === 401 &&
    gated.body?.type === "virtual_key_required" &&
    gated.body.is_bifrost_error === false

  if (!healthy || !rejectsAnonymous) {
    throw new Error("The configured address did not respond like Bifrost")
  }
}

export function modelCatalogUrl(baseUrl) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/(?:v1)?\/?$/, "")}/v1/models`.replace(/^\/\//, "/")
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function bifrostApiUrl(baseUrl) {
  const url = new URL(modelCatalogUrl(baseUrl))
  url.pathname = url.pathname.replace(/\/models$/, "")
  return url.toString().replace(/\/$/, "")
}

export function bifrostMcpUrl(baseUrl) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/(?:v1)?\/?$/, "")}/mcp`.replace(/^\/\//, "/")
  url.search = ""
  url.hash = ""
  return url.toString()
}

export async function discoverBifrostModels({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 8_000,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
}) {
  await probeBifrost(baseUrl, {
    fetchImpl,
    timeoutMs: Math.min(probeTimeoutMs, timeoutMs),
  })

  const response = await fetchImpl(modelCatalogUrl(baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`Bifrost model discovery returned HTTP ${response.status}`)
  }

  return parseModelCatalog(await response.json())
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}
