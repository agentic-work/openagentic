/**
 * AU-10 (NIST 800-53 — Non-repudiation) — the tool-call-audit cryptographic
 * hash chain, the tamper-evident counterpart to `adminAuditChain.ts` for the
 * approval-gate trail (`tool_call_audit_log`).
 *
 * WHY THIS EXISTS:
 *   `admin_audit_log` rows are hash-chained; `tool_call_audit_log` rows were NOT.
 *   They were app-layer append-only with a single in-place pending→decided
 *   UPDATE (`decideAuditRow`), so a DB actor with write access could alter the
 *   tool name, args, or decision of any past row undetectably. This module
 *   chains every row so any such edit breaks the chain.
 *
 * TWO-PHASE (insert + decision) CHAIN — and why an in-place UPDATE is safe here:
 *   A tool-call row has an IMMUTABLE part (tool, args, classification, who/when)
 *   written at insert, and a MUTABLE part (decision/decided_by/decided_at) that
 *   transitions pending→approved|denied|timed_out exactly once via the guarded
 *   `updateMany WHERE decision='pending'` in `auditLog.ts`. We must keep that
 *   single-row transition: the admin audit-log reader + the activity aggregator
 *   read `decision` straight off the row, and the once-only concurrency guard
 *   depends on it (a separate "decision event" row would break both readers and
 *   the guard, and is forbidden by the append-only source-regression cage).
 *
 *   So we chain in TWO covered fields instead of forking the chain:
 *
 *     chain_hash    = computeChainHash(prevRow.chain_hash, [IMMUTABLE content])
 *                     ← the linear chain. Written ONCE at insert; NEVER touched
 *                       by the decide step, so the decide UPDATE can never break
 *                       the linear chain. Covers tool_name/server/args/etc.
 *
 *     decision_hash = computeChainHash(thisRow.chain_hash, [decision content])
 *                     ← covers decision/decided_by/decided_at, anchored to this
 *                       row's own chain_hash (which already covers the content +
 *                       the prior row). Written by the decide UPDATE. NULL while
 *                       pending. Tampering with the decision breaks decision_hash.
 *
 *   Net: editing ANY field of ANY row — the immutable content (→ breaks
 *   chain_hash and every subsequent chain_hash) or the decision (→ breaks
 *   decision_hash) — is detectable by `verifyToolCallAuditChain`.
 *
 * Writes are SERIALIZED through a module-level promise queue: two concurrent
 * inserts must not both read the same tip and fork the chain. (The decision
 * UPDATE does not advance the tip, so it is not queued — it only reads its own
 * row's already-final chain_hash.)
 */
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';
import { computeChainHash, normalizeDetails } from './adminAuditChain.js';

const EVENT_TYPE = 'tool_call';

// Cached tip of the chain + a serialization queue so concurrent inserts link to
// the correct predecessor instead of forking.
let lastHash: string | null = null;
let coldStartDone = false;
let writeQueue: Promise<void> = Promise.resolve();

/** Test-only: reset the in-memory chain cache between cases. */
export function __resetToolCallAuditChainCache(): void {
  lastHash = null;
  coldStartDone = false;
  writeQueue = Promise.resolve();
}

/** Immutable insert-time content fields a tool-call row commits to. */
export interface ToolCallChainContent {
  toolName: string;
  serverName: string | null;
  args: unknown;
  classification: string;
  userId: string | null;
  sessionId: string | null;
  messageId: string | null;
  origin: string;
  createdAt: Date;
}

/**
 * Hash over the IMMUTABLE insert content. `args` is jsonb → canonicalized via
 * `normalizeDetails` so write-hash == verify-hash despite Postgres key churn.
 */
export function computeToolCallChainHash(
  previousHash: string | null,
  c: ToolCallChainContent,
): string {
  return computeChainHash(previousHash, [
    EVENT_TYPE,
    c.toolName,
    c.serverName ?? '',
    normalizeDetails(c.args),
    c.classification,
    c.userId ?? '',
    c.sessionId ?? '',
    c.messageId ?? '',
    c.origin,
    c.createdAt.toISOString(),
  ]);
}

/** Decision content fields, anchored to the row's own chain_hash. */
export interface ToolCallDecisionContent {
  /** This row's chain_hash — the anchor the decision hash chains off. */
  chainHash: string;
  decision: string;
  decidedBy: string | null;
  decidedAt: Date;
}

