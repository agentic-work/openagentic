# P3 Wave 2 — Security blockers (B1–B4, the GO-gate criticals)

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp`
**Method:** TDD (RED→GREEN), each fix gated by api `tsc` (0 errors) + service test suite.

The two world-readable authentication bypasses + the fail-open root cause + the
unauth SSRF — the findings that made P2 a NO-GO. All fixed fail-closed.

## B1 — committed `*-change-me` secret defaults (CRITICAL · IA-5, SC-12, AC-3, CM-6)

`docker-compose.yml` defaulted `JWT_SECRET`/`SIGNING_SECRET`/`INTERNAL_API_KEY`/
`FRONTEND_SECRET` to world-readable `openagentic-dev-*-change-me` literals under
`NODE_ENV=production`. Anyone with the public repo could forge an admin JWT.

**Fix:** every secret now uses the required-var form `${VAR:?…}` (mirroring the
existing `POSTGRES_PASSWORD`) — a bare `docker compose up` fails fast with a
helpful message. `install.sh` and `.env.example` now generate/list all five
required secrets (added `INTERNAL_API_KEY`, `FRONTEND_SECRET`,
`INTERNAL_SERVICE_SECRET`). **Verified:** `docker compose config` errors on a
missing var; 0 `change-me`/`change-in-prod` defaults remain; YAML parses.

## B2 — `secrets.config.ts` fail-OPEN root cause (CRITICAL · IA-5, CM-6, SI-10)

The validator "never crashed": on a missing/placeholder secret it generated an
ephemeral value and continued, and its blocklist matched `change-me` only as an
EXACT value — so the shipped `openagentic-dev-jwt-secret-change-me` slipped
through and the API booted signing JWTs with it.

**Fix:** `validateSecret` now FAILS CLOSED under `NODE_ENV=production` (throws,
aborting boot) on a missing or weak secret; added `change-me`/`change_me`/
`changeme`/`change-in-prod`/`dev-`/`dev_` to the substring blocklist. Dev keeps
the auto-generate convenience. `startup/01-secrets.ts` is now `critical: true`
and re-raises in production (was swallowing the throw). **Test:**
`src/config/__tests__/secrets-fail-closed.test.ts` 5/5. api `tsc` 0 errors.

## B3 — mcp-proxy auth bypass (CRITICAL · AC-3, AC-6, IA-2, IA-5)

`get_user_info()` granted `system-admin` to credential-less callers and
`system-root` (+ SP cloud creds) to any `Bearer oa_sys_<anything>` with zero
verification, before any `ENABLE_AUTH` check. The OBO call sites silently fell
back to passing the user's original AAD token upstream on exchange failure.

**Fix (in `src/main.py`):**
- No credentials → `HTTPException(401, missing_authorization)` when `ENABLE_AUTH`
  (local-dev admin context only when auth is explicitly disabled).
- `oa_sys_` tokens are HMAC-verified via `compute_system_token_suffix` +
  `verify_system_token` (constant-time compare against `INTERNAL_SERVICE_SECRET`,
  matching the api's `mintInterServiceSystemToken`). The prefix alone is never
  trusted; a forged/empty-secret token → 401.
- `bootstrap_jwt_keys()` + `BootError`: boot fails closed on a missing/`dev-secret`
  signing key.
- `require_obo_token()` + `acquire_azure_obo_tokens()`: OBO exchange failure →
  `401 obo_failed`, never the original-token passthrough. The 3 legacy
  `exchange_for_audience` call sites (proxy_mcp_request, batch_call_tools,
  call_mcp_tool) were rewired through the fail-closed helper.
- Compose now passes `INTERNAL_SERVICE_SECRET` to BOTH api (mints) and mcp-proxy
  (verifies) — previously the proxy never received it.

**Tests:** `tests/test_auth_hardening.py` 17/17 + `tests/test_jwt_auth.py` 12/12
= **29/29** green. (OBO call-site rewire delegated to a focused agent against the
fixed test contract; HMAC helper + no-creds gate done directly.)

## B4 — unauthenticated probe-ollama SSRF (HIGH · SC-7, AC-4, AC-3, SI-10)

`POST /api/setup/probe-ollama` fetched an attacker-controlled `host` with no
validation and stayed live forever — an internal port-scan + cloud-metadata
(`169.254.169.254`) primitive.

**Fix (in `routes/setup.ts`):** (1) a `needsSetup` gate — returns 409 once an
admin exists (the durable fix: the route dies post-setup); (2) `ssrfReject()`
blocks the IMDS endpoints (`169.254.169.254`, `fd00:ec2::254`,
`metadata.google.internal`) and any non-http(s) scheme before fetch. A
legitimate LAN/loopback/`host.docker.internal` Ollama is still allowed
pre-setup (no blanket RFC1918 block — that would break the install).
**Test:** `src/routes/__tests__/setup-probe-ssrf.test.ts` 5/5. api `tsc` 0 errors.

## Build gates (all green)

- api `tsc --noEmit`: **0 errors** (baseline maintained)
- api vitest (B2+B4): 10/10
- mcp-proxy pytest (B3): 29/29
- `docker compose config`: parses; fails fast on missing required secret
