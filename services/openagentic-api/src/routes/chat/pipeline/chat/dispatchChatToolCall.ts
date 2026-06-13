/**
 * dispatchChatToolCall — single-stage tool-use routing for chatmode.
 *
 * Mirrors Claude Code's main loop in `<claude-code-src>/QueryEngine.ts`:
 * one tool_choice='auto' call into the model, one ReAct loop, one
 * concurrency-aware dispatcher.
 *
 * NO regex intent gate. NO pre-LLM classifier turn. NO delegation gating.
 * Tool name → handler mapping is pure structural match (`is*Tool(name)`
 * helpers). Everything not in the meta-tool registry falls through to
 * `deps.executeMcpTool`.
 *
 * REUSES (does not replace):
 *   - chatLoopRecursor-backed sub-agent dispatch (via TaskTool deps)
 *   - ProviderManager (streaming caller)
 *   - SmartModelRouter (model pick — minus its 4 regex detectors)
 *   - existing NDJSON envelope helpers
 *   - existing MCP tool inventory + permissions
 *
 * Ported from the legacy V2 pipeline in #741 / B-vrip step 6. The
 * streaming wrapper that calls this lives next to the existing
 * chat-stream route handler and reuses its NDJSON plumbing.
 */

import {
  isRenderArtifactTool,
  executeRenderArtifact,
  type RenderArtifactInput,
  type RenderArtifactResult,
} from '../../../../services/RenderArtifactTool.js';
import { randomUUID } from 'node:crypto';
import { getLocalExecutorRegistry } from '../../../../services/local-executor/LocalExecutorRegistry.js';
import {
  isComposeVisualTool,
  executeComposeVisual,
  type ComposeVisualInput,
  type ComposeVisualResult,
} from '../../../../services/ComposeVisualTool.js';
import {
  isComposeAppTool,
  executeComposeApp,
  type ComposeAppInput,
  type ComposeAppResult,
} from '../../../../services/ComposeAppTool.js';
import {
  isGenerateImageTool,
  type GenerateImageInput,
  type GenerateImageResult,
} from '../../../../services/GenerateImageTool.js';
import {
  isTaskTool,
  executeTask,
  type TaskInput,
  type TaskResult,
  type TaskDeps,
  type TraceStore,
  type AgentRegistryEntry,
} from '../../../../services/TaskTool.js';
import {
  isRequestClarificationTool,
  executeRequestClarification,
  type RequestClarificationInput,
  type RequestClarificationResult,
} from '../../../../services/RequestClarificationTool.js';
import { getPermissionService } from '../../../../services/PermissionService.js';
import { logger as rootLogger } from '../../../../utils/logger.js';
import {
  isMemorizeTool,
  executeMemorize,
  type MemorizeInput,
} from '../../../../services/MemorizeTool.js';
import {
  isToolSearchTool,
  executeToolSearch,
  type ToolSearchInput,
  type ToolSearchResult,
} from '../../../../services/ToolSearchTool.js';
import {
  isAgentSearchTool,
  executeAgentSearch,
  type AgentSearchInput,
  type AgentSearchResult,
} from '../../../../services/AgentSearchTool.js';
import {
  isAgentSendTool,
  executeAgentSend,
  type AgentSendInput,
  type AgentSendResult,
} from '../../../../services/AgentSendTool.js';
import {
  isAgentListTool,
  executeAgentList,
  type AgentListInput,
  type AgentListResult,
} from '../../../../services/AgentListTool.js';
import {
  isAgentStopTool,
  executeAgentStop,
  type AgentStopInput,
  type AgentStopResult,
} from '../../../../services/AgentStopTool.js';
import {
  isPatternSaveTool,
  executePatternSave,
  type PatternSaveInput,
  type PatternSaveResult,
} from '../../../../services/PatternSaveTool.js';
import {
  isPatternRecallTool,
  executePatternRecall,
  type PatternRecallInput,
  type PatternRecallResult,
} from '../../../../services/PatternRecallTool.js';

// ---------------------------------------------------------------------------
// Tool-call dispatch types
// ---------------------------------------------------------------------------

