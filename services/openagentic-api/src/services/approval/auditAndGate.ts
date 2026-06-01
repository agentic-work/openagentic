/**
 * auditAndGate — the single, reusable "audit EVERY tool call + approval-gate
 * the mutating ones" primitive.
 *
 * WHY THIS EXISTS (live-wiring fix, 2026-05-31):
 *   The approval+audit feature originally lived ONLY in the priority-11
 *   `builtin:approval-gate:before_tool_call` hook (pipeline/built-in-hooks.ts).
 *   That hook fires from `chatLoop.wrappedDispatch` via
 *   `deps.hooks.runModifying('before_tool_call', …)` — but ONLY when
 *   `deps.hooks` resolves to a HookRunner that actually has the built-ins
 *   registered. On the live OSS build that resolution is fragile (the
 *   singleton is acquired by `buildChatV2Deps` via `getHookRunner()`, and any
 *   init-order / module-identity slip leaves `deps.hooks` undefined → the loop
 *   runs WITHOUT cross-cuts and NO audit row is ever written). The live
 *   evidence: a real `tool_search` call executed but `GET /api/admin/audit-log`
 *   returned `total:0`.
 *
 *   The durable fix is to audit at the seam EVERY live tool call passes
 *   through unconditionally — the chat dispatch function (`dispatchTool.ts`
 *   `dispatchBody`, the `makeDispatch` the live `runChat`→`chatLoop` path
 *   always calls). This module is that seam's worker, factored out so the
 *   built-in hook can delegate to the SAME logic (no duplicated insert/gate
 *   code, no divergence).
 *
 * SINGLE-PASS GUARANTEE:
 *   `runAuditAndGate` stamps `ctx[AUDIT_DONE_FLAG] = true` once it has audited
 *   a call. Both callers check `alreadyAudited(ctx)` first, so when the hook
 *   AND the dispatch seam are both live for the same tool call, only the first
 *   one to run audits — the second is a no-op. The flag is set on the per-call
 *   dispatch ctx (chatLoop passes a fresh `dispatchCtx` object per tool call),
 *   so it never leaks across tool calls.
 */
import type { Logger } from 'pino';
import { classifyTool } from './classifyTool.js';
import { resolveApprovalGatePolicy } from './approvalGatePolicy.js';
import { insertAuditRow, decideAuditRow, makePreview } from './auditLog.js';
import { getApprovalRegistry } from './ApprovalRegistry.js';

/** Per-call marker — prevents the hook + dispatch seam from double-auditing. */
export const AUDIT_DONE_FLAG = '__oa_audit_done';

export interface AuditAndGateInput {
  toolName: string;
  serverName?: string;
  args: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  messageId?: string;
  origin?: 'chat' | 'subagent';
  /** Emit a top-level SSE event ({approval_required,approval_resolved}). */
  emit?: (event: string, data: unknown) => void;
  logger?: Pick<Logger, 'warn' | 'error'>;
}

export interface AuditAndGateResult {
  /** Tool may execute. */
  allowed: boolean;
  /** Populated when !allowed — human-readable reason for the synthetic error. */
  blockReason?: string;
  /** The audit row id (when one was written). */
  auditId?: string;
  classification: 'READ' | 'MUTATING';
}

/** True if this dispatch ctx has already been audited this call. */
export function alreadyAudited(ctx: unknown): boolean {
  return !!ctx && typeof ctx === 'object' && (ctx as Record<string, unknown>)[AUDIT_DONE_FLAG] === true;
}

/** Mark this dispatch ctx as audited (single-pass guard). */
export function markAudited(ctx: unknown): void {
  if (ctx && typeof ctx === 'object') {
    (ctx as Record<string, unknown>)[AUDIT_DONE_FLAG] = true;
  }
}

/**
 * Audit a tool call and, for MUTATING calls with the gate ON, pause for human
 * approval. READ calls (and all calls when the gate is OFF) are audited
 * decision='auto' and allowed immediately — a READ tool (tool_search, get_*,
 * list_*, web search) is NEVER gated, so chat never hangs on it.
 *
 * NEVER throws: an audit/DB failure on a READ degrades to allow-and-log (the
 * user already expects the read to run); a failure to even record a pending
 * row for a MUTATING call fails SAFE (blocked) so an un-audited mutation can't
 * slip through.
 */
export async function runAuditAndGate(input: AuditAndGateInput): Promise<AuditAndGateResult> {
  const args = (input.args ?? {}) as Record<string, unknown>;
  const classification = classifyTool(input.toolName, args);
  const policy = await resolveApprovalGatePolicy();

  // READ, or gate OFF → audit decision='auto', execute normally.
  if (classification === 'READ' || !policy.gateMutating) {
    let auditId: string | undefined;
    try {
      auditId = await insertAuditRow({
        toolName: input.toolName,
        serverName: input.serverName,
        args,
        classification,
        decision: 'auto',
        userId: input.userId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        origin: input.origin ?? 'chat',
      });
    } catch (e) {
      input.logger?.warn?.({ err: e, tool: input.toolName }, '[APPROVAL] audit INSERT failed (auto)');
    }
    return { allowed: true, auditId, classification };
  }

  // MUTATING + gate ON → persist pending, emit, await.
  let auditId: string;
  try {
    auditId = await insertAuditRow({
      toolName: input.toolName,
      serverName: input.serverName,
      args,
      classification,
      decision: 'pending',
      userId: input.userId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      origin: input.origin ?? 'chat',
    });
  } catch (e) {
    // Fail SAFE-but-audited: if we cannot record the pending row we must NOT
    // silently execute a mutating call — block it.
    input.logger?.error?.(
      { err: e, tool: input.toolName },
      '[APPROVAL] pending INSERT failed — blocking mutating call',
    );
    return {
      allowed: false,
      blockReason: 'Approval audit unavailable; mutating call blocked',
      classification,
    };
  }

  const preview = makePreview(args);
  const emit = input.emit ?? (() => {});
  emit('approval_required', {
    auditId,
    requestId: auditId,
    toolName: input.toolName,
    serverName: input.serverName,
    args,
    preview,
    classification,
    timeoutMs: policy.timeoutMs,
  });

  const outcome = await getApprovalRegistry().waitFor(auditId, policy.timeoutMs);
  // On timeout the approve/deny route never fired → record the terminal
  // decision here (the route records it on the human path).
  if (outcome === 'timed_out') {
    await decideAuditRow(auditId, 'timed_out', null).catch(() => {});
  }
  emit('approval_resolved', { auditId, requestId: auditId, outcome });

  if (outcome !== 'approved') {
    return {
      allowed: false,
      auditId,
      blockReason: `Mutating tool '${input.toolName}' ${
        outcome === 'timed_out' ? 'timed out' : 'denied'
      } by approval gate`,
      classification,
    };
  }
  return { allowed: true, auditId, classification };
}
