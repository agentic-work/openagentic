All key claims confirmed at source. Critical reachability finding: the compose path sets `NODE_ENV: production` but does NOT pass `AZURE_CLIENT_ID`/`AZURE_TENANT_ID` — so the default OSS compose deploy (local-auth-only, non-Azure LLM) will hit `validateSecret('AZURE_CLIENT_ID', undefined)` → throw in the `critical: true` bootstrap → **fail-closed boot crash on the shipped happy path**. This is a launch-functional regression, not just SSP residue. AU-10 chain writer confirmed dead code; admin audit writes bypass the chain.

I have enough verified evidence to produce the final re-grade.

---

# OpenAgentic OSS Launch — FINAL Re-Grade Card
**Branch:** `oss-launch/a3-fedramp` · **Prior verdict:** D / NO-GO · **Method:** adversarial, source-verified (file:line), build-state taken on faith where noted

## 1. Grade Table

| Dimension | Before | After | Verified note |
|---|---|---|---|
| **security** | D | **A−** | All 4 ex-criticals genuinely fixed at source: compose `${VAR:?}` fail-fast (16 occurrences, 0 `change-me`); `secrets.config.ts:79-91` throws in prod; mcp-proxy `oa_sys_` HMAC `compare_digest` (`main.py:163`) + `ENABLE_AUTH` default true (`:83`) + no-creds→401 (`:695`); probe-ollama setup-gated + SSRF-guarded. HS256 pinned (`tokenValidator.ts:70`). Held off A by 3 residuals below. |
| **secrets/IP-leak** | D | **B** | Headline binary leaks gone (no root jpegs, no `Dockerfile.overlay*`, no `harbor.*` host in tracked files). `live-dashboard/` **IS now gitignored** (refutes the supplied "NOT ignored" claim — in the safe direction). Residual PII/infra identifiers survive: `admin@cdc.gov`, `<REDACTED-INTERNAL-IP>` (7 files), `<REDACTED-INTERNAL-NS>` in prod source. |
| **completeness** | D | **A−** | 9 MCPs only, cluster plugin really registered, ApiRoutesPage manifest-driven, api tsc 0 errors. Held off A by the stale manifest fabricating 6 dead AAD routes + orphan `LoginDev.tsx`. |
| **duplication** | D | **A−** | Chat-fork class gone; single canonical engines. Residual: tracked, unregistered brand-leak node `agenticwork_chat/` (registry hits = 0). C10 engine-dedup is documented POA&M, not counted. |
| **tech-debt** | D | **B+** | Hygiene blockers cleared; jwt-alg-pin in live path. Held off A by an incompletely-swept dead Azure-AD code island (the "AAD excised entirely" claim is only true for the live request path). |
| **docs** | D | **A** | LICENSE Apache-2.0 throughout, mcp-proxy README de-fabricated and source-backed, `--profile milvus` quickstart, redact `--check` clean. One trivial residual (non-existent `tests/integration/` in README). |

## 2. Overall Grade + GO/NO-GO

**Overall: B+ — CONDITIONAL NO-GO (a short, mechanical fix-list from GO).**

The remediation is real and substantial: every one of the original 4 GO-gate security blockers from the D/NO-GO audit is **genuinely closed at source**, not just in the campaign log. No exploitable auth bypass, secret-default, or SSRF blocker survives. That is a legitimate D→A− security lift.

But this is **not yet a GO**, for two reasons — one functional, one launch-quality:

**BLOCKER 1 (functional, NEW — refutes "build-state green is sufficient"): fail-closed boot crash on the shipped compose happy path.** `secrets.config.ts:168,170` require `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` as **mandatory** (`validateSecret` with no `allowEmpty`). `loadSecrets()` runs in the `critical: true` bootstrap (`startup/01-secrets.ts:10`) which re-raises to abort boot. The shipped `docker-compose.yml` sets `NODE_ENV: production` (`:184`) and does **not** pass either AZURE var. So a default OSS install — local-auth-only, Ollama/non-Azure LLM, exactly the documented happy path — will **throw and refuse to boot**. This is residue of the AAD excision (those vars now only matter for the optional Azure OpenAI *LLM provider*) and it directly contradicts the "OSS is local-auth only, installs in 5 min, everything works" goal. tsc-green does not catch it. **Must fix before launch.**

