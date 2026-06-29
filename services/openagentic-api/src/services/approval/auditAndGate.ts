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

// ---------------------------------------------------------------------------
// MCP-execution seam (live-wiring fix, 2026-05-31)
// ---------------------------------------------------------------------------
//
// WHY A SECOND SEAM:
//   In V2 discovery-mode the model is given only meta tools + `tool_search`;
//   the REAL MCP tools (web_search + every cloud/k8s/observability tool —
//   exactly the MUTATING infra writes this gate must protect) are resolved
//   mid-turn and EXECUTED through `deps.executeMcpTool` (buildChatV2Deps →
//   makeExecuteMcpTool* → POST mcp-proxy /mcp/tool). That executor is the
//   single convergence point EVERY named MCP tool call passes through,
//   regardless of which caller reached it (main chatLoop dispatchBody, the
//   sub-agent chatLoopRecursor sharing parentDeps, or any future path). The
//   prior dispatchBody-only seam (dbf929102) audited the meta/base tools but
//   could be bypassed by an MCP execution that didn't route the dispatch ctx
//   through it — live evidence: `web_search` executed, audit-log total:0.
//
//   `auditMcpExecutionSeam` wraps the mcp-proxy executor so the audit row +
//   approval gate fire at the proxy invocation itself. It reuses
//   `runAuditAndGate` (no duplicated insert/gate logic) and the same
//   `alreadyAudited`/`markAudited` ctx flag, so when BOTH the dispatchBody
//   seam and this seam are live for one call (the common case — the same ctx
//   object flows dispatchBody → dispatchChatToolCall → executeMcpTool), only
//   the first writes a row; the second is a no-op.

/** Minimal ctx shape the MCP-execution seam reads for audit/gate context. */
export interface McpSeamCtx {
  emit?: (event: string, data: unknown) => void;
  logger?: Pick<Logger, 'warn' | 'error'>;
  sessionId?: string;
  userId?: string;
  user?: { id?: string } | undefined;
  messageId?: string;
  toolUseId?: string;
  serverName?: string;
}

/** Result shape an MCP executor returns (and the synthetic block shape). */
type McpExecResult = { ok: boolean; output?: unknown; error?: string };

/**
 * Wrap an MCP tool executor so EVERY named MCP tool call is audited (READ →
 * 'auto'; MUTATING per `classifyTool` → 'pending' + `approval_required` SSE +
 * ApprovalRegistry.waitFor, honoring `approvalGatePolicy`) at the mcp-proxy
 * convergence point.
 *
 * Single-pass: when the dispatch ctx is already marked audited (the
 * dispatchBody seam OR the before_tool_call hook ran first for this same
 * call), this wrap calls the inner executor directly without a second audit.
 * Otherwise it audits here and marks the ctx so a downstream seam won't
 * double-audit.
 *
 * Block behavior: a denied/timed-out MUTATING call returns a structured
 * `{ ok:false, error }` WITHOUT invoking the inner executor — the mutation
 * never reaches the proxy. READ calls (and all calls when the gate is OFF)
 * pass straight through, so a normal web_search never hangs.
 */
export function auditMcpExecutionSeam(
  inner: (ctx: any, name: string, input: any) => Promise<McpExecResult>,
  opts: { origin?: 'chat' | 'subagent' } = {},
): (ctx: any, name: string, input: any) => Promise<McpExecResult> {
  return async (ctx: any, name: string, input: any): Promise<McpExecResult> => {
    if (alreadyAudited(ctx)) {
      // Already audited upstream (dispatchBody seam / before_tool_call hook).
      // Do NOT write a second row — just execute.
      return inner(ctx, name, input);
    }

    const c = (ctx ?? {}) as McpSeamCtx;
    const gate = await runAuditAndGate({
      toolName: name,
      serverName: c.serverName,
      args: (input ?? {}) as Record<string, unknown>,
      userId: c.user?.id ?? c.userId,
      sessionId: c.sessionId,
      messageId: c.messageId ?? c.toolUseId,
      origin: opts.origin ?? 'chat',
      emit:
        typeof c.emit === 'function'
          ? (e: string, d: unknown) => c.emit!(e, d)
          : undefined,
      logger: c.logger,
    });
    markAudited(ctx);

    if (!gate.allowed) {
      // Denied / timed-out MUTATING call — synthesize a tool failure so the
      // model sees the block reason and the loop continues. The mutation
      // NEVER reached the proxy.
      return {
        ok: false,
        error: gate.blockReason ?? `tool '${name}' blocked by approval gate`,
      };
    }

    return inner(ctx, name, input);
  };
}

