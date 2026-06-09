# P0 — Harden `sync-upstream.py` PRESERVE against OSS-only security regressions

**Date:** 2026-06-09
**Branch:** `main` (`b249e0911`)
**Driver:** `preserve-hardening-classify` workflow (62 Opus-4.8 agents, adversarial per-file classification)
**Evidence:** [`../evidence/P0-preserve-classification.json`](../evidence/P0-preserve-classification.json) (full per-file reasons + diff hunks), [`../evidence/P0-port-candidates.json`](../evidence/P0-port-candidates.json)

## Problem

`tools/sync-upstream.py` overlays the internal enterprise upstream onto the OSS
repo, overwriting files by default. The OSS-readiness audit proved a full sync
**re-introduces** security/PII fixes that already exist on `main` (e.g.
`googleAuth.ts`, `LoginDev.tsx`) because those files were missing from the
`PRESERVE` set. PRESERVE covered chat/admin/theme work but **none** of the core
auth/secret/PII surface.

## Method

Computed the set of files that (a) exist on both `main` and a full-sync base
(`f10b0c9ba`), (b) differ, and (c) match security/auth/secret/PII path patterns
→ 62 candidates. One agent per file diffed `main` vs the sync base (ignoring
brand renames) and classified it, citing the exact diff hunk:

- **PRESERVE** — `main` holds a security property upstream lacks/regresses.
- **TAKE_UPSTREAM** — upstream is equal or stronger (a *port* candidate, not a regression).
- **NEUTRAL** — brand/cosmetic only.

Result: **12 PRESERVE · 18 TAKE_UPSTREAM · 32 NEUTRAL · 0 errors.**

## Fix — 12 files added to `PRESERVE`

| File | Category | What a sync would regress |
|---|---|---|
| `api/src/auth/googleAuth.ts` | admin-default / PII | Re-adds `<REDACTED-PERSONAL-EMAIL>` as the `GOOGLE_ADMIN_EMAILS` default → PII + privilege-escalation backdoor; main fails closed. |
| `api/src/routes/google-auth/index.ts` | admin-default / PII | Same hardcoded-admin default on the OIDC allow/admin path; main fails closed + warns. |
| `api/src/config/featureFlags.ts` | authz-gate / codemode | Deletes the default-ON `approvalGateMutating` gate **and** re-leaks Code Mode (`codeManagerUrl`, `controlPlaneCodemode`, `codemode.plugin.ts`). |
| `api/src/routes/auth.ts` | audit-failclose | Drops `sso_login` + `login_failed` persistence to `auth_audit_log` on the Azure SSO path. |
| `api/src/services/DLPScannerService.ts` | PII-default | Re-adds the #1144 cloud-inventory PII exemption (skips `pii` category for `gcp_/aws_/azure_/k8s_` read tools); main keeps the stricter, FedRAMP-correct posture. |
| `api/src/utils/secrets.ts` | secret-failclose | Re-introduces an **infinite-recursion** bug (`getVaultServiceInstance()` calls itself); main calls `getVaultService()`. |
| `ui/.../auth/components/LoginDev.tsx` | PII | Re-adds a real personal public IP + LAN subnets; main scrubbed to loopback/Docker-bridge (env-configurable). |
| `mcp-proxy/tests/test_jwt_auth.py` | authz-isolation | Drops the assertion that a user API key is NOT routed through the privileged `oa_sys_` system path. |
| `tests/config.js` | PII | Re-adds a personal email + real-key-shaped fallback. |
| `tests/e2e/auth.setup.ts` | infra-leak | Re-adds an internal dev hostname (vs RFC-2606 placeholder). |
| `tests/e2e/helpers/loginAsMcpTester.ts` | PII / infra | Re-adds a real AAD tenant domain, internal test email, live internal hostname. |
| `tests/e2e/helpers/saveAuthState.ts` | infra-leak | Re-adds `<REDACTED-INTERNAL-HOST>`. |

## Note carried forward to P3

The 18 **TAKE_UPSTREAM** files are *port candidates*: upstream has genuinely
stronger hardening OSS lacks (MFA-freshness enforcement, failed-login lockout,
fail-closed secret validation, the `core/authz` AuthorizationSpine/Governor ATO
core, secret redaction). These are ported **surgically** in P3 — not by
file-level clobber — precisely because some of those files (e.g.
`featureFlags.ts`) also carry the OSS-only fixes preserved above.

## Verification

- `python3 -c "import ast; ast.parse(...)"` → `sync-upstream.py` valid.
- All 12 paths confirmed present in the `PRESERVE` set via grep.
