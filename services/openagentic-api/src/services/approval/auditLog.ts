import { prisma } from '../../utils/prisma.js';
import type { ToolClassification } from './classifyTool.js';

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

/** INSERT a new audit row. Returns the new row id (== auditId). */
export async function insertAuditRow(row: AuditInsert): Promise<string> {
  const created = await prisma.toolCallAuditLog.create({
    data: {
      tool_name: row.toolName,
      server_name: row.serverName ?? null,
      args: row.args as any,
      preview: makePreview(row.args),
      classification: row.classification,
      decision: row.decision,
      user_id: row.userId ?? null,
      session_id: row.sessionId ?? null,
      message_id: row.messageId ?? null,
      origin: row.origin ?? 'chat',
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * The ONLY mutation path. Transitions pending→approved|denied|timed_out exactly
 * once. Concurrency-guarded: updateMany WHERE decision='pending' — a race
 * between human-approve and timeout-deny can only win once (count===1).
 * Returns true if THIS call performed the transition.
 */
export async function decideAuditRow(
  auditId: string,
  decision: 'approved' | 'denied' | 'timed_out',
  decidedBy: string | null,
): Promise<boolean> {
  const res = await prisma.toolCallAuditLog.updateMany({
    where: { id: auditId, decision: 'pending' },
    data: { decision, decided_by: decidedBy, decided_at: new Date() },
  });
  return res.count === 1;
}
