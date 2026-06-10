# P5 — AU-10 admin-audit hash chain (wired)

**Date:** 2026-06-09 · **Branch:** `oss-launch/a3-fedramp` · **Method:** understanding-first, TDD (RED→GREEN).

## Finding (from P4)

NIST **AU-10 (non-repudiation)** was effectively unmet: `AuditLogger` had a
SHA-256 hash-chain design, but it was **dead** (0 callers) and the ~8 *live*
admin-audit writers all called `prisma.adminAuditLog.create` **directly**,
producing rows with null `previous_hash`/`chain_hash` — an unchained, non-tamper-evident audit log.

## Understanding established before coding (the part skipped on the first attempt)

- `admin_audit_log.details` is a **`jsonb`** column, not `String?`. The 8 direct
  writers store `details` as an **object**; the dead `AuditLogger` stored
  `JSON.stringify(details)` — two conflicting conventions.
- **jsonb does not preserve object key order**, so hashing `JSON.stringify(details)`
  is non-deterministic across write→read and would report *false* tampering.
  → Decision (user-approved): hash over a **canonical (recursively sorted-key)**
  serialization, computed identically on write and verify.

## Fix

- New single writer `services/audit/adminAuditChain.ts` (under the PRESERVE'd
  `audit/` prefix):
  - `createChainedAdminAudit({ data })` — drop-in for `prisma.adminAuditLog.create`;
    computes `previous_hash`/`chain_hash` and writes. **Serialized** through a
    module-level promise queue so concurrent writes can't fork the chain.
  - `normalizeDetails()` — canonical sorted-key serialization (survives jsonb reorder).
  - `verifyAdminAuditChain()` — recomputes + detects tampering; reads `details`
    as the object jsonb returns (no `JSON.parse`, which threw on the object form).
- Routed all **8 live writers** (`unifiedAuth`, `permissions`, `v3-extras`,
  `v3-extras-mutations`, `user-data-management` ×2, `DatabaseService`,
  `auditTrail`, + the dead `AuditLogger`) through it — one-line rename each.

## Tests (TDD)

- `adminAuditChain.test.ts` (5): sequential chaining; **no-fork under concurrent
  writes**; **canonical hash survives jsonb key-reorder on read-back** (the RED
  test that drove the canonical design); verify-intact; tamper-detection.
- `admin-audit-chained-writes.source-regression.test.ts` (1): guard — no source
  file calls `prisma.adminAuditLog.create` directly except the chain writer.

## Gates (all green)

- AU-10 tests 6/6 · api `tsc --noEmit` 0 · the 8 edited callers' existing tests
  92/92 (rename broke nothing). All touched files added to sync PRESERVE.

## Deferred (separable follow-ups — POA&M)

- **AU-10 verify *endpoint***: the `verifyAdminAuditChain()` function exists +
  is tested; exposing it as an admin route is a small separate increment.
- **De-dup**: the dead `AuditLogger` chain logic (its own `computeChainHash`/
  `getLatestAdminAuditHash`) is now redundant — remove with the C10 dedup pass.
- **AU-9** (DB-level append-only / REVOKE on all 4 audit tables) — unchanged.
