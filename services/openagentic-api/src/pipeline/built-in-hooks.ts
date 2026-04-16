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
import { getToolApprovalGate, type ToolCallInfo } from '../services/ToolApprovalGate.js';
import { EventSequencer } from '../infra/event-sequencer.js';

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
  // 3. HITL Gate (before_tool_call - modifying)
  // =========================================================================
  runner.register({
    id: 'builtin:hitl:before_tool_call',
    point: 'before_tool_call',
    priority: 10, // Run first — structural gate
    description: 'Mandatory HITL approval for high-risk tools',
    fn: (async (data: ToolCallHookData, ctx: HookContext) => {
      const gate = getToolApprovalGate(ctx.logger);

      const toolCallInfo: ToolCallInfo = {
        toolName: data.toolName,
        serverName: data.serverName,
        arguments: data.arguments,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        messageId: ctx.messageId,
      };

      const emit = data.emit ?? (() => {});
      const approval = await gate.evaluate(toolCallInfo, emit);

      if (!approval.approved) {
        ctx.logger.warn({
          tool: data.toolName,
          riskLevel: approval.riskLevel,
          approvedBy: approval.approvedBy,
        }, '[HOOK:HITL] Tool call denied');
        return {
          ...data,
          blocked: true,
          blockReason: `HITL: ${approval.reason} (risk: ${approval.riskLevel})`,
        };
      }

      return data;
    }) as ModifyingHookFn<ToolCallHookData>,
  });

  // =========================================================================
  // 4. Cost tracking (after_completion)
  // =========================================================================
  runner.register({
    id: 'builtin:cost:after_completion',
    point: 'after_completion',
    priority: 50,
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
  // =========================================================================
  runner.register({
    id: 'builtin:audit:after_tool_call',
    point: 'after_tool_call',
    priority: 50,
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
        ctx.logger.warn({
          severity: result.severity,
          findings: result.findings.length,
        }, '[HOOK:DLP] Blocking LLM output');
        return { ...data, text: '[Response blocked by DLP policy — sensitive data detected]' };
      }

      return { ...data, text };
    }) as ModifyingHookFn<{ text: string; userId: string; sessionId?: string }>,
  });

  log.info({
    hookCount: runner.listHooks().length,
  }, 'Built-in hooks registered');
}
