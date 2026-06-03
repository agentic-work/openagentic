/**
 * Node Plugin Types — schema-driven node plugin system.
 *
 * Each node plugin lives in `src/nodes/<type>/` with:
 *   - schema.json   — canonical metadata (compiler, palette, AI Flow Builder, validator)
 *   - executor.ts   — async execute(node, input, ctx) function
 *   - executor.test.ts — TDD tests for the executor
 *
 * The registry (registry.ts) auto-loads all migrated nodes at boot.
 * Compiler and engine both consult the registry first, then fall through
 * to the legacy switch/case for the 50+ nodes still using the old pattern.
 *
 * This file defines the shared interfaces. Pure data — no runtime imports.
 */

import type { LLMTracingService } from '../tracing/LLMTracingService.js';
import type { TestMocks } from '../runtime/testMocks.js';

// ---------------------------------------------------------------------------
// WorkflowNode — graph-node shape passed to executors.
//
// Originally lived in WorkflowExecutionEngine.ts; moved here in S0-11 (Task #18)
// so the shared package has no dependency on either engine copy.
// Both engines re-export this from types.ts for backward compat.
// ---------------------------------------------------------------------------

export interface WorkflowNode {
  id: string;
  type: string;
  data: Record<string, any>;
  position?: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Schema shape (mirrors schema.json)
// ---------------------------------------------------------------------------

export type NodeCategory =
  | 'trigger'
  | 'action'
  | 'control'
  | 'data'
  | 'ai'
  | 'integration'
  | 'annotation'
  | 'utility';

export type SettingType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'json'
  | 'object'
  | 'code'
  | 'secret_ref';

export interface NodePort {
  name: string;
  type: string;
  required?: boolean;
  shape?: Record<string, string>;
}

export interface NodeSetting {
  name: string;
  label?: string;
  description?: string;
  type: SettingType;
  required?: boolean;
  /** Allowed values for `enum`-type settings. */
  values?: ReadonlyArray<string>;
  default?: unknown;
  placeholder?: string;
  supportsTemplating?: boolean;
  min?: number;
  max?: number;
  validation?: {
    pattern?: string;
    errorMessage?: string;
  };
}

export interface NodeAiHints {
  /** Short description used in the AI Flow Builder system prompt. */
  shortDescription: string;
  whenToUse: string;
  examplePrompt?: string;
  /** Free-form hint about output template references. */
  promptHints?: string;
}

export interface NodeOutputAssertion {
  /** Stable name for the assertion — surfaces in node_error.failedAssertion. */
  name: string;
  /**
   * JS-style boolean expression evaluated against the executor return value.
   * The variable `result` refers to the return value. Use `result.foo`, etc.
   * Expressions run in a sandboxed Function — no closure over engine state.
   */
  expression: string;
  errorMessage: string;
}

export interface NodeSchema {
  /** Unique node type — also the folder name. */
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  /** Icon hint — frontend maps this to its icon registry. */
  icon?: string;
  /**
   * TYPED NODE-IO CONTRACT — the keystone (P0 mechanism).
   *
   * Names the field in the executor's FLAT runtime result that
   * `{{steps.X.output}}` / `{{X.output}}` MUST resolve to. This is a runtime
   * contract, not a UI label: the schema-aware resolver
   * (WorkflowExecutionEngine.interpolateTemplate) looks up the source node's
   * TYPE → its schema → `primary`, and when a primary is declared AND present
   * on the stored result it returns `result[primary]` deterministically —
   * INSTEAD of running the `canonicalNodeOutput` heuristic ladder.
   *
   * BACKWARD-COMPATIBLE: nodes WITHOUT a declared `primary` fall back to the
   * existing `canonicalNodeOutput` heuristic, so the currently-working nodes
   * are unaffected. Only declare `primary` when the heuristic returns the wrong
   * field, or when the safety/semantics demand a specific field (guardrails →
   * `passed`, NOT the scanned `content`).
   *
   * The named field MUST be a key the executor actually returns on its flat
   * result object (the contract harness asserts this RED→GREEN).
   */
  primary?: string;
  ports?: {
    inputs?: ReadonlyArray<NodePort>;
    outputs?: ReadonlyArray<NodePort>;
  };
  settings?: ReadonlyArray<NodeSetting>;
  ai?: NodeAiHints;
  outputAssertions?: ReadonlyArray<NodeOutputAssertion>;
}

// ---------------------------------------------------------------------------
// Execution context — what each executor.ts depends on
// ---------------------------------------------------------------------------

/**
 * The minimal interface a node executor needs from the engine.
 * The engine constructs this object per-node-execution and passes it in.
 *
 * Keeping this small means executors don't depend on the giant
 * WorkflowExecutionEngine class — they're testable in isolation.
 */
export interface NodeExecutionContext {
  /** AbortSignal — wired through abortableAxios.* helpers. */
  readonly signal: AbortSignal;
  /** Workflow execution id (for headers, logs, tracing). */
  readonly executionId: string;
  /** Workflow definition id — used by tracing for per-workflow grouping. */
  readonly workflowId?: string;
  /**
   * Caller's tenant id (Azure AD `azure_tenant_id` claim). Theme A / S1-1.
   * Originally added for tracing (per-tenant observability); now also drives
   * the Prisma tenant-injection extension's auto-filter for any executor
   * that opens a Prisma session. Engine threads this through from
   * ExecutionContext on every node-execution.
   */
  readonly tenantId?: string;
  /** OpenAgentic API base URL (e.g. http://openagentic-api:8000). */
  readonly apiUrl: string;
  /** Optional MCP Proxy base URL — used by mcp_tool. */
  readonly mcpProxyUrl?: string;
  /**
   * Optional Agent Proxy base URL — used by agent_spawn / a2a / agent_single /
   * agent_pool / agent_supervisor / multi_agent. Defaults to
   * `http://openagentic-proxy:3300` when the engine wires the context.
   */
  readonly openagenticProxyUrl?: string;
  /**
   * Optional internal-auth secret for the openagentic-proxy. The executors send it
   * as `Authorization: Bearer <key>` along with `X-Agent-Proxy: true`. When
   * absent, executors fall back to ctx.getInternalAuthHeaders().
   */
  readonly openagenticProxyInternalKey?: string;
  /**
   * Optional caller user id — used for `X-User-Id` header on openagentic-proxy
   * calls and as the `userId` field in execute-sync payloads. Falls back
   * to `'workflow-engine'` when unset.
   */
  readonly userId?: string;
  /**
   * Optional user auth token (NOT internal-secret) — used by user-context
   * nodes such as mcp_tool that call the MCP proxy as the user. The proxy
   * validates this and uses it for OBO federation.
   */
  readonly authToken?: string;
  /**
   * Optional ID token — used by mcp_tool for AWS Identity Center / Azure OBO
   * federation (passed as X-AWS-ID-Token / X-Azure-ID-Token).
   */
  readonly idToken?: string;
  /**
   * Optional run-user email (#1275) — threaded from ExecutionContext.userEmail.
   * Sent to openagentic-proxy in the agent dispatch body so the spawned sub-agent
   * runs AS THE USER (true run-as-user OBO) for audit attribution, instead of
   * the service principal.
   */
  readonly userEmail?: string;
  /**
   * Resolves {{steps.X.field}}, {{trigger.body.X}}, {{secret:NAME}},
   * {{env.NAME}} etc. against the running workflow's context.
   */
  interpolateTemplate(template: string, input: unknown): string;
  /** Internal-service auth headers for self-calls (LLM endpoint). */
  getInternalAuthHeaders(): Record<string, string>;
  /**
   * Pino-compatible logger. The signature is intentionally loose
   * (`...args: any[]`) so the engine can pass its raw pino instance
   * without wrapping. Tests can pass any structurally-compatible object.
   */
  readonly logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
  };

