# Runtime IDP Configuration — Implementation Plan

> Goal: make SSO identity providers (Azure-AD / Google / generic-OIDC) a **runtime, DB-driven, admin-editable registry** instead of deploy-time env vars baked at container/module load. An admin (or the install wizard) can add an Azure-AD or Google directory — paste tenant/client-id/secret, see the exact callback URL to register, validate the OIDC discovery doc, map groups→roles — and the login page renders one button per enabled directory, with **no `VITE_AZURE_*` / client-id ever baked into or shipped to the browser bundle**. Zero API rebuild and zero API *restart* on change (hot-reload via atomic-swap), mirroring the LLM-provider registry that already solved env→DB→hot-reload in this codebase.

---

## 1. Verdict — how baked is it today, how big is the conversion

**How baked:** Moderately, with one big saving grace already in place. Today *all* IDP config is **deploy-time env consumed at module/process load** — `tokenValidator.ts:21,25-27` picks the provider and constructs the `AzureADAuthService`/`GoogleAuthService` singletons **once at module load** from `process.env.AUTH_PROVIDER` + `AZURE_AD_*` / `GOOGLE_*`; the group→role/admin logic is inline `process.env` reads inside `azureADAuth.ts` `validateToken` (`:250-366`). Changing the IdP means editing `.env`/helm and **restarting** the API. The UI is *not* bundle-baked in the shipped path — `public/config.js` ships `*_PLACEHOLDER` strings that `docker-entrypoint.sh` sed-fills from env into `window.__CONFIG__`, read by `config/runtime.ts` — so the login buttons + a single global Azure client-id are runtime-per-deploy already, but there is exactly **one** global Azure tenant/client-id and a hard single-tenant `decoded.tid === this.config.tenantId` assertion (`azureADAuth.ts:230`). The helm chart goes further and hardcodes `AUTH_PROVIDER=local` as a literal in `templates/api.yaml`+`ui.yaml` with **no** Azure/Google secret keys in `templates/secret.yaml`.

**Conversion size: L (large), ~3.5–5 eng-days for a strong dev.** It is *not* algorithmically hard because the codebase already contains a 1:1 structural precedent — the LLM-provider registry (`ProviderConfigService` "DB is the SINGLE SOURCE OF TRUTH" loader, `ProviderManager.reloadProviders()` atomic-swap-of-keyed-Map at `:1686-1779`, `CredentialEncryptionService` which **already** encrypts a field literally named `clientSecret` in its `SENSITIVE_FIELDS` set, and the admin CRUD route `routes/admin/llm-providers.ts`). The auth classes (`AzureADAuthService`, `GoogleAuthService`) **already** take a config object and only env-fall-back when a field is absent — so they are nearly per-instance-configurable today. The size comes from breadth, not depth: a new Prisma model + migration, two new services (config loader + atomic-swap manager), a generic-OIDC strategy (needs the **new** `openid-client` dependency — only `@azure/msal-node` + `google-auth-library` are present today), directory-parameterized login/callback routes, a multi-issuer `tokenValidator` lookup, an extracted `mapGroupsToRoles` helper, an admin CRUD route + a cloned admin UI page, a public `/api/auth/directories` endpoint + a `Login.tsx` rewrite, a wizard step, and a seeder for graceful env→DB migration. **Nothing to port from the enterprise upstream for the registry itself** (grep-confirmed: upstream `~/agenticwork/agentic` has the same env-baked auth files, no `IdentityProvider`/`SsoConnection`/`IdpConfig` model) — this is net-new OSS work.

---

## 2. Data model (Prisma `IdentityDirectory`)

Shaped as a 1:1 analogue of `model LLMProvider` (`prisma/schema.prisma:2210`, `@@map("llm_providers")`): uuid id, unique name, `type` discriminator, `enabled`, `priority`, an **encrypted** `auth_config Json`, soft-delete, `created_by`/`updated_by`, audit timestamps, `@@index` on type/enabled/priority. The `clientSecret` lives **inside** `auth_config` and is encrypted/decrypted **for free** by the existing `CredentialEncryptionService` because `'clientSecret'` is already in `SENSITIVE_FIELDS` (`CredentialEncryptionService.ts:18`) — **no new crypto code**. Every env knob from `azureADAuth.ts` becomes a first-class column.

