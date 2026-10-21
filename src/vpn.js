import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { tool } from "@opencode-ai/plugin"

import { bifrostRootUrl } from "./discovery.js"

const execFileAsync = promisify(execFile)

const HEALTH_TIMEOUT_MS = 5_000
const COMMAND_TIMEOUT_MS = 15_000
const NM_DOWN_TIMEOUT_MS = 30_000
const NM_UP_TIMEOUT_MS = 120_000
const RECOVERY_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 3_000

// Always resolves with exit information instead of throwing, so every
// failure becomes part of the report instead of an aborted diagnosis.
export const defaultRun = async (command, args, timeoutMs = COMMAND_TIMEOUT_MS) => {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: timeoutMs, maxBuffer: 1_000_000 })
    return { code: 0, stdout: stdout?.toString() ?? "", stderr: "" }
  } catch (error) {
    const stderr =
      error.stderr?.toString() ||
      (error.killed ? `${command} timed out after ${timeoutMs}ms` : undefined) ||
      error.message ||
      String(error)
    return { code: Number.isInteger(error.code) ? error.code : 1, stdout: error.stdout?.toString() ?? "", stderr }
  }
}

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// NetworkManager's fortisslvpn plugin passes the connection's profile as
// /var/lib/NetworkManager-fortisslvpn/<uuid>.config, the only reliable way to
// identify which profile owns a running openfortivpn process.
export function parseNetworkManagerVpnUuid(processList) {
  if (typeof processList !== "string") return undefined
  return processList.match(/NetworkManager-fortisslvpn\/([0-9a-fA-F-]{36})\.config/)?.[1]?.toLowerCase()
}

// nmcli -t escapes separator colons inside values with a backslash.
function splitNmcliLine(line) {
  const fields = []
  let current = ""
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      current += line[i + 1]
      i++
    } else if (line[i] === ":") {
      fields.push(current)
      current = ""
    } else {
      current += line[i]
    }
  }
  fields.push(current)
  return fields
}

export function findVpnConnectionName(connectionOutput, uuid) {
  if (!uuid || typeof connectionOutput !== "string") return undefined
  for (const line of connectionOutput.split("\n")) {
    if (!line.trim()) continue
    const [name, id, type] = splitNmcliLine(line)
    if (id?.toLowerCase() === uuid && type === "vpn") return name
  }
  return undefined
}

export function parseRouteDevice(routeGetOutput) {
  return routeGetOutput?.match(/\bdev\s+(\S+)/)?.[1]
}

async function probeGateway({ baseUrl, fetchImpl, timeoutMs }) {
  try {
    const response = await fetchImpl(bifrostRootUrl(baseUrl, "/health"), {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await response.json().catch(() => undefined)
    const healthy = response.ok && body?.status === "ok"
    return { healthy, detail: healthy ? "status ok" : `HTTP ${response.status}` }
  } catch {
    return { healthy: false, detail: "unreachable (timed out or no route)" }
  }
}

export async function refreshBifrostVpn({
  baseUrl,
  force = false,
  run = defaultRun,
  fetchImpl = fetch,
  sleep = defaultSleep,
  healthTimeoutMs = HEALTH_TIMEOUT_MS,
  pollIntervalMs = POLL_INTERVAL_MS,
  recoveryTimeoutMs = RECOVERY_TIMEOUT_MS,
}) {
  const report = {
    baseUrl,
    force,
    gatewayHealthyBefore: null,
    gatewayHealthyAfter: null,
    gatewayDetailBefore: undefined,
    gatewayDetailAfter: undefined,
    routeDevice: undefined,
    connection: undefined,
    refreshed: false,
    skippedReason: undefined,
    errors: [],
  }

  try {
    new URL(baseUrl)
  } catch {
    report.errors.push(`BIFROST_URL is not a valid URL: ${baseUrl}`)
    report.skippedReason = "invalid BIFROST_URL"
    return report
  }

  const first = await probeGateway({ baseUrl, fetchImpl, timeoutMs: healthTimeoutMs })
  if (first.healthy && !force) {
    report.gatewayHealthyBefore = true
    report.gatewayDetailBefore = first.detail
    report.skippedReason = "gateway healthy"
    return report
  }

  // A single failed probe can be a blip; a tunnel black-hole fails them all.
  let second = first
  if (!first.healthy) {
    await sleep(pollIntervalMs)
    second = await probeGateway({ baseUrl, fetchImpl, timeoutMs: healthTimeoutMs })
  }
  report.gatewayHealthyBefore = first.healthy || second.healthy
  report.gatewayDetailBefore = (first.healthy ? first : second).detail
  if (report.gatewayHealthyBefore && !force) {
    report.skippedReason = "gateway healthy on second probe"
    return report
  }

  const host = new URL(baseUrl).hostname
  const route = await run("ip", ["route", "get", host])
  report.routeDevice = parseRouteDevice(route.stdout)
  if (!report.routeDevice) {
    report.errors.push(`could not determine route to ${host}: ${route.stderr.trim() || `ip route get exited ${route.code}`}`)
    report.skippedReason = "route to the gateway could not be determined"
    return report
  }
  if (!/^ppp\d+$/.test(report.routeDevice)) {
    report.skippedReason = `route to gateway uses ${report.routeDevice}, not the VPN (ppp device); refreshing the VPN would not help`
    return report
  }

  const processes = await run("pgrep", ["-af", "openfortivpn"])
  if (processes.code !== 0 && processes.code !== 1) {
    report.errors.push(`pgrep failed: ${processes.stderr.trim()}`)
    report.skippedReason = "pgrep is not available"
    return report
  }
  const uuid = parseNetworkManagerVpnUuid(processes.stdout)
  if (!uuid) {
    report.skippedReason =
      processes.code === 1
        ? "no openfortivpn process is running; nothing to refresh"
        : "openfortivpn is running but not managed by NetworkManager; refusing to touch it"
    return report
  }

  const connections = await run("nmcli", ["-t", "-f", "NAME,UUID,TYPE", "connection", "show"])
  if (connections.code !== 0) {
    report.errors.push(`nmcli failed: ${connections.stderr.trim()}`)
    report.skippedReason = "nmcli is not available"
    return report
  }
  report.connection = findVpnConnectionName(connections.stdout, uuid)
  if (!report.connection) {
    report.skippedReason = "no NetworkManager vpn profile matches the running openfortivpn"
    return report
  }

  const down = await run("nmcli", ["connection", "down", report.connection], NM_DOWN_TIMEOUT_MS)
  if (down.code !== 0) report.errors.push(`nmcli connection down failed: ${down.stderr.trim()}`)
  const up = await run("nmcli", ["connection", "up", report.connection], NM_UP_TIMEOUT_MS)
  if (up.code !== 0) {
    report.errors.push(`nmcli connection up failed: ${(up.stderr.trim() || up.stdout.trim()).slice(0, 200)}`)
  }
  report.refreshed = down.code === 0 && up.code === 0

  const deadline = Date.now() + recoveryTimeoutMs
  let after = { healthy: false, detail: "not rechecked" }
  while (true) {
    await sleep(pollIntervalMs)
    after = await probeGateway({ baseUrl, fetchImpl, timeoutMs: healthTimeoutMs })
    if (after.healthy || Date.now() + pollIntervalMs > deadline) break
  }
  report.gatewayHealthyAfter = after.healthy
  report.gatewayDetailAfter = after.detail
  return report
}

export function formatRefreshReport(report) {
  const lines = []
  for (const error of report.errors) lines.push(`Error: ${error}`)

  if (report.skippedReason) {
    lines.push(`No VPN refresh performed: ${report.skippedReason}.`)
    lines.push(`Gateway ${report.baseUrl} health check: ${report.gatewayDetailBefore ?? "not performed"}.`)
    return lines.join("\n")
  }

  lines.push(`Gateway ${report.baseUrl} health check before: ${report.gatewayDetailBefore}.`)
  lines.push(`Route to gateway: ${report.routeDevice} (VPN in path).`)
  lines.push(`NetworkManager VPN connection: ${report.connection}.`)
  lines.push(
    report.refreshed
      ? `Refreshed ${report.connection} (nmcli connection down + up).`
      : `Refresh of ${report.connection} did not complete; see errors above.`,
  )
  lines.push(
    report.gatewayHealthyAfter
      ? `Gateway health check after refresh: ${report.gatewayDetailAfter}. Bifrost should work again.`
      : `Gateway is still unhealthy after refresh (${report.gatewayDetailAfter}). The gateway itself or the FortiGate policy may be the problem, not the tunnel.`,
  )
  return lines.join("\n")
}

export function createVpnRefreshTool({ env, run = defaultRun, fetchImpl = fetch, log } = {}) {
  return tool({
    description:
      "Refresh the NetworkManager Fortinet SSL-VPN connection when the Bifrost gateway (the bifrost provider) is unreachable. " +
      "Call this when requests to the bifrost provider fail with \"Cannot connect to API\" / \"Unable to connect\" stream errors, " +
      "when the Bifrost health check hangs, or when the user says Bifrost or the VPN is down. " +
      "It bounces the running NetworkManager fortisslvpn connection with nmcli and verifies the gateway recovers. " +
      "Only refreshes when the gateway health check actually fails and the route to the gateway crosses the VPN; " +
      "pass force=true to refresh even when the health check currently passes.",
    args: {
      force: tool.schema
        .boolean()
        .optional()
        .describe("Refresh even when the gateway health check currently passes (for intermittent black-holing)."),
    },
    async execute(args) {
      const baseUrl = env.BIFROST_URL?.trim()
      if (!baseUrl) return "BIFROST_URL is not set, so the gateway address is unknown; no refresh performed."

      const report = await refreshBifrostVpn({ baseUrl, force: args.force === true, run, fetchImpl })
      const summary = report.skippedReason
        ? `skipped (${report.skippedReason})`
        : `refreshed=${report.refreshed} recovered=${report.gatewayHealthyAfter}`
      await log?.("info", `bifrost_vpn_refresh: ${summary}`)
      return formatRefreshReport(report)
    },
  })
}
