# Operations & Troubleshooting

This is the day-2 operations guide for a running OpenAgentic deployment: how to
check health, apply updates, recover from the handful of well-known first-boot
failures, back up your data, and reason about logs and scale.

Everything here is grounded in the shipping code — `install.sh`,
`docker-compose.yml`, the API service's `docker-entrypoint.sh`, and the Helm
chart under `helm/openagentic`. Where a behaviour is enforced by code (a
fail-fast secret, a boot-time dependency wait), that is called out so you can
match symptoms to the exact mechanism.

OpenAgentic ships two deploy targets. Both run the same container images and the
same API boot path, so the troubleshooting is largely shared:

| Target | Brought up by | Documented command |
|---|---|---|
| Docker Compose | `install.sh` (default / `--quick` / `--env`) | `docker compose --profile milvus up -d` |
| Kubernetes (Helm) | `install.sh --helm` | `helm upgrade --install openagentic ./helm/openagentic -n openagentic` |

---

## Health checks

### Is everything running? — `docker compose ps`

After bringing the stack up with the Milvus profile, every service should report
`running` or `healthy`:

```bash
# Run from your install dir (~/.openagentic, or your local checkout).
# Use the same --profile milvus you started with, so etcd/minio/milvus show.
docker compose --profile milvus ps
```

The compose file defines healthchecks for `postgres`, `redis`, `etcd`, `minio`,
`milvus`, `ollama`, `searxng`, and `prometheus`, plus the API container's own
`HEALTHCHECK` (see below). The application services (`ui`, `workflows`,
`mcp-proxy`, `proxy`) report `running` rather than `healthy` — they have no
compose-level healthcheck and start once their dependencies are up.

A few things worth knowing when reading the output:

- **`ollama-init` exits.** It is a one-shot job that pulls the embedding model
  (and, if set, the chat model) on first boot, then exits `0`. Seeing it in an
  `Exited (0)` state is correct — it is not a crashed service.
