# P3 Wave 3 — Doc & wiring blockers (B9, B10, B12, B13)

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp`
**Method:** 4 parallel file-scoped agents, each self-verified; then independently re-verified by greps + build gates before commit.

The credibility blockers a discerning OSS reviewer hits in the first five minutes
(wrong license, fabricated docs, crash-loop quickstart, dead/fabricated pages).

## B9 — mcp-proxy README: wrong license + mass fabrication (HIGH · SA-5, CM-2/6)

`services/openagentic-mcp-proxy/README.md` declared **MIT** (repo is Apache-2.0)
and fabricated content: `your-org` clone URLs, invented contacts (Slack channel,
`mcp-proxy-team@`, `docs.openagentic.io`), a non-existent helm path
(`helm/openagenticchat-v3`), fictional source files (`tool_registry.py`,
`health_monitor.py`, `metrics.py`, `config/mcps.json`), invented API endpoints,
env vars, Prometheus metrics, and removed System MCPs.

**Fix:** rewrote only the false sections against verified reality — Apache-2.0;
`agentic-work` org + `hello@agenticwork.io`; `helm/openagentic`; the REAL src/
files; the REAL FastAPI routes (`/mcp`, `/mcp/tool`, `/call`, `/batch-call`,
`/tools`, `/servers/*`, `/user-sessions/*`, `/version`); the REAL
`OpenAgentic_*_MCP_DISABLED` toggles; the 9 actually-wired MCPs. Where uncertain,
removed rather than invented. **Verified:** 0 refs to `MIT`/`your-org`/
`openagenticchat-v3`/the fabricated files; `Apache-2.0` present.

## B10 — CONTRIBUTING crash-loop quickstart (HIGH · SA-5, CM-2)

The quickstart used a bare `docker compose up -d`, which does not start Milvus —
the api requires it on boot, so the documented first command crash-loops.

**Fix:** both full-stack `up -d` calls (quickstart + wipe-and-restart) now use
`docker compose --profile milvus up -d`. The scoped invocations (`--force-recreate
api`, `up -d postgres redis` for unit tests) correctly left bare. The `.env` note
now points to install.sh / the wizard and lists all 5 required internal secrets
(`openssl rand -hex 32`). **Verified:** grep — only the 2 scoped calls remain bare.

## B12 — dead cluster plugin → permanent 404 (HIGH · SA-11, CM-6)

The docs "Deployed Services" page called `GET /api/cluster/services`, but
`clusterPlugin` was never registered in `server.ts` (its own header falsely
claimed it was) → permanent 404 + 30s error-poll.

**Fix:** registered `clusterPlugin` at `/api/cluster` in `server.ts`
`registerAllRoutes()` (same encapsulated dynamic-import pattern as `docs.plugin.ts`);
confirmed the handler degrades gracefully off-cluster (returns empty inventory,
not 500). **Verified:** registration present in `server.ts:928`; api `tsc` 0 errors
(baseline maintained).

## B13 — ApiRoutesPage advertised fabricated endpoints (HIGH · SA-5)

`ApiRoutesPage.tsx` hardcoded a curated route table advertising endpoints the API
never serves (`/api/chat/completions`, `/api/conversations*`, `/api/flows*`,
`/api/mcp/invoke`, …). The real chat API is `/api/chat/stream` + `/api/chat/sessions/*`.

**Fix (option A — truth from source):** deleted the hardcoded `routeGroups` array
and repointed the page to render from the build-generated OpenAPI manifest
(`public/docs/generated/api-routes.json`, 570 real routes). **Verified:** 0 refs to
`/api/chat/completions`/`/api/conversations`/`routeGroups`; `ui vite build` ✓.

## Build gates (all green)

- api `tsc --noEmit`: **0 errors** (baseline maintained)
- ui `vite build`: ✓ built
- greps confirm every fabricated/wrong reference removed