```prisma
// admin schema — sits next to model LLMProvider
model IdentityDirectory {
  id           String  @id @default(uuid())
  name         String  @unique                 // stable slug, e.g. "corp-entra"
  display_name String                          // shown on the login button
  type         String                          // 'azure-ad' | 'google-oidc' | 'generic-oidc'
  enabled      Boolean @default(true)
  priority     Int     @default(1)             // login-button order (lower = first)

  // Encrypted secret bag — clientSecret encrypted by CredentialEncryptionService
  // (clientSecret is already in SENSITIVE_FIELDS). Also holds clientId.
  auth_config  Json    @default("{}")          // { clientId, clientSecret(enc), ... }

  // OIDC endpoint identity
  tenant_id    String?                          // Azure tenant (single-tenant assertion is now per-row)
  authority    String?                          // e.g. https://login.microsoftonline.com/<tenant>
  issuer       String?                          // generic-oidc issuer base
  redirect_uri String?                          // override; else derived from PUBLIC_BASE_URL
  scopes       String[] @default([])            // [] → type default
  discovery    Json?                            // cached .well-known/openid-configuration

  // Group → role mapping (replaces every AZURE_*_GROUPS / SKIP_GROUP_VALIDATION env)
  group_claim             String?  @default("groups")
  authorized_groups       String[] @default([]) // gate login (GUIDs or names)
  admin_groups            String[] @default([]) // grant isAdmin
  group_role_mappings     Json     @default("{}") // { "<groupIdOrName>": "role" }
  external_admin_emails   String[] @default([]) // EXTERNAL_ADMIN_EMAILS, per-row
  allowed_domains         String[] @default([]) // Google hd / email-domain gate
  allow_all_authenticated Boolean  @default(false) // per-dir replacement for SKIP_GROUP_VALIDATION

  status     String    @default("active")      // 'active' | 'disabled' | 'error'
  created_by String?
  updated_by String?
  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt
  deleted_at DateTime?

  creator User? @relation("IdentityDirectoryCreator", fields: [created_by], references: [id])
  updater User? @relation("IdentityDirectoryUpdater", fields: [updated_by], references: [id])

  @@index([type])
  @@index([enabled])
  @@index([priority])
  @@map("identity_directories")
}
```

**Migration (forward-only, per `services/openagentic-api/CLAUDE.md:117`):** edit `schema.prisma` → `prisma migrate dev --name add_identity_directories` locally → **commit the generated `prisma/migrations/<ts>_add_identity_directories/migration.sql`**. Do **NOT** `prisma db push` — the boot path runs `prisma migrate deploy` and a destructive-push is pinned-against by `__tests__/architecture/no-destructive-migration-at-boot.source-regression.test.ts`. (Note: the design input said `db push`; the authoritative service rule is `migrate dev` — follow the service rule.)

**Group→role mapping shape** consumed by `mapGroupsToRoles()`:
- `authorized_groups` non-empty → user **must** be a member of one (login gate), unless `allow_all_authenticated=true` or email ∈ `external_admin_emails`.
- `admin_groups` membership → `isAdmin=true`.
- `group_role_mappings` → extra `roles[]` beyond `['admin']`.
- Result: `{ authorized: boolean, isAdmin: boolean, roles: string[] }`. The local-JWT is then minted with `payload.userId` present (unchanged classification per memory) **plus** new `directory_id` + resolved `roles`.

---

## 3. Backend

### 3a. DB-as-SoT loader + dynamic strategy manager (the ProviderManager analogue)

- **ADD `services/openagentic-api/src/services/identity/IdentityDirectoryConfigService.ts`** — clone of `ProviderConfigService.loadProviderConfig()`. `loadDirectories()` = `prisma.identityDirectory.findMany({ where: { enabled: true, deleted_at: null }, orderBy: { priority: 'asc' } })`, run `decryptAuthConfig(row.auth_config)` (reuses `CredentialEncryptionService`), return `DirectoryConfig[]`. Header doctrine copied verbatim: "Database is the SINGLE SOURCE OF TRUTH; env only seeds the first directory via the seeder."