- **The `milvus` profile must be passed every time.** `etcd`, `minio`, and
  `milvus` are gated behind the `milvus` compose profile. A bare
  `docker compose ps` (no profile) will not list them even when they are
  running, and a bare `docker compose up` will not start them — which crashes
  the API at boot (see [First-boot landmines](#first-boot-landmines)).

### The API container healthcheck

The API image defines its own Docker `HEALTHCHECK`:

```dockerfile
HEALTHCHECK --interval=15s --timeout=10s --start-period=600s --retries=5 \
  CMD curl -f http://localhost:8000/api/health || exit 1
```

The `start-period=600s` (10 minutes) grace window exists because first boot does
real work — Prisma schema push, Milvus collection creation, embedding-model
warm-up — before `/api/health` returns 200. `install.sh` polls this exact health
state and waits up to ~3 minutes for it to flip to `healthy`:

```bash
docker inspect --format '{{.State.Health.Status}}' openagentic-api-1
# → starting | healthy | unhealthy
```

### Dependency status — `GET /api/health`

The basic health endpoint runs a live connectivity probe against each core
dependency and returns JSON. It is served on the API's internal port `8000` and
proxied to the UI host port (default `8080`):

```bash
curl -s http://localhost:8080/api/health | jq .
```

```json
{
  "status": "healthy",
  "timestamp": "2026-06-18T00:00:00.000Z",
  "version": "1.0.0",
  "commit": "dev",
  "build": "2026-06-18T00:00:00.000Z",
  "database": { "status": "connected", "method": "prisma" },
  "redis":    { "status": "connected" },
  "milvus":   { "status": "connected" },
  "users":    { "count": 1 }
}
```

`database` comes from a real `prisma.user.count()`, `redis` from the client's
`isConnected()`, and `milvus` from a live `checkHealth` ping against the
canonical Milvus client. If the database query throws, the whole endpoint
returns HTTP `503` with `{"status":"unhealthy", ...}` — which is also what trips
the container `HEALTHCHECK`.

Field reference for `/api/health`:

| Field | Source | Meaning |
|---|---|---|
| `status` | computed | `healthy`, or `unhealthy` (503) if the DB probe fails |
| `database.status` | `prisma.user.count()` | `connected` when the query succeeds |
| `redis.status` | redis client | `connected` / `disconnected` / `error` / `not_configured` |
| `milvus.status` | live `checkHealth` ping | `connected` / `reconnected` / `error` / `not_configured` |
| `users.count` | `prisma.user.count()` | seeded admin + any users you created |

### Deeper checks

Two additional read-only endpoints give progressively more detail:

```bash
# Database statistics: session + recent-message counts, env sanity
curl -s http://localhost:8080/api/health/detailed | jq .

# Full system: database, chat model, embedding model, MCP orchestrator, vectors.
# Returns 503 if ANY check fails (overall_healthy=false).
curl -s http://localhost:8080/api/health/comprehensive | jq .
```

`/api/health/comprehensive` is the most thorough probe. It exercises the chat
model (a real round-trip), the embedding model (the RAG health check), the MCP
orchestrator (server + tool counts from the proxy), and Milvus vector storage.
Use it to distinguish "the platform is up" from "the platform can actually serve
a chat with tools."

### Kubernetes equivalents

On Helm, check pods and the same endpoint through a port-forward:

```bash
kubectl -n openagentic get pods
kubectl -n openagentic port-forward svc/api 8000:8000 &
curl -s http://localhost:8000/api/health | jq .
```

---

## Updating an existing install

### Docker: `install.sh --update`

`--update` updates an existing install in place — it pulls the latest source
(for a cloned install), rebuilds changed services, restarts, and **keeps your
`.env`**. It is safe to re-run.

```bash
# From a curl pipe…
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash -s -- --update
# …or from your install dir / local checkout:
./install.sh --update
```

Under the hood the Docker update path runs:

```bash
docker compose --profile milvus up -d --build
```

…then polls `docker inspect --format '{{.State.Health.Status}}' openagentic-api-1`
for up to ~3 minutes and fails loudly if the API does not return to `healthy`.

`--update` auto-detects the deploy target: if a Helm release named `openagentic`
exists in the namespace, it takes the Helm path instead (next section). Override
the namespace with `OPENAGENTIC_NAMESPACE`.

### Kubernetes: `install.sh --update` (or `helm upgrade` directly)

For a Helm install, `--update` runs a `helm upgrade` with `--wait` and a 10-minute
rollout timeout against the existing release, using `values-local-k8s.yaml` if
present (else the chart defaults):

```bash
./install.sh --helm --update
```

You can also drive the upgrade by hand:

```bash
helm upgrade openagentic ./helm/openagentic -n openagentic \
  -f helm/openagentic/values.yaml \
  -f ~/.openagentic/helm-secrets.yaml \
  --wait --timeout 10m

# If it goes wrong, roll back to the previous revision:
helm rollback openagentic -n openagentic
```

> **Always pass your secret overlay on a manual `helm upgrade`.** The chart
> `required`-guards every secret with no defaults (see below). An upgrade that
> omits `-f ~/.openagentic/helm-secrets.yaml` aborts with a
> `secrets.* is required` error rather than silently rotating to empty values.

### Helm secret persistence — `~/.openagentic/helm-secrets.yaml`

The Helm chart ships **no** secret defaults. Every secret in
`templates/secret.yaml` is wrapped in Helm's `required`, so an unset value
aborts the install (mirroring compose's `${VAR:?}` fail-fast):

```yaml
# helm/openagentic/values.yaml — all empty, must be supplied
secrets:
  postgresPassword: ""
  jwtSecret: ""
  signingSecret: ""
  internalApiKey: ""
```

To make re-runs safe, `install.sh --helm` generates strong random secrets
**once** and persists them to `~/.openagentic/helm-secrets.yaml` (mode `0600`),
then reuses that file on every subsequent install/upgrade via `-f` precedence:

```yaml
# Auto-generated by install.sh. Reused on upgrade.
secrets:
  postgresPassword: "<openssl rand -hex 16>"
  jwtSecret:        "<openssl rand -hex 32>"
  signingSecret:    "<openssl rand -hex 32>"
  internalApiKey:   "<openssl rand -hex 32>"
  frontendSecret:   "<openssl rand -hex 32>"
  adminEmail:       admin@openagentic.local
  adminPassword:    "<openssl rand -hex 16>"
```

The admin login is also written to `~/.openagentic/admin-credentials.txt`
(mode `0600`). The persistence matters for a critical reason: `jwtSecret`,
`signingSecret`, and `internalApiKey` are the inter-service trust roots shared
by the API, UI, mcp-proxy, and workflows. Rotating them out from under a running
release would `401` every active session and every internal service call — so an
upgrade must reuse the same values. **Do not delete `helm-secrets.yaml`** unless
you intend to fully rotate (and re-seed) the deployment.

> If you supply your own values (`OPENAGENTIC_VALUES`, or a
> `values-local-k8s.yaml` overlay), `install.sh` trusts *that* to carry the
> secrets and does **not** generate `helm-secrets.yaml`.

The compose path uses the equivalent fail-fast in `.env`. Every required secret
is referenced as `${VAR:?set VAR in .env}` in `docker-compose.yml`, so a missing
value aborts `docker compose up` with a clear message. `install.sh` (`--quick`
and the wizard) generates them with `openssl rand` and writes them into `.env`.

---

## First-boot landmines

These are the failures that historically tripped a fresh install. Each is now
fixed in the shipping code; the entries below let you match a log symptom to the
exact mechanism so you can confirm the fix is in place rather than re-debugging
from scratch.

### 1. `table admin.prompt_templates does not exist` — Prisma schema not pushed

**Cause:** the API came up before its database tables existed.

**Fix (shipping):** `services/openagentic-api/docker-entrypoint.sh` runs the
Prisma schema sync *before* starting the server:

```sh
./node_modules/.bin/prisma db push --accept-data-loss --skip-generate
exec node dist/server.js
```

This is idempotent: it creates missing tables on first boot and no-ops once the
schema is in sync. If it fails, the entrypoint aborts the start with
`prisma db push failed. Aborting start.` rather than crash-looping the server
against a half-built schema.

### 2. `type "halfvec" does not exist` — pgvector extension missing

**Cause:** the Prisma schema uses pgvector's `halfvec` type for embedding
columns, which requires the `vector` extension to exist *before* `prisma db push`
creates those tables.

**Fix (shipping):** the compose `postgres` service mounts
`./scripts/postgres-init` into `/docker-entrypoint-initdb.d`, and
`01-extensions.sql` runs on first postgres boot:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This runs **once**, on the very first initialization of the `pg-data` volume.
If you hit this error on an existing volume (e.g. a DB created before this fix),
create the extension manually:

```bash
docker compose exec postgres \
  psql -U openagentic -d openagentic -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

### 3. API exits at boot / `FATAL: Milvus not ready` — the `milvus` profile

**Cause:** the API connects to Milvus on boot and exits if it cannot reach it.
The `etcd` / `minio` / `milvus` services are gated behind the `milvus` compose
profile, so a **bare `docker compose up`** (no profile) never starts them and
the API crashes.

**Fix (shipping):** always bring the stack up with the profile — which is what
`install.sh` and the wizard do:

```bash
docker compose --profile milvus up -d
```

`MILVUS_HOST` defaults to the `milvus` service name, so a profile-up install
needs no extra `.env`. The API's `docker-entrypoint.sh` waits up to 5 minutes
for the Milvus gRPC port (`19530`) and `exit 1`s with
`FATAL: Milvus not ready after 5 minutes` if it never accepts connections.

> The `--quick` install path is the one exception: it writes
> `SKIP_TOOL_SEMANTIC_CACHE=true` and uses pgvector inside Postgres instead of a
> Milvus container, so the entrypoint logs `Milvus disabled — using pgvector`
> and skips the wait. The documented standard path is `--profile milvus`.

### 4. `Connect Timeout Error (host.docker.internal:11434)` — undici pool starvation

**Cause:** Node's built-in `fetch` starved its connection pool when chat and
embedding calls hit Ollama concurrently. `setGlobalDispatcher()` from the npm
`undici` package does **not** affect Node's built-in fetch — only a per-call
`dispatcher` does.

**Fix (shipping):** `services/openagentic-api/src/utils/ollama-agent.ts` exports
a shared, generously-sized `undici` `Agent` that is passed explicitly on every
Ollama call:

```ts
export const ollamaAgent = new Agent({
  connections: 64,
  connect: { timeout: 30_000 },
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
});
```

If you still see Ollama connect timeouts, the cause is almost always reachability
rather than pooling: on macOS the containers reach host-Ollama via
`http://host.docker.internal:11434` (the compose `api`/`mcp-proxy` services map
`host.docker.internal` to the host gateway). Confirm Ollama is actually serving
from inside the network:

```bash
docker compose exec api curl -fsS http://host.docker.internal:11434/api/tags
```

### 5. mcp-proxy returns `401` on tool calls — shared internal secrets

**Cause:** the API signs internal JWTs / mints an `oa_sys_` inter-service token,
and the mcp-proxy must verify them with the **same** secret values. If they
disagree, every tool call `401`s (fail-closed).

**Fix (shipping):** compose passes the full set of internal-trust secrets to
every service that needs them. They must agree across `api`, `ui`, `mcp-proxy`,
`workflows`, and `proxy`:

| Secret | Used by | Purpose |
|---|---|---|
| `JWT_SECRET` | api, ui, mcp-proxy, workflows | session + internal JWT signing |
| `SIGNING_SECRET` | api, mcp-proxy, workflows | request signing |
| `INTERNAL_API_KEY` | api, ui, mcp-proxy, workflows, proxy | service-to-service bearer (proxy reads it as `API_INTERNAL_KEY`) |
| `INTERNAL_SERVICE_SECRET` | api, mcp-proxy | mints/verifies the `oa_sys_` system token (HMAC) |

Because `install.sh` generates all of these into one `.env` (or one
`helm-secrets.yaml`) and every service reads from it, they stay in agreement.
The failure mode to watch for is a **stale mcp-proxy image** picking up old
secrets — if you see `401`s on tool calls after a partial update, rebuild and
restart mcp-proxy so it re-reads the current secrets.

### Quick diagnostic recipe

When the API will not come up, read the boot log top-to-bottom — the entrypoint
prints a numbered `[1/4] … [4/4]` dependency check, then the schema sync, before
the server starts:

```bash
docker logs openagentic-api-1 --tail=120
```

`install.sh --doctor` runs a non-destructive preflight (Docker/Compose, Node,
helm/kubectl, disk, port 8080, existing install) and fixes nothing — run it first
when something breaks:

```bash
./install.sh --doctor
```

---

## Backups

The only stateful data you must back up is **Postgres** — it holds users, chat
sessions/messages, flows, providers, MCP config, prompts, and the audit log.
Redis is a cache/queue, Milvus is a rebuildable vector index (re-indexed from
Postgres + the MCP catalog), and the Ollama volume just holds re-pullable models.

The compose defaults are: database `openagentic`, user `openagentic`, data on the
`pg-data` named volume.

### Docker: logical backup with `pg_dump`

```bash
# Dump to a compressed file on the host (custom format = parallel restore).
docker compose exec -T postgres \
  pg_dump -U openagentic -d openagentic -Fc > openagentic-$(date +%F).dump

# Restore into a fresh, empty database (clean + recreate objects).
cat openagentic-2026-06-18.dump | docker compose exec -T postgres \
  pg_restore -U openagentic -d openagentic --clean --if-exists
```

For a plain-SQL dump (human-readable, easy to grep):

```bash
docker compose exec -T postgres \
  pg_dump -U openagentic -d openagentic > openagentic-$(date +%F).sql
```

> Run logical backups against a quiescent or low-traffic window for a consistent
> snapshot. The `pg-data` Docker volume can also be archived at the
> filesystem level, but only while the postgres container is **stopped** —
> copying a live volume risks a torn, unrecoverable image.

### Kubernetes: `pg_dump` through the pod

Postgres runs against a `postgres-data` PersistentVolumeClaim. Stream a dump out
through the pod:

```bash
kubectl -n openagentic exec deploy/postgres -- \
  pg_dump -U openagentic -d openagentic -Fc > openagentic-$(date +%F).dump
```

For production, prefer a scheduled CronJob (or your platform's managed
PVC/volume-snapshot tooling) over ad-hoc dumps.

### What to keep alongside the database

A database dump is not enough to reconstruct the deployment by itself. Keep these
together (all `0600`, none of them in git):

- **`.env`** (compose) or **`~/.openagentic/helm-secrets.yaml`** (Helm) — the
  secrets. Without the original `JWT_SECRET` / `SIGNING_SECRET` /
  `INTERNAL_API_KEY` / `INTERNAL_SERVICE_SECRET`, a restored database's sessions
  and inter-service trust break.
- **`~/.openagentic/cloud-secrets/*.env`** — any cloud MCP credentials you filled
  in by hand.

---

## Scaling notes

OpenAgentic OSS is designed as a **single-instance, single-user** self-hosted
deployment. There is no built-in horizontal-scaling or multi-replica story in
the OSS edition — scale **up** (more CPU/RAM, GPU for Ollama) before you think
about scaling out.

### Vertical scaling (Helm)

The chart sets small, tunable per-service resource requests/limits in
`values.yaml`. Raise them in your overlay for heavier load:

```yaml
# helm/openagentic/values.yaml (defaults shown — raise in your overlay)
resources:
  api:      { requests: { cpu: "250m", memory: "768Mi" }, limits: { memory: "2Gi" } }
  ollama:   { requests: { cpu: "500m", memory: "2Gi"   }, limits: { memory: "6Gi" } }
  workflows:{ requests: { cpu: "100m", memory: "384Mi" }, limits: { memory: "1Gi" } }
  mcpProxy: { requests: { cpu: "100m", memory: "256Mi" }, limits: { memory: "1Gi" } }
  postgres: { requests: { cpu: "100m", memory: "256Mi" }, limits: { memory: "1Gi" } }
```

The biggest lever is the **model layer**. Local inference through Ollama is
CPU-bound by default; give it more cores/memory, or attach a GPU (compose ships
`docker-compose.gpu-nvidia.yml` / `docker-compose.gpu-wsl.yml` overrides). If
latency matters more than self-hosting, point the platform at a hosted provider
(e.g. AWS Bedrock for Claude) via the admin UI — the Smart Model Router is
always on and will route to whatever providers you configure.

### Storage sizing

- **Postgres** grows with chat history, flows, and the audit log — give it a
  durable, appropriately-sized PVC (Helm: `postgres.storage`).
- **Milvus** holds the tool/RAG vector index. It is rebuildable but benefits
  from fast disk.
- **Prometheus** retention defaults to **7 days** (`--storage.tsdb.retention.time=7d`).
  On Helm it is off by default and ephemeral; set `prometheus.persistence: true`
  (+ `storageSize`) for a durable TSDB if you want history to survive restarts.

### Resource preflight

`install.sh` warns when free disk in `$HOME` is low (the images need ~8–10 GB)
and when host port `8080` is already bound. If `8080` is taken, set
`UI_HOST_PORT` to a free port in `.env` rather than fighting the conflict.

---

## Logs

### Docker

Compose configures JSON-file log rotation on every service — 3 files × 10 MB =
**max ~30 MB per container** — so container stdout never fills the disk
(important on WSL2, where it would otherwise grow the VHD unbounded).

```bash
# Tail the API (the most useful log when something is wrong)
docker logs openagentic-api-1 --tail=100 -f

# All services interleaved (remember the profile so milvus stack is included)
docker compose --profile milvus logs -f

# One service
docker compose logs -f mcp-proxy
```

Reading the API boot log is the fastest way to triage a failed start: the
entrypoint prints the numbered `[1/4]…[4/4]` dependency waits (Milvus, Redis,
MCP proxy, embedding model), then `Syncing database schema`, then
`starting API server` before `node dist/server.js` runs.

### Kubernetes

```bash
kubectl -n openagentic logs deploy/api -f --tail=100
kubectl -n openagentic logs deploy/mcp-proxy --tail=100
kubectl -n openagentic describe pod <name>   # events: image pull, pending PVC, OOMKill
```

When a Helm rollout times out, the usual culprits are an image pull failure, a
PVC stuck `Pending` (no default storage class), or a missing secret — all visible
in `kubectl describe pod`.

### Telemetry note

OpenAgentic OSS emits **zero telemetry** — there is no phone-home. Metrics are
local-only: the in-stack Prometheus scrapes the API's `/api/metrics` and backs
the admin-console dashboard analytics. Nothing leaves your network.

---

## Quick reference

| Task | Docker | Kubernetes (Helm) |
|---|---|---|
| Status | `docker compose --profile milvus ps` | `kubectl -n openagentic get pods` |
| Health JSON | `curl -s localhost:8080/api/health \| jq .` | port-forward `svc/api`, then curl |
| API healthy? | `docker inspect --format '{{.State.Health.Status}}' openagentic-api-1` | `kubectl -n openagentic get pods` |
| Logs | `docker logs openagentic-api-1 --tail=100 -f` | `kubectl -n openagentic logs deploy/api -f` |
| Update | `./install.sh --update` | `./install.sh --helm --update` |
| Roll back | redeploy previous tag | `helm rollback openagentic -n openagentic` |
| Backup | `pg_dump -U openagentic -d openagentic -Fc` | `kubectl exec deploy/postgres -- pg_dump …` |
| Diagnose | `./install.sh --doctor` | `./install.sh --doctor` |
| Secrets | `.env` (`${VAR:?}` fail-fast) | `~/.openagentic/helm-secrets.yaml` |
