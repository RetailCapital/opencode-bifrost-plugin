---
name: bifrost-usage
description: Retrieve usage, cost, and request-log data from the Bifrost gateway's Memento dashboard API (same host as $BIFROST_URL, port 8767). Use when asked what was spent, what a model or session cost, which models ran, or to split subscription-passthrough vs API-key-billed traffic for a virtual key.
---

# Bifrost usage data retrieval

This plugin shows per-request cost client-side from the `/v1/models` catalog
pricing. The **server-side record of truth** — what Bifrost actually logged,
for every client, not just OpenCode — is the Memento dashboard API that backs
the memory MCP this plugin injects at `/mcp`. Use it to answer "what did we
spend", "which models ran", "is passthrough billing working".

The deployment has two HTTP surfaces. This skill covers the second one:

| Surface | Where | Auth | What it has |
| --- | --- | --- | --- |
| Bifrost gateway | `$BIFROST_URL` (port 80) | virtual key (`Authorization: Bearer` or `x-bf-vk`) for LLM calls; separate admin creds for `/api/*` | LLM proxying, `/v1/models` catalog with per-token `pricing` |
| Memento dashboard | same host, **port 8767** | the virtual key IS the login | per-key request logs, cost stats, memory records |

Do not probe the gateway's admin `/api/*` — it 401s without dashboard admin
credentials, which this team does not hold. Everything below is self-serve per
virtual key on Memento. Never echo, log, or write the key to a file.

## Authenticate

```bash
MEMO="http://$(python3 -c "import os,urllib.parse; print(urllib.parse.urlparse(os.environ['BIFROST_URL']).hostname)"):8767"
curl -s -c /tmp/memento_cookies.txt -X POST "$MEMO/api/login" \
  -H "Content-Type: application/json" -d "{\"key\":\"$BIFROST_API_KEY\"}"
# => {"deployment_id":"ci","virtual_key_id":"...","virtual_key_name":"...","expires_at":...}
```

Then pass `-b /tmp/memento_cookies.txt` on every request. Sessions survive until
logout, expiry, or key rotation; on a 401, log in again (do not retry in a
loop, and report a persistent 401 instead of working around it).

## Endpoints

LLM request data (the spend data lives here):

- `GET /api/llm-logs` — individual rows: `timestamp, provider, model, cost,
  prompt_tokens, completion_tokens, status, latency, app, user_agent,
  selected_key_name, session_id, object_type, ...`
- `GET /api/llm-logs/stats` — aggregates: `total_requests, total_cost,
  total_tokens, prompt_tokens, completion_tokens, success_rate, avg_latency,
  p95_latency`, plus a `previous` block for the prior window.
- `GET /api/llm-logs/histogram` — daily buckets with `count, cost, tokens`.
- `GET /api/llm-logs/filters` — distinct values for the filter params.

The same four exist under `/api/mcp-logs*` for MCP tool traffic (including
calls to the Memento MCP this plugin injects). `/api/summary`, `/api/records`,
`/api/activity`, `/api/documents` are the memory side — not cost.

## Query parameters

- `period`: `1h | 6h | 24h | 7d | 30d`. **The logs endpoint defaults to `1h`**
  — always pass a period or an explicit window.
- `start` / `end`: ISO-8601 UTC, e.g. `2026-10-01T00:00:00Z`. **Windows are
  capped at 31 days** ("time windows are limited to 31 days"); walk backwards
  in 30-day chunks for all-time totals.
- Filters (all endpoints): `provider`, `model`, `status`, `object`,
  `stop_reason`, `session_id`, `parent_request_id`, `request_id`, `q`.
- Logs list only: `sort` (e.g. `timestamp`), `order` (`asc|desc`),
  `limit` (**max 200**, more errors with "invalid request"), `offset`,
  `roots_only`.

## Gotchas

- **Deep offsets fail.** Past roughly the first few hundred rows the server
  intermittently returns `{"error":"Bifrost data is unavailable"}`. Page
  large ranges by splitting queries into day × provider slices instead of one
  deep scan.
