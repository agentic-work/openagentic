# P3 Wave 5 — Control gaps C1, C5, C7 (+ C6 deferred)

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp` · all build-gated.

Run after the AAD/OBO excision (which shrank C1 and removed the RS256/Azure surface).

| ID | Gap | NIST | Fix | Verified |
|---|---|---|---|---|
| C1 | `jwt.verify` sites didn't pin `algorithms` (alg-confusion / `alg:none`) | SI-10, IA-2 | Pinned `{ algorithms: ['HS256'] }` on all 8 symmetric sites + the 1 callback-form site (`auth.middleware.ts`). The 2 RS256/JWKS sites (Teams, auth-validator) already pinned `['RS256']`. Added a source-regression guard test. | guard test 1/1; api tsc 0 |
| C5 | mcp-proxy CORS: default included localhost dev origins + `allow_methods/headers=["*"]` with `allow_credentials=True` | SC-7, AC-4 | Default origins = internal services only (localhost via `ALLOWED_ORIGINS` env for dev); explicit method allow-list (GET/POST/OPTIONS) + explicit header allow-list (no `*`) | pytest 19/19; main.py valid |
| C7 | pre-commit scanner: skipped ALL `*/docs/*`; only matched the stale `awc_` key prefix | RA-5, SA-11, SI-3 | Narrowed docs-skip to only the redact-guarded `docs/fedramp-remediation/*` (all other docs now scanned); added a real `oa_`/`oa_sys_` key pattern (40+ char body, so the bare `oa_sys_` prefix in prose isn't flagged); kept `awc_` for back-compat | `bash -n` valid; redact-guarded tree still skipped |

## C1 detail — sites pinned

`tokenValidator.ts`, `advanced-prompting/prompts.ts`, `analytics-monitoring/prompt-metrics.ts`, `auth.ts` (×3), `local-auth.ts`, `memory-vector/contexts.ts` → `{ algorithms: ['HS256'] }`; `chat/middleware/auth.middleware.ts` (callback form) → options inserted before callback. Guard: `src/__tests__/architecture/jwt-algorithms-pinned.source-regression.test.ts` walks `src/**`, fails on any unpinned `jwt.verify`.

## Deferred (deliberate — documented for the evidence package / POA&M)

- **C6** MCP_READ_ONLY_MODE default → `true`: a **product-behavior change** (a fresh install couldn't run any write/mutating cloud op until an admin opts in). The audit rated it "secondary defense, NOT the fix" (the real cloud-write authz is the per-tool permission gate). **Deferred to a product decision** rather than flipped unilaterally.
- **C10** forked workflow-engine consolidation (~5,200 LOC) — explicitly post-launch hygiene per the original audit; high-risk refactor, marginal FedRAMP benefit. Tracked for a dedicated effort.
- **C11** flip ESLint `no-console`/`no-explicit-any` to `error` — a large mechanical burn-down (803 `console.*`, ~5,300 `any`); CI-gate change, post-launch.
- **C12** digest-pin all base images — mechanical, low-risk; batched into a release-hardening pass.

## Build gates (all green)
- api `tsc --noEmit`: 0 errors · C1 guard test: 1/1
- mcp-proxy pytest: 19/19 · main.py valid
- `.githooks/pre-commit`: valid bash