- **ADD `services/openagentic-api/src/services/identity/IdentityDirectoryService.ts`** — the `ProviderManager` analogue. Holds `Map<directoryId, { type, instance: AzureADAuthService | GoogleAuthService | GenericOidcStrategy, row }>`. `initialize()` + `reload()` use the **exact atomic-swap pattern** from `ProviderManager.reloadProviders()` (`:1708-1779`): build a fresh `newMap` in a temp, fully construct + (for generic-oidc) fetch+validate discovery, then swap atomically so no request ever sees an empty registry; the old map serves until the new one is ready. Per-directory instance is constructed by passing the **full** decrypted config object (so the env fallback inside the auth class never fires for DB-driven directories). Methods: `getDirectory(id)`, `listEnabled()` (public, redacted), `validateOidcDiscovery(authorityOrIssuer)` (fetch `<base>/.well-known/openid-configuration`, assert `authorization_endpoint`/`token_endpoint`/`jwks_uri`/`issuer`, cache into the `discovery` column). Subscribe to the same Redis invalidate channel `ProviderManager` uses so a CRUD write in one API replica reloads all.

### 3b. Directories CRUD admin API

- **ADD `services/openagentic-api/src/routes/admin/identity-directories.ts`** — clone of `routes/admin/llm-providers.ts`:
  - `GET /api/admin/identity-directories` — list, **redact `clientSecret`** (return a `hasSecret: true` flag only).
  - `POST` — validate OIDC discovery first, then `encryptAuthConfig(authConfig)` (the `clientSecret` field auto-encrypts), persist, **hot-reload** via `IdentityDirectoryService.reload()`, audit via `auditTrail` + `credentialAuditService` (same as the provider route).
  - `PUT`/`PATCH` — edit; re-encrypt only if a new secret was supplied (mirror the provider route's "keep existing secret if blank").
  - `DELETE` — **soft delete** (`deleted_at`), then reload.
  - `POST /:id/test` — run discovery validation + a dry token-endpoint reachability probe; never exchanges a real code.
  - `GET /:id/callback-url` — returns the exact `redirect_uri` to register: `${PUBLIC_BASE_URL}/api/auth/sso/:id/callback`.
  - Wire into the admin domain in **`plugins/admin.plugin.ts`** (where `adminRoutes` is registered at `:82-86`).

### 3c. Per-directory login / callback + the strategies

- **ADD/EXTEND `services/openagentic-api/src/routes/auth-sso.ts`** (register from `plugins/auth.plugin.ts`):
  - `GET /api/auth/directories` — **PUBLIC**, returns `[{ id, type, displayName, loginUrl, iconHint }]` for enabled rows. **No secrets, no clientId, no tenant.** This is what kills the baked `VITE_AAD_CLIENT_ID` — the browser never receives a client-id; the whole OAuth handshake is server-initiated.
  - `GET /api/auth/sso/:directoryId/login` → `IdentityDirectoryService.getDirectory(id).instance.getAuthUrl(state)` where `state` encodes `directoryId` (HMAC-signed, CSRF). Redirect to the IdP.
  - `GET /api/auth/sso/:directoryId/callback` → that directory's `exchangeCodeForToken(code)` → validate the IdP token via the directory's instance → `mapGroupsToRoles(userGroups, row)` → **mint the unchanged local HS256 JWT** (still `payload.userId` present) stamped with `directory_id` + resolved `roles` → store IdP access/id/refresh in `userAuthToken` (OBO unchanged) → redirect to `FRONTEND_URL`.
  - Keep the legacy `GET /api/auth/microsoft/login|callback` + `/google/login|callback` as thin aliases that resolve the **single seeded directory** of that type, so existing bookmarks/registered redirect URIs keep working during transition.

- **ADD `services/openagentic-api/src/services/identity/mapGroupsToRoles.ts`** — pure fn extracted from `azureADAuth.ts:250-366`. Signature: `mapGroupsToRoles(userGroups: string[], cfg: { authorizedGroups, adminGroups, groupRoleMappings, allowAllAuthenticated, externalAdminEmails, email }) → { authorized, isAdmin, roles }`. Called by **both** the Azure callback and the generic-OIDC callback so mapping is identical across IdP types.

- **EDIT `services/openagentic-api/src/auth/azureADAuth.ts` + `googleAuth.ts`** — these already take a config object; the change is to (a) always pass the full DB-derived config from `IdentityDirectoryService` so the `process.env.AZURE_AD_*` fallbacks at `:68-73` never leak when DB-constructed, and (b) move the inline group/admin block (`:250-366`) to call `mapGroupsToRoles.ts`. Relax the single-tenant coupling: the `decoded.tid === this.config.tenantId` assertion (`:230`) now checks against **that instance's** `tenantId`, which is per-row — so multiple Azure tenants coexist, one directory per tenant.

- **ADD `services/openagentic-api/src/auth/genericOidcAuth.ts`** — new `GenericOidcStrategy` using the **new `openid-client` dependency** (add to `services/openagentic-api/package.json`; today only `@azure/msal-node` + `google-auth-library` are present). Mirrors `GoogleAuthService`'s surface (`generateAuthUrl` / `exchangeCodeForTokens` / `validateIdToken`), driven entirely by the directory's cached `discovery` doc + `clientId`/`clientSecret`/`issuer`/`group_claim`. Covers Okta/Auth0/Keycloak/Entra-as-generic.

### 3d. tokenValidator — multiple issuers

- **EDIT `services/openagentic-api/src/auth/tokenValidator.ts`** — replace the module-load `AUTH_PROVIDER`-keyed singleton selection (`:21,25-27`) with a runtime lookup: on an IdP token, `jwt.decode`, find the matching directory by `iss`/`aud`/the `directory_id` claim, and call **that directory's** `instance.validateToken`. The branch order is preserved: `oa_`/`oa_sys_` prefix → API key; else by claim shape. **The local branch is UNCHANGED** — `payload.userId` present and no `tid`/`oid`/google-`iss` → local, verified with `JWT_SECRET` (the documented `userId`-keying gotcha stays intact). `AUTH_PROVIDER` env survives only as a **bootstrap default** (which directory to seed) — no longer the source of truth once a row exists.

- **EDIT `services/openagentic-api/src/plugins/auth.plugin.ts`** — compute `ssoActive` from `prisma.identityDirectory.count({ where: { enabled: true, deleted_at: null } }) > 0` (falling back to the old `AUTH_MODE`/`AUTH_PROVIDER` env only when zero rows exist, for first boot). This is the gate that suppresses `/api/auth/local/*`; it now follows the DB, so adding a directory live disables local-password login without a restart. Register the new `auth-sso` routes here.

- **EDIT `services/openagentic-api/src/config/featureFlags.ts`** — keep `authProvider` (default `'azure-ad'`) as **bootstrap-only**; add a comment that runtime SSO state now comes from `identity_directories`.

---

## 4. Frontend

### 4a. Admin "Identity / Directories" page (cloned from `pages-v3/llm-providers/`)

- **ADD `services/openagentic-ui/src/features/admin/pages-v3/identity-directories/`** — `IdentityDirectoriesPage.tsx` + `DirectoryModal.tsx` + `DirectoryDetail.tsx`, copying the structure of `pages-v3/llm-providers/` (`ProviderModal.tsx`, `ProviderDetail.tsx`, `OverviewPane.tsx`, `types.tsx`). The **add/edit modal** flow:
  1. **Pick type** — Azure-AD / Google / Generic-OIDC.
  2. **Fill** — tenantId + authority (Azure) *or* issuer (generic) *or* nothing extra (Google) → clientId → clientSecret → allowedDomains → groupClaim → authorizedGroups → adminGroups → group_role_mappings.
  3. **Show the read-only callback URL** to register, with a copy button + provider-specific instructions: Azure → *"App Registration → Authentication → Redirect URIs (Web)"* + required API permissions (`openid profile email offline_access` + a `groups` optional-claim); Google → *"OAuth client → Authorized redirect URIs"* + scopes.
  4. **Test** — calls `POST /api/admin/identity-directories/:id/test` (validate discovery + token-endpoint probe) and shows pass/fail.
  5. **Save** — `clientSecret` is write-only; the detail view never shows it (redacted by the API, mirroring `ProviderDetail`).

- **EDIT `services/openagentic-ui/src/features/admin/shell-v3/sidebar-data.ts`** — add a nav leaf under the existing Security group next to `auth-access` (`:23`): `{ id: 'identity-directories', key: 'si', name: 'Identity / Directories' }`, and wire the `id`→page route in the pages-v3 router.

### 4b. Login page — fetch directories, render a button per IdP

- **EDIT `services/openagentic-ui/src/features/auth/components/Login.tsx`** — replace the static `authConfig{ microsoftEnabled, googleEnabled, localEnabled }` (sourced from `config/runtime.ts`) with a `fetch('/api/auth/directories')` on mount. Map `directories[]` → one button each (icon by `type`); each handler does `window.location.href = dir.loginUrl` (`/api/auth/sso/:id/login`). Keep the local-email/password button gated by a `localEnabled` meta flag returned alongside the directories list. This **removes the `getAADClientId()`/`getAADAuthority()`/`getAADRedirectUri()` dependency** (`runtime.ts:40-53`) from the login path — the browser no longer needs any Azure client-id.

- **EDIT `services/openagentic-ui/src/config/runtime.ts` + `public/config.js` + `docker-entrypoint.sh`** — retire the `VITE_AAD_*` getters and the `*_LOGIN_ENABLED`/`VITE_AZURE_*` placeholders from the login path (they become dead once `Login.tsx` fetches directories). Leave `VITE_API_URL` (the only legitimately build/runtime value) intact. This is the concrete "kill the baked `VITE_AZURE_*`" deliverable.

### 4c. Install wizard step

- **ADD `tools/setup/src/steps/IdentityDirectory.tsx`** — a new step inserted in `tools/setup/src/index.tsx` after `AdminUser.tsx` / before `LlmStrategy.tsx`, modeled on `McpAuth.tsx`'s paste-creds UX. Optionally add a directory: pick type, paste tenantId/clientId/clientSecret (or issuer for generic-oidc), set allowedDomains + admin group/email, **show the callback URL to register**, validate discovery. On first boot it writes the directory to the `.env`-seed consumed by the seeder; post-launch it `POST`s to `/api/admin/identity-directories`.

---

## 5. Port from `~/agenticwork/agentic` vs build new

**Grep-confirmed: there is NOTHING to port for the runtime IDP *registry* itself** — the enterprise upstream has the same env-baked `azureADAuth.ts` / `googleAuth.ts` / `tokenValidator.ts` and **no** `IdentityProvider`/`SsoConnection`/`IdpConfig` Prisma model. The registry is net-new OSS work. What is reused is OSS-already-present infrastructure and a couple of upstream-or-OSS auth helpers wired per-directory.

| Source (file : concept) | Disposition |
|---|---|
| `services/llm-providers/ProviderConfigService.ts` : DB-as-SoT `loadProviderConfig()` "single source of truth" loader | **Copy** → `IdentityDirectoryConfigService.loadDirectories()` |
| `services/llm-providers/ProviderManager.ts:1686-1779` : `reloadProviders()` atomic-swap-of-keyed-Map | **Copy the shape** → `IdentityDirectoryService.reload()` |
| `services/llm-providers/CredentialEncryptionService.ts` : `encryptAuthConfig`/`decryptAuthConfig` (`clientSecret` ∈ `SENSITIVE_FIELDS`) | **Reuse verbatim** — zero new crypto |
| `vault.service.ts` : `encryptLocal`/`decryptLocal` (AES-256-GCM, `local2:`, `LOCAL_ENCRYPTION_KEY`) | **Reuse** (the only legitimately env-baked value; must stay stable across deploys) |
| `routes/admin/llm-providers.ts` : admin CRUD (encrypt+persist+hot-reload+audit, redact-on-GET) | **Copy** → `routes/admin/identity-directories.ts` |
| `auth/azureADAuth.ts`, `auth/googleAuth.ts` : config-object-driven strategy classes | **Reuse + lightly edit** (always pass DB config; extract group block) |
| `services/AzureOBOService.ts`, `UserAzureMCPService`, `routes/obo.ts` (OSS-present) : OBO token exchange | **Reuse unchanged** — OBO operates on the stored Azure access token, not on env app-reg, so once the callback stores the same token + mints the same local JWT, OBO is unaffected |
| `services/identity/AzureGroupService` (Graph group enrichment, OSS-present) | **Reuse per-directory** when the IdP token omits `groups` |
| `config/runtime.ts` window.`__CONFIG__` runtime-injection (OSS-present) | **Reference only** (login now fetches `/api/auth/directories` instead) |
| `openid-client` npm package | **Build new dependency** — not currently in `package.json`; required for `genericOidcAuth.ts` |
| `IdentityDirectory` Prisma model, `IdentityDirectoryService`, `mapGroupsToRoles.ts`, `genericOidcAuth.ts`, `auth-sso.ts`, the admin UI page, the wizard step, the seeder | **Build new** |

---

## 6. Migration — existing env-based SSO keeps working

The doctrine is `ProviderConfigService`'s: **env seeds the DB once on first boot; after that DB is SoT and env is ignored.**

- **ADD `services/openagentic-api/src/services/identity/IdentityDirectorySeeder.ts`** — the `LLMProviderSeeder` analogue. On boot, **if zero `identity_directories` rows exist AND `AUTH_PROVIDER` ∈ {azure-ad, google, hybrid, both, all} with the relevant `AZURE_AD_*`/`GOOGLE_*` env set**, seed **one** directory from env:
  - Azure → `type='azure-ad'`, `tenant_id=AZURE_AD_TENANT_ID`, `auth_config={ clientId: AZURE_AD_CLIENT_ID, clientSecret: AZURE_AD_CLIENT_SECRET }` (encrypted on write), `authorized_groups`/`admin_groups`/`external_admin_emails`/`group_role_mappings` from the corresponding env, `allow_all_authenticated = (SKIP_GROUP_VALIDATION==='true')`.
  - Google → `type='google-oidc'`, `auth_config={ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }`, `allowed_domains=GOOGLE_ALLOWED_DOMAINS`, `external_admin_emails=GOOGLE_ADMIN_EMAILS`.
  - Idempotent + gated by a `SEEDER_VERSION` flag (same as `LLMProviderSeeder`) so it runs exactly once.
- After seeding, an existing env-configured deployment logs in **unchanged** with zero manual steps; the admin can then edit/add directories in the UI and the DB wins.
- The legacy `/api/auth/microsoft/*` + `/api/auth/google/*` routes alias to the seeded directory, so already-registered redirect URIs in Azure/Google keep resolving.
- **`AUTH_PROVIDER`/`AUTH_MODE` env survive only** as (a) the seeder's "which directory to create" hint and (b) the first-boot fallback for the `auth.plugin.ts` `ssoActive` local-login-suppression gate when zero rows exist. The hardcoded helm `AUTH_PROVIDER=local` in `templates/api.yaml`/`ui.yaml` is unaffected (local stays the default until a directory is added).

---

## 7. Concrete task breakdown (executable by a follow-up workflow)

Ordered; each task is build-gated. Backend route files can be built in parallel, then one agent mounts/wires, then verify — the LLM-provider-route convention.

**Phase A — Data model + crypto reuse (sequential first; everything depends on it)**
1. Add `model IdentityDirectory` to `services/openagentic-api/prisma/schema.prisma` (+ the two `User` back-relations). Run `prisma migrate dev --name add_identity_directories`; **commit** the generated `migration.sql`. Gate: `prisma validate` + the migration test green.
2. Confirm `clientSecret` ∈ `SENSITIVE_FIELDS` (it is, `CredentialEncryptionService.ts:18`) — no change needed; add a unit test that `encryptAuthConfig({clientSecret})` round-trips.

**Phase B — Backend services (parallelizable, file-scoped)**
3. `IdentityDirectoryConfigService.ts` (clone `ProviderConfigService`) + unit test loading enabled+decrypted rows.
4. `IdentityDirectoryService.ts` (clone `ProviderManager.reloadProviders()` atomic-swap) + `validateOidcDiscovery()` + Redis-invalidate subscribe. Test: reload swaps the map without an empty window.
5. `mapGroupsToRoles.ts` (extract from `azureADAuth.ts:250-366`) + unit tests for authorized/admin/role/allow-all/external-admin cases.
6. `genericOidcAuth.ts` (`GenericOidcStrategy`, add `openid-client` to `package.json`) + a discovery-doc test against a fixture.

**Phase C — Routes + tokenValidator (sequential — touches shared wiring)**
7. `routes/admin/identity-directories.ts` (clone `llm-providers.ts`: CRUD + `/:id/test` + `/:id/callback-url`, encrypt+persist+hot-reload+audit, redact secret). Register in `admin.plugin.ts`.
8. `auth-sso.ts`: public `GET /api/auth/directories` + `:directoryId/login` + `:directoryId/callback` (calls `mapGroupsToRoles`, mints unchanged local JWT + `directory_id`/`roles`). Keep `/microsoft/*` + `/google/*` aliases. Register in `auth.plugin.ts`.
9. Edit `azureADAuth.ts`/`googleAuth.ts` to call `mapGroupsToRoles` + accept full DB config (no env leak; per-row `tid` assertion).
10. Edit `tokenValidator.ts` for multi-issuer directory lookup (local branch untouched).
11. Edit `auth.plugin.ts` `ssoActive` to read `identityDirectory.count() > 0` (env fallback at zero rows).
12. Edit `config/featureFlags.ts` comment.

**Phase D — Seeder (graceful migration)**
13. `IdentityDirectorySeeder.ts` (clone `LLMProviderSeeder`, gated by `SEEDER_VERSION`). Test: env-present + zero-rows seeds one directory; second boot is a no-op.

**Phase E — Frontend**
14. Admin page `pages-v3/identity-directories/` (clone `llm-providers/`: list + modal + detail; type picker, callback-URL display+copy, Test, redacted secret). Wire `sidebar-data.ts` leaf + pages-v3 route.
15. Rewrite `Login.tsx` to fetch `/api/auth/directories` and render a button per directory → `dir.loginUrl`; gate local-login by the `localEnabled` meta flag. Retire the `VITE_AAD_*` getters from the login path in `runtime.ts`/`public/config.js`/`docker-entrypoint.sh`.

**Phase F — Wizard**
16. `tools/setup/src/steps/IdentityDirectory.tsx` (clone `McpAuth.tsx` UX) + insert in `index.tsx` after `AdminUser` / before `LlmStrategy`; writes `.env`-seed first-boot or `POST`s post-launch.

**Phase G — Verify (proof-is-green, per memory)**
17. `tsc` clean on `openagentic-api`; `vite build` clean on `openagentic-ui`; wizard PTY harness walks the new step.
18. Runtime smoke: seed an Azure directory from env (or via the admin POST), hit `GET /api/auth/directories` (assert no clientId/secret in payload), walk `:id/login`→IdP→`:id/callback`, confirm a local JWT with `directory_id`+`roles` is minted and `tokenValidator` accepts it; flip a second directory enabled and confirm hot-reload (no API restart) surfaces a second login button. Capture evidence (curl output + logs) — do not claim green without it.
19. Confirm OBO still works: an Azure tool call in chat exchanges the stored access token (`AzureOBOService`) — unaffected by the registry change.

**Risk notes for the executor:**
- `JWT_SECRET` and `LOCAL_ENCRYPTION_KEY` must be stable real values (not placeholders) — rotating `LOCAL_ENCRYPTION_KEY` makes every encrypted `clientSecret` unreadable, exactly the LLM-provider-secret caveat.
- Keep the local-JWT `payload.userId` keying intact (memory: a `sub`-only JWT hits the Azure branch and 401s).
- Honor `prisma migrate dev` (NOT `db push`) per `services/openagentic-api/CLAUDE.md:117` — the input design note saying `db push` is wrong for this repo.
- Compose's `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` vs the code's `GOOGLE_CLIENT_ID`/`_SECRET` name mismatch is a pre-existing bug; the seeder should read **both** names so the Google passthrough actually seeds.
