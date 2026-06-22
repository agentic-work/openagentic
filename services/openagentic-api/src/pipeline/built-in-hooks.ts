/**
 * Built-in Pipeline Hooks
 *
 * Registers the core security and observability hooks:
 * - DLP scanner (after_tool_call, before_streaming)
 * - HITL gate (before_tool_call)
 * - Cost tracking (after_completion)
 * - Audit logging (after_tool_call, on_pipeline_end)
 * - Event sequencing (enrich_sse_event)
 */

import type { Logger } from 'pino';
import { type HookRunner, type HookContext, type ModifyingHookFn, type VoidHookFn, type SyncHookFn } from './hooks.js';
import { getDLPScanner, type DLPScanContext } from '../services/DLPScannerService.js';
import { getPermissionService, type ToolCallInfo } from '../services/PermissionService.js';
import { EventSequencer } from '../infra/event-sequencer.js';
import { runAuditAndGate, AUDIT_DONE_FLAG } from '../services/approval/auditAndGate.js';

// ---------------------------------------------------------------------------
// Tool call types used by hooks
// ---------------------------------------------------------------------------

export interface ToolCallHookData {
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  executionTimeMs?: number;
  userId: string;
  sessionId?: string;
  messageId?: string;
  emit?: (event: string, data: unknown) => void;
  /** Set by HITL hook to block execution */
  blocked?: boolean;
  blockReason?: string;
}

export interface CompletionHookData {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  totalCost: number;
  latencyMs: number;
  userId: string;
  sessionId?: string;
}

export interface SSEEventHookData {
  type: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Register all built-in hooks
// ---------------------------------------------------------------------------

export function registerBuiltInHooks(runner: HookRunner, logger: Logger): void {
  const log = logger.child({ component: 'BuiltInHooks' });

  // =========================================================================
  // 1. DLP: Scan tool call results (after_tool_call)
  //
  // Phase 3: this hook stays default (fail_closed). A DLP scanner failure
  // must NOT silently let unscanned tool output reach the audit pipeline.
  // The hook itself doesn't currently throw — it logs findings — so this
  // is a forward-compat guard for when scanAndAct grows policy
  // enforcement. Read the result-stream stage scans (before_streaming)
  // for the inline-redact path.
  // =========================================================================
  runner.register({
    id: 'builtin:dlp:after_tool_call',
    point: 'after_tool_call',
    priority: 10, // Run early — security first
    description: 'DLP scan of tool call results',
    fn: (async (data: ToolCallHookData, ctx: HookContext) => {
      const dlp = getDLPScanner(ctx.logger);
      const resultText = typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? '');

      const scanContext: DLPScanContext = {
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        scanPoint: 'tool_result',
        toolName: data.toolName,
      };

      const scanResult = dlp.scan(resultText, scanContext);

      if (scanResult.findings.length > 0) {
        ctx.logger.warn({
          tool: data.toolName,
          findings: scanResult.findings.length,
          severity: scanResult.severity,
          action: scanResult.action,
        }, '[HOOK:DLP] Findings in tool result');
      }
    }) as VoidHookFn<ToolCallHookData>,
  });

  // =========================================================================
  // 2. DLP: Scan tool call inputs (before_tool_call - modifying)
  // =========================================================================
  runner.register({
    id: 'builtin:dlp:before_tool_call',
    point: 'before_tool_call',
    priority: 20, // After HITL gate (10)
    description: 'DLP scan of tool call arguments',
    fn: (async (data: ToolCallHookData, ctx: HookContext) => {
      if (data.blocked) return data; // Already blocked by HITL

      const dlp = getDLPScanner(ctx.logger);
      const argsText = JSON.stringify(data.arguments);

      const scanContext: DLPScanContext = {
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        scanPoint: 'tool_input',
        toolName: data.toolName,
      };

      const { text: redacted, blocked, result } = dlp.scanAndAct(argsText, scanContext);

      if (blocked) {
        ctx.logger.warn({
          tool: data.toolName,
          severity: result.severity,
        }, '[HOOK:DLP] Blocking tool call — DLP findings in arguments');
        return { ...data, blocked: true, blockReason: `DLP: ${result.severity} severity findings in arguments` };
      }

      if (result.action === 'redact' && redacted !== argsText) {
        // Replace arguments with redacted version
        try {
          const newArgs = JSON.parse(redacted);
          return { ...data, arguments: newArgs };
        } catch {
          // If redacted JSON is invalid, block instead
          return { ...data, blocked: true, blockReason: 'DLP: Could not safely redact arguments' };
        }
      }

      return data;
    }) as ModifyingHookFn<ToolCallHookData>,
  });

