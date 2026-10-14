import { lookup } from "node:dns/promises"
import { platform } from "node:os"

const EXCLUDED_CAPABILITIES =
  /image|audio|tts|live|transcribe|embedding|robotics|lyria|veo|nano-banana|computer-use|aqa|deep-research|antigravity|omni|realtime|search|moderation|sora|whisper|instruct/i
const OPENAI_AGENTIC_MODEL =
  /^openai\/(?:chat-latest|gpt-3\.5-turbo(?:$|-)|gpt-4(?:$|-|\.)|gpt-4o(?:$|-)|gpt-5(?:$|-|\.)|gpt-6(?:$|-|\.)|o1(?:$|-)|o3(?:$|-)|o4(?:$|-))/
const FIREWORKS_AGENTIC_MODEL =
  /^accounts\/fireworks\/models\/(?:deepseek|glm|kimi|llama|mixtral|qwen)/i
const VPN_INTERFACE = /^(?:ppp|tun|tap|wg|tailscale|zt|vpn|globalprotect|gp)/i

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
  return discovered
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

export function parseRouteInterface(routeOutput) {
  return routeOutput.match(/\bdev\s+(\S+)/)?.[1]
}

export async function hasBifrostVpnRoute(
  hostname,
  runIpRoute,
  operatingSystem = platform(),
  dnsLookup = lookup,
) {
  if (operatingSystem !== "linux") return true

  const { address } = await dnsLookup(hostname)
  const interfaceName = parseRouteInterface(await runIpRoute(address))
  return Boolean(interfaceName && VPN_INTERFACE.test(interfaceName))
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
  runIpRoute,
  operatingSystem,
  dnsLookup,
  timeoutMs = 8_000,
}) {
  const url = new URL(baseUrl)
  if (
    !(await hasBifrostVpnRoute(url.hostname, runIpRoute, operatingSystem, dnsLookup))
  ) {
    throw new Error("Bifrost is not routed through an active VPN interface")
  }

  const response = await fetchImpl(modelCatalogUrl(baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}` },
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
