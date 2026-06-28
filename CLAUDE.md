# openagentic

Open-source agentic work platform.

## What this repo is

The open-source OpenAgentic platform — services for building, orchestrating, and running production-grade AI agents with full control over providers, tools, and infrastructure.

## Services

| Service | Purpose |
|---|---|
| `services/openagentic-api` | Platform API: chat, flows, providers, RAG, admin, Slack/Teams gateway (in-API: `/api/v1/hooks/{slack,teams}` inbound, `/api/admin/integrations` config; integration secrets encrypted at rest via `LOCAL_ENCRYPTION_KEY`) |
| `services/openagentic-ui` | React UI (chat, flows, admin) |
| `services/openagentic-workflows` | Workflow engine (Flowise-derived) |
| `services/openagentic-mcp-proxy` | MCP server proxy (spawns built-in MCPs as subprocesses) |
| `services/openagentic-proxy` | Egress proxy for agent tool calls |
| `services/mcps/*` | 11 built-in MCP servers (aws, azure, gcp, entra/M365, google/Workspace, kubernetes, prometheus, loki, github, admin, web) — these are what the proxy actually wires (see `services/openagentic-mcp-proxy/src/mcp_manager.py` `initialize_servers`). |
| `services/openagentic-ollama` | Optional custom Ollama image with model pre-pull |
| `services/shared` | Cross-service types / utilities |

Top-level `helm/openagentic` is the platform Helm chart (templates only — env-specific values live in downstream deployment repos, not here). The helm path is not wired into the install wizard yet; use the docker path for v1.

## Install + run

The user-facing install path is `install.sh`, which checks Docker/git/Node, clones/updates the repo under `~/.openagentic`, creates cloud-secret stubs, then launches the Ink TUI wizard under `tools/setup/`. The wizard walks the user through deploy target → admin user → Ollama → LLM providers → MCP selection → per-MCP auth → review → launch, writes `.env`, and brings the compose stack up.

End-to-end from a fresh clone on osx or linux:

```bash
# 1. install.sh (clones + runs wizard + brings stack up)
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash

# OR: skip install.sh and drive the wizard against the local checkout
cd ~/path/to/openagentic
(cd tools/setup && npm install)  # first run only
./tools/setup/node_modules/.bin/tsx tools/setup/src/index.tsx
# then: docker compose --profile ui up -d  (full = web UI + API. The `ui` container is gated behind the `ui` compose profile; a bare `docker compose up -d` with NO `--profile ui` is the HEADLESS path — API only, published on the host via API_HOST_PORT, driven by the `oa` CLI under tools/oa. Default vector store = pgvector-only; boots healthy with NO Milvus. Add `--profile milvus` + set MILVUS_ENABLED=true + SKIP_TOOL_SEMANTIC_CACHE=false only for large embedding/RAG workloads)
```

**On osx specifically**, the wizard defaults `OLLAMA_HOST` to `http://host.docker.internal:11434` so containers can reach Ollama running on the host. Docker Desktop's file-sharing must include the user's home dir (for `~/.openagentic/cloud-secrets` mounts) — this is the default, but verify under Docker Desktop → Settings → Resources → File sharing.

Health check after launch:

```bash
# all services should be healthy or running
# (in the default pgvector-only stack etcd/minio/milvus are absent — that's expected;
#  add `--profile milvus` only when running the optional Milvus path)
docker compose ps

# api self-reports connection status to each dependency
curl -s http://localhost:8080/api/health | jq .

# login as the seeded admin
curl -sX POST http://localhost:8080/api/auth/local/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@openagentic.local","password":"<from-wizard>"}'
```

## Boot sequence gotchas (first-run landmines)

These all tripped the first install and are fixed in commits `7266813` and `f7c679d`. If you hit a fresh-install failure, check the logs against these first:

