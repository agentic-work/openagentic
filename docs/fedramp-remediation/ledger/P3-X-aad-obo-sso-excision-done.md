# P3-X — AAD IdP / OBO / Google-SSO Excision (DONE)

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp`
**Method:** 4 build-gated tracks (A=api, B=mcp-proxy, C=ui in parallel; D=infra after). Every gate **independently re-verified** by the orchestrator (not trusted from agent self-reports). 32 files deleted, 44 edited.

## Directive

The OSS edition is **local-auth only**. Removed: Azure-AD/Entra user login, the OBO
(on-behalf-of) user-token→cloud-token exchange (for *any* MCP), and Google SSO login —
all enterprise-only. Kept: local username/password, all inter-service auth, and
**Service-Principal / static-keypair / ADC** cloud credentials for CSP MCPs.
Refinement: the **SP-based Azure cost dashboards stay** (only `azure-integration/auth.ts`
— the OBO part — removed); users pull Azure costs via the same SP the azure MCP uses.

## What was removed (32 deletes)

**api (25):** `auth/azureADAuth.ts`, `auth/googleAuth.ts`, `services/{AzureOBOService,AzureTokenService,AdminValidationService,AzureGroupService,UserAzureMCPService}.ts`, `routes/obo.ts`, `routes/google-auth/`, `routes/azure-ad-sync.ts`, `routes/account-linking.ts`, `routes/azure-integration/auth.ts`, `routes/v1/credentials.ts`, `utils/validateAzureToken.ts`, `middleware/azureAdAuth.ts`, `plugins/integrations.plugin.ts`, + 7 OBO/AAD/Google test files that asserted removed behavior.
**mcp-proxy (4):** `azure_oauth.py`, `azure_obo_strategy.py`, `user_session_manager.py`, `test_azure_obo_strategy.py`.
**ui (3):** `AADLogin.tsx`, `AuthCallback.tsx`, `services/AzureTokenService.ts`.

## What was surgically edited (44) — KEEP code preserved

- **api guardrails:** `tokenValidator.ts` (kept local `jwt.verify(token,JWT_SECRET)→tenantId:'local'` + `validateApiKey` bcrypt oa_/oa_sys_ + `extractBearerToken`; removed AAD/Google branches; **`UserContext` relocated to new `auth/types.ts`**), `unifiedAuth.ts` (kept the internal-service bypass + token extraction + email-remap + api-key audit; removed only azure_oid hydration + the azure-ad auto-sync block).
- **api `routes/auth.ts`:** rewritten — kept inter-service `/verify` + `/validate-token`, local `/me`/`/logout`/`/change-password`(now bcrypt)/`/client-ip`; removed the Microsoft OAuth flow, `/obo`, `/admin/validate-azure`, Graph-group logic, sso_login.
- **THE critical keep — `buildChatV2Deps.ts`:** the HS256 internal-JWT branch (signs with `JWT_SECRET`→`API_INTERNAL_KEY`) survives — this is what authenticates local-user chat→mcp-proxy tool calls. Verified present (3 signer refs) + the e2e gate.
- **`auth.plugin.ts`:** flipped `ssoActive` so `localAuthRoutes` **always** registers.
- **azure-integration:** kept `metrics/admin/events/index.ts` (SP cost dashboards) + `azureIntegrationPlugin` registration; removed only `auth.ts`.
- **mcp-proxy `get_user_info`:** kept the no-creds→401 gate, `oa_sys_` HMAC, oa_ user-key, INTERNAL_API_KEY, and the HS256 internal-JWT branch + except handlers byte-identical; removed the RS256/JWKS Azure branch + AAD group helpers + the 3 OBO call sites. `mcp_manager.py`: `supports_obo=False` for aws/azure, kept SP/static-keypair env. Dropped `msal`.
- **ui `Login.tsx`:** kept the local form + `handleLocalLogin → /api/auth/local/login` + `auth_token`; stripped the SSO buttons.

## Infra (track D)

`docker-compose.yml` — dropped AAD/Google passthrough envs; kept the 5 internal secrets, the `cloud-secrets/*.env` + RO host-CLI mounts (SP/SA cloud creds), `AZURE_OPENAI_*` (LLM), and the SP envs (`AZURE_CLIENT_ID/SECRET/TENANT_ID/SUBSCRIPTION_ID`) the azure MCP + cost dashboard need. **`sync-upstream.py`** — removed googleAuth/google-auth from PRESERVE; added every deleted path to SKIP (so a sync never re-creates them); kept `routes/auth.ts` in PRESERVE (edited inter-service version wins). Verified: no live PRESERVE entry references a deleted file.

## Independently-verified gates (all green)

| Gate | Result |
|---|---|
| api `tsc --noEmit` | **0 errors** |
| mcp-proxy `pytest test_jwt_auth + test_auth_hardening` | **19 passed** (10 OBO tests correctly removed) |
| ui `vite build` | **✓ built** |
| no live AAD/OBO refs in kept src | confirmed (only comments + prisma columns + LLM `google-auth-library`) |
| local login path | `local-auth.ts POST /login` (bcrypt) + always-registered + ui form intact |
| SP cloud creds independent of OBO | confirmed (cloud-secrets mount + `mcp_manager` env merge) |
| sync-upstream `--dry-run` | clean; excised paths SKIP'd, not re-pulled |

## Deferred (phase-2)

Prisma column drops (Azure/SSO models + `User.azure_oid` etc.) — forward-only
migration, NOT db push; safe interim is leaving them nullable/unused. No active
code path consumes them after this excision.

## FedRAMP impact

Moots B3-OBO hardening, audit PORTS P2 (MFA-freshness) + the Azure parts of P3.
C1 (jwt-alg-pinning) now shrinks to HS256-only on the kept files (no asymmetric/
`none`-confusion surface remains).
