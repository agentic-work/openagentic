# P3 Wave 4 — Control gaps (C2, C3, C4, C8, C9)

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp`
**Method:** parallel surgical fixes, each build-gated; independently re-verified before commit.

Low-risk, high-certainty NIST control-gap closers. (C1 jwt-alg-pinning was in this
wave but its agent hit an API error mid-run leaving 11 files partially edited —
those were reverted to HEAD and C1 is deferred to after the AAD/OBO excision,
which deletes several of C1's target files outright. C5/C6/C7/C10/C11/C12 remain.)

| ID | Gap | File | NIST | Fix | Verified |
|---|---|---|---|---|---|
| C2 | mcp-proxy HS256 secret fell back to the literal `dev-secret-change-in-production` (forgeable internal tokens) | `mcp-proxy/src/main.py` ~841 | IA-5, CM-6 | Resolve secret from env only; **fail closed** (401) when unset — no literal default | 0 literal refs; pytest 29/29 |
| C3 | `VaultInitService` defaulted the Vault token to `vault-dev-token-change-me` | `api/.../VaultInitService.ts` ~25 | IA-5, CM-6 | `VAULT_TOKEN \|\| ''`; empty token ⇒ `vaultEnabled=false` ⇒ existing disabled/env-secret path | 0 default refs; api tsc 0 |
| C4 | MCP Inspector auto-started in prod (unauthenticated debug surface + unpinned npx) | `mcp-proxy/src/main.py` ~381 | CM-7, SA-15 | Gated behind `ENABLE_MCP_INSPECTOR` (default OFF); skipped-log on the else | flag def + if-guard present |
| C8 | seed-SQL comments leaked `PGPASSWORD=<REDACTED> + `<REDACTED-INTERNAL-NS>` ns + kubectl | `api/prisma/seed-{docs-assistant,flows-agent}.sql` | IA-5, SC-28, CM-6 | Rewrote comments to credential-free `psql -h <host> -U <user> -d <db> -f <file>` | 0 PGPASSWORD/<REDACTED-DB-PASSWORD> refs |
| C9 | `<REDACTED-INTERNAL-NS>` internal namespace hardcoded as a runtime fallback | `api/config/featureFlags.ts`, `api/routes/admin/registry-tombstones.ts` | CM-6, SC-7 | Default to neutral `default` namespace | 0 `'<REDACTED-INTERNAL-NS>'` refs in both |

## Build gates (all green)
- api `tsc --noEmit`: 0 errors
- mcp-proxy pytest (C2/C4 both touched main.py, coexist cleanly): 29/29

## Deferred from this wave
- **C1** (pin `algorithms` on ~21 `jwt.verify` sites + guard test) — re-run after the AAD/OBO excision shrinks its scope (azure-integration/auth.ts, google-auth/index.ts, obo.ts are being deleted).
- **C5** mcp-proxy CORS, **C6** MCP_READ_ONLY default, **C7** pre-commit scanner gaps, **C10** forked workflow engines, **C11** lint gates, **C12** base-image pinning — later waves.