  /**
   * Optional hook for the webhook_response node to stash its resolved
   * response on the execution context. The engine wires this up to
   * `this.context.webhookResponse = ...`. Absent in tests that don't
   * care about the side-effect.
   */
  setWebhookResponse?: (response: {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  }) => void;

  /**
   * Optional hook for nodes that produce a user-facing artifact (e.g.
   * webhook_response with `persistAsArtifact: true`) to persist the
   * rendered output to the artifacts library so it appears alongside
   * chat-produced artifacts. The engine wires this to a direct
   * `prisma.artifactFile.create` against the `artifact_files` table —
   * same table `ArtifactService.uploadArtifact` populates and the same
   * source `/api/artifacts` reads from.
   *
   * Returns the freshly persisted artifact id so the executor can surface
   * it on its return envelope (`artifactId`) for downstream chaining /
   * UI display. Returns null on persistence failure (the executor swallows
   * the failure since artifact creation should never block a flow's
   * primary output delivery).
   *
   * Absent in tests that don't exercise persistence — the executor
   * skips the call when the hook is missing.
   */
  persistArtifact?: (artifact: {
    title: string;
    description?: string;
    mimeType: string;
    body: string;
    tags?: string[];
    kind?: string;
  }) => Promise<string | null>;

  /**
   * Optional hook for executors to emit per-node progress events during
   * a long-running operation. The engine wires this to its `emitEvent`
   * stream so the UI can render live cards (e.g. multi-agent swarm popover
   * showing each sub-agent's status, tool calls, tokens).
   *
   * Two accepted shapes:
   *
   *   1. Legacy free-form (back-compat):
   *      { nodeId, eventType: 'subagent.contract_violation' | …, payload }
   *
   *   2. Canonical SDK AgenticEvent (Tier A — preferred):
   *      { nodeId, event: AgenticEvent }
   *      where AgenticEvent comes from @agentic-work/llm-sdk builders
   *      (e.g. buildSubAgentStarted / buildSubAgentCompleted /
   *      buildAgentTreeUpdate). The engine forwards the canonical event
   *      verbatim under `frame.event` on the SSE node_progress envelope,
   *      keeping the UI swarm-renderer contract identical to chatmode.
   *
   * The legacy shape is wrapped in a frame as { eventType, payload }; the
   * canonical shape is wrapped as { event }. Consumers must dispatch on
   * `frame.event?.type` first, falling back to `frame.eventType`.
   */
  emitNodeProgress?: (
    event:
      | {
          nodeId: string;
          eventType: string;
          payload: Record<string, unknown>;
        }
      | {
          nodeId: string;
          /**
           * Canonical AgenticEvent from @agentic-work/llm-sdk.
           * Typed as a minimal structural shape here to keep
           * workflow-engine free of the SDK package import at the type
           * layer. Concrete variants (SubAgentStartedEvent, etc.) widen
           * to this shape because every AgenticEvent has `type` + `ts`.
           */
          event: { type: string; ts: number };
        },
  ) => void;