1. **`table admin.prompt_templates does not exist`** — api crashlooping because Prisma migrations never ran. Fix: `services/openagentic-api/docker-entrypoint.sh` now calls `prisma db push --accept-data-loss --skip-generate` before `node dist/server.js`. Idempotent — no-op on subsequent boots.
2. **`type "halfvec" does not exist`** — Prisma halfvec embedding columns need pgvector. Fix: `scripts/postgres-init/01-extensions.sql` runs `CREATE EXTENSION IF NOT EXISTS vector` on first postgres boot via `/docker-entrypoint-initdb.d` mount.
3. **`FATAL: Post-indexing verification failed — semantic search returns 0 results`** — boot was `process.exit(1)`-ing when MCP tool index was empty (always true on first boot). Fix: downgraded those paths in `server.ts` to warn-then-continue; first chat request re-triggers indexing.
4. **`fetch failed: Connect Timeout Error (attempted address: host.docker.internal:11434, timeout: 10000ms)`** — undici pool starved when chat + embedding calls run concurrently. Fix: `services/openagentic-api/src/utils/ollama-agent.ts` exports a shared `Agent` with 64 connections and 30s connect timeout, wired per-call via the `dispatcher` option in `OllamaProvider.ts` and `UniversalEmbeddingService.ts`. `setGlobalDispatcher()` from the npm undici package does NOT affect Node's built-in fetch; only the per-call dispatcher does.
5. **mcp-proxy returning 401 on tool calls** — api signed internal JWTs with `JWT_SECRET`, mcp-proxy didn't have it. Fix: compose now passes `JWT_SECRET` + `SIGNING_SECRET` to both sides.
6. **Internal service auth** — `JWT_SECRET`, `SIGNING_SECRET`, and `INTERNAL_API_KEY` must agree across api, ui, and mcp-proxy. Compose passes them all from `.env`.
7. **`FATAL: Cannot connect to Milvus after 10 attempts` on a bare `docker compose up`** — used to be the biggest first-run blocker: the api treated Milvus as a hard boot dependency and `process.exit(1)`-ed when the Milvus trio (milvus+etcd+minio, profile-gated) wasn't running. Fix: the api now runs **pgvector-only by default** (`MILVUS_ENABLED=false` on the api service, the compose default). `server.ts` gates BOTH Milvus boot blocks behind `isMilvusEnabled()` (false when `MILVUS_ENABLED=false`, `SKIP_TOOL_SEMANTIC_CACHE=true`, or `MILVUS_HOST` is empty); MCP tool/RAG embeddings live in the PostgreSQL `mcp_tools` halfvec columns and `tool_search` resolves via `ToolPgvectorSearchService` (wired into the `/api/internal/tool-search` route as the pgvector fallback when the Milvus `toolSemanticCache` singleton is absent). The api-side `MCPToolIndexingService` populates `search_embedding`/`schema`/`category` in pgvector at boot + on a 30-min cycle (passing a null Milvus client so it skips the Milvus sink). A bare `docker compose up` now boots healthy. Set `MILVUS_ENABLED=true` + `SKIP_TOOL_SEMANTIC_CACHE=false` + `--profile milvus` to restore the Milvus path (unchanged — connect-with-retry, exit(1) on 10 fails).

## Wizard tests

The wizard has a pexpect-driven PTY harness under `tools/setup/tests/`. Run with:

```bash
# first time only — create venv + install pexpect
python3 -m venv tools/setup/tests/.venv
tools/setup/tests/.venv/bin/pip install pexpect

# then
tools/setup/tests/.venv/bin/python tools/setup/tests/pty_harness.py
```

Three variations exercise the main paths: `minimal` (defaults, 1 MCP), `all-mcps-inline` (every MCP with pasted creds), `skip-all-cloud` (enable all, skip aws/azure/gcp when asked). The harness runs the wizard with `WIZARD_DRY_RUN=1` so it writes `.env` but doesn't touch docker.

## Conventions

- No hardcoded model IDs in source outside of provider adapters + seeders (see `services/openagentic-api/src/services/llm-providers/`).
- No hardcoded deployment / tenant / registry strings. Everything environment-specific flows via env vars or Helm values.
- No secrets in code or in this repo. The `.githooks/pre-commit` script blocks known secret patterns.
- Prefer editing existing files over creating new ones.

## Quick start from a fresh clone

1. `git clone https://github.com/agentic-work/openagentic.git && cd openagentic`
2. Re-run the wizard against the local checkout (above), or use `curl … | bash` for the install.sh flow.
3. Run the PTY harness to confirm the wizard still walks cleanly.
4. Bring the stack up with `docker compose --profile ui up -d` (full = web UI + API; the `ui` container is behind the `ui` profile, so a bare `docker compose up -d` is the headless/API-only path driven by the `oa` CLI). Default = pgvector-only; the api boots healthy with NO Milvus. For the optional Milvus path: `docker compose --profile ui --profile milvus up -d` + set `MILVUS_ENABLED=true` and `SKIP_TOOL_SEMANTIC_CACHE=false` in `.env`); wait for `docker inspect --format '{{.State.Health.Status}}' openagentic-api-1` to report `healthy` (usually ~90s first boot because of the Prisma schema push).
5. Smoke test: login via `/api/auth/local/login`, send a chat with `/api/chat/stream`, verify tool calls succeed (the mcp-proxy auto-spawns web/knowledge/admin MCPs; cloud MCPs require creds in `~/.openagentic/cloud-secrets/*.env`).