// ---------------------------------------------------------------------------
// Sub-agent MCP-proxy seam (approval-gate bypass fix, 2026-06-19)
// ---------------------------------------------------------------------------
//
// WHY A THIRD SEAM:
//   The chat path routes EVERY named MCP tool call through `runAuditAndGate`
//   (via the dispatchBody seam / before_tool_call hook / auditMcpExecutionSeam).
//   But `SubagentOrchestrator` calls `this.mcpProxy.callTool(server, tool, args)`
//   DIRECTLY — it never touches any of those chat seams. An orchestrated
//   MUTATING tool call (e.g. `kubernetes_delete_pod`, `aws_sts_assume_role`)
//   therefore executed with NO audit row and NO human approval: a complete
//   bypass of the trust gate.
//
//   The orchestrator only ever reaches the proxy through the `MCPProxyClient`
//   interface (`callTool` / `getAvailableTools`). `gateMcpProxyClient` wraps
//   that interface so EVERY `callTool` runs `runAuditAndGate` (origin
//   'subagent') BEFORE the real proxy call. It reuses `runAuditAndGate` — no
//   duplicated insert/gate logic — exactly like the chat seams.
//
//   READ calls (classifyTool → READ) and all calls when the gate is OFF pass
//   straight through to the real proxy (no approval hang). A denied/timed-out
//   MUTATING call NEVER reaches the real proxy — it throws a structured error
//   carrying `blockReason`, surfaced to the sub-agent loop as a tool failure.
//   FAIL SAFE: a gate/audit failure on a MUTATING call blocks it (the
//   `runAuditAndGate` MUTATING-path catch returns allowed:false; for non-SSE
//   routes with no `emit`, a MUTATING call simply blocks on approval timeout).

/** Minimal shape `gateMcpProxyClient` wraps (the sub-agent MCPProxyClient). */
export interface GateableMcpProxyClient {
  callTool(server: string, tool: string, args: Record<string, any>): Promise<any>;
  getAvailableTools(server?: string): Promise<string[]>;
}

/** Context threaded from the orchestrate route handler into the gate. */
export interface SubagentGateContext {
  userId?: string;
  sessionId?: string;
  /** SSE/NDJSON emit (approval_required / approval_resolved). Omit for non-SSE. */
  emit?: (event: string, data: unknown) => void;
  logger?: Pick<Logger, 'warn' | 'error'>;
}

/**
 * Wrap an `MCPProxyClient` so its `callTool` is audited + approval-gated via
 * `runAuditAndGate` (origin 'subagent') BEFORE the real proxy call. `callTool`
 * keeps its exact `(server, tool, args) => Promise<any>` signature so it is a
 * drop-in replacement for the orchestrator's `MCPProxyClient`.
 *
 * - READ → audited 'auto', passes straight through (no hang).
 * - MUTATING + gate ON → pending audit + (if `emit`) approval_required SSE +
 *   ApprovalRegistry.waitFor; on approve → real proxy; on deny/timeout/audit
 *   failure → throws WITHOUT calling the real proxy (mutation never executes).
 * - `getAvailableTools` passes through unchanged (read-only discovery).
 */
export function gateMcpProxyClient<T extends GateableMcpProxyClient>(
  inner: T,
  ctx: SubagentGateContext,
): T {
  const wrapped: GateableMcpProxyClient = {
    async callTool(server: string, tool: string, args: Record<string, any>): Promise<any> {
      const gate = await runAuditAndGate({
        toolName: tool,
        serverName: server,
        args: (args ?? {}) as Record<string, unknown>,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        origin: 'subagent',
        emit: ctx.emit,
        logger: ctx.logger,
      });

      if (!gate.allowed) {
        // Mutation blocked by the gate — never reaches the real proxy. Throwing
        // (rather than returning) matches MCPProxyClient.callTool's error
        // contract; the orchestrator's per-tool try/catch turns this into a
        // tool-result error the sub-agent LLM sees.
        throw new Error(
          gate.blockReason ?? `Mutating tool '${tool}' blocked by approval gate`,
        );
      }

      return inner.callTool(server, tool, args);
    },

    getAvailableTools(server?: string): Promise<string[]> {
      return inner.getAvailableTools(server);
    },
  };

  // Preserve any extra methods/props on the concrete client (e.g.
  // getServers, callToolsParallel) by layering the gated overrides on top of
  // a prototype-preserving clone, so the returned value is still a `T`.
  return Object.assign(Object.create(Object.getPrototypeOf(inner)), inner, wrapped) as T;
}