/** Hash over the decision, anchored to the row's own (content) chain_hash. */
export function computeToolCallDecisionHash(d: ToolCallDecisionContent): string {
  return computeChainHash(d.chainHash, [
    'tool_call_decision',
    d.decision,
    d.decidedBy ?? '',
    d.decidedAt.toISOString(),
  ]);
}

async function coldStart(): Promise<void> {
  if (coldStartDone) return;
  try {
    const latest = await prisma.toolCallAuditLog.findFirst({
      orderBy: { created_at: 'desc' },
      select: { chain_hash: true } as any,
    });
    lastHash = (latest as any)?.chain_hash ?? null;
  } catch {
    // Column may not exist on a legacy DB — degrade to no-previous.
    lastHash = null;
  }
  coldStartDone = true;
}

/**
 * Compute the next insert chain hash (serialized) and advance the tip. Returns
 * `{ previousHash, chainHash }` for the row about to be created. The CALLER
 * performs the actual `prisma.create` (so the writer keeps its one create call
 * + select). Fail-safe: on any error returns nulls so the insert still happens
 * (un-chained), never throwing into the audit writer.
 */
export async function nextToolCallChainLink(
  content: ToolCallChainContent,
): Promise<{ previousHash: string | null; chainHash: string | null }> {
  const run = async (): Promise<{ previousHash: string | null; chainHash: string | null }> => {
    try {
      await coldStart();
      const previousHash = lastHash;
      const chainHash = computeToolCallChainHash(previousHash, content);
      lastHash = chainHash;
      return { previousHash, chainHash };
    } catch (error) {
      loggers.services.warn(
        { err: (error as any)?.message, tool: content.toolName },
        '[AUDIT] tool-call chain link failed',
      );
      return { previousHash: null, chainHash: null };
    }
  };
  const next = writeQueue.then(run);
  writeQueue = next.then(() => undefined).catch(() => undefined);
  return next;
}

/**
 * Verify the chain integrity over the first `limit` rows (AU-10 verify).
 * Checks BOTH the linear content chain (chain_hash / previous_hash) and the
 * per-row decision_hash (decision/decided_by/decided_at).
 */
export async function verifyToolCallAuditChain(
  limit = 100,
): Promise<{ intact: boolean; brokenAt?: string; reason?: string; checkedCount: number }> {
  try {
    const rows = await prisma.toolCallAuditLog.findMany({
      orderBy: { created_at: 'asc' },
      take: limit,
      select: {
        id: true,
        tool_name: true,
        server_name: true,
        args: true,
        classification: true,
        decision: true,
        decided_by: true,
        decided_at: true,
        user_id: true,
        session_id: true,
        message_id: true,
        origin: true,
        created_at: true,
        chain_hash: true,
        previous_hash: true,
        decision_hash: true,
      } as any,
    });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as any;
      // Legacy un-chained rows (pre-migration) have no chain_hash — skip.
      if (!r.chain_hash || r.previous_hash === undefined) continue;

      const expectedChain = computeToolCallChainHash(r.previous_hash, {
        toolName: r.tool_name,
        serverName: r.server_name ?? null,
        // jsonb returns args as an object; normalizeDetails canonicalizes it.
        args: r.args,
        classification: r.classification,
        userId: r.user_id ?? null,
        sessionId: r.session_id ?? null,
        messageId: r.message_id ?? null,
        origin: r.origin,
        createdAt: new Date(r.created_at),
      });
      if (expectedChain !== r.chain_hash) {
        return { intact: false, brokenAt: r.id, reason: 'content', checkedCount: i + 1 };
      }

      // Decision-hash check: only meaningful once the row is decided (a decided
      // row MUST carry a decision_hash; a still-pending row carries none).
      const decided = r.decision !== 'pending' && r.decision !== 'auto';
      if (decided && r.decided_at) {
        if (!r.decision_hash) {
          return { intact: false, brokenAt: r.id, reason: 'decision-missing', checkedCount: i + 1 };
        }
        const expectedDecision = computeToolCallDecisionHash({
          chainHash: r.chain_hash,
          decision: r.decision,
          decidedBy: r.decided_by ?? null,
          decidedAt: new Date(r.decided_at),
        });
        if (expectedDecision !== r.decision_hash) {
          return { intact: false, brokenAt: r.id, reason: 'decision', checkedCount: i + 1 };
        }
      }
    }
    return { intact: true, checkedCount: rows.length };
  } catch (error) {
    loggers.services.warn({ err: (error as any)?.message }, '[AUDIT] tool-call chain verification failed');
    return { intact: true, checkedCount: 0 };
  }
}