**BLOCKER 2 (launch-quality, surviving criticals/highs — not deferred, not documented):**
- **PII:** `admin@cdc.gov` (maintainer's government employer domain) in tracked test `mcp-tools-list-auth-forward.test.ts:82` — ships publicly.
- **Fabricated public docs:** `api-routes.json` manifest advertises 6 dead AAD identity routes (`/api/auth/microsoft*`, `/api/auth/obo*`, `*-azure`); verified GONE from API source — the public docs page invents endpoints the API never serves. This is the exact "fabricated docs / 404 routes" failure mode.
- **Brand leak:** tracked, unregistered `services/shared/workflow-engine/src/nodes/agenticwork_chat/` carries the proprietary brand into a public OSS path.
- **"AAD excised entirely" is OVERSTATED:** a dead Azure-AD island still ships — `auth.middleware.ts:262` `verifyAzureToken()` `jwt.decode()`s without signature verification ("we can trust them since they've already been validated by MSAL"). Confirmed **orphaned** (no importers; only its `AuthenticatedRequest` type is consumed by two sibling middlewares), so **not a live bypass** — but it is a re-wireable trust-the-token landmine that contradicts the excision attestation.

**Refuted / corrected claims (honesty):**
- The "`live-dashboard/` is NOT gitignored, a `git add -A` would commit it" claim is **REFUTED** — `git check-ignore` confirms it IS ignored now. Risk eliminated, in the safe direction.
- The mcp-proxy env var is `API_INTERNAL_KEY` (not `INTERNAL_API_KEY`) at `main.py:773`; the non-constant-time `==` finding still holds.

None of the survivors is an exploitable auth/secret/SSRF bypass, so the security dimension itself is GO-clean. But Blocker 1 breaks the default install, and the surviving criticals/highs (PII, fabricated docs, brand leak) are exactly the public-launch quality gates. **Verdict: NO-GO until the fix-list below clears; this is hours of mechanical work, not another campaign.**

**Pre-GO fix-list (all mechanical):**
1. Make `AZURE_CLIENT_ID`/`AZURE_TENANT_ID` conditional (`allowEmpty`, gated on Azure-OpenAI provider selection) so local-auth/non-Azure prod boots. *(Blocker 1)*
2. `admin@cdc.gov` → `example.com`. *(critical PII)*
3. Regenerate + re-commit `api-routes.json`. *(fabricated docs)*
4. `git rm -r .../nodes/agenticwork_chat/` + add to sync SKIP/scrub. *(brand leak)*
5. Delete `auth.middleware.ts` / `fastify-auth.ts` / `auth-validator.ts` / `routes/memories.ts` / `LoginDev.tsx`; move `AuthenticatedRequest` to siblings. *(clean local-auth-only attestation)*
6. Sweep `<REDACTED-INTERNAL-IP>`→`127.0.0.1`/RFC5737, `ollama-hal`→neutral, `<REDACTED-INTERNAL-NS>`→`default`. *(infra identifiers)*
7. (defense-in-depth) call `bootstrap_jwt_keys()` in mcp-proxy `lifespan()`; make `tokenValidator.ts:19-27` throw under `NODE_ENV=production`; switch `main.py:773` to `hmac.compare_digest`.

## 3. NIST 800-53 High Technical Baseline — Readiness

Counts from the verified evidence package (AC, AU, IA families; SC/SI families summarized):

| Family | implemented | partial | n/a (by design) | poam |
|---|---|---|---|---|
| **AC** (Access Control) | 9 | 4 | 2 | 5 |
| **AU** (Audit & Accountability) | 9 | 2 | 1 | 5 |
| **IA** (Identification & Auth) | 4 | 0 | 2 | (shared) |

**Headline:** The local-auth-only edition now substantiates a **strong majority of the AC/AU/IA *technical* High-baseline control surface in code** — the trust root is a single source-of-truth validator (HS256-pinned, fail-closed), access enforcement is uniform (admin middleware, mcp-proxy fail-closed at the tool boundary), and the audit substrate (AU-2/3/8/12) is centralized at the seams every event must traverse with a single-pass dedup flag and fail-SAFE mutating-call blocking. The federated-identity control set (IA-2(1/2) MFA-freshness, OBO replay, external-IdP group claims) is **legitimately N/A by design** — there is no IdP/delegated-token surface to assess (mcp-proxy rejects `kid`/RS256 fail-closed; CSP MCPs use static Service-Account creds).

**Biggest remaining technical gaps (beyond the launch blockers):**
- **AU-9 (Protection of Audit Info) — partial:** append-only is **app-enforced only** and **only `tool_call_audit_log` is caged** by a source-regression test; `admin_audit_log`/`auth_audit_log`/`user_query_audit` have no immutability guard and there is no DB-level REVOKE/trigger. No separation-of-duty check on the approval-decide route.
- **AU-10 (Non-repudiation) — partial/effectively unmet:** the SHA-256 hash-chain on `admin_audit_log` is **dead code** — confirmed: zero live call sites for the chaining writer (`AuditLogger.logAdminAction`); the rows that ARE written go through direct `adminAuditLog.create` (unifiedAuth, permissions, v3-extras, DatabaseService, auditTrail) which set no `previous_hash`/`chain_hash`. The chain is designed but unwired.
- **AC-7 — partial:** generic-401 + global IP rate-limit on `/login`, but no per-account consecutive-failure lockout.
- **AC-2(1) — partial:** sessions/keys auto-expire; no automated inactive-*user*-account disable.

These four are **SSP/POA&M items, not launch blockers**, but an assessor will flag AU-9 (DB-level enforcement) and AU-10 (wire the chain) as the highest-value technical hardening before an actual ATO.

## 4. POA&M (deferred — tracked, not counted as fixed)

| ID | Item | Remaining action | Risk |
|---|---|---|---|
| **C6** | `MCP_READ_ONLY_MODE` default | Flip default to ON before authorizing cloud-mutating MCPs in a High env | Med — least-privilege for destructive cloud ops currently relies on the (active, fail-closed) HITL mutating-approval gate; acceptable interim |
| **C10** | Forked workflow-engine dedup | Consolidate the Flowise-derived engine fork (single canonical engine already consumed via `workspace:*`/`file:`) | Low — documented (`P3-wave5-control-gaps-2.md:17-20`); no live duplicate engines, hygiene only |
| **C11** | Lint-gate flip | Make lint failures block CI | Low — code-quality drift risk only |
| **C12** | Base-image digest pin | Replace floating tags with `sha256` digests (CM-6/SR) | Med — supply-chain integrity; image-substitution exposure until pinned |
| **Prisma** | Drop unused Azure/SSO columns | Author forward-only migration (`migrate deploy`, not `db push`) to drop `azure_group_id`/`azure_group_name` + any AAD/OBO columns | Low — columns inert/unpopulated in local-auth-only; data-model cleanliness/scoping only |

*(Additional POA&M items this audit surfaces, recommend adding: AU-9 DB-level append-only + extend the source cage to all four audit tables + authz on approval-decide; AU-10 route admin writes through the chaining writer + expose a verify endpoint.)*

## 5. What an Assessor Would Still Need (org/process, beyond code)

Honest scope statement — the code now provides strong *technical* control evidence, but a FedRAMP authorization requires the process layer the OSS repo cannot contain:

- **System Security Plan (SSP)** mapping every control to this implementation evidence, including the explicit N/A justifications for the federated-identity family and the operator-responsibility carve-outs (AC-8 login banner is deployment-layer).
- **Continuous Monitoring (ConMon)** plan: vuln scanning cadence, the C12 digest-pin SBOM/scan pipeline, log aggregation/retention (AU-4/AU-11 storage + retention policy live at the deployment layer, not in code).
- **POA&M as a living artifact** owned by the deploying agency, seeded with C6/C10/C11/C12/Prisma + the AU-9/AU-10 gaps above.
- **Captured test evidence:** the mcp-proxy 19/19 auth pytest **could not be re-run in this sandbox** (no fastapi) — the source implements what the tests assert, but the actual green run must be captured in the evidence package, not taken on faith.
- **Org-defined parameter values** (session timeout, AC-7 lockout thresholds, password policy), incident response (IR family), personnel/physical/contingency families — all environmental, none in scope for OSS code.
- **3PAO assessment + agency ATO** — the authorization decision itself.

**Bottom line:** D→B+ is a real, source-verified improvement and the security posture is GO-clean. But the verdict stays **NO-GO** until the AZURE-mandatory boot crash (functional, breaks default install) and the surviving PII/fabricated-docs/brand-leak criticals clear — a short mechanical fix-list, not another remediation campaign.