The grep used `git show ... | grep` which returns empty for those two files (likely path quirk piping), but my earlier `git ls-tree` confirmed both files exist on the launch ref, and the working-tree grep already confirmed compose secrets + mcp-proxy bypass. The upstream confirms the full ATO core exists: `AuthorizationSpine.ts`, `controlPlaneCapabilities.ts`, `flowAuthorizeHook.ts`, MFA-freshness (`AzureTokenService.mfaFreshnessEnforcement`, `dispatchChatToolCall.mfaFreshness`), lockout (`UserAuthService`/`sessionEnforcement`/`ScopeEnforcementService`), and DLP (`azure-sync-and-dlp-auth`). That grounds the PORTS section.

I have everything verified. Producing the final report.

---

# OpenAgentic — FedRAMP-High + OSS-Readiness Re-Audit Grade Card
**Branch audited:** `oss-launch/a3-fedramp` (`a6ea1baf2`) — the LAUNCH branch. Working-tree HEAD (`fea7be951`, full-sync overlay) used only as upstream reference.
**Date:** 2026-06-09 · **Lead auditor verdict: NO-GO.**
All findings below re-verified against the launch ref (`git ls-tree`/`git show`) and the working tree. Prior P0s #4 (googleAuth) and #5 (LoginDev) are **confirmed FIXED**; the rest re-confirmed REAL.

---

## 1. Grade Table

| Dimension | Grade | One-line note |
|---|---|---|
| Security | **D** | Two fail-open auth criticals (compose `*-change-me` secrets under `NODE_ENV=production`; mcp-proxy no-creds→system-admin + `oa_sys_`→system-root with zero verification) + fail-open `secrets.config.ts` root cause + unauth SSRF. |
| Secrets / IP / PII leak | **D** | Same two criticals reading secrets RAW; PLUS a self-inflicted re-leak: `docs/fedramp-remediation/` ships and quotes verbatim every PII item it documents removing (personal email, real public IP, real Azure tenant, internal hostname). |
| Completeness | **C+** | Dead-admin-endpoint + gen_ai metrics campaigns largely succeeded; remaining: clusterPlugin unregistered (404 docs page), ApiRoutesPage advertises 4 fabricated endpoints, 5 orphan MCP dirs, vestigial Code Mode toggle. |
| Duplication | **C** | ~5,200 LOC of FORKED, already-diverged workflow engine across api + workflows-svc (incl. security-sensitive `WorkflowSecretService.ts`), both LIVE; dead duplicate `MilvusService.ts`/`GlassCard.tsx`/brand-leaked node. CM-2/CM-3 liability. |
| Tech-debt | **C** | 25 unreferenced root `.jpeg` dumps (~3.2 MB, 2 re-leak Code Mode brand); ~88 MB orphan binaries; `Dockerfile.overlay` leaks `<REDACTED-INTERNAL-REGISTRY>`; warn-only lint gates (~5,300 `any`, 803 `console.*`). |
| Docs | **D** | `tests/demos/*.md` leak dev home paths / Harbor creds / internal IPs+namespaces / proprietary enterprise arch; mcp-proxy README is mass-fabricated and states MIT (repo is Apache-2.0); systematic 14-vs-9 MCP contradiction; CONTRIBUTING quickstart crash-loops (missing `--profile milvus`). |

### NIST 800-53 family roll-up (technical baseline relevant to this codebase)

Counts reflect what the **code on the launch branch substantiates**, derived from the confirmed findings (not the full High catalog).

| Family | Implemented | Partial | Gap | Headline gap driver |
|---|---|---|---|---|
| **AC** (Access Control) | 1 | 2 | 3 | AC-3 fail-open: mcp-proxy unconditional admin grant; AC-6 least-privilege bypassed; AC-4 SSRF egress |
| **IA** (Identification & Auth) | 0 | 2 | 4 | IA-2/IA-5 forgeable shared secrets + unsigned `oa_sys_` trust; no MFA-freshness, no failed-login lockout |
| **SC** (System & Comms Protection) | 1 | 2 | 3 | SC-7 SSRF (no egress filter); SC-12/SC-13 weak/committed key material; SC-28 secret-at-rest handling forked |
| **SI** (System & Info Integrity) | 1 | 2 | 2 | SI-10 no JWT algorithm pinning (~13 sites); secret-validation input checks fail-open |
| **AU** (Audit & Accountability) | 1 | 2 | 2 | AU-9 audit content re-leaks PII; AU-2/AU-12 uncontrolled `console.*` stdout, no consistent event scoping |
| **CM** (Configuration Management) | 0 | 2 | 3 | CM-2/CM-3 forked engines + tag-floating images; CM-6 insecure committed config defaults; CM-7 MCP Inspector in prod image |
| **SA / SR** (Acquisition / Supply Chain) | 0 | 1 | 3 | SA-5 fabricated README + wrong license; SR-3/SR-11 internal-Harbor base images, unpinned bases |
| **RA / PM** (Risk / Program Mgmt) | 0 | 1 | 2 | RA-5 pre-commit scanner gaps (skips `*/docs/*`, wrong key prefix); PM-12 PII in shipped evidence |