  /**
   * Tier B — optional hook for streaming LLM executors (llm_completion and
   * follow-on AI nodes) to emit per-token canonical events as they arrive
   * from the provider. The engine forwards each event to its execution
   * frame stream as a `node_canonical` ExecutionEvent so the UI can render
   * incremental token deltas in real time, identical to chatmode.
   *
   * The shape is the SDK's `CanonicalEvent` union
   * (`@agentic-work/llm-sdk` → `selectCanonicalNormalizer(...)`); typed
   * loosely here to keep the workflow-engine type surface free of the
   * SDK import. Concrete variants (`message_start`,
   * `content_block_delta`, `message_stop`, etc.) widen to this minimal
   * structural shape.
   *
   * Absent in tests that don't care about streaming events; executors must
   * null-check before calling.
   */
  emitCanonical?: (event: { type: string } & Record<string, unknown>) => void;

  /**
   * Optional hook for the merge node to retrieve all results from
   * incoming edges. Returns an array of { sourceId, label, value } entries,
   * one per incoming edge that has a resolved result.
   *
   * The engine wires this up to its incomingEdges + nodeResults + nodeMap
   * state for the current node. Absent in tests that exercise merge logic
   * without engine graph state.
   */
  getIncomingResults?: (nodeId: string) => Array<{
    sourceId: string;
    label: string;
    value: unknown;
  }>;

  /**
   * Optional LLM tracing service. When present, each LLM-class node executor
   * calls ctx.tracing?.recordCall(...) after the API responds. Wired by the
   * engine at boot; absent in tests that don't care about tracing side-effects.
   */
  tracing?: LLMTracingService;

  /**
   * Optional hook for the trigger node to publish the workflow's first event
   * onto the execution context, so {{trigger.*}} template references resolve
   * for downstream nodes. The engine wires this to
   * `this.context.nodeResults.set('__trigger__', triggerData)`. Absent in
   * tests that don't care about template wiring.
   */
  setTriggerData?: (triggerData: Record<string, unknown>) => void;

  /**
   * Optional hook for the sub_workflow node to invoke another saved workflow
   * by id. The engine wires this to a recursive `executeWorkflow(...)` call
   * with a derived sub-execution id and the current user/auth context.
   * Returns `{ success, output, error? }` so the executor can surface failure.
   */
  executeSubWorkflow?: (
    workflowId: string,
    input: unknown,
  ) => Promise<{ success: boolean; output: unknown; error?: string }>;

  /**
   * Optional hook for the human_approval / approval node to persist the
   * approval record, checkpoint the execution state, emit `approval_required`,
   * and dispatch notifications. The engine wires this to its existing
   * createApprovalRecord + workflowExecution.update + emitEvent +
   * sendApprovalNotifications sequence so the executor stays free of Prisma
   * and engine-class state. Returns the persisted approval row so the
   * executor can pass `approvalId` and `expiresAt` (timeout_at) downstream.
   *
   * The engine still owns the post-return pause: when the executor returns
   * `{ status: 'awaiting_approval', ... }`, executeNodeWithRecovery emits
   * `execution_paused` and stops processing the branch — that path is
   * unchanged after the migration.
   */
  pauseForApproval?: (payload: {
    nodeId: string;
    approvers: string[];
    requiredCount: number;
    timeoutSeconds: number;
    timeoutAction: string;
    message: string;
    notificationChannels: string[];
    input: unknown;
  }) => Promise<{
    id: string;
    message: string;
    timeout_at: Date | string;
  }>;

