import assert from "node:assert/strict"
import test from "node:test"

import { createBifrostPlugin } from "../src/plugin.js"
import {
  createVpnRefreshTool,
  defaultRun,
  findVpnConnectionName,
  formatRefreshReport,
  parseNetworkManagerVpnUuid,
  parseRouteDevice,
  refreshBifrostVpn,
} from "../src/vpn.js"

const UUID = "960474fe-85d5-435b-9c97-06a82b017811"
const RUNNING_VPN_PROCESS = `970160 /usr/bin/openfortivpn -c /var/lib/NetworkManager-fortisslvpn/${UUID}.config --no-routes --no-dns remote.credibly.com --trusted-cert 78fc3cf35724ed510145f8515c5aa6f4310cdb333a5539048604b27161cbc519`
const CONNECTIONS = `Wired connection 2:0cbc29e8-5636-3de3-9a07-890b36c10685:802-3-ethernet
Credibly-ITOPS\\: 5G:29ef5489-cc90-4935-96d5-788dedaddf33:802-11-wireless
Credibly-Southfield:${UUID}:vpn
`
const ROUTE_PPP = "10.16.100.85 dev ppp0 src 10.20.245.2 uid 1654008445 \n    cache \n"
const ROUTE_WIFI = "93.184.216.34 dev wlp2s0 via 192.168.1.1 src 192.168.1.186 \n"

const HEALTHY = { ok: true, status: 200, body: { status: "ok", components: { db_pings: "ok" } } }

function healthResponses(responses) {
  let index = 0
  return async () => {
    const response = responses[Math.min(index++, responses.length - 1)]
    if (response === "timeout") throw new Error("fetch failed")
    return { ok: response.ok, status: response.status, json: async () => response.body }
  }
}

function scriptedRun(script, calls = []) {
  return async (command, args) => {
    const key = [command, ...args].join(" ")
    calls.push(key)
    const result = script[key]
    if (result === undefined) throw new Error(`unexpected command: ${key}`)
    return typeof result === "number" ? { code: result, stdout: "", stderr: "" } : result
  }
}

const fullScript = {
  "ip route get 10.16.100.85": { code: 0, stdout: ROUTE_PPP, stderr: "" },
  "pgrep -af openfortivpn": { code: 0, stdout: RUNNING_VPN_PROCESS, stderr: "" },
  "nmcli -t -f NAME,UUID,TYPE connection show": { code: 0, stdout: CONNECTIONS, stderr: "" },
  [`nmcli connection down Credibly-Southfield`]: { code: 0, stdout: `Connection 'Credibly-Southfield' successfully deactivated`, stderr: "" },
  [`nmcli connection up Credibly-Southfield`]: { code: 0, stdout: `Connection successfully activated`, stderr: "" },
}

test("parseNetworkManagerVpnUuid extracts the NetworkManager profile UUID", () => {
  assert.equal(parseNetworkManagerVpnUuid(RUNNING_VPN_PROCESS), UUID)
  assert.equal(
    parseNetworkManagerVpnUuid(`123 openfortivpn remote.credibly.com --trusted-cert abc`),
    undefined,
  )
  assert.equal(parseNetworkManagerVpnUuid(undefined), undefined)
})

test("findVpnConnectionName matches vpn profiles by UUID and unescapes colons", () => {
  assert.equal(findVpnConnectionName(CONNECTIONS, UUID), "Credibly-Southfield")
  assert.equal(findVpnConnectionName(`Credibly\\: Southfield:${UUID}:vpn`, UUID), "Credibly: Southfield")
  assert.equal(findVpnConnectionName(`Wired connection 2:0cbc29e8-5636-3de3-9a07-890b36c10685:802-3-ethernet`, UUID), undefined)
  assert.equal(findVpnConnectionName(CONNECTIONS, "other-uuid"), undefined)
  assert.equal(findVpnConnectionName(CONNECTIONS, undefined), undefined)
})

test("parseRouteDevice extracts the outbound device", () => {
  assert.equal(parseRouteDevice(ROUTE_PPP), "ppp0")
  assert.equal(parseRouteDevice(ROUTE_WIFI), "wlp2s0")
  assert.equal(parseRouteDevice(""), undefined)
})

test("refreshBifrostVpn does nothing when the gateway is healthy", async () => {
  const calls = []
  const run = scriptedRun({}, calls)
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    run,
    fetchImpl: healthResponses([HEALTHY]),
    sleep: async () => {},
  })

  assert.equal(report.gatewayHealthyBefore, true)
  assert.equal(report.skippedReason, "gateway healthy")
  assert.equal(report.refreshed, false)
  assert.equal(calls.length, 0)
})

test("refreshBifrostVpn treats a single failed probe as a blip", async () => {
  const calls = []
  const run = scriptedRun({}, calls)
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    run,
    fetchImpl: healthResponses(["timeout", HEALTHY]),
    sleep: async () => {},
  })

  assert.equal(report.gatewayHealthyBefore, true)
  assert.equal(report.skippedReason, "gateway healthy on second probe")
  assert.equal(calls.length, 0)
})

test("refreshBifrostVpn bounces the running NetworkManager VPN when the gateway is black-holed", async () => {
  const calls = []
  const run = scriptedRun(fullScript, calls)
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    run,
    fetchImpl: healthResponses(["timeout", "timeout", HEALTHY]),
    sleep: async () => {},
  })

  assert.equal(report.gatewayHealthyBefore, false)
  assert.equal(report.routeDevice, "ppp0")
  assert.equal(report.connection, "Credibly-Southfield")
  assert.equal(report.refreshed, true)
  assert.equal(report.gatewayHealthyAfter, true)
  assert.deepEqual(calls, [
    "ip route get 10.16.100.85",
    "pgrep -af openfortivpn",
    "nmcli -t -f NAME,UUID,TYPE connection show",
    "nmcli connection down Credibly-Southfield",
    "nmcli connection up Credibly-Southfield",
  ])
})

test("refreshBifrostVpn with force refreshes even when the gateway is healthy", async () => {
  const calls = []
  const run = scriptedRun(fullScript, calls)
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    force: true,
    run,
    fetchImpl: healthResponses([HEALTHY]),
    sleep: async () => {},
  })

  assert.equal(report.refreshed, true)
  assert.equal(report.gatewayHealthyAfter, true)
  assert.equal(calls.includes("nmcli connection down Credibly-Southfield"), true)
})

test("refreshBifrostVpn does not refresh when the route does not cross the VPN", async () => {
  const calls = []
  const run = scriptedRun({ "ip route get 93.184.216.34": { code: 0, stdout: ROUTE_WIFI, stderr: "" } }, calls)
  const report = await refreshBifrostVpn({
    baseUrl: "http://93.184.216.34",
    run,
    fetchImpl: healthResponses(["timeout", "timeout"]),
    sleep: async () => {},
  })

  assert.equal(report.refreshed, false)
  assert.match(report.skippedReason, /not the VPN/)
  assert.deepEqual(calls, ["ip route get 93.184.216.34"])
})

test("refreshBifrostVpn does not refresh when no openfortivpn is running", async () => {
  const calls = []
  const run = scriptedRun(
    {
      "ip route get 10.16.100.85": { code: 0, stdout: ROUTE_PPP, stderr: "" },
      "pgrep -af openfortivpn": { code: 1, stdout: "", stderr: "" },
    },
    calls,
  )
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    run,
    fetchImpl: healthResponses(["timeout", "timeout"]),
    sleep: async () => {},
  })

  assert.equal(report.refreshed, false)
  assert.match(report.skippedReason, /no openfortivpn process is running/)
})

test("refreshBifrostVpn refuses to touch a non-NetworkManager openfortivpn", async () => {
  const calls = []
  const run = scriptedRun(
    {
      "ip route get 10.16.100.85": { code: 0, stdout: ROUTE_PPP, stderr: "" },
      "pgrep -af openfortivpn": { code: 0, stdout: "4242 openfortivpn remote.credibly.com", stderr: "" },
    },
    calls,
  )
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    run,
    fetchImpl: healthResponses(["timeout", "timeout"]),
    sleep: async () => {},
  })

  assert.equal(report.refreshed, false)
  assert.match(report.skippedReason, /not managed by NetworkManager/)
  assert.equal(report.connection, undefined)
})

test("refreshBifrostVpn reports a failed connection up without throwing", async () => {
  const calls = []
  const run = scriptedRun(
    {
      ...fullScript,
      "nmcli connection up Credibly-Southfield": {
        code: 4,
        stdout: "",
        stderr: "Error: Connection activation failed: Could not find appropriate device",
      },
    },
    calls,
  )
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    run,
    fetchImpl: healthResponses(["timeout", "timeout", "timeout"]),
    sleep: async () => {},
    recoveryTimeoutMs: 0,
  })

  assert.equal(report.refreshed, false)
  assert.equal(report.gatewayHealthyAfter, false)
  assert.match(report.errors.join("\n"), /connection up failed/)
  const text = formatRefreshReport(report)
  assert.match(text, /did not complete/)
})