export interface ChatPipelineDeps {
  /** ComposeVisualTool handler — primary visualizer (DI for tests). */
  executeComposeVisual: typeof executeComposeVisual;
  /** ComposeAppTool handler — interactive HTML app composer (DI for tests). */
  executeComposeApp: typeof executeComposeApp;
  /**
   * GenerateImageTool handler — real image generation (DI for tests).
   *
   * The production binding (buildChatV2Deps / runChat) closes over the
   * resolve-imageGen-default-model → provider.generateImage →
   * ImageStorageService.store pipeline, so the dispatcher only passes
   * `(ctx, input)`. Tests inject a stub. NEVER fabricates an external
   * `<img>` URL — on provider error it returns `{ ok:false }`.
   */
  executeGenerateImage: (
    ctx: any,
    input: GenerateImageInput,
  ) => Promise<GenerateImageResult>;
  /** RenderArtifactTool handler — back-compat alias (DI for tests). */
  executeRenderArtifact: typeof executeRenderArtifact;
  /** TaskTool handler (DI for tests). */
  executeTask: (
    ctx: any,
    input: TaskInput,
    deps: TaskDeps,
  ) => Promise<TaskResult>;
  /** RequestClarificationTool handler (DI for tests). */
  executeRequestClarification: typeof executeRequestClarification;
  /** BrowserSandboxExecTool handler. */
  executeBrowserSandbox: (ctx: any, input: any) => Promise<any>;
  /** MemorizeTool handler — durable memory write (DI for tests). */
  executeMemorize: typeof executeMemorize;
  /** MCP tool execution — fall-through for everything not in the meta registry. */
  executeMcpTool: (ctx: any, name: string, input: any) => Promise<any>;
  /** Sub-agent registry source (for TaskTool description rebuilds). */
  listSubagentTypes: () => Promise<AgentRegistryEntry[]>;
  /**
   * Sub-agent runner (chatLoopRecursor-backed child chatLoop dispatch).
   *
   * SEV-0 fix 2026-04-30 — accepts `parentCtx` so the runner can build
   * a ctx-aware MCP tool callback that propagates Azure-AD OBO headers
   * (Authorization, X-Azure-ID-Token, X-AWS-ID-Token, X-User-Email,
   * X-User-Id) on every sub-agent MCP tool call.
   */
  runSubagent: TaskDeps['runSubagent'];
  /**
   * A2 (2026-05-12) — optional sub-agent trace store. Forwarded into
   * `TaskDeps.traceStore` so executeTask returns `trace_handle` on the
   * result when set. Production wiring resolves a
   * `LargeResultTraceStoreAdapter` in buildChatV2Deps; unit tests can
   * leave it undefined for back-compat (no trace_handle field surfaces).
   */
  traceStore?: TraceStore;
  /**
   * F2 (2026-05-12) — OTel GenAI v1.37 tracer. When set, `makeDispatch`
   * wraps each tool call in `execute_tool <name>` (or `invoke_agent <agentId>`
   * for the Task tool) — the gen_ai_tool_calls_total / gen_ai_agent_invocations_total
   * prom counters fire on /metrics. Optional in test paths.
   */
  genAITracer?: import('../../../../services/observability/GenAITracer.js').GenAITracer;
  /**
   * Permission service (rip-replacement landed 2026-05-11).
   *
   * Optional in deps so tests can inject a mock; production wiring resolves
   * via getPermissionService() when this is omitted. Every MCP tool that
   * falls through `dispatchChatToolCall`'s meta-tool registry goes through
   * `permissionService.evaluate()` first — allow auto-approves in ~1ms,
   * deny blocks the dispatch, ask emits `mcp_approval_required` and waits
   * for the UI to POST /api/chat/tool-approval/:requestId.
   */
  approvalGate?: {
    evaluate: (
      toolCall: {
        toolName: string;
        arguments: Record<string, unknown>;
        userId: string;
        sessionId?: string;
        messageId?: string;
      },
      emit: (event: string, data: unknown) => void,
    ) => Promise<{ approved: boolean; reason: string; riskLevel?: string }>;
  };
}

export interface ChatToolCall {
  name: string;
  input: unknown;
}

