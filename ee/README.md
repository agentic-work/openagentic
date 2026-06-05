# OpenAgentic Enterprise (`ee/`)

Copyright © Agenticwork™ LLC. All rights reserved.

The rest of this repository is open source under the **Apache License 2.0**
(`/LICENSE`). The files listed below are **NOT** — they are the **Enterprise
Software** and are licensed **only** under the **OpenAgentic Enterprise License**
(`/ee/LICENSE`), a commercial, proprietary license.

> **You need a paid OpenAgentic Enterprise subscription from Agenticwork LLC to use
> these features in production.** Reading the source grants no license. Using,
> selling, hosting-as-a-service, redistributing, or modifying them without a
> subscription — or removing the license gate — is a breach of the Enterprise
> License and an infringement of Agenticwork's copyright. See `/ee/LICENSE` §4.

## What's Enterprise

**Runtime Identity Directory (SSO) registry** — the ability to add and manage
identity providers (Azure AD / Entra ID, Google Workspace, generic OIDC) as
**runtime, admin-editable directories** (no rebuild, no restart, hot-reload), with
per-directory group→role mapping and a setup wizard.

> The community (Apache-2.0) edition still supports **local login** and a **single,
> environment-configured SSO provider** at build/deploy time. The *runtime,
> multi-directory, admin-managed* registry is the Enterprise feature.

## Covered files

| File | Role |
|---|---|
| `services/openagentic-api/src/services/identity/IdentityDirectoryService.ts` | Atomic-swap runtime registry / hot-reload |
| `services/openagentic-api/src/services/identity/IdentityDirectoryConfigService.ts` | DB-as-SoT loader (encrypted secrets) |
| `services/openagentic-api/src/services/identity/IdentityDirectorySeeder.ts` | One-time env→DB directory seed |
| `services/openagentic-api/src/services/identity/mapGroupsToRoles.ts` | Group/claim → role/admin mapping |
| `services/openagentic-api/src/auth/genericOidcAuth.ts` | Generic-OIDC strategy |
| `services/openagentic-api/src/routes/admin/identity-directories.ts` | Admin CRUD for directories |
| `services/openagentic-api/src/routes/auth-sso.ts` | `/api/auth/directories` + per-directory login/callback |
| `services/openagentic-ui/src/features/admin/pages-v3/identity-directories/*` | Admin "Identity / Directories" UI |
| `tools/setup/src/steps/IdentityDirectory.tsx` | Install-wizard directory step |

The `IdentityDirectory` Prisma model in
`services/openagentic-api/prisma/schema.prisma` and its migration are part of the
Enterprise Software for the purposes of `/ee/LICENSE`.

## The license gate

`services/openagentic-api/src/ee/license.ts` verifies an **offline, Ed25519-signed
license key** (no phone-home). Only Agenticwork LLC can mint valid keys (the private
signing key never ships in this repo). Set the key via the `OPENAGENTIC_LICENSE_KEY`
environment variable. Without a valid key, the runtime-directory registry routes
return **HTTP 402 Payment Required** and the registry loads no directories — local
login and a single env-configured SSO provider continue to work.

Licensing: **licensing@agenticwork.io**
