# codemode k6 load test pack

Five scenarios scoped to **10 concurrent users**, designed to flush out
codemode-specific failure modes ahead of a 0.7.1 UAT release. Each
scenario targets a different layer of the stack so a failed run points
at a specific subsystem rather than "something is slow".

## Prerequisites

- `k6` installed (`~/bin/k6` or `~/.local/bin/k6`)
- An API key with `code:read`, `code:write`, `chat:write` scopes
- Network reachability to `chat-dev.openagentic.io` (or whatever
  `BASE_URL` you target)

## Run

```bash
export BASE_URL=https://chat-dev.openagentic.io
export API_KEY=awc_…   # full key, not just prefix

# Single scenario
k6 run tests/load/scenarios/codemode/01-burst-spawn.js

# Or the whole pack via the Makefile (see ./Makefile)
make -C tests/load/scenarios/codemode all
```

## Scenarios

| # | File | What it tests | Duration | Pass thresholds |
|---|---|---|---|---|
| 01 | `01-burst-spawn.js` | 10 simultaneous `POST /api/code/sessions` — manager throttle, pod scheduler, image pull, PVC mount race | ~1m20s | p95 spawn < 60s, ≥8/10 success |
| 02 | `02-chat-completions.js` | 10 sustained chat streams — Smart Router cascade, redis intent cache, milvus tool ranker, provider pool | ~4m | p95 chat < 60s, ≥30 successes |
| 03 | `03-preview-proxy.js` | 10 concurrent preview-proxy fetches against agent-launched http.servers — proxy fetch path, frame-lock injection, **the new daemon port-rescanner** | ~2m45s | p95 < 1s, < 10 `port_not_announced` events |
| 04 | `04-ws-soak.js` | 10 long-held `/api/code/ws/events` — WS upgrade path, mux from nginx → api → manager → daemon, FD pressure | ~3m35s | p95 handshake < 5s, < 3 unexpected drops |
| 05 | `05-session-churn.js` | spawn → 30s idle → delete loop, 4-5 cycles per VU — PVC mount/unmount cycle (geesefs is the weak spot), state ledger consistency | ~3m35s | p95 spawn < 60s, ≥20 cycles |

## What "10 users" means

Each scenario provisions 10 virtual users (`vus: 10`) ramping in over the
first 20-30 seconds. Each VU runs the iteration body until the scenario's
sustain phase ends. So:

- **burst-spawn**: 10 VUs each spawn ONE session (~10 sessions total)
- **chat-completions**: 10 VUs × 6 prompts each = ~60 chat completions
- **preview-proxy**: 10 VUs × ~60 proxy GETs each = ~600 GETs
- **ws-soak**: 10 VUs × 1 WS each = 10 long-held connections
- **session-churn**: 10 VUs × ~4 cycles each = ~40 spawn/teardown events

For a UAT run, fire them sequentially (so failure modes don't cross-
pollute) — `make all` does this.

## Reading results

k6 prints per-metric thresholds at the end. Anything red means the
threshold was breached. The custom metrics are namespaced
`cm_<scenario>_*` so scrolling for `cm_` shows only codemode-specific
numbers.

For deeper analysis, point k6 at Prometheus or InfluxDB:

```bash
k6 run --out experimental-prometheus-rw=http://10.2.10.142:9090/api/v1/write \
  tests/load/scenarios/codemode/02-chat-completions.js
```

## Known limitations

- Auth uses a single API key — every VU runs as the same upstream
  identity. The code-manager DOES support per-user pod isolation but
  only differentiates by userId, so a real 10-distinct-user load
  test needs 10 different API keys.
- `03-preview-proxy.js` asks the agent to run a Bash command that
  starts an http.server in the background. If the agent declines or
  takes too long, the proxy probe will sit in 403 land for a while.
  The new rescanner is supposed to catch it within 30s.
- `04-ws-soak.js` does NOT replay full session-event traffic — it
  just holds the socket and pings. Real traffic patterns (lots of
  small frames per second) might surface bugs this scenario misses.
