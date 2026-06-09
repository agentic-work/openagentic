# P4 — Adversarial Re-Grade + Final Fix Wave + FedRAMP-Readiness Evidence

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp`
**Method:** 20-agent adversarial re-grade (6 dimensions + 7 NIST families + 6 refute-the-claim verifiers) → fix-list applied → re-verified.
**Full card:** `P4-regrade-gradecard.md` · **data:** `../evidence/P4-regrade-data.json`

## Verdict: D/NO-GO → **B+ (GO-clean security; was CONDITIONAL pending the fixes below — now applied)**

| Dimension | Before | After |
|---|---|---|
| security | D | **A−** |
| secrets / IP-leak | D | **B → B+** (after P4 fixes) |
| completeness | D | **A−** |
| duplication | D | **A−** |
| tech-debt | D | **B+** |
| docs | D | **A** |

All **5 of 6 GO-gate claims held under adversarial refutation**: compose fail-fast, mcp-proxy fail-closed (no-creds→401 + `oa_sys_` HMAC), AAD/OBO/Google-SSO gone, local login works, the `buildChatV2Deps` HS256 tool-call signer survives. The 6th (jwt-alg-pin) was **refuted** — one aliased call site missed — and fixed.

## Fixes applied this wave (all re-verified)

| # | Finding (P4) | Severity | Fix | Verified |
|---|---|---|---|---|
| **BLOCKER 1** | `secrets.config.ts` marked AZURE_CLIENT_ID/TENANT_ID/API_KEY/MILVUS/MINIO **mandatory** in production, but the OSS compose passes only DATABASE_URL/REDIS_URL/JWT_SECRET → my B2 fail-closed change would **crash the default `docker compose up` on boot** | **critical (functional, self-inflicted)** | Required set reduced to DATABASE_URL + JWT_SECRET; everything else `allowEmpty` (optional; AZURE_* only for the optional Azure-OpenAI LLM). Added a BLOCKER-1 regression test (boots with only OSS-compose secrets). | B2 tests 7/7; api tsc 0 |
| #4 | `admin-mcp-logs.ts:359` `jwt.default.verify(` unpinned (aliased form my C1 grep/guard missed) | high | Pinned `{ algorithms: ['HS256'] }`; **tightened the C1 guard test** to catch `.verify(` aliases | guard test 1/1 |
| #1 | PII: `admin@cdc.gov` (maintainer's gov employer domain) in a tracked test | high | → `admin@example.com`; also dropped the stale `azure-ad`/`azure_abc123` (→ `local`) | 0 cdc.gov refs; test 3/3 |
| #2 | `api-routes.json` advertised 6 dead AAD identity routes (stale manifest, pre-excision) | high | Regenerated the manifest (source-scan dropped them) | 0 dead-AAD refs |
| #3 | Orphaned `auth.middleware.ts` `verifyAzureToken()` — unverified `jwt.decode` MSAL-trust landmine (no importers; contradicts the excision attestation) | high | Reduced the 661-line file to just the `AuthenticatedRequest` type its 2 siblings consume; deleted the unsafe code | api tsc 0; ui build ✓ |
| #5 | Brand leak: orphan `nodes/agenticwork_chat/` (3 files, 0 refs) in a public path | high | `git rm` (0 references confirmed) | 0 tracked |
| #6a | Internal registry IP `<REDACTED-INTERNAL-IP>:30500/agentic/...` in a mock template | med | → `registry.example.com:5000/openagentic/...` | 0 refs |
| #6b | Private LAN GPU IP in helm values comment | low | → `gpu-host.example.internal` | — |

## NIST 800-53 High — technical-baseline readiness (local-auth-only)

Per the verified control-implementation evidence (`evidence/P4-regrade-data.json` has the full per-control matrix):

| Family | implemented | partial | n/a (by design) | poam |
|---|---|---|---|---|
| AC (Access Control) | 9 | 4 | 2 | 5 |
| AU (Audit & Accountability) | 9 | 2 | 1 | 5 |
| IA (Identification & Auth) | 4 | 0 | 2 | — |
| SC / SI / CM / RA-SA | (see evidence JSON) | | | |

**Headline:** the local-auth-only edition substantiates a strong majority of the AC/AU/IA *technical* High-baseline in code — single source-of-truth HS256-pinned fail-closed validator, uniform admin enforcement, mcp-proxy fail-closed at the tool boundary, centralized audit substrate. The **federated-identity control set (IA-2(1)(2) MFA-freshness, OBO replay, external-IdP group claims) is legitimately N/A by design** — there is no IdP/delegated-token surface (mcp-proxy rejects `kid`/RS256 fail-closed; CSP MCPs use static Service-Account creds).

**Highest-value technical gaps an assessor would flag (SSP/POA&M, not launch blockers):**
- **AU-9** append-only is app-enforced + only `tool_call_audit_log` is caged by a regression test; no DB-level REVOKE/trigger on the other audit tables.
- **AU-10** the SHA-256 hash-chain on `admin_audit_log` is designed but **unwired** (rows written via direct `create`, no `previous_hash`/`chain_hash`).
- **AC-7** global IP rate-limit on `/login` but no per-account lockout.

## POA&M (deferred — tracked, not counted as fixed)

| ID | Item | Risk |
|---|---|---|
| C6 | `MCP_READ_ONLY_MODE` default→ON | Med (mitigated by the active fail-closed HITL mutating-approval gate) |
| C10 | Forked workflow-engine dedup | Low (hygiene; no live duplicate engines) |
| C11 | Lint-gate flip (block CI) | Low |
| C12 | Base-image digest pin | Med (supply-chain) |
| Prisma | Drop unused Azure/SSO columns (forward migration) | Low (inert in local-auth) |
| AU-9 | DB-level append-only + extend the source cage to all 4 audit tables | Med (assessor will flag) |
| AU-10 | Wire admin writes through the hash-chaining writer + verify endpoint | Med (assessor will flag) |
| infra-IPs | Sweep `<REDACTED-INTERNAL-IP>`/`ollama-hal` from ~10 test fixtures → RFC5737/neutral | Low (private RFC1918, cosmetic) |

## What an assessor still needs (org/process, beyond code)

SSP (control→implementation mapping incl. the N/A federated-identity justification), ConMon plan (vuln-scan cadence, SBOM/digest-pin pipeline, log retention AU-4/AU-11), the POA&M as a living agency-owned artifact, captured test-run evidence (the mcp-proxy 19/19 auth pytest green run), org-defined parameter values (session timeout, AC-7 thresholds), and the 3PAO assessment + agency ATO decision itself. The OSS repo provides strong *technical* control evidence; the process layer is the deploying organization's.