test("refreshBifrostVpn reports when the gateway does not recover", async () => {
  const run = scriptedRun(fullScript)
  const report = await refreshBifrostVpn({
    baseUrl: "http://10.16.100.85",
    run,
    fetchImpl: healthResponses(["timeout"]),
    sleep: async () => {},
    recoveryTimeoutMs: 0,
  })

  assert.equal(report.refreshed, true)
  assert.equal(report.gatewayHealthyAfter, false)
  assert.match(formatRefreshReport(report), /still unhealthy/)
})

test("refreshBifrostVpn reports an invalid BIFROST_URL without running commands", async () => {
  const calls = []
  const report = await refreshBifrostVpn({
    baseUrl: "not a url",
    run: scriptedRun({}, calls),
    fetchImpl: healthResponses(["timeout"]),
    sleep: async () => {},
  })

  assert.equal(report.skippedReason, "invalid BIFROST_URL")
  assert.equal(calls.length, 0)
})

test("formatRefreshReport explains skips and never contains credentials", () => {
  const skip = formatRefreshReport({ baseUrl: "http://10.16.100.85", skippedReason: "gateway healthy", gatewayDetailBefore: "status ok", errors: [] })
  assert.match(skip, /No VPN refresh performed: gateway healthy/)

  const recovered = formatRefreshReport({
    baseUrl: "http://10.16.100.85",
    gatewayDetailBefore: "unreachable (timed out or no route)",
    routeDevice: "ppp0",
    connection: "Credibly-Southfield",
    refreshed: true,
    gatewayHealthyAfter: true,
    gatewayDetailAfter: "status ok",
    errors: [],
  })
  assert.match(recovered, /Credibly-Southfield/)
  assert.match(recovered, /Bifrost should work again/)
  assert.doesNotMatch(recovered, /key|token|password/i)
})

test("defaultRun resolves command results, failures, and timeouts", async () => {
  assert.equal((await defaultRun("true", [])).code, 0)
  const failure = await defaultRun("false", [])
  assert.equal(failure.code, 1)

  const timeout = await defaultRun("sleep", ["5"], 50)
  assert.notEqual(timeout.code, 0)
  assert.match(timeout.stderr, /timed out/)
})

test("plugin registers the refresh tool when the gateway is configured", async () => {
  const logs = []
  const plugin = createBifrostPlugin({
    env: { BIFROST_URL: "http://bifrost.internal", BIFROST_API_KEY: "test-key" },
    discover: async () => ({ "openai/gpt-5.6-sol": { name: "GPT-5.6 Sol" } }),
    fetchImpl: healthResponses([HEALTHY]),
    run: scriptedRun({}),
  })
  const hooks = await plugin({ client: { app: { log: async ({ body }) => logs.push(body) } } })

  const refreshTool = hooks.tool.bifrost_vpn_refresh
  assert.equal(typeof refreshTool.execute, "function")
  assert.match(refreshTool.description, /Cannot connect to API/)

  const text = await refreshTool.execute({}, {})
  assert.match(text, /No VPN refresh performed: gateway healthy/)
  assert.match(logs.at(-1).message, /bifrost_vpn_refresh: skipped/)
  assert.doesNotMatch(text, /test-key/)
})

test("plugin omits the refresh tool without BIFROST_URL, on request, or under a custom id", async () => {
  const client = { app: { log: async () => {} } }
  const withUrl = { BIFROST_URL: "http://bifrost.internal", BIFROST_API_KEY: "k" }
  const discover = async () => ({})

  const withoutUrl = await (await createBifrostPlugin({ env: {}, discover }))({ client })
  assert.equal(withoutUrl.tool, undefined)

  const disabled = await (await createBifrostPlugin({ env: withUrl, discover }))({ client }, { injectRefreshTool: false })
  assert.equal(disabled.tool, undefined)

  const custom = await (await createBifrostPlugin({ env: withUrl, discover }))({ client }, { refreshToolId: "vpn_bounce" })
  assert.equal(custom.tool.bifrost_vpn_refresh, undefined)
  assert.equal(typeof custom.tool.vpn_bounce.execute, "function")
})

test("refresh tool execute handles a missing BIFROST_URL defensively", async () => {
  const refreshTool = createVpnRefreshTool({ env: {} })
  const text = await refreshTool.execute({}, {})
  assert.match(text, /BIFROST_URL is not set/)
})