- **No key-name filter on stats.** Per-credential splits require paging the
  logs list and aggregating client-side (recipe below).
- **Cost is catalog-priced, not necessarily billed** — same pricing table the
  plugin uses for OpenCode's cost display. Subscription-passthrough Anthropic
  traffic is metered but not invoiced — see the attribution section.
- **`cost: null` rows** (`object_type` `list_models` / `count_tokens`, empty
  `model`) are pings; exclude them from spend math.
- **History starts when recording started** (~mid-Oct 2026 on the `ci`
  deployment). Empty windows before that are not evidence of no spend.

## Attribution: subscription passthrough vs API key

`selected_key_name` on each log row tells which credential served the request:

- **empty string** → Bifrost forwarded the client's own credential to
  Anthropic (claude.ai OAuth from `claude /login` = subscription billing).
- **a name** (e.g. `OpenAI Praxent Code Analysis Key`) → Bifrost's configured
  provider key = real API spend.

Server semantics (verified by probes): a valid Anthropic credential is
forwarded; an absent, malformed, or **invalid/expired** one silently falls
back to the configured key and the request still succeeds. An unexpected flip
from empty to a named key in the logs means someone's login lapsed.

## Recipes

Total spend for a window, with provider/model breakdown:

```bash
curl -s -b /tmp/memento_cookies.txt "$MEMO/api/llm-logs/stats?period=30d"
curl -s -b /tmp/memento_cookies.txt "$MEMO/api/llm-logs/stats?period=30d&provider=anthropic"
curl -s -b /tmp/memento_cookies.txt "$MEMO/api/llm-logs/stats?period=30d&model=claude-sonnet-5-5"
curl -s -b /tmp/memento_cookies.txt "$MEMO/api/llm-logs/histogram?period=30d"   # per-day cost
```

All-time spend (31-day cap): loop `start`/`end` backwards in 30-day steps until
a window returns `total_requests: 0`, summing `total_cost`.

Per-credential split (day × provider paging to stay under the limits):

```python
import json, subprocess, collections, datetime, time

MEMO = "http://<host>:8767"  # same host as BIFROST_URL
def api(path, tries=4):
    for _ in range(tries):
        out = subprocess.run(["curl", "-s", "-m", "90", "-b", "/tmp/memento_cookies.txt",
                              MEMO + path], capture_output=True, text=True)
        try:
            d = json.loads(out.stdout)
            if "logs" in d or "total_requests" in d: return d
        except Exception: pass
        time.sleep(1)
    raise RuntimeError(f"failed: {path} -> {out.stdout[:200]}")

agg = collections.defaultdict(lambda: [0, 0.0])
day, end_day = datetime.date(2026, 9, 23), datetime.date.today() + datetime.timedelta(days=1)
while day < end_day:
    s = f"{day}T00:00:00Z"; e = f"{day + datetime.timedelta(days=1)}T00:00:00Z"
    for prov in ["anthropic", "openai", "gemini", "fireworks", "dev.meta.ai"]:
        st = api(f"/api/llm-logs/stats?start={s}&end={e}&provider={prov}")
        if not st.get("total_requests"): continue
        offset = 0
        while True:
            d = api(f"/api/llm-logs?start={s}&end={e}&provider={prov}&limit=200&offset={offset}")
            for r in d["logs"]:
                key = (prov, r.get("selected_key_name") or "(passthrough)", r.get("app") or "?")
                agg[key][0] += 1; agg[key][1] += r.get("cost") or 0
            offset += len(d["logs"])
            if len(d["logs"]) < 200 or offset >= d["total"]: break
    day += datetime.timedelta(days=1)

for (prov, key, app), (n, cost) in sorted(agg.items(), key=lambda x: -x[1][1]):
    print(f"{prov:<12}{key:<40}{app:<14}{n:>6,}  ${cost:,.2f}")
```

Use `app` / `user_agent` (`opencode/...` = OpenCode, `claude-cli/...` = Claude
Code) to attribute by client, and `session_id` to trace one conversation's
requests end to end.