export type ChatToolResult =
  | ComposeVisualResult
  | ComposeAppResult
  | GenerateImageResult
  | RenderArtifactResult
  | TaskResult
  | RequestClarificationResult
  | ToolSearchResult
  | AgentSearchResult
  | AgentSendResult
  | AgentListResult
  | AgentStopResult
  | PatternSaveResult
  | PatternRecallResult
  | { ok: boolean; output?: string; error?: string };

/**
 * Route a `tool_use` block to the right handler. Pure name-match
 * against the meta-tool registry; everything else falls through to
 * the MCP executor.
 *
 * NO regex on tool names. NO regex on input.
 */
export async function dispatchChatToolCall(
  ctx: any,
  call: ChatToolCall,
  deps: ChatPipelineDeps,
): Promise<ChatToolResult> {
  const { name, input } = call;

  if (isComposeVisualTool(name)) {
    return deps.executeComposeVisual(ctx, input as ComposeVisualInput);
  }

  if (isComposeAppTool(name)) {
    return deps.executeComposeApp(ctx, input as ComposeAppInput);
  }

  if (isGenerateImageTool(name)) {
    return deps.executeGenerateImage(ctx, input as GenerateImageInput);
  }

  if (isRenderArtifactTool(name)) {
    return deps.executeRenderArtifact(ctx, input as RenderArtifactInput);
  }

  if (isTaskTool(name)) {
    const taskDeps: TaskDeps = {
      listSubagentTypes: deps.listSubagentTypes,
      runSubagent: deps.runSubagent,
      ...(deps.traceStore ? { traceStore: deps.traceStore } : {}),
    };
    return deps.executeTask(ctx, input as TaskInput, taskDeps);
  }

  // Local-executor (VS Code extension): workspace_* tools execute on the USER's
  // machine via their connected extension, not on the server. Routed here (above
  // the MCP fall-through) and awaited via the in-process LocalExecutorRegistry;
  // run_command HITL approval is enforced client-side in the editor.
  if (name.startsWith('workspace_')) {
    const userId = ctx?.userId ?? ctx?.user?.userId ?? ctx?.user?.id ?? 'anonymous';
    const reg = getLocalExecutorRegistry();
    if (!reg.isConnected(userId)) {
      return {
        ok: false,
        error: `No local executor connected. Install the OpenAgentic VS Code extension and run "OpenAgentic: Connect" to use ${name}.`,
      };
    }
    const r = await reg.dispatch(
      userId,
      { name, tool_use_id: randomUUID(), input },
      Number(process.env.LOCAL_EXECUTOR_TIMEOUT_MS ?? 120_000),
    );
    return r.isError ? { ok: false, error: r.content } : { ok: true, output: r.content };
  }

  if (isRequestClarificationTool(name)) {
    return deps.executeRequestClarification(
      ctx,
      input as RequestClarificationInput,
    );
  }

  if (isToolSearchTool(name)) {
    return executeToolSearch(ctx, input as ToolSearchInput);
  }

  if (isAgentSearchTool(name)) {
    return executeAgentSearch(ctx, input as AgentSearchInput);
  }

  // Sub-agent lifecycle primitives (chatmode-rip Phase C tasks C.2-C.4).
  // These talk to the openagentic-proxy service (sibling microservice) so
  // running sub-agents can be nudged, enumerated, or torn down without
  // re-spawning. Auth shared with OpenAgenticProxyClient via
  // OPENAGENTIC_PROXY_INTERNAL_KEY + X-Agent-Proxy: true.
  if (isAgentSendTool(name)) {
    return executeAgentSend(ctx, input as AgentSendInput);
  }

  if (isAgentListTool(name)) {
    return executeAgentList(ctx, input as AgentListInput);
  }

  if (isAgentStopTool(name)) {
    return executeAgentStop(ctx, input as AgentStopInput);
  }

  // Pattern memory primitives (2026-05-11). Both are auto-approved meta-tools
  // (LOW risk — pattern_save scopes by user_id at write, pattern_recall is
  // read-only and the service enforces user_id OR shared at search time).
  // Routed BEFORE the MCP fall-through so the permission service doesn't
  // fire on these.
  if (isPatternSaveTool(name)) {
    return executePatternSave(ctx, input as PatternSaveInput);
  }

  if (isPatternRecallTool(name)) {
    return executePatternRecall(ctx, input as PatternRecallInput);
  }

  if (isBrowserSandboxToolName(name)) {
    return deps.executeBrowserSandbox(ctx, input);
  }

  if (isMemorizeTool(name)) {
    // MemorizeTool returns the Anthropic-shape `{ type, content, is_error }`
    // tool-result block. The legacy chat loop expects `{ ok, output, error }`.
    // Translate at the dispatch boundary so the loop stays generic.
    const memResult = await deps.executeMemorize(ctx, input as MemorizeInput);
    const text =
      Array.isArray(memResult.content) && memResult.content[0]?.type === 'text'
        ? memResult.content[0].text
        : '';
    if (memResult.is_error) {
      return { ok: false, error: text || 'memorize failed' };
    }
    return { ok: true, output: text };
  }

  // ─── Permission service ─────────────────────────────────────────────
  // Sev-0 (2026-05-13) — RIPPED redundant gate.evaluate() call. The
  // `builtin:permissions:before_tool_call` hook in pipeline/built-in-hooks.ts
  // (priority 10) already runs PermissionService.evaluate() for every tool
  // call and signals block via data.blocked → chatLoop's wrappedDispatch
  // short-circuits with `{ ok:false, error: blockReason }` BEFORE this
  // dispatcher is ever reached.
  //
  // The legacy block here was calling evaluate() a SECOND time on the
  // same toolCall, creating a NEW requestId + waitForApproval(). On `ask`
  // tier tools the user saw TWO approval cards: the first Approve click
  // resolved hook-1's emitter; this second wait was on a different
  // requestId that never received an approve → 120s timeout → auto-deny
  // → tool returned a fake "approval timed out" error.
  //
  // The hook layer is the canonical gate. Tests that need to inject a
  // mock gate should register a custom HookRunner via `deps.hooks`.
  const gate = deps.approvalGate;
  if (gate) {
    const gateLogger = ctx?.logger ?? rootLogger;
    const userId =
      ctx?.userId ?? ctx?.user?.userId ?? ctx?.user?.id ?? 'anonymous';
    const decision = await gate.evaluate(
      {
        toolName: name,
        arguments: (input ?? {}) as Record<string, unknown>,
        userId,
        sessionId: ctx?.sessionId,
        messageId: ctx?.messageId,
      },
      (event: string, data: unknown) => {
        if (typeof ctx?.emit === 'function') ctx.emit(event, data);
      },
    );
    if (!decision.approved) {
      return {
        ok: false,
        error: `Tool '${name}' rejected by HITL gate: ${decision.reason}`,
      };
    }
    void gateLogger;
  }

  // Default: MCP fall-through. Phase 26 — auto-emit a streaming_table
  // frame when the tool result is a list-shape; the UI's v2/StreamingTable
  // renders rows inline with a fade-in animation.
  const mcpResult = await deps.executeMcpTool(ctx, name, input);
  try {
    if (mcpResult && (mcpResult as any).ok && typeof ctx?.emit === 'function') {
      // Lazy-import to avoid pulling the full implementation into hot paths
      // when the result obviously isn't list-shaped.
      const { autoEmitStreamingTable } = await import('../../../../services/autoEmitStreamingTable.js');
      autoEmitStreamingTable({
        toolCallId: (call as any).id ?? `${name}-${Date.now()}`,
        toolName: name,
        result: (mcpResult as any).output ?? (mcpResult as any).result,
        write: (frame) => ctx.emit(frame.type, frame),
      });
    }
  } catch {
    // Never let table-emit failures sink the tool result.
  }
  return mcpResult;
}

const SANDBOX_ALIASES = new Set<string>([
  'browser_sandbox_exec',
  'browserSandboxExec',
  'BrowserSandboxExec',
  'browser-sandbox-exec',
  'sandbox_exec',
]);

function isBrowserSandboxToolName(name: string): boolean {
  return SANDBOX_ALIASES.has(name);
}
