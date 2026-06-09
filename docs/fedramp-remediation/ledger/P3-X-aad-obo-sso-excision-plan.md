Critical infra findings confirmed:

1. **compose** already defaults `AUTH_PROVIDER:-local` (L269/345) and AAD/Google envs are passthrough stubs (`:-` empty). So compose needs only cleanup, not re-wiring — the local default already holds.
2. **wizard** (`tools/setup/src/`) has **zero** AAD/Google references — already local-only. Good.
3. **sync-upstream PRESERVE** currently PRESERVES `googleAuth.ts`, `google-auth/index.ts`, and `routes/auth.ts` (lines 661-672) — these are PRESERVE entries that **conflict** with the excision (they'd keep re-pulling the AAD/Google surface from upstream). The plan must move these from PRESERVE to SKIP-equivalent after excision.

I have enough verified ground truth. Producing the plan.

# AAD-IdP / OBO / Google-SSO Excision Plan — OSS Local-Auth-Only Edition

> Drives the `P3-X` excision workflow. Verified against the working tree on `audit/full-sync-v2` (2026-06-09). Line numbers are from the current files; treat them as anchors, re-grep before each edit.

---

## 1. Summary

**Goal:** Remove three federated-identity surfaces — (1) Azure-AD/Entra user login (OAuth redirect/callback/group-validation), (2) OBO user-token→cloud-token exchange, (3) Google SSO login — across `openagentic-api`, `openagentic-mcp-proxy`, `openagentic-ui`, and infra. **Keep** local username/password, all inter-service auth (HS256 JWT, `oa_sys_` HMAC, `INTERNAL_API_KEY`, API keys), the SA/static/ADC cloud-MCP credential path, and the Azure-OpenAI / Google-Vertex **LLM provider** backends.

**Surface counts (verified):**

| Kind | Count | Notes |
|---|---|---|
| Whole-file deletes | **23** | api: 13 src + 2 tests · mcp-proxy: 3 src + 1 test · ui: 4 (3 confirmed in maps) · +api `v1/credentials.ts` (OBO-only) |
| Surgical edit-out (file kept) | **~20** | The two api guardrails (`tokenValidator.ts`, `unifiedAuth.ts`), `routes/auth.ts`, chat pipeline (4 files), workflows (2), `mcp-proxy/main.py` (8 edit blocks + 1 RS256 branch), ui (`modules.d.ts`, `ChatContainer.tsx`, `App.tsx`, `Login.tsx` cleanup) |
| Route/plugin unregisters | **~6** | api `server.ts` ×3, `auth.plugin.ts` (obo+google+ssoActive flip), `v1/index.ts`, mcp-proxy `/auth/*`+`/user-sessions/*` |
| Env / dep / compose / docs | **~8** | api+proxy env globals, `requirements.txt` (`msal`), compose AAD/Google passthroughs, `sync-upstream.py` PRESERVE→drop, README/comment rewording |
| Prisma (phase-2, needs-care) | **1** | forward migration, NOT db push |

**Two corrections to the area maps (verified, load-bearing):**

- **`integrations.plugin.ts` is NOT a clean orphan.** Two tests bind to it: `__tests__/architecture/server-routes-not-leaked.integrations.source-regression.test.ts` (L69 asserts `server.ts` must contain `register(integrationsRoutesPlugin`) and `plugins/__tests__/integrations.plugin.test.ts` (L88 imports it). The source-regression test is **already red on main** (server.ts registers the 3 modules *directly* at L1331/1340/1640, never via the plugin). Whole-file-deleting `integrations.plugin.ts` is still correct, but **both test files must be deleted in the same pass** or api CI goes redder.
- **`sync-upstream.py` PRESERVE actively re-pulls the AAD/Google surface.** Lines 661-662 PRESERVE `googleAuth.ts` + `google-auth/index.ts`, and L672 PRESERVEs `routes/auth.ts`. Left as-is, the next sync re-introduces everything excised. These three must move out of PRESERVE (and the excised whole-file paths added to SKIP) as a mandatory final step.

**Good news (verified, no work needed):** compose already defaults `AUTH_PROVIDER=local` (L269/345) with AAD/Google envs as empty `:-` passthroughs; the wizard (`tools/setup/src/`) has **zero** AAD/Google references already.

---

## 2. REMOVE list (grouped by service)

### 2a. `openagentic-api`

**Whole-file deletes (`src/`):**

| Path | Kind · Risk | What breaks if wrong |
|---|---|---|
| `auth/azureADAuth.ts` | delete · **needs-care** | Exports `UserContext` TYPE consumed by `tokenValidator.ts` (L16) + `middleware/authorization.ts` (L8). MUST relocate `UserContext` (local def in tokenValidator or new `auth/types.ts`) before delete or every `validateAnyToken` consumer fails to compile. |
| `auth/googleAuth.ts` | delete · safe | Consumers: tokenValidator Google branch + `routes/google-auth/index.ts` (both removed). |
| `routes/google-auth/index.ts` | delete · safe | Unregister at `auth.plugin.ts` L77-81 first. |
| `routes/obo.ts` | delete · safe | Unregister at `auth.plugin.ts` L20+L70 first. |
| `routes/azure-integration/` (dir) | delete · **needs-care** | Unregister `server.ts` L1640-1641. Contains OBO `auth.ts` + Azure cost dashboards (metrics/admin/events) — recommend drop whole dir for OSS local-only. |
| `routes/azure-ad-sync.ts` | delete · safe | Unregister `server.ts` L1331-1332. |
| `routes/account-linking.ts` | delete · safe | Unregister `server.ts` L1340-1341. Instantiates `AzureOBOService`. |
| `routes/v1/credentials.ts` | delete · **needs-care** | **Confirmed OBO-only** (imports `AzureOBOService` L19, `/exchange` does OBO at L227). Unregister `routes/v1/index.ts` L120-122 first. |
| `plugins/integrations.plugin.ts` | delete · **needs-care** (not "safe") | **Delete its 2 bound tests too** (see §1 correction): `__tests__/architecture/server-routes-not-leaked.integrations.source-regression.test.ts` + `plugins/__tests__/integrations.plugin.test.ts`. |
| `services/AzureOBOService.ts` | delete · **needs-care** | MSAL `acquireTokenOnBehalfOf` — OBO engine. Consumers: `routes/auth.ts`, `account-linking.ts`, `v1/credentials.ts` — all removed/edited first. |
| `services/AzureTokenService.ts` | delete · **risky** | Widest web: `routes/auth.ts`, `obo.ts`(del), `chat/index.ts` L33/109, `chat/services/ChatAuthService.ts` L9/32, `buildChatV2Deps.ts`, `AdminValidationService.ts`, `WorkflowScheduler.ts` L445, `InitializationService.ts`, `workflows.ts` L1595/1761. **Every consumer must drop its OBO call before this file is deleted** or tsc breaks broadly. |
| `services/AdminValidationService.ts` | delete · needs-care | Consumers: `routes/auth.ts` (3 sites), `local-auth.ts` (orphan import drop), `InitializationService.ts` L7. |
| `services/AzureGroupService.ts` | delete · needs-care | `routes/admin.ts` L16/L103 must drop import + usage first. |
| `services/UserAzureMCPService.ts` | delete · safe | No consumers (dead). |
| `middleware/azureAdAuth.ts` | delete · safe | Dead (superseded by unifiedAuth). |
| `utils/validateAzureToken.ts` | delete · safe | Only consumer is `AzureTokenService.ts` (deleted). |

**Surgical edit-out (file KEPT):**

| Path | What to REMOVE · Risk | What breaks if wrong |
|---|---|---|
| `auth/tokenValidator.ts` | imports L16-17, `AUTH_PROVIDER`+singletons L21-27, token-type detection (tid/oid/google), Google branch (~L139-200), Azure-AD `else` branch (~L250-300), `'azure-ad'\|'google'` from tokenType union L46. **Relocate `UserContext`.** · **needs-care** | All `validateAnyToken` callers (`unifiedAuth`, `authenticate`, `auth.ts`, `server.ts`, `adminGuard`, `grafana-proxy`, `background-jobs`, `uploads`) — signature unchanged, only AAD/Google token types stop validating. |
| `middleware/unifiedAuth.ts` | **azure_oid hydration L304-313 ONLY** (keep the email-remap L286-302), entire azure-ad auto-sync block L324-387, `oid`/`azureOid` fields L25-26 + L64+L77, `'azure-ad'\|'google'` from buildRequestUser union L66. **KEEP ENTIRELY** internal-service bypass L100-214, token extraction L216-256, validateAnyToken+buildRequestUser L258-272, api-key audit. · **needs-care** | THE global auth hook. Edits are subtractive *within* branches; local + internal-service paths must remain byte-identical. |
| `routes/auth.ts` | initializeUserMCPInstances azure-spawn (~L40-106), Azure/OBO service instantiation (~L109-119), Graph-group logic in `/validate`+`/me`, `POST /api/admin/validate-azure`, `POST /api/auth/obo`, the whole AAD OAuth flow (`/microsoft*`, `/exchange-session` ~L1688-2103), `logAuthEvent provider:'azure'`+`sso_login`. **KEEP** `/api/auth/verify` (L374-582, inter-service), `/validate-token` (L1406-1479), `/logout` (drop azure cleanup), `/accept-disclaimer`, `/client-ip`. Rewrite `change-password` (L1487, currently 400s "use Azure portal") for local. · **risky** | Mixes KEEP (inter-service verify/validate-token used by proxy/workflows/nginx auth_request) with REMOVE. Must be edited, not deleted. |
| `services/buildChatV2Deps.ts` | OBO branch in `buildMcpProxyHeaders`: isValidAzureJwt/isAzureAdAuth (L546-550), azure-ad Bearer-OBO branch (L552-569), `AzureTokenServiceLike` param plumbing (L524-531,650,732,898,1260), `X-Azure-ID-Token`/`X-AWS-ID-Token` (L609-614). **KEEP the HS256 internal-JWT branch L570-607** (signs with JWT_SECRET/SIGNING_SECRET → API_INTERNAL_KEY fallback) + X-User-Email/Id hints L616-619. · **risky** | The kept HS256 branch is what authenticates local users' chat→mcp-proxy tool calls. Removing it breaks all tool execution. |
| `routes/chat/handlers/stream.handler.ts` | OBO header-plumb block (~L1552+): isAzureUser detection, getAzureTokenInfo/isTokenExpired loads, `resolvedAuthMethod='azure-ad'`. **KEEP** the #51 connected-vs-needsAuth logic L1387-1447 (reword to drop OBO/azure narrative). · needs-care | Self-contained removal; getAzureTokenInfo is an optional dep. |
| `routes/chat/index.ts` | import AzureTokenService L33, `new AzureTokenService` L109, `azureToken` dep L194, wiring into buildChatV2Deps L332-337 + getAzureTokenInfo into stream.handler. · needs-care | Subtractive; chat still works via kept HS256 path. |
| `routes/chat/services/ChatAuthService.ts` | import+field+ctor of AzureTokenService L9/28/32, `getAzureTokenInfo()` L334-371. **KEEP** rate-limit/permissions/healthCheck. · needs-care | Only OBO method removed. |
| `routes/workflows.ts` | run-as-user OBO blocks L1595-1597 + L1761-1794. · needs-care | Cloud tools in flows fall back to SA/static creds. |
| `services/WorkflowScheduler.ts` | #1275 run-as-user OBO block L431-474 (`getOrRefreshToken`→scheduledAuthToken). · needs-care | scheduledAuthToken→undefined→SA creds. |
| `services/InitializationService.ts` | imports L7-8, azureValidation/azureSDKKnowledge flags L25-29/233-237, `validateAzureConfiguration()` step L327-330. · needs-care | One fewer boot step. |
| `routes/local-auth.ts` (**KEEP file**) | orphan import `AdminValidationService` L17 (never used), `AzureTokenService` L18 if unused, azureOid/azureTenantId fields + `MapAzureRequest` + `/map-azure` L25-57. · needs-care | PRIMARY login path — strip only vestigial Azure-link fields. |
| `routes/admin.ts` | import AzureGroupService L16 + `new AzureGroupService()` L103 + the AAD-group admin endpoint. · needs-care | Drops AAD-group admin feature only. |
| `middleware/authorization.ts` | repoint `UserContext` import (L8) from azureADAuth to relocated def. authorize() is generic — KEEP. · safe | Pure type-import fix. |

**Route/plugin unregisters:**

| Path | What · Risk |
|---|---|
| `plugins/auth.plugin.ts` | Remove `oboRoutes` import L20 + register L70; Google conditional register L77-81; **flip `ssoActive` gate L50-66 so `localAuthRoutes` ALWAYS registers** (currently L60-61 registers local only when NOT ssoActive). KEEP `authRoutes` register L36. · needs-care |
| `server.ts` | Remove direct registrations: azureADSyncRoutes L1330-1336, accountLinkingRoutes L1339-1345, azureIntegrationPlugin L1638-1645 (each in own try/catch). · needs-care |
| `routes/v1/index.ts` | Unregister `credentialRoutes` L120-122. · needs-care |

**Env (api):** strip from wiring — `AZURE_*`/`AAD_*` (CLIENT_ID/SECRET/TENANT_ID/AUTHORITY/REDIRECT_URI/AUTHORIZED_GROUPS), `AZURE_ADMIN_GROUPS`, `AZURE_GROUP_MAPPINGS`, `VITE_AZURE_AD_AUTHORIZED_GROUPS`, `EXTERNAL_ADMIN_EMAILS`, `KNOWN_GUEST_ADMINS`, `SKIP_GROUP_VALIDATION`, `AZURE_GRAPH_*`, `AZURE_OBO_MFA_FRESHNESS_MINUTES`, `GOOGLE_CLIENT_*`/`GOOGLE_ALLOWED_*`/`GOOGLE_ADMIN_*`, `AUTH_PROVIDER`, `AUTH_MODE`. **KEEP** `JWT_SECRET`, `SIGNING_SECRET`, `INTERNAL_SERVICE_SECRET`, `INTERNAL_API_KEY`/`API_INTERNAL_KEY`, `FRONTEND_URL`, `MCP_PROXY_URL`, and all `AZURE_OPENAI_*` (LLM provider).

**`prisma/schema.prisma` — phase-2, risky:** forward migration only, NOT db push. AAD/OBO/SSO models: `UserAuthToken`/user_azure_tokens (L181-197), `AzureAccount` (L274-290), `LinkedAzureAccount` (L292-305), `UserSettings.azure_*` (L307-314), `AccessRequest` (L117-139), `AuthAllowedUser`/`AuthAllowedDomain` (L145-179), `User.azure_oid/azure_tenant_id/oauth_provider/oauth_id` (L27-30), `MCPServerConfig.require_obo` (L909), `ProviderServer.require_obo` (L2192). **KEEP** `auth_audit_log` (L1299-1321) minus `sso_login` event value. Interim-safe: leave columns nullable/unused; physical drop is a separate forward migration after code excision lands green.

### 2b. `openagentic-mcp-proxy`

**Whole-file deletes:**

| Path | Kind · Risk | What breaks if wrong |
|---|---|---|
| `src/azure_oauth.py` | delete · needs-care | AAD OAuth2+PKCE (MSAL). Consumers: `main.py` L36 import, L288 global, L377 lifespan init, `/auth/*` endpoints. Delete consumers same pass. |
| `src/azure_obo_strategy.py` | delete · safe | Only `tests/test_azure_obo_strategy.py` imports it (main.py inlines its own audience check). |
| `src/user_session_manager.py` | delete · needs-care | Per-user `azmcp` OBO subprocess. Consumers: `main.py` L35 import + `/user-sessions/*` + `/auth/callback`+`/auth/logout`+`/auth/manual-session`. |
| `tests/test_azure_obo_strategy.py` | delete · safe | Imports deleted module. |

**Surgical edit-out (`main.py`, line-verified):**

| Lines · Kind | What to REMOVE · Risk |
|---|---|
| L79-81 env | `TENANT_ID/CLIENT_ID/CLIENT_SECRET = os.getenv(AZURE_*)` globals (OBO/JWKS). · needs-care — same env names legitimately reach the azure MCP via cloud-secrets; only the Python OBO globals go. |
| L288, L345, L377 | `oauth_service` global + lifespan `oauth_service = AzureOAuthService(...)`. · needs-care |
| **L904-1032 (RS256 branch)** | `get_user_info` Azure-AD RS256/JWKS validation (JWKS fetch L911, kid match, RS256 verify L986, AAD group RBAC). **KEEP** the function + all earlier branches + the `except` handlers L1034-1040. · **risky** — trailing branch; the HS256 return and except handlers must survive exactly or every token-error path breaks. |
| L546-564 | `get_authorized_groups`/`is_user_authorized`/`is_admin_user` (AAD group RBAC) — only called from RS256 branch. · needs-care |
| L539-543 + L1042-1137 | `TokenExchangeError` + `exchange_token_for_azure` (L1043) + `require_obo_token` (L1076) + `acquire_azure_obo_tokens` (L1095). Remove the 3 call sites first. · needs-care |
| **L1236-1362 (OBO call site 1, `/mcp`)** | supports_obo gate, AZURE_MCP_USE_SHARED_SP, X-Azure-ID-Token swap, OBO acquire, AWS federation fallback. KEEP route + RBAC + route_request (pass `user_token=None, azure_tokens=None`). Also remove `/mcp/tool` meta.userAccessToken injection L1494-1500. · **risky** |
| **L2299-2338 (OBO call site 2, `/batch-call`)** | azure-calls detect + OBO acquire. KEEP route + pre-flight RBAC L2282-2297 + route_request None. · **risky** |
| **L2539-2611 (OBO call site 3, `/call`)** | azure-branch OBO acquire + AWS federation. KEEP route + read-only + admin-server + check_tool_access L2516-2529 + route_request None. · **risky** |
| L1818-1885, L1887-2042 route-unregister | `/user-sessions/*` + `/auth/login`/`/callback`/`/me`/`/logout`/`/manual-session`. No internal service depends on these. · needs-care |
| L131 env | drop `aad_public_key` return from `bootstrap_jwt_keys` (KEEP the function). · safe |

**`mcp_manager.py`:**

| Lines · Kind | What · Risk |
|---|---|
| L580-619 | azure MCP: drop `AWC_AZURE_OBO_CLIENT_ID/SECRET` L596-597, set `supports_obo=False` L608/617, reword OBO comments. **KEEP** SA env `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET/SUBSCRIPTION_ID` L589-593. · needs-care |
| L642-682 | aws MCP: drop `AWS_OBO_ROLE_ARN/AWS_IC_*/AWS_OBO_FALLBACK_TO_SERVICE` L648-656, set `supports_obo=False` L671/680. **KEEP** static keypair L646/654-655. · needs-care |

**Tests:** `tests/test_auth_hardening.py` — remove the 3 OBO classes `TestOboFailureFailsClosed` (L183-276), `TestMultiAudienceObo` (L282-424), `TestCallSitesRoutedThroughRequireObo` (L430-514 — source-asserts the call sites). **KEEP** `TestBootHardening` L67-128 + `TestNoCredsPath` L134-177. · needs-care — class 5 goes red the moment call sites change.

**Dep:** `requirements.txt` — drop `msal>=1.24.0` (**verified**: imported only by deleted `azure_oauth.py`). Leave `azure-identity` (**verified**: zero imports in proxy `src/`; bundled MCP servers own it). · needs-care (verify confirmed).

**Docs:** `README.md` reword OBO/AAD rows + sections; `Dockerfile` L87 stale comment.

### 2c. `openagentic-ui`

| Path | Kind · Risk | What breaks if wrong |
|---|---|---|
| `src/services/AzureTokenService.ts` | delete · safe | **Verified zero importers**; would not build (msal-browser not in package.json, only the ambient shim). |
| `src/types/modules.d.ts` | edit-out the `declare module '@azure/msal-browser'` block (or whole-file if it only contains that). · safe | Only AzureTokenService referenced it. |
| `src/features/auth/components/AADLogin.tsx` | delete · safe | **Verified** imported but never rendered at `ChatContainer.tsx:42`. |
| `src/features/chat/components/ChatContainer.tsx` | edit-out dead import L42. · safe | Companion to AADLogin delete. |
| `src/features/auth/components/AuthCallback.tsx` | delete · (map truncated) | **Verified** consumers: `App.tsx:14` import + `App.tsx:364` `<Route path="/auth/callback">`. Remove both. The Microsoft OAuth redirect-callback handler. |
| `src/features/auth/components/Login.tsx` | **KEEP** — strip only AAD/Google federated buttons; **verified** `handleLocalLogin`→`/api/auth/local/login` (L46/52) + `auth_token` localStorage are intact and must survive. |

**Env (ui):** drop `VITE_AZURE_AD_*` / any Google client-id vite var from build wiring.

### 2d. Infra / tooling

| Path | What · Risk |
|---|---|
| `docker-compose.yml` | Remove AAD/Google passthrough envs (api L272-274 `AZURE_AD_*`; any GOOGLE_*); reword L444 "same pattern as azure OBO" comment. **KEEP** `AUTH_PROVIDER:-local` default L269/345 (harmless, already local) — optional to drop. **No re-wiring needed.** · safe |
| `tools/setup/src/` (wizard) | **Verified zero AAD/Google refs** — no action. |
| `tools/sync-upstream.py` | **MANDATORY (see §1):** remove `googleAuth.ts` (L661), `google-auth/index.ts` (L662) from PRESERVE; PRESERVE for `routes/auth.ts` (L672) must stay only if we keep the edited inter-service file — but since upstream's `routes/auth.ts` re-adds AAD OAuth, **move it from PRESERVE to a per-file skip OR keep PRESERVE so our edited version wins** (PRESERVE = "never overwritten", which is what we want for the edited file — KEEP it in PRESERVE). Add all whole-file-deleted paths (azureADAuth.ts, AzureOBOService.ts, azure-ad-sync.ts, obo.ts, azure-integration/, v1/credentials.ts, azure_oauth.py, user_session_manager.py, azure_obo_strategy.py, AADLogin.tsx, AuthCallback.tsx, AzureTokenService.ts, etc.) to `SKIP_PREFIXES`/`SKIP_NAMES` so they never re-appear. · risky (sync correctness) |
| `helm/openagentic` | Remove any AAD/Google identity values/templated env (LLM Azure-OpenAI values stay). · needs-care |

---

## 3. KEEP list — do-not-touch guardrails

These are the load-bearing local-auth + inter-service + SA-cloud-cred paths. Any edit here that changes behavior is a regression.

**api — surgical-file survivors:**
- `auth/tokenValidator.ts`: **L75-82** oa_/oa_sys_ API-key routing → `validateApiKey`; **L202-249** `isLocalToken` branch (`jwt.verify(token, JWT_SECRET)` → tenantId `'local'`) = local auth; **L313-413** `validateApiKey()` (bcrypt over prisma.apiKey incl. oa_sys_); **L418-423** `extractBearerToken`; the UnifiedTokenResult plumbing.
- `middleware/unifiedAuth.ts`: **L100-214** internal-service bypass (timing-safe `x-internal-secret` vs `INTERNAL_SERVICE_SECRET`, X-User-Id forwarded-user resolution, BLOCK-on-mismatch); **L216-256** token extraction (x-api-key, bearer, `?token=` SSE, cookie `openagentic_token`); **L258-272** validateAnyToken+buildRequestUser; **L286-302** local-id email-remap (keep, drop only azure_oid); api-key audit L392-415; authMiddleware/adminMiddleware/plugin.
- `routes/auth.ts`: **`POST/GET /api/auth/verify` L374-582** + **`/api/auth/validate-token` L1406-1479** (inter-service, used by proxy / workflows-svc / nginx auth_request).
- `services/buildChatV2Deps.ts`: **`buildMcpProxyHeaders` HS256 internal-JWT branch L570-607** — signs with JWT_SECRET/SIGNING_SECRET (→ API_INTERNAL_KEY fallback) so local/api-key chat→mcp-proxy tool calls authenticate. **THE critical keep.**
- `routes/local-auth.ts` (bcrypt `/api/auth/local/*`); `middleware/authenticate.ts`; `ChatAuthService.ts` rate-limit/permissions/healthCheck; `middleware/{adminGuard,adminAuth,tenantContext,rls-context,fastify-auth,mcp-auth,rateLimiter}.ts`; `auth_audit_log` model (minus sso_login).
- **LLM providers (NOT identity):** `azureOpenAIConfigService.ts`, `providers/AzureOpenAIProvider.ts`, `services/llm-providers/{AzureOpenAIProvider,AzureAIFoundryProvider,GoogleVertexProvider,GoogleVertexAuth,GoogleVertexCacheManager}.ts`, and `auth/azureOpenAIAuth.ts` (deprecated LLM shim — out of scope, leave).

**mcp-proxy — `get_user_info` survivors (the trust root):**
- L737-757 no-creds→401 fail-closed gate; L766-783 oa_sys_ HMAC branch; L785-815 oa_ user-API-key→`/api/auth/me`; L817-831 INTERNAL_API_KEY branch; **L833-902 internal HS256 JWT branch** (verify against JWT_SECRET/SIGNING_SECRET/INTERNAL_JWT_SECRET); L140-169 `verify_system_token`; L105-129 `bootstrap_jwt_keys` (drop only `aad_public_key`).
- `mcp_manager.py`: L623-640 GCP MCP (already SA-only, supports_obo=False); L197-211 FedRAMP SC-4 filtered env + `env.update(config.env)`; L835-929 `route_request` (azure_tokens meta-injection becomes harmless no-op when callers pass None).
- Tests: `test_jwt_auth.py` (all); `test_auth_hardening.py` `TestBootHardening`+`TestNoCredsPath`.

**ui:** `Login.tsx` local form + `auth_token` localStorage; the inter-service JWT flow.

**infra — the CSP-cred answer (`docker-compose.yml`):**
- **L390-405** RO host-CLI mounts (`~/.azure`, `~/.aws`, `~/.config/gcloud`, `~/.kube`) + `env_file ~/.openagentic/cloud-secrets/{aws,azure,gcp}.env`. **This is the SA/static/ADC cloud-cred path, fully independent of OBO.** Compose passes NO `AZURE_CLIENT_*`/`AAD_*` from root `.env` to the proxy — creds reach MCP subprocesses via `config.env` merge + RO mounts, never via OBO. **Removing OBO does not break SA cloud access.**
- **L406-424** inter-service secrets to mcp-proxy: `JWT_SECRET`, `SIGNING_SECRET`, `API_INTERNAL_KEY`/`INTERNAL_API_KEY`, `INTERNAL_SERVICE_SECRET`.
- `Dockerfile` L81-88 bundled MCP installs.

---

## 4. Ordered excision steps

Two **independent service tracks** (api / mcp-proxy / ui run in parallel). **Within a track, steps are sequential** (leaf consumers before whole-file deletes). Infra + sync-upstream + prisma run last.

### Track A — `openagentic-api` (sequential)
- **A1.** Delete `plugins/integrations.plugin.ts` + **both bound tests** (source-regression + integrations.plugin.test). *Parallel-safe with A2.*
- **A2.** Edit `server.ts` — drop the 3 direct registrations (L1330-1336, L1339-1345, L1638-1645). *Parallel-safe with A1.*
- **A3.** Delete route files: `obo.ts`, `google-auth/`, `azure-integration/`, `azure-ad-sync.ts`, `account-linking.ts`; edit `routes/auth.ts` (strip AAD OAuth + /obo + Graph-group, keep verify/validate-token/logout/local).
- **A4.** Edit chat pipeline: `buildChatV2Deps.ts` (drop OBO branch, KEEP HS256), `stream.handler.ts`, `chat/index.ts`, `ChatAuthService.ts`.
- **A5.** Edit `workflows.ts` + `WorkflowScheduler.ts` (run-as-user OBO blocks).
- **A6.** Edit `auth.plugin.ts` — drop obo+google registers, **flip ssoActive so local always registers**.
- **A7.** Edit the two guardrails: `tokenValidator.ts` + `unifiedAuth.ts`. **Relocate `UserContext`** to a local def / `auth/types.ts`.
- **A8.** Edit `routes/v1/index.ts` unregister + delete `v1/credentials.ts`. Edit `routes/admin.ts` (AzureGroupService), `InitializationService.ts`, `local-auth.ts` (orphan drops), `authorization.ts` (UserContext repoint).
- **A9.** Delete services: `AzureOBOService.ts`, `AzureTokenService.ts`, `AdminValidationService.ts`, `AzureGroupService.ts`, `UserAzureMCPService.ts`, `azureADAuth.ts`, `googleAuth.ts`, `utils/validateAzureToken.ts`, `middleware/azureAdAuth.ts`.

### Track B — `openagentic-mcp-proxy` (sequential, per the dependency-safe order)
- **B1.** Delete `tests/test_azure_obo_strategy.py` + the 3 OBO classes in `test_auth_hardening.py` (class 5 source-asserts go red the instant call sites change).
- **B2.** Remove the 3 OBO call-site blocks (`main.py` L1236-1362, L2299-2338, L2539-2611) — pass `user_token=None, azure_tokens=None`.
- **B3.** Remove `exchange_token_for_azure`/`require_obo_token`/`acquire_azure_obo_tokens`/`TokenExchangeError` (L539-543, L1042-1137).
- **B4.** Remove `/auth/*` + `/user-sessions/*` endpoints; delete `azure_oauth.py` + `user_session_manager.py` + imports/globals/lifespan (L35-36, L288, L374-380).
- **B5.** Remove RS256/JWKS branch (L904-1032) + AAD group helpers (L546-564) + TENANT_ID/CLIENT_ID/CLIENT_SECRET globals (L79-81) + `aad_public_key` (L131). **Preserve the HS256 return + except handlers exactly.**
- **B6.** `mcp_manager.py`: `supports_obo=False` + drop AWC_AZURE_OBO_*/AWS_OBO_*/AWS_IC_* env; delete `azure_obo_strategy.py`.
- **B7.** Drop `msal` from `requirements.txt`; README/comment reword.

### Track C — `openagentic-ui` (sequential)
- **C1.** Edit `ChatContainer.tsx` L42 (drop AADLogin import); delete `AADLogin.tsx`.
- **C2.** Edit `App.tsx` (drop L14 import + L364 route); delete `AuthCallback.tsx`.
- **C3.** Delete `AzureTokenService.ts`; edit/delete `types/modules.d.ts` (msal-browser block).
- **C4.** Edit `Login.tsx` — strip federated buttons only (keep local form + auth_token).

### Track D — infra/tooling (after A/B/C green)
- **D1.** `docker-compose.yml` — drop AAD/Google passthrough envs, reword comments.
- **D2.** `helm/openagentic` — drop identity AAD/Google values.
- **D3.** `tools/sync-upstream.py` — remove `googleAuth.ts`+`google-auth/index.ts` from PRESERVE; add every whole-file-deleted path to SKIP; confirm `routes/auth.ts` stays PRESERVE (so our edited inter-service file wins). **Mandatory — otherwise next sync re-leaks everything.**
- **D4 (phase-2, separate change after all green).** Prisma forward migration to drop the Azure/SSO models/columns. **Generate a migration; do NOT db push** (schema is forward-only). Only after all code refs are gone.

---

## 5. Build-gate plan

Run after **each** completed step inside a track; full gate after each track.

| Gate | Command (from repo root) | Expected green state |
|---|---|---|
| api typecheck | `cd services/openagentic-api && npx tsc --noEmit` | 0 errors. The only churn should be the deleted symbols; if `UserContext` errors appear, A7 relocation is incomplete. (Do NOT use the arch test suite as a gate — it is ~30% red on main per project memory; the 2 deleted integrations tests **reduce** red.) |
| api runtime smoke | boot api + `curl /api/health` + `POST /api/auth/local/login` | health OK; local login returns a JWT; protected route accepts it. |
| mcp-proxy tests | `cd services/openagentic-mcp-proxy && pytest tests/test_jwt_auth.py tests/test_auth_hardening.py -q` | all pass; **no collection error** (proves OBO imports gone + no dangling refs). |
| mcp-proxy import | `python -c "import src.main"` (or container boot) | imports clean; boot fail-closed still fires when JWT signing key unset. |
| ui build | `cd services/openagentic-ui && npx vite build` (or `npm run build`) | builds; **no missing-module error** for AADLogin/AuthCallback/AzureTokenService/@azure/msal-browser. |
| end-to-end | compose `--profile milvus up -d`; login local; send chat with a tool call | tool call authenticates to mcp-proxy via HS256 (proves §3 KEEP intact) + produces an audit row. |
| sync guard | `python3 tools/sync-upstream.py --dry-run` | excised paths show as SKIP, not re-pulled; edited `routes/auth.ts`/`tokenValidator.ts`/`unifiedAuth.ts` show PRESERVE. |

**Final green state:** api tsc clean · proxy pytest green · ui vite build clean · local login + chat-with-tool e2e pass · sync dry-run shows no AAD/Google re-leak · `grep -ri "obo\|azure.ad\|msal\|AzureADAuth\|GoogleAuth" services/*/src` returns only LLM-provider hits + reworded comments.

---

## 6. Risks & open questions

- **`buildChatV2Deps.ts` HS256 branch (risky).** The single most dangerous keep. If the OBO removal accidentally takes L570-607, **all** local-user tool calls 401 at the proxy. Verify with the e2e tool-call gate, not just tsc.
- **`mcp-proxy get_user_info` RS256 removal (risky).** It's the trailing branch; the HS256 `return` and the `except HTTPException/except Exception` handlers (L1034-1040) must remain byte-identical. A botched edit breaks every token-error path, not just AAD.
- **The 3 OBO call sites (risky).** Deeply nested in try/except + RBAC. Excise only token-population; keep read-only/admin-server/`check_tool_access` checks and the `route_request(..., user_token=None, azure_tokens=None)` call. `route_request`'s azure_tokens meta-injection (L911-921) is a confirmed harmless no-op when None.
- **`routes/auth.ts` (risky, entangled).** Mixes inter-service KEEP (`/verify`, `/validate-token` — used by proxy/workflows/nginx auth_request) with AAD OAuth REMOVE. Must be edited, never deleted. After edit, confirm the proxy's oa_ branch (`/api/auth/me`) and nginx auth_request still validate.
- **`unifiedAuth.ts` azure_oid vs email-remap entanglement (needs-care).** The email-remap (L286-302) is local-useful and **must stay**; only the `azure_oid` assignment (L304-313) goes. Easy to over-cut.
- **`integrations.plugin.ts` is not "safe."** Its 2 bound tests must die with it (corrected from the map). The source-regression test is already red on main.
- **`sync-upstream.py` re-leak (risky correctness).** PRESERVE currently keeps `googleAuth.ts`/`google-auth/index.ts`. If not fixed, the next sync silently re-introduces the entire AAD/Google surface — this is the most likely way the excision regresses.
- **Open question — Azure cost dashboards.** `azure-integration/{metrics,admin,events}.ts` are Azure-spend telemetry, not identity. The map recommends dropping the whole dir for OSS local-only. **Confirm with user** whether to keep Azure cost dashboards (they only make sense in the Azure story; recommend drop).
- **CSP-MCP-without-OBO — CONFIRMED works.** Verified against `docker-compose.yml` L390-405: SA/static/ADC creds reach aws/azure/gcp MCP subprocesses via RO host-CLI mounts + `cloud-secrets/*.env` → `mcp_manager.config.env` merge, entirely independent of OBO. GCP is already `supports_obo=False`. **Removing OBO does NOT break SA-based cloud tool access.** No re-wiring needed.
- **Prisma drop is forward-only (risky).** Defer to phase-2 after code excision is green. Leaving columns nullable/unused is the safe interim. Generate a migration; never `db push` (project convention).

---

## 7. FedRAMP impact

- **Moots B3-OBO entirely** — the OBO token-exchange control surface (api `AzureOBOService`, proxy `acquire_azure_obo_tokens`/`require_obo_token`/`exchange_token_for_azure`) is removed; there is no user-token→cloud-token exchange left to assess.
- **Moots audit-PORTS P2 (MFA-freshness)** — `AZURE_OBO_MFA_FRESHNESS_MINUTES` + the `AzureTokenService` MFA-freshness gate are deleted; OBO MFA freshness no longer applies.
- **Moots the Azure parts of P3** — AAD group RBAC (proxy L546-564 + api `AzureGroupService`) and AAD user-sync (azure-ad-sync) drop out of scope. Local RBAC (roles in local JWT) remains.
- **C1 (jwt-alg-pinning) scope shrinks to the KEPT files.** With the RS256/JWKS branch gone from `get_user_info`, the only signature-verification surfaces left are HS256 inter-service (proxy L833-902, `tokenValidator` local branch, `buildChatV2Deps` signer). C1 alg-pinning now applies **only** to HS256 — assert `algorithms=['HS256']` on every `jwt.verify`/`jwt.decode` in the kept files; no asymmetric/`none`-algorithm confusion surface remains. This is a **smaller, simpler** control to evidence post-excision.

**Files touched (absolute, for the workflow):** api guardrails `/home/trent/agenticwork/openagentic/services/openagentic-api/src/auth/tokenValidator.ts` + `/home/trent/agenticwork/openagentic/services/openagentic-api/src/middleware/unifiedAuth.ts`; proxy trust root `/home/trent/agenticwork/openagentic/services/openagentic-mcp-proxy/src/main.py` (`get_user_info`); sync guard `/home/trent/agenticwork/openagentic/tools/sync-upstream.py`; compose `/home/trent/agenticwork/openagentic/docker-compose.yml`.
---

## 8. User refinement (2026-06-09) — Azure cost dashboards KEEP (SP-based)

The azure-integration cost/spend dashboards STAY. Users still pull Azure costs
via the **Service Principal** (same SP the azure MCP uses: AZURE_CLIENT_ID/SECRET/
TENANT_ID/SUBSCRIPTION_ID). The ONLY removal in `routes/azure-integration/` is
`auth.ts` (the OBO/MSAL/account-linking part) + dropping its import+register in
`index.ts` (L11 import, L18 `register(azureAuthRoutes, {prefix:'/auth'})`).
Verified: `metrics.ts`/`admin.ts`/`events.ts` import ONLY `unifiedAuth`/`adminGuard`
(kept) — zero dependency on the OBO `auth.ts`, so this is a clean partial keep.

**Net rule:** remove OBO (for ANY MCP) + AAD/Google LOGIN; KEEP SP-based cloud
access — both the CSP MCP creds AND the Azure cost dashboards.