  /**
   * HITL data-request hook (sister of pauseForApproval) — backs the
   * `human_input` / `request_data` node. Persists a typed WorkflowDataRequest,
   * checkpoints the execution, and emits the `needs_input` frame. The engine's
   * pause logic then suspends the run; POST /resume-execution re-enters with
   * the user's submitted values. Returns the request id + expiry so the
   * executor can echo them downstream.
   */
  requestData?: (payload: {
    nodeId: string;
    fields: Array<Record<string, unknown>>;
    title: string;
    description: string;
    timeoutSeconds: number;
    timeoutAction: string;
    assignTo: string[];
    channel: string;
    input: unknown;
  }) => Promise<{
    id: string;
    timeout_at: Date | string;
  }>;

  // ---------------------------------------------------------------------------
  // Control-flow hooks (Task #45) — let condition / switch / parallel / loop
  // run as schema-driven plugins. The legacy engine methods used direct access
  // to outgoingEdges + executeNode + notifySkippedBranch. These hooks expose
  // exactly that surface to executors without requiring them to import the
  // engine class.
  // ---------------------------------------------------------------------------

  /**
   * Optional read of a node's outgoing edges. Sister of getIncomingResults —
   * used by routing executors (condition, switch) to pick which downstream
   * targets to follow vs skip.
   *
   * Returned shape mirrors the engine's WorkflowEdge minus the `id` field,
   * which routing executors don't need.
   */
  getOutgoingEdges?: (nodeId: string) => Array<{
    target: string;
    label?: string;
    sourceHandle?: string;
  }>;

  /**
   * Control-flow hook: dispatch to a chosen subset of the node's outgoing
   * edges and mark the rest as skipped (which decrements downstream merge
   * gates so they don't hang). The engine wires this to:
   *   - notifySkippedBranch(skip[i]) for each id in the skip list
   *   - executeNode(follow[i], input) for each id in the follow list
   * Used by condition + switch.
   */
  routeBranches?: (
    fromNodeId: string,
    decision: { follow: string[]; skip: string[] },
    input: unknown,
  ) => Promise<void>;

  /**
   * Control-flow hook: fan out to ALL outgoing edges in parallel, returning
   * each branch's result. Used by parallel.
   * Engine wires to Promise.allSettled over executeNode for each outgoing edge.
   */
  fanOutBranches?: (
    fromNodeId: string,
    input: unknown,
  ) => Promise<
    Array<{
      targetId: string;
      status: 'fulfilled' | 'rejected';
      value?: unknown;
      reason?: string;
    }>
  >;

  /**
   * Control-flow hook: iterate over a collection by re-executing the
   * downstream subgraph once per item, with the iteration variable bound
   * in the per-iteration input. Used by loop.
   * Engine wires to a per-iteration executeNode call binding `${itemVariable}`
   * in the input scope, accumulating per-iteration results.
   *
   * Optional `concurrency` (default 1 / sequential) bounds how many
   * per-item subgraph executions run at once — used by map_reduce to
   * fan out under a configurable limit. When omitted the engine runs
   * iterations sequentially (loop's historical behaviour).
   */
  iterateOver?: (
    fromNodeId: string,
    items: ReadonlyArray<unknown>,
    itemVariable: string,
    input: unknown,
    concurrency?: number,
  ) => Promise<unknown[]>;

  /**
   * Control-flow hook: execute the downstream subgraph from `fromNodeId`
   * exactly once with the supplied input, resolving to the subgraph's
   * terminal result or REJECTING if any node in it errors. Used by
   * retry_with_backoff to drive a single attempt of the operation it
   * guards. The engine wires this to executeNode over the node's outgoing
   * edges, surfacing the first rejection so the executor can decide whether
   * to back off and retry. Distinct from iterateOver (which never re-runs
   * the same item) and fanOutBranches (which swallows rejections into a
   * settled array).
   *
   * Absent in unit tests that inject their own attempt function.
   */
  runSubStep?: (fromNodeId: string, input: unknown) => Promise<unknown>;