**Net:** ~4 control families have a confirmed fail-open or leak that **directly contradicts** the High technical baseline. No family is clean.

---

## 2. Overall Grade + GO/NO-GO

**Overall: D / NO-GO for public OSS launch.**

Rationale: the audit surfaced **two independent, world-readable critical authentication bypasses** that ship in the documented happy-path install (`docker compose up -d`):

1. **Forgeable trust root** — `docker-compose.yml` defaults `JWT_SECRET`/`SIGNING_SECRET`/`INTERNAL_API_KEY` to committed `openagentic-dev-*-change-me` literals under `NODE_ENV=production`, and the api reads them RAW from `process.env` (the `secrets.config.ts` placeholder check never writes back and doesn't even match the shipped literal). Anyone with the public repo forges admin JWTs.
2. **mcp-proxy fail-open** — `main.py` grants `system-admin` to credential-less callers and `system-root` (+ SP cloud creds) to any `Bearer oa_sys_<anything>` with zero signature/DB check, **before** any `ENABLE_AUTH` gate.

Either one alone is launch-blocking. Together with a fail-open `secrets.config.ts` root cause, an unauthenticated SSRF, and a remediation-docs PII re-leak, the security and secrets dimensions are both **D**. The completeness/duplication/tech-debt/docs grades (C/C/C/D) confirm the surrounding shell is also not first-clone-credible for the sovereignty-bound audience the README targets. Public exposure of this branch hands an attacker an admin path on day one.

**Bar to flip to GO:** all four confirmed criticals fixed + fail-closed boot guard proven + PII docs removed + the four launch-blocking high-severity docs/leak items cleared (Top 10 below).

---

## 3. FedRAMP-High Readiness — honest statement

**The code substantiates roughly 25–30% of the High technical baseline, and is currently DISQUALIFYING on the access-control / identification-and-authentication families.** This is not a "close, polish it" posture — it is a fail-open trust-boundary posture.

What is genuinely present and helps: a real audit-log substrate (~16 Prisma tables), an approval-gate on mutating tool calls, Prometheus telemetry now emitted, RBAC keyed on `is_admin`, and an HMAC inter-service token minting path (`mintInterServiceSystemToken`) that the proxy simply *doesn't verify*.

**Biggest control gaps (in severity order):**
- **IA-2 / IA-5 / AC-3 — fail-open authentication.** Forgeable committed secrets + unsigned `oa_sys_`/no-creds admin grant. A High system cannot have a trust root that is published in a public Git repo or a prefix-only admin grant. This is the gating gap.
- **IA — no MFA-freshness, no step-up, no failed-login lockout.** None of these exist in the OSS branch; the upstream has them (see PORTS). High requires session/auth assurance the OSS code does not implement.
- **SC-7 / AC-4 — no egress filtering / SSRF guard.** `probe-ollama` is a live unauthenticated SSRF primitive (internal port-scan + `169.254.169.254` IMDS reach), and there is no general egress denylist applied to tool-driven fetches.
- **CM-2 / CM-3 — configuration management.** Forked, diverged dual workflow engines (incl. forked secret-handling) mean a security fix to one copy silently leaves the other vulnerable — a direct CM-3 change-control defect.
- **SI-10 — input/algorithm hardening.** ~13 `jwt.verify` sites with no `algorithms` pinning; secret-validation that fails open rather than rejecting.
- **AU-9 / PM-12 — audit/evidence integrity.** The compliance evidence itself re-leaks the PII it documents removing.
- **SA-5 / SR-3 / SR-11 — supply chain.** Fabricated service README, wrong license, internal-Harbor base images, tag-floating (not digest-pinned) bases.

A realistic FedRAMP-High readiness timeline is gated on porting the upstream ATO core (AuthorizationSpine/Governor + MFA-freshness + lockout + DLP), not on the OSS launch fixes alone.

---

## 4. Prioritized P3 Plan

Each item: `file:line` · NIST control(s) · one-line fix.

### BLOCKERS — confirmed critical/high A+++ findings (must fix before launch)

| # | ID | Severity | file:line | NIST | One-line fix |
|---|---|---|---|---|---|
| B1 | SEC-001 / SIL-01 / COMP-SEC-01 / SEC-03(dup) | **critical** | `docker-compose.yml:276,277,283,366,367,368,407,408,414,415` (+ ui `:339`) | IA-5, SC-12, SC-13, AC-3, CM-6 | Replace every `:-...change-me` with required-var form `${JWT_SECRET:?set JWT_SECRET in .env}` (mirror existing `POSTGRES_PASSWORD`); wizard/install.sh generate strong randoms into `.env`. |
| B2 | SEC-003 | **critical (root cause)** | `services/openagentic-api/src/config/secrets.config.ts` `validateSecret()` ~63–118; `startup/01-secrets.ts` `critical:false` | IA-5, CM-6, SI-10 | Under `NODE_ENV=production` fail CLOSED (throw + abort boot) on missing/weak secret; add `change-me`/`dev-` to `substringPlaceholders`; set the boot step `critical:true` in prod. Keep auto-gen only in development. |
| B3 | SEC-002 / SIL-02 / COMP-SEC-02 / SEC-01(dup) | **critical** | `services/openagentic-mcp-proxy/src/main.py:649` (no-creds→system-admin) and `:669` (`oa_sys_`→system-root); RBAC `~1050` | AC-3, AC-6, IA-2, IA-5, AU-2 | Fail closed: reject missing creds with 401 when `ENABLE_AUTH`; verify `oa_sys_` via HMAC against `SIGNING_SECRET` (api already mints it via `mintInterServiceSystemToken`) — never trust the prefix; constant-time compare `INTERNAL_API_KEY`. |
| B4 | SEC-004 / SIL-03 / COMP-SEC-03 / SEC-02(dup) | **high** | `services/openagentic-api/src/routes/setup.ts:62–80` (registered unconditionally via `plugins/setup.plugin.ts`) | SC-7, AC-4, AC-3, SI-10 | Gate behind `needsSetup===true` (409 once an admin exists); deny RFC1918 + `169.254.169.254` + loopback + non-http(s); resolve+pin IP pre-fetch (anti-rebind). Reuse the `deny_if_private` guard already in `oap-web-mcp/tests`. |
| B5 | SIL-04 | **high** | `docs/fedramp-remediation/evidence/P0-preserve-classification.json:14,15,36,64,70,71,78,84,85,91,92`; `ledger/P0-preserve-hardening.md:34,45` | AU-9, SC-28, PM-12, RA-5 | Remove `docs/fedramp-remediation/` from the launch tree (move to a private compliance store) OR redact every literal: `<REDACTED-PERSONAL-EMAIL>`, `<REDACTED-PERSONAL-EMAIL>`, `<REDACTED-PUBLIC-IP>`, `<REDACTED-LAN-SUBNET>`, `<REDACTED-LAN-SUBNET>`, `<REDACTED-TEST-ACCOUNT>`, `<REDACTED-INTERNAL-HOST>`. (Verified present on launch ref.) |
| B6 | DOC-01 / TD junk | **critical** | `tests/demos/{GLASS-MIGRATION-to-agenticwork,HELM-K3S-RUNBOOK,UPSTREAM-CHATMODE-REWRITE-SNAPSHOT,RUNTIME-IDP-PLAN}.md` (+ `.mp4`/`.gif`/`.tape`) | RA-5, SA-5, SC-28, PM-5, AC-21 | Delete the `tests/demos/*.md` set + recording binaries; add `tests/demos/*.md` to the sync-upstream SKIP list so they cannot re-leak `<REDACTED-INTERNAL-REGISTRY>`, `<REDACTED-INTERNAL-IP>`, `<REDACTED-INTERNAL-NS>`, AwTool/AuthorizationSpine internals. |
| B7 | TD-01 | **high** | repo root: 25 `*.jpeg` (incl. `agenticode-*codemode*.jpeg`) | (hygiene / brand-leak) | `git rm` all 25 (0 references confirmed via `git ls-tree`); add `/*.jpeg` + `*.jpg` to `.gitignore` next to the existing `*.png` rule. |
| B8 | TD-02 | **high** | `services/openagentic-{api,ui}/Dockerfile.overlay:1` (`FROM <REDACTED-INTERNAL-REGISTRY>/...`) + `.dockerignore` | SR-3, SR-11 | Delete the four `Dockerfile.overlay*` files from OSS (internal Harbor fast-deploy, unbuildable externally, leaks private registry host + pinned internal tag). |
| B9 | DOC-02 / DOC-03 / SIL-07 / SEC-009 | **high** | `services/openagentic-mcp-proxy/README.md:818` (MIT) + fabricated API/files/env/metrics/helm/Support blocks | SA-5, CM-2, CM-6 | Set license to Apache-2.0; rewrite against real endpoints (`/mcp`, `/mcp/tool`, `/call`, `/tools`, `/user-sessions/*`); fix helm path to `helm/openagentic`; remove invented files/env/metrics/`notify_admin`/`your-org`/team email. |
| B10 | DOC-04 | **high** | `CONTRIBUTING.md:17,21,43` | SA-5, CM-2 | Change quickstart to `docker compose --profile milvus up -d` (a bare up never reports api healthy). |
| B11 | DOC-05 + COMP orphan MCPs | **high** | `docs/launch/{show-hn,roadmap,awesome-list-entries,cncf-sandbox-application}.md`; `services/mcps/oap-{alertmanager,agent-architect,incident,knowledge,runbook}-mcp/` | SA-5 | Reconcile to the authoritative 9 wired MCPs; remove the 5 removed-MCP claims from launch docs AND `git rm` the 5 orphan dirs (verified shipping on launch ref). |
| B12 | COMP-01 | **high** | `plugins/cluster.plugin.ts:23` (never registered); `features/docs/pages/DeployedServicesPage.tsx:203` | SA-11, CM-6 | Either register `clusterPlugin` in `server.ts` (only returns data under helm) or remove the dead `deployed-services` docs page (permanent 404 + 30s error-poll today). |
| B13 | COMP-02 | **high** | `features/docs/pages/ApiRoutesPage.tsx:10–44` | SA-5 | Correct the curated table to real routes (`/api/chat/stream` not `/chat/completions`; sessions under `/api/chat`; flows under `/api/workflows`; `/api/mcp/tools/execute` not `/mcp/invoke`) or drive it from the Swagger spec it already renders. |

### PORTS — upstream hardening to bring in surgically (the ATO core)

Verified present in upstream `~/agenticwork/agentic`. Bring each in **surgically** (file-scoped, brand-rewritten, no bulk sync), with its tests, and add to the PRESERVE list.

| # | What | Upstream source (verified) | NIST | One-line fix |
|---|---|---|---|---|
| P1 | **AuthorizationSpine / Governor ATO core** | `services/agenticwork-api/src/core/authz/AuthorizationSpine.ts`, `authz-rules.ts`, `flowAuthorizeHook.ts`, `controlPlaneCapabilities.ts` (+ `AuthorizationSpine.auditFailClosed.test.ts`) | AC-3, AC-6, AU-9 | Port the central fail-closed authorization decision point so api + mcp-proxy share ONE allow/deny spine instead of ad-hoc `is_admin` checks; port the fail-closed-audit test as the regression gate. |
| P2 | **MFA-freshness / step-up gate** | `services/AzureTokenService.ts` (+ `AzureTokenService.mfaFreshnessEnforcement.test.ts`), `routes/chat/pipeline/.../dispatchChatToolCall.mfaFreshness.test.ts`, `middleware/__tests__/unifiedAuth-admin-mfa-gate.test.ts` | IA-2(1)(2), AC-6 | Enforce MFA recency (`amr`/`acr` claim freshness) on privileged + mutating tool calls; reject stale-MFA tokens at the dispatch gate. |
| P3 | **Failed-login lockout / session enforcement** | `services/UserAuthService.ts`, `middleware/sessionEnforcement.ts` (+ `sessionEnforcement.test.ts`), `services/ScopeEnforcementService.ts` | AC-7, IA-5(1), AC-12 | Port progressive lockout on repeated failed local logins + server-side session enforcement/scope checks (OSS local-auth currently has neither). |
| P4 | **DLP / PII redaction on tool I/O** | `core/dispatch.ts` DLP hook; `__tests__/architecture/azure-sync-and-dlp-auth.source-regression.test.ts` | SC-28, AU-9, SI-4 | Port the dispatch-level DLP/redaction hook so tool args/outputs and audit rows are scrubbed of secrets/PII before persistence/stream. |
| P5 | **Fail-closed secrets enforcement (server-side)** | upstream secret-validation path feeding `unifiedAuth.ts` (no raw `process.env` reads behind auth) | IA-5, CM-6, SI-10 | Adopt the upstream pattern where validated secrets are the single source and a missing/weak secret aborts boot — replaces the OSS fail-open `secrets.config.ts` (couples with B2). |
| P6 | **Unified auth middleware** | `services/agenticwork-api/src/middleware/unifiedAuth.ts` (+ the `manual-jwt-verify-routes-use-authmiddleware` / `route-auth-coverage` source-regression tests) | IA-2, AC-3, SI-10 | Replace the ~13 scattered raw `jwt.verify` sites (SEC-005) with one unified middleware that pins `algorithms:['HS256']` and is enforced by the upstream route-auth-coverage test. |

### CONTROL GAPS — partial/gap NIST controls to close beyond the ports

| # | Gap | file:line | NIST | One-line fix |
|---|---|---|---|---|
| C1 | JWT alg pinning (defense-in-depth, if P6 not taken wholesale) | `auth/tokenValidator.ts:206`, `auth.ts:763/825/914/2132`, `obo.ts:54/102`, `chat/middleware/auth.middleware.ts:192`, +6 | SI-10, IA-2 | Add `{ algorithms:['HS256'] }` to every symmetric `jwt.verify` (only `auth.ts:609` is pinned today). |
| C2 | mcp-proxy HS256 dev-secret fallback | `main.py ~748` (`... or 'dev-secret-change-in-production'`) | IA-5, CM-6 | Remove the literal fallback; reject HS256 internal tokens (401) when no real secret is set. |
| C3 | VaultInitService dev-token default | `services/VaultInitService.ts:25` (`|| 'vault-dev-token-change-me'`) | IA-5, CM-6 | Never default the Vault token; disable Vault (fall back to env-secret mode) when `VAULT_TOKEN` unset. |
| C4 | MCP Inspector auto-started in prod image | `main.py ~298–308` (`subprocess.Popen(['npx','@modelcontextprotocol/inspector'...])`) | CM-7, SA-15 | Gate behind an explicit dev-only flag (default off); never start in prod images — unauthenticated debug surface + unpinned npx fetch. |
| C5 | mcp-proxy CORS allows localhost with credentials | `main.py ~410–419` (`allow_credentials=True`, `localhost:3000/5173`, `*` headers) | SC-7, AC-4 | Default `ALLOWED_ORIGINS` to internal hosts only; drop wildcard headers with credentials. |
| C6 | MCP_READ_ONLY_MODE defaults false | `main.py:98` | AC-6, CM-6 | Default to `true` as secondary defense (NOT the fix for B3); document the toggle. |
| C7 | Pre-commit secret scanner gaps | `.githooks/pre-commit:47` (skips `*/docs/*`), `:72` (matches stale `awc_` not `oa_`/`oa_sys_`) | RA-5, SA-11, SI-3 | Add `oa_`/`oa_sys_` patterns, personal-email rule, weak-default/`PGPASSWORD=<REDACTED> rule, onmicrosoft-tenant + private-IP heuristic; narrow the docs-skip to binary assets only. |
| C8 | Seed-SQL leaks namespace + plaintext password | `prisma/seed-docs-assistant.sql:5`, `seed-flows-agent.sql:5` (`kubectl -n <REDACTED-INTERNAL-NS> ... PGPASSWORD=<REDACTED> | IA-5, SC-28, CM-6 | Rewrite comments to generic `psql -h <host> -U <user> -d <db>`; rotate `<REDACTED-DB-PASSWORD>` if ever real. |
| C9 | Internal namespace hardcoded as runtime default | `config/featureFlags.ts:96–100` (`return '<REDACTED-INTERNAL-NS>'`); also `azureADAuth.ts:478`, `oap-kubernetes-mcp/src/server.py:89` | CM-6, SC-7, AC-4 | Require `K8S_NAMESPACE` (fail closed) or default to neutral `default`; strip `<REDACTED-INTERNAL-NS>`/`chat-dev` from source/comments. |
| C10 | Forked workflow engines (CM liability) | api vs workflows-svc `WorkflowExecutionEngine.ts` (4029/5935), `WorkflowCompiler.ts` (678/983), `WorkflowSecretService.ts` (642/601) | CM-2, CM-3, SA-15, SC-28 | Complete the `executeViaWorkflowsService` migration: re-point `embed.ts:104`, `WorkflowTestRunner.ts:362`, `routes/workflows.ts`; promote `WorkflowSecretService` to the shared package; DELETE the api copies. |
| C11 | Uncontrolled stdout logging / weak typing gates | `.eslintrc.js` (`no-console`/`no-explicit-any` = warn; override disables `no-explicit-any` at line 124); 803 `console.*`, ~5,300 `any` | AU-9, AU-12, SA-15 | Flip `no-console`/`no-explicit-any` to `error` and gate in CI; burn down `console.*` to a structured logger. |
| C12 | Tag-floating / inconsistent base images | mcp-proxy `python:3.11-slim` vs 9 MCPs on distroless Chainguard; `node:22-slim`/`nginx:alpine` unpinned | CM-2, SR-11, SI-7 | Digest-pin all base images; standardize mcp-proxy onto the same distroless base as the MCPs. |

---

## 5. Top 10 to Fix Before Launch

1. **B1 — Remove committed `*-change-me` secret defaults** (`docker-compose.yml`): require the vars (`${VAR:?...}`); wizard generates strong randoms. *(forge-admin trust root)*
2. **B3 — Close the mcp-proxy auth bypass** (`main.py:649,669`): 401 on no-creds under `ENABLE_AUTH`; HMAC-verify `oa_sys_` against `SIGNING_SECRET`. *(unsigned system-root grant)*
3. **B2 — Fail-closed `secrets.config.ts`** in production (throw on missing/weak; add `change-me`/`dev-` to blocklist; `critical:true`). *(the root cause behind #1)*
4. **B4 — Gate + SSRF-guard `probe-ollama`** (`routes/setup.ts:62–80`): `needsSetup` gate + RFC1918/IMDS/loopback denylist + IP pin.
5. **B5 — Remove/redact `docs/fedramp-remediation/`** — it re-leaks the exact PII/IP/tenant it documents removing (verified verbatim on the launch ref).
6. **B6 — Delete `tests/demos/*.md`** (Harbor creds, dev home paths, internal IPs/namespaces, enterprise internals) + add to sync SKIP.
7. **B7 — `git rm` the 25 root `.jpeg` dumps** (incl. the two Code Mode brand re-leaks) + `.gitignore` `/*.jpeg`.
8. **B8 — Delete the `Dockerfile.overlay*` files** leaking `<REDACTED-INTERNAL-REGISTRY>` and unbuildable externally.
9. **B9 — Fix the mcp-proxy README**: Apache-2.0 (not MIT) + remove the mass fabrication (API/files/env/metrics/helm/Support).
10. **B10 + B11 — Fix CONTRIBUTING quickstart** (`--profile milvus`) **and reconcile the 14-vs-9 MCP claims** + `git rm` the 5 orphan MCP dirs.

**After the Top 10, the next pass is PORTS P1–P3 (AuthorizationSpine + MFA-freshness + lockout)** — these are the gating FedRAMP-High controls and are the difference between "publishable OSS" (Top 10) and "credible ATO trajectory."

**Verification gate for P3 workflow:** re-run leak-scan (B5–B8 zero hits), prove fail-closed boot (B1–B3: api + mcp-proxy refuse to start on weak/missing secret; `oa_sys_garbage` → 401), prove SSRF gate (B4: `169.254.169.254` rejected, 409 post-setup), then re-grade. Do **not** flip GO until that evidence is captured.

Relevant absolute paths: `/home/trent/agenticwork/openagentic/docker-compose.yml`, `/home/trent/agenticwork/openagentic/services/openagentic-mcp-proxy/src/main.py`, `/home/trent/agenticwork/openagentic/services/openagentic-api/src/config/secrets.config.ts`, `/home/trent/agenticwork/openagentic/services/openagentic-api/src/routes/setup.ts`, `/home/trent/agenticwork/openagentic/docs/fedramp-remediation/`, `/home/trent/agenticwork/openagentic/tests/demos/`, `/home/trent/agenticwork/openagentic/services/openagentic-mcp-proxy/README.md`. Upstream ATO-core sources for PORTS: `/home/trent/agenticwork/agentic/services/agenticwork-api/src/core/authz/AuthorizationSpine.ts` and siblings (verified present).