  // =========================================================================
  // 3. Permission Gate (before_tool_call - modifying)
  //
  // Replaces the legacy HITL/regex-tier gate as of 2026-05-11. Uses
  // Claude-Code-style allow/deny/ask globs (see PermissionService).
  // =========================================================================
  runner.register({
    id: 'builtin:permissions:before_tool_call',
    point: 'before_tool_call',
    priority: 10, // Run first — structural gate
    description: 'Permission rule check (allow/deny/ask) for every tool call',
    fn: (async (data: ToolCallHookData, ctx: HookContext) => {
      const svc = getPermissionService(ctx.logger);

      const toolCallInfo: ToolCallInfo = {
        toolName: data.toolName,
        serverName: data.serverName,
        arguments: data.arguments,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        messageId: ctx.messageId,
      };

      const emit = data.emit ?? (() => {});
      const decision = await svc.evaluate(toolCallInfo, emit);

      if (!decision.approved) {
        ctx.logger.warn({
          tool: data.toolName,
          behavior: decision.behavior,
          approvedBy: decision.approvedBy,
        }, '[HOOK:PERMISSIONS] Tool call denied');
        return {
          ...data,
          blocked: true,
          blockReason: `Permissions: ${decision.reason}`,
        };
      }

      return data;
    }) as ModifyingHookFn<ToolCallHookData>,
  });

  // =========================================================================
  // 3b. Approval Gate + Immutable Audit (before_tool_call — modifying)
  //
  // Audits EVERY tool call to an append-only tool_call_audit_log row. READ
  // calls → decision='auto', execute normally. MUTATING calls (gate ON) →
  // decision='pending', emit 'approval_required', await the in-process
  // ApprovalRegistry (timeout→deny), then UPDATE the row + block-on-deny.
  // =========================================================================
  runner.register({
    id: 'builtin:approval-gate:before_tool_call',
    point: 'before_tool_call',
    priority: 11, // after permissions (10), before everything else
    description: 'Immutable audit + human-approval gate on mutating tool calls',
    fn: (async (data: ToolCallHookData, ctx: HookContext) => {
      // Single-pass: if the dispatch-seam audit (dispatchTool.ts) already
      // recorded THIS call, skip. The two seams share `runAuditAndGate`, so
      // whichever runs first owns the row; the other is a no-op. The flag
      // rides on the hook DATA object (chatLoop forwards it onto the dispatch
      // ctx) so the second seam sees it.
      if ((data as unknown as Record<string, unknown>)[AUDIT_DONE_FLAG] === true) {
        return data;
      }

      const gate = await runAuditAndGate({
        toolName: data.toolName,
        serverName: data.serverName,
        args: (data.arguments ?? {}) as Record<string, unknown>,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        messageId: ctx.messageId,
        origin: 'chat',
        emit: data.emit,
        logger: ctx.logger,
      });

      // Stamp the data object so the dispatch-seam guard (alreadyAudited)
      // skips re-auditing this same call.
      (data as unknown as Record<string, unknown>)[AUDIT_DONE_FLAG] = true;

      if (!gate.allowed) {
        return {
          ...data,
          [AUDIT_DONE_FLAG]: true,
          blocked: true,
          blockReason: gate.blockReason ?? `Mutating tool '${data.toolName}' blocked by approval gate`,
        };
      }
      return data;
    }) as ModifyingHookFn<ToolCallHookData>,
  });

  // =========================================================================
  // 4. Cost tracking (after_completion)
  //
  // Observer-only — failureMode: 'fail_open'. A logger/metrics sink hiccup
  // must not abort the user's chat turn. Phase 3: HookRunner now defaults
  // to fail_closed; non-security hooks must opt in to the legacy
  // log-and-continue behaviour explicitly.
  // =========================================================================
  runner.register({
    id: 'builtin:cost:after_completion',
    point: 'after_completion',
    priority: 50,
    failureMode: 'fail_open',
    description: 'LLM cost tracking and metrics',
    fn: (async (data: CompletionHookData, ctx: HookContext) => {
      ctx.logger.info({
        model: data.model,
        provider: data.provider,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalCost: data.totalCost,
        latencyMs: data.latencyMs,
      }, '[HOOK:COST] Completion metrics');
      // Actual persistence is handled by LLMMetricsService in completion stage
    }) as VoidHookFn<CompletionHookData>,
  });

  // =========================================================================
  // 5. Audit logging (after_tool_call)
  //
  // Observer-only — failureMode: 'fail_open'. Audit sink failures get
  // logged but must not abort the chat turn (the user already saw the
  // tool result; aborting now strands them mid-conversation). Phase 3.
  // =========================================================================
  runner.register({
    id: 'builtin:audit:after_tool_call',
    point: 'after_tool_call',
    priority: 50,
    failureMode: 'fail_open',
    description: 'Tool call audit trail',
    fn: (async (data: ToolCallHookData, ctx: HookContext) => {
      ctx.logger.debug({
        tool: data.toolName,
        server: data.serverName,
        executionTimeMs: data.executionTimeMs,
        userId: ctx.userId,
      }, '[HOOK:AUDIT] Tool call recorded');
      // Actual persistence happens in tool-execution.helper.ts logMCPCall
    }) as VoidHookFn<ToolCallHookData>,
  });

  // =========================================================================
  // 6. Event sequencing (enrich_sse_event - sync)
  // =========================================================================
  // Note: Each pipeline run should create its own EventSequencer.
  // This hook provides a fallback global sequencer.
  const globalSequencer = new EventSequencer();

  runner.register({
    id: 'builtin:sequencer:enrich_sse_event',
    point: 'enrich_sse_event',
    priority: 10,
    // Hot-path observer — a broken sequencer still wraps the payload (the
    // raw event flows through) rather than aborting the SSE stream. Phase 3.
    failureMode: 'fail_open',
    description: 'Add sequence numbers to SSE events',
    fn: ((data: SSEEventHookData, ctx: HookContext) => {
      // Use per-run sequencer from context meta if available, else global
      const sequencer = (ctx.meta.eventSequencer as EventSequencer) ?? globalSequencer;
      const wrapped = sequencer.wrap(data.payload);
      return { ...data, payload: wrapped };
    }) as SyncHookFn<SSEEventHookData>,
  });

  // =========================================================================
  // 7. DLP: Scan LLM output before streaming (before_streaming)
  // =========================================================================
  runner.register({
    id: 'builtin:dlp:before_streaming',
    point: 'before_streaming',
    priority: 10,
    description: 'DLP scan of LLM response before streaming to client',
    fn: (async (data: { text: string; userId: string; sessionId?: string }, ctx: HookContext) => {
      const dlp = getDLPScanner(ctx.logger);

      const scanContext: DLPScanContext = {
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        scanPoint: 'llm_output',
      };

      const { text, blocked, result } = dlp.scanAndAct(data.text, scanContext);

      if (blocked) {
        // Task #176: don't nuke the whole message. Code-gen responses
        // commonly contain example JWT secrets / password placeholders that
        // trip high-severity DLP rules. Redact the findings in place so the
        // user sees "[REDACTED:jwt_secret]" markers within the otherwise
        // intact code, with a trailing banner noting the count — much more
        // useful than "[Response blocked by DLP policy]".
        ctx.logger.warn({
          severity: result.severity,
          findings: result.findings.length,
        }, '[HOOK:DLP] High-severity findings redacted inline (not blocking whole output)');
        const redacted = dlp.redact(data.text, result.findings);
        const banner =
          `\n\n> **Note:** ${result.findings.length} sensitive item${
            result.findings.length === 1 ? '' : 's'
          } (${[...new Set(result.findings.map(f => f.category))].join(', ')})` +
          ` were redacted inline above by the DLP policy.`;
        return { ...data, text: redacted + banner };
      }

      return { ...data, text };
    }) as ModifyingHookFn<{ text: string; userId: string; sessionId?: string }>,
  });

  log.info({
    hookCount: runner.listHooks().length,
  }, 'Built-in hooks registered');
}
