-- AU-10 (NIST 800-53 — Non-repudiation): make tool_call_audit_log tamper-evident.
--
-- admin.admin_audit_log is already hash-chained (previous_hash/chain_hash), but
-- admin.tool_call_audit_log (the approval-gate trail) was app-layer append-only
-- with an in-place pending->decided UPDATE, so a DB actor could alter tool name,
-- args, or the decision of any past row undetectably.
--
-- This adds the chaining columns the writers (services/approval/auditLog.ts via
-- services/audit/toolCallAuditChain.ts) now populate:
--   previous_hash  — prior row's chain_hash (linear content chain)
--   chain_hash     — SHA-256(previous_hash + immutable insert content); written once
--   decision_hash  — SHA-256(chain_hash + decision content); written by the decide step,
--                    NULL while pending
--
-- Forward-only + nullable: existing rows stay NULL (legacy un-chained) and the
-- verifier skips them; new rows chain from the current tip.

ALTER TABLE "admin"."tool_call_audit_log"
  ADD COLUMN "previous_hash" TEXT,
  ADD COLUMN "chain_hash"    TEXT,
  ADD COLUMN "decision_hash" TEXT;

CREATE INDEX "tool_call_audit_log_chain_hash_idx"
  ON "admin"."tool_call_audit_log" ("chain_hash");
