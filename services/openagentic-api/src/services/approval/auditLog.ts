import { prisma } from '../../utils/prisma.js';
import type { ToolClassification } from './classifyTool.js';
import {
  nextToolCallChainLink,
  computeToolCallDecisionHash,
} from '../audit/toolCallAuditChain.js';

const MAX_PREVIEW = 500;

export function makePreview(args: Record<string, unknown> | undefined): string {
  try {
    const s = JSON.stringify(args ?? {});
    return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}…` : s;
  } catch {
    return '[unserializable args]';
  }
}

export interface AuditInsert {
  toolName: string;
  serverName?: string;
  args: Record<string, unknown>;
  classification: ToolClassification;
  decision: 'auto' | 'pending';
  userId?: string;
  sessionId?: string;
  messageId?: string;
  origin?: 'chat' | 'subagent';
}

/**
 * INSERT a new audit row. Returns the new row id (== auditId).
 *
 * Tamper-evidence (AU-10): the row is hash-chained — `chain_hash` covers this
 * row's IMMUTABLE content + the prior row's `chain_hash` (computed serialized so
 * concurrent inserts can't fork the chain). `created_at` is computed here (not
 * left to the DB default) so the value hashed exactly matches the stored value.
 * See `services/audit/toolCallAuditChain.ts`. A chain failure NEVER blocks the
 * insert — the row is still written (un-chained, verify skips it).
 */
export async function insertAuditRow(row: AuditInsert): Promise<string> {
  const createdAt = new Date();
  const serverName = row.serverName ?? null;
  const userId = row.userId ?? null;
  const sessionId = row.sessionId ?? null;
  const messageId = row.messageId ?? null;
  const origin = row.origin ?? 'chat';

  const { previousHash, chainHash } = await nextToolCallChainLink({
    toolName: row.toolName,
    serverName,
    args: row.args,
    classification: row.classification,
    userId,
    sessionId,
    messageId,
    origin,
    createdAt,
  });

  const created = await prisma.toolCallAuditLog.create({
    data: {
      tool_name: row.toolName,
      server_name: serverName,
      args: row.args as any,
      preview: makePreview(row.args),
      classification: row.classification,
      decision: row.decision,
      user_id: userId,
      session_id: sessionId,
      message_id: messageId,
      origin,
      created_at: createdAt,
      previous_hash: previousHash,
      chain_hash: chainHash,
    } as any,
    select: { id: true },
  });
  return created.id;
}

/**
 * The ONLY mutation path. Transitions pending→approved|denied|timed_out exactly
 * once. Concurrency-guarded: updateMany WHERE decision='pending' — a race
 * between human-approve and timeout-deny can only win once (count===1).
 * Returns true if THIS call performed the transition.
 *
 * Tamper-evidence (AU-10): this single guarded mutation writes a `decision_hash`
 * covering the decision content (decision/decided_by/decided_at), anchored to
 * the row's own immutable `chain_hash`. The linear content chain
 * (`chain_hash`/`previous_hash`) is written ONCE at insert and is NEVER touched
 * here, so this UPDATE can't break it; `verifyToolCallAuditChain` validates both.
 * If the row's chain_hash can't be read (legacy un-chained row) the transition
 * still happens with a null decision_hash.
 */
export async function decideAuditRow(
  auditId: string,
  decision: 'approved' | 'denied' | 'timed_out',
  decidedBy: string | null,
): Promise<boolean> {
  const decidedAt = new Date();

  // Read the row's immutable content chain_hash to anchor the decision hash.
  let chainHash: string | null = null;
  try {
    const existing = await prisma.toolCallAuditLog.findUnique({
      where: { id: auditId },
      select: { chain_hash: true } as any,
    });
    chainHash = (existing as any)?.chain_hash ?? null;
  } catch {
    chainHash = null;
  }
  const decisionHash = chainHash
    ? computeToolCallDecisionHash({ chainHash, decision, decidedBy, decidedAt })
    : null;

  const res = await prisma.toolCallAuditLog.updateMany({
    where: { id: auditId, decision: 'pending' },
    data: { decision, decided_by: decidedBy, decided_at: decidedAt, decision_hash: decisionHash } as any,
  });
  return res.count === 1;
}
