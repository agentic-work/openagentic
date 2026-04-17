# openagentic

Open-source agentic work platform.

## What this repo is

The OSS upstream of the OpenAgentic platform — services for building, orchestrating, and running production-grade AI agents with full control over providers, tools, and infrastructure.

**Status:** private while we cut the first public release. A lot of work is still in flight on the internal upstream.

## Services

| Service | Purpose |
|---|---|
| `services/openagentic-api` | Platform API: chat, flows, providers, RAG, admin |
| `services/openagentic-ui` | React UI (chat, flows, admin, code mode) |
| `services/openagentic-workflows` | Workflow engine (Flowise-derived) |
| `services/openagentic-mcp-proxy` | MCP server proxy (spawns built-in MCPs as subprocesses) |
| `services/openagentic-exec` | Per-user exec container; spawns the Code Mode CLI (claude / gemini / etc.) |
| `services/openagentic-server` | Openagentic CLI bridge |
| `services/openagentic-proxy` | Egress proxy for agent tool calls |
| `services/openagentic-synth` | OAT tool-synthesis framework runner |
| `services/mcps/*` | Built-in MCP servers (aws, azure, admin, github, k8s, prometheus, loki, alertmanager, web, knowledge, gcp) |
| `services/shared` | Cross-service types / utilities |
| `services/ollama` | Local Ollama bring-your-own-models config |

Top-level `helm/openagentic` is the platform Helm chart (templates only — env-specific values live in downstream deployment repos, not here). The helm path is not wired into the install wizard yet; use the docker path for v1.

## Install + run

The user-facing install path is `install.sh`, which checks Docker/git/Node, clones/updates the repo under `~/.openagentic`, creates cloud-secret stubs, then launches the Ink TUI wizard under `tools/setup/`. The wizard walks the user through deploy target → admin user → Ollama → LLM providers → MCP selection → per-MCP auth → coding CLI → review → launch, writes `.env`, and brings the compose stack up.

End-to-end from a fresh clone on osx or linux:

```bash
# 1. install.sh (clones + runs wizard + brings stack up)
curl -sSL https://raw.githubusercontent.com/agentic-work/openagentic/main/install.sh | bash

# OR: skip install.sh and drive the wizard against the local checkout
cd ~/path/to/openagentic
(cd tools/setup && npm install)  # first run only
./tools/setup/node_modules/.bin/tsx tools/setup/src/index.tsx
# then: docker compose up -d
```

**On osx specifically**, the wizard defaults `OLLAMA_HOST` to `http://host.docker.internal:11434` so containers can reach Ollama running on the host. Docker Desktop's file-sharing must include the user's home dir (for `~/.openagentic/cloud-secrets` mounts) — this is the default, but verify under Docker Desktop → Settings → Resources → File sharing.

Health check after launch:

```bash
# all services should be healthy or running
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
4. **`fetch failed: Connect Timeout Error (attempted address: hal:11434, timeout: 10000ms)`** — undici pool starved when chat + embedding calls run concurrently. Fix: `services/openagentic-api/src/utils/ollama-agent.ts` exports a shared `Agent` with 64 connections and 30s connect timeout, wired per-call via the `dispatcher` option in `OllamaProvider.ts` and `UniversalEmbeddingService.ts`. `setGlobalDispatcher()` from the npm undici package does NOT affect Node's built-in fetch; only the per-call dispatcher does.
5. **mcp-proxy returning 401 on tool calls** — api signed internal JWTs with `JWT_SECRET`, mcp-proxy didn't have it. Fix: compose now passes `JWT_SECRET` + `SIGNING_SECRET` to both sides.
6. **exec rejecting session creation with "INTERNAL_API_KEY required"** — compose now passes a shared `INTERNAL_API_KEY` to both `api` and `exec`.

## Code Mode

The ptyManager in `services/openagentic-exec/src/ptyManager.ts` spawns a CLI per session based on `CODING_ADAPTER`:

| adapter | binary | bundled in exec image |
|---|---|---|
| `claude-code` (default) | `claude` | yes |
| `gemini-cli` | `gemini` | yes |
| `aider` | `aider` | no — `pip install aider-chat` |
| `opencode` | `opencode` | no |
| `open-interpreter` | `interpreter` | no |
| `cursor-cli` | `cursor` | no |
| `none` | `/bin/bash` | yes |

Switching adapter: either re-run the wizard, flip `CODING_ADAPTER=...` in `.env` and `docker compose up -d --force-recreate exec`, or update in the admin UI (persists to `SystemConfiguration` and overrides the env on next session spawn). The selected adapter's API key comes from the LLM-provider step in the wizard (`ANTHROPIC_API_KEY` for claude-code, `GEMINI_API_KEY`/`GOOGLE_GENERATIVE_AI_API_KEY` for gemini-cli).

## Upstream sync

`tools/sync-upstream.py` pulls from `$OAP_UPSTREAM` (default `~/agenticwork/agentic`) with path renames, brand rewrite, a skip-list for proprietary content, and a preserve-list for OSS-only patches. It automatically runs `tools/scrub-headers.py` on completion to strip copyright/license boilerplate the upstream keeps adding.

Files in the PRESERVE list never get overwritten — any local fix you want to survive a sync must be added there. The current preserve list includes our entrypoint fix, the undici agent, the adapter-aware ptyManager, the wizard, docker-compose.yml, install.sh, etc.

```bash
python3 tools/sync-upstream.py --dry-run  # preview
python3 tools/sync-upstream.py            # sync + auto-scrub
```

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

## Continuing this work from another machine

This doc is meant to let `claude --continue` on a fresh clone (osx or linux) pick up where the install/test work left off. The happy path:

1. `git clone git@github.com:agentic-work/openagentic.git && cd openagentic`
2. `claude --continue` in this directory — the memory system will pull prior context (user profile, feedback rules, project state).
3. Re-run the wizard against the local checkout as above, or use `curl | bash` for the real install.sh flow.
4. Run the PTY harness to confirm the wizard still walks cleanly.
5. Bring the stack up with `docker compose up -d`; wait for `docker inspect --format '{{.State.Health.Status}}' openagentic-api-1` to report `healthy` (usually ~90s first boot because Prisma schema push + Milvus collections).
6. Smoke test: login via `/api/auth/local/login`, send a chat with `/api/chat/stream`, verify tool calls succeed (the mcp-proxy auto-spawns web/knowledge/admin MCPs; cloud MCPs require creds in `~/.openagentic/cloud-secrets/*.env`).