  // ---------------------------------------------------------------------------
  // Synth + code/openagentic hooks (Task #46) — let the last unmigrated nodes
  // run as schema-driven plugins. The legacy engine executors hit Prisma
  // directly for the user-email lookup and called runSandboxed inline; these
  // hooks expose exactly that surface to executors without forcing them to
  // import Prisma or pin a sandbox version.
  // ---------------------------------------------------------------------------

  /**
   * Optional hook for synth: resolve the calling user's email so synth can
   * pass it to the synthesis API for credential lookup. Returns null if
   * unknown (the synth executor handles that case by falling back to '').
   * Engine wires this to `prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } })`.
   */
  getUserEmail?: () => Promise<string | null>;

  /**
   * Optional hook for code / openagentic: run user-supplied code in the
   * shared isolated-vm sandbox, returning the evaluated result. Engine
   * wires this to runSandboxed(code, { input, timeoutMs }) and unwraps the
   * `{ ok, value }` envelope (throwing on `!ok`). Executors that want to
   * stay engine-independent fall back to direct sandbox import when this
   * hook is absent.
   */
  runIsolatedCode?: (
    code: string,
    language: string,
    input: unknown,
    timeoutMs?: number,
  ) => Promise<unknown>;

  /**
   * Current sub-flow nesting depth — used by the `flow_tool` node to enforce
   * a hard recursion cap (default 3). The engine increments this when it
   * dispatches a sub-execution through executeSubWorkflow and resets at the
   * root. Gap-analysis 2026-05-14 P0 #3.
   */
  readonly subFlowDepth?: number;

  /**
   * Optional hook for the conversation_memory node. The engine wires this
   * to ConversationMemoryService (Prisma-backed). Absent in unit tests that
   * inject their own mock + in tests that don't exercise the node.
   *
   * Gap-analysis 2026-05-14 P0 #2.
   */
  conversationMemory?: {
    read: (args: {
      tenantId?: string;
      memoryId: string;
      limit?: number;
    }) => Promise<{
      messages: Array<{ role: string; content: string; timestamp: string | Date }>;
      count: number;
    }>;
    write: (args: {
      tenantId?: string;
      memoryId: string;
      role: string;
      content: string;
      metadata?: Record<string, unknown>;
    }) => Promise<{ written: boolean; total: number }>;
    clear: (args: {
      tenantId?: string;
      memoryId: string;
    }) => Promise<{ cleared: boolean; removedCount?: number }>;
    summarize: (args: {
      tenantId?: string;
      memoryId: string;
      summarizerModel?: string;
      summaryPrompt?: string;
    }) => Promise<{ summary: string; messagesSummarized: number }>;
    /**
     * V1.1 vector backend (2026-05-14). Embeds the query via the platform's
     * UniversalEmbeddingService and returns the top-K most-similar prior
     * messages for the (tenantId, memoryId) scope. Optional so unit tests
     * that don't exercise search can leave it undefined.
     */
    search?: (args: {
      tenantId?: string;
      memoryId: string;
      query: string;
      limit: number;
    }) => Promise<{
      matches: Array<{
        role: string;
        content: string;
        timestamp: string | Date;
        score: number;
      }>;
      count: number;
    }>;
  };

  /**
   * Optional test-mode mock payload (Phase B #17). When present,
   * mock-aware executors (mcp_tool, llm_completion, etc.) consult the
   * resolver before reaching for the network — letting WorkflowTestRunner
   * (now api-side proxy) drive deterministic test runs against the
   * remote workflows-svc engine instead of constructing one in-process.
   *
   * Absent in production traffic. Wired by the engine when /test-execute
   * is called with `mocks` in the request body.
   */
  testMocks?: TestMocks;
}

// ---------------------------------------------------------------------------
// Executor function signature
// ---------------------------------------------------------------------------

export type NodeExecutor = (
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Registry entry (combines schema + executor)
// ---------------------------------------------------------------------------

export interface NodePlugin {
  schema: NodeSchema;
  execute: NodeExecutor;
}

// ---------------------------------------------------------------------------
// Output-assertion failure tag
// ---------------------------------------------------------------------------

/**
 * Thrown by runWithAssertions when an outputAssertion fails.
 * The engine catches this and emits node_error with reason='output_failed_assertion'.
 */
export class OutputAssertionError extends Error {
  readonly reason = 'output_failed_assertion' as const;
  readonly failedAssertion: string;
  readonly nodeOutput: unknown;

  constructor(opts: {
    failedAssertion: string;
    errorMessage: string;
    nodeOutput: unknown;
  }) {
    super(opts.errorMessage);
    this.name = 'OutputAssertionError';
    this.failedAssertion = opts.failedAssertion;
    this.nodeOutput = opts.nodeOutput;
  }
}
