/**
 * V3 chat-loop shared types.
 *
 * Mirrors Anthropic Messages content blocks + ProviderManager turn shape,
 * but kept ISOLATED from V2's existing types so V3 can iterate without
 * dragging V2 along during the strangler cutover.
 *
 * Plan: <internal-plan>
 */

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

// F2-4 (2026-05-12 audit): `content_filter` added — Azure Responsible AI
// trip on a truncated assistant response. Previously the value fell
// through to `end_turn` in mapStopReason, hiding a COMPLIANCE EVENT
// from the operator + audit log. chatLoop branches on this distinct
// stop_reason to emit a `content_filter` annotation frame so the UI
// renders a compliance banner instead of an empty bubble.
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'content_filter';

/**
 * Streaming events the provider yields. The loop consumes these and
 * translates to NDJSON opcodes; the provider adapter (streamProvider.ts)
 * normalizes OpenAI-shape `delta.content` / `delta.tool_calls` /
 * `finish_reason` into this canonical event union.
 */
export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; name: string; inputDelta: string }
  | { type: 'tool_use_complete'; id: string; name: string; input: unknown }
  | { type: 'message_stop'; stop_reason: StopReason }
  // F2-followup (2026-05-12) — usage tokens surfaced from provider's
  // canonical `message_delta.usage`. chatLoop accumulates these and
  // forwards to deps.recordCompletionMetrics so the SLO histograms
  // (gen_ai_server_time_*, gen_ai_client_token_usage_total, etc.)
  // fire on streaming turns. Absent on providers that don't surface
  // usage mid-stream (rare).
  | {
      type: 'usage';
      input: number;
      output: number;
      cacheRead?: number;
      cacheWrite?: number;
      reasoning?: number;
    };

/**
 * Phase A.4 — named-function tool_choice shape for server-side artifact
 * verb forcing. Passed through streamProvider to the provider wire body
 * (buildAnthropicWireBody / buildOllamaWireBody). The Anthropic adapter's
 * decorateToolChoice already handles `{type:'tool',name}` on the wire;
 * we use the OpenAI-shape `{type:'function',function:{name}}` here because
 * that's what `completionRequestToCanonical` accepts and the SDK adapters
 * expect from callers of streamProvider.
 */
export type NamedFunctionToolChoice = {
  type: 'function';
  function: { name: string };
};

export interface ProviderRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>;
  tools: ReadonlyArray<any>;
  tool_choice: 'auto' | 'none' | 'any' | NamedFunctionToolChoice;
  model: string;
  cacheBreakpoint?: 'after_tools' | 'never';
  /**
   * L5-1 five-layer audit (2026-05-12) — OBO context for cloud providers
   * that exchange the caller's Azure AD ID/access token for short-lived
   * cloud credentials. Currently consumed by `AWSBedrockProvider`
   * (assumeRoleWithAADToken → BedrockRuntimeClient scoped to the user)
   * and threaded through by `streamProvider`. Optional — when omitted,
   * providers fall back to the service-principal singleton client
   * (the back-compat behavior for non-OBO models).
   */
  callerContext?: {
    aadToken?: string;
    userEmail?: string;
  };
  /**
   * Z.ET (2026-05-19) — per-turn extended thinking toggle. When false,
   * the provider skips attaching a thinking budget even for capable models.
   * Undefined = ON (backwards-compatible default).
   */
  extendedThinkingEnabled?: boolean;
}

export interface ToolDispatchResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  /**
   * Side-channel from tool_search / agent_search dispatchers — appended
   * to the next turn's tools array (deduped by function.name).
   */
  discoveredTools?: ReadonlyArray<any>;
  discoveredAgents?: ReadonlyArray<any>;
  /**
   * Side-channel from compose_visual / compose_app / render_artifact —
   * emits an opcode `4` artifact frame in addition to opcode `3` tool_result.
   */
  artifact?: {
    kind: string;
    payload: unknown;
  };
  /**
   * Phase 4 — two-channel envelope. When set, chatLoop uses
   * `envelope.structuredContent` for the model channel (next turn's
   * messages[].content) and `envelope._meta` for the UI channel
   * (NDJSON tool_result frame). When absent, chatLoop falls back to
   * the legacy `output` / `error` rendering for backward compat.
   *
   * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §6
   */
  envelope?: import('../../../../types/ToolResult.js').ToolResult;
}

export interface RunCtx {
  emit: (op: string, payload: any) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
  user?: any; // OBO surface — propagates to sub-agents per Plan §Sub-Agent Recursion
  /**
   * Typed accessor for the user's Azure AD ACCESS token (chatmode-rip
   * Phase C.6). Set once per turn by `runChat.ts` via `extractUserJwt`.
   * The synth dispatcher (Phase C.5) and any future OBO-aware tool reads
   * `ctx.userJwt` instead of sniffing `ctx.user` so the contract stays
   * typed and CredentialBroker.brokerFor never receives an idToken by
   * accident (which would silently 401 at ARM/STS).
   */
  userJwt?: string;
}

export interface ChatLoopInput {
  userMessage: string;
  priorMessages: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>;
  systemPrompt: string;
  tools: ReadonlyArray<any>;
  model: string;
  /**
   * REQUIRED — admin-tunable via ChatLoopConfigService (SoT:
   * `admin.system_configuration` row keyed `chat_loop`). chatLoop
   * throws a RangeError if this is missing or not a positive integer.
   * Range enforced by ChatLoopConfigService.setMaxTurns is [4, 100].
   *
   * The Sev-1 from the 2026-05-11 multi-cloud capstone (gpt-5.4 hit
   * the old hardcoded 12-cap during 32-tool cascade fanout) is the
   * reason this knob exists.
   */
  maxTurns: number;
  /**
   * Set of tool names that are concurrency-safe (read-only). Used by
   * partitionToolCalls to coalesce adjacent read-only tool_use blocks
   * into one parallel batch. Tools NOT in the set get isolated into
   * single-block serial batches. Computed by toolRegistry.ts from
   * PermissionService.classifyName() — single source of truth.
   * Defaults to empty set (everything serial) for safety.
   */
  concurrencySafeNames?: ReadonlySet<string>;
  /**
   * Max concurrent tool dispatches within a parallel batch. Defaults to 5
   * (multi-tenant safer than Claude Code's 10).
   */
  maxConcurrency?: number;
  /**
   * Z.ET (2026-05-19) — per-turn extended thinking toggle. When false,
   * chatLoop passes extendedThinkingEnabled:false on every ProviderRequest
   * for this turn, suppressing thinking even for capable models.
   * Undefined = ON (backwards-compatible default).
   */
  extendedThinkingEnabled?: boolean;
}

/**
 * Minimal HookRunner surface chatLoop exercises. Kept structural so unit
 * tests can pass `vi.fn()`-style stubs without instantiating the real
 * `pipeline/hooks.ts` HookRunner; production wiring passes the singleton
 * via `getHookRunner()` (see services/buildChatV2Deps.ts).
 *
 * `run` is the unified dispatcher (void points + sync points). `runModifying`
 * is the modifying-hook entry chatLoop uses for `before_tool_call`
 * (returns transformed data so DLP/HITL can mutate `arguments` /
 * `blocked` / `blockReason`).
 */
export interface HookRunnerLike {
  run: (point: string, data: unknown, ctx: any) => Promise<void>;
  runModifying: <T>(point: string, data: T, ctx: any) => Promise<T>;
  runSync?: <T>(point: string, data: T, ctx: any) => T;
}

/**
 * Phase 8 — minimal ContextManagementService surface chatLoop + runChat
 * exercise. Kept structural so tests can pass `vi.fn()`-style stubs without
 * bootstrapping Prisma. Production wiring passes the singleton.
 *
 * `getContextUsage` returns the current token usage + percentage and a
 * `needsCompaction` flag from the underlying ContextManagementService.
 * `compactContext` is best-effort — failures must never abort a turn;
 * callers swallow the throw and log a warn.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §4.4
 */
export interface ContextMgmtLike {
  getContextUsage: (
    sessionId: string,
    model?: string,
  ) => Promise<{
    sessionId: string;
    currentTokens: number;
    maxTokens: number;
    usagePercentage: number;
    messagesCount: number;
    needsCompaction: boolean;
    compactionLevel: 'none' | 'light' | 'medium' | 'aggressive';
  }>;
  compactContext: (
    sessionId: string,
    model?: string,
  ) => Promise<{
    sessionId: string;
    messagesRemoved: number;
    messagesSummarized: number;
    tokensFreed: number;
    newTokenCount: number;
    compactionLevel: string;
    timestamp: Date;
  } | null>;
}

/**
 * F2-followup (2026-05-12) — payload for the per-turn streaming-chat
 * metrics emit. Production wiring threads this to
 * `recordCompletionMetrics` (services/llm-providers/recordCompletionMetrics)
 * which fires the legacy TTFT/TPOT/operation_duration histograms +
 * token_usage / finish_reasons / errors counters.
 */
export interface ChatTurnMetricsArgs {
  model: string;
  providerType: string;
  providerName?: string;
  startedAt: Date;
  /** ms from request send to first text/thinking delta. Undefined when the
   *  stream produced no deltas before terminating (rare). */
  timeToFirstTokenMs?: number;
  /** Final usage from canonical `message_delta.usage`. Undefined when the
   *  provider didn't surface it (some self-hosted Ollama paths). */
  usage?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
  };
  stopReason: StopReason;
  /** Error class for the error-path emit. When set, status='error' and
   *  the gen_ai_errors_total counter increments. */
  errorClass?: string;
  errorMessage?: string;
  /** Optional caller context for per-user / per-session drill-down rows. */
  userId?: string;
  sessionId?: string;
  messageId?: string;
}

export interface ChatLoopDeps {
  /**
   * Streaming provider call. Yields StreamEvent values; loop drives a
   * for-await over the iterator. The adapter normalizes OpenAI / Anthropic
   * / Bedrock shapes into the canonical StreamEvent union.
   */
  streamProvider: (req: ProviderRequest) => AsyncIterable<StreamEvent>;
  /**
   * Tool name router. Same contract as V2's dispatchChatToolCall — returns
   * { ok, output|error, discoveredTools?, discoveredAgents?, artifact? }.
   */
  dispatch: (
    ctx: RunCtx,
    call: { name: string; input: unknown },
  ) => Promise<ToolDispatchResult>;
  /**
   * Phase 3 — Pipeline hook runner. Wires DLP / HITL / audit / cost /
   * sequencer cross-cuts at the canonical hook points (`on_turn_start`,
   * `before_streaming`, `enrich_sse_event`, `before_tool_call`,
   * `after_tool_call`, `on_turn_end`, `on_pipeline_end`).
   *
   * Optional: when omitted (existing unit tests), chatLoop runs without
   * cross-cuts. Production deps factory (buildChatV2Deps) must inject
   * the runner singleton.
   */
  hooks?: HookRunnerLike;
  /**
   * F2 (2026-05-12) — OTel GenAI v1.37 tracer for chat-span emission.
   * Optional: when omitted (unit tests), the loop runs without spans and
   * no gen_ai_* prom counters increment for that turn.
   * Production wiring: buildChatV2Deps → runChat passes the singleton
   * onto ChatLoopDeps as part of the dispatch deps struct.
   */
  genAITracer?: import('../../../../services/observability/GenAITracer.js').GenAITracer;
  /**
   * F2-followup (2026-05-12) — per-turn completion-metrics emit. Called
   * once per chatLoop iteration's stream completion (success path) so the
   * SLO histograms (TTFT / TPOT / operation_duration / token_usage /
   * finish_reasons) populate for streaming chat. Without this dep the
   * legacy LLMRequestLog row + gen_ai_server_time_to_first_token_seconds
   * histogram stay empty on /metrics — see "TTFT p95 by model is empty"
   * in admin console LLM Performance.
   *
   * Default in production: buildChatV2Deps wraps `recordCompletionMetrics`
   * (services/llm-providers/recordCompletionMetrics.ts) and threads
   * providerType from `providerManager.getProviderForModel(model)?.type`.
   *
   * Optional in tests — when omitted, no metrics fire (parity with the
   * existing genAITracer dep).
   */
  recordCompletionMetrics?: (args: ChatTurnMetricsArgs) => void | Promise<void>;
  /**
   * Phase 8 — ContextManagementService for mid-loop compaction.
   *
   * After tool_results are pushed at the end of every loop iteration,
   * chatLoop checks `getContextUsage()`. When `usagePercentage >= 85`
   * (HARD threshold), it awaits `compactContext()` so the next provider
   * call sees a smaller buffer.
   *
   * Optional: when omitted (existing unit tests + back-compat), the
   * mid-loop check is skipped entirely. Production deps factory
   * (runChat) must inject the singleton.
   *
   * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §4.4
   */
  contextMgmt?: ContextMgmtLike;
  /**
   * Phase 10 — TFC mid-loop handoff trigger. Called when chatLoop detects:
   *   - 3 consecutive `request_clarification` tool_uses (model is stuck
   *     in a clarification spiral), OR
   *   - `stop_reason === 'max_tokens'` without producing `end_turn` text.
   *
   * The signal is informational; the callback decides (via
   * HandoffDecisionService) whether to emit the offer envelope. The
   * caller owns the once-per-turn dedup flag — chatLoop fires the
   * trigger every time the pattern matches and trusts the callback to
   * suppress duplicates.
   *
   * Optional: when omitted (existing unit tests + back-compat), no
   * mid-loop trigger fires.
   *
   * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §11.3
   */
  onMidLoopHandoffTrigger?: (
    signal: 'consecutive_clarifications' | 'max_tokens',
  ) => Promise<void>;
  /**
   * #47 (2026-06-01) — exact-name MCP catalog resolver for auto-resolve.
   * Weak local models (gpt-oss:20b) skip the tool_search handshake and emit
   * the target MCP tool name directly. When a tool name is NOT in the offered
   * set, chatLoop calls this to look it up by EXACT name in the indexed MCP
   * catalog (same collection tool_search resolves against). On a hit it returns
   * the OpenAI-shape def so the loop appends it to `tools` and lets the normal
   * dispatch (→ executeMcpTool, audited+gated) run. On a miss → null → the
   * existing synthetic-error self-correction path (#850) is preserved.
   * Optional: when omitted (unit tests / pre-RAG boot), behavior is unchanged.
   * EXACT-NAME ONLY — never fuzzy-resolve a hallucination to a near tool.
   */
  resolveMcpToolByExactName?: (
    name: string,
  ) => Promise<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: unknown;
      server_name?: string;
    };
    serverId?: string;
    originalToolName?: string;
  } | null>;
}

export interface ChatLoopResult {
  ok: boolean;
  error?: string;
  turns: number;
  toolUses: string[];
}

// ---------------------------------------------------------------------------
// Pipeline-entry types (ported from the legacy V2 pipeline in #741).
// `runChat` (the chat pipeline entry) consumes `RunChatInput` + `RunChatDeps`;
// stream.handler.ts builds them per request. Names dropped the V2 suffix per
// MEMORY rule `feedback_no_v_versioning_in_source.md` (2026-05-10).
// ---------------------------------------------------------------------------

/**
 * Dep shape consumed by the (deleted) legacy ranker service. Retained as a
 * type-only alias in `BuildChatV2DepsOptions` so older callers of
 * `buildChatV2Deps` can still pass `toolRanker: undefined` without breaking;
 * a follow-up rip will drop both the field and the alias when no caller
 * remains.
 */
export interface ToolRankerLike {
  rankAndSubset: (args: {
    intent: string;
    allMcpTools: ReadonlyArray<any>;
    server?: string;
    keywords?: string[];
    topK?: number;
  }) => Promise<ReadonlyArray<any>>;
}

/**
 * Dep shape consumed by the (deleted) legacy router-tuning service. Retained
 * for the same back-compat reason as `ToolRankerLike` — the field stays on
 * `BuildChatV2DepsOptions` as `routerTuning?:` until that struct is renamed
 * and slimmed.
 */
export interface RouterTuningLike {
  getIntentToTopK?: () => Promise<Record<string, number> | undefined>;
}

/**
 * Input bag the chat pipeline consumes per request.
 *
 * `attachments` is hydrated by `stream.handler.ts` before invoking the
 * pipeline (image/* → image_url block; PDF/DOCX/text-family → extracted
 * text block via `buildUserMessageContent`).
 */
export interface RunChatInput {
  /** User's current message text. */
  userMessage: string;
  /** Prior turns in the session (already in the user/assistant/tool envelope). */
  priorMessages?: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>;
  /** Resolved MCP tools for this turn. */
  mcpTools: ReadonlyArray<any>;
  /** Active model id. */
  model: string;
  /**
   * Maximum chat-loop turns (ReAct iterations). REQUIRED — resolved by
   * the caller (stream.handler.ts) via `ChatLoopConfigService.getMaxTurns()`
   * before invoking runChat. The SoT is `admin.system_configuration`
   * row keyed `chat_loop` (admin-editable at /admin#chat-loop).
   */
  maxTurns: number;
  /** Optional admin prompt-section overrides — unused post Phase E.3 (RBAC path). */
  promptSectionOverrides?: Record<string, string>;
  /** Optional file attachments hydrated by stream.handler.ts. */
  attachments?: Array<{
    id?: string;
    originalName?: string;
    mimeType: string;
    size?: number;
    base64Data?: string;
    url?: string;
  }>;
  /**
   * P1 #940 (2026-05-18) — per-turn opt-in grounding T1 flag from the
   * chat-input-toolbar SearchCheck toggle. When true the system prompt
   * receives a one-line addendum that instructs the model to verify the
   * factual claims it would have emitted by invoking the existing
   * web_search MCP tool. Defaults false → no behavior change for users
   * who don't toggle it.
   */
  groundingEnabled?: boolean;
  /**
   * Z.ET (2026-05-19) — per-turn extended thinking toggle from the
   * chat-input-toolbar Brain toggle. When false, the provider MUST NOT
   * attach a thinking budget to the CompletionRequest even if the model
   * would otherwise support it. When true or omitted (undefined), the
   * provider may enable thinking per its own capability check.
   *
   * Default: undefined = ON (backwards-compatible — existing callers that
   * don't set this field see no behavior change).
   */
  extendedThinkingEnabled?: boolean;
}

/**
 * Dep bag the chat pipeline consumes per request. Built once at chat-plugin
 * init via `buildChatV2Deps` (the factory keeps its legacy name — slated for
 * rename to `buildChatDeps` in a follow-up rip).
 */
/**
 * Minimal CredentialBroker surface the chat pipeline exercises — the
 * `brokerFor(userJwt, clouds[])` entry point that `SynthOBODispatcher`
 * calls. Kept structural so unit tests can inject `{ brokerFor: vi.fn() }`
 * stubs without instantiating the full broker (which would otherwise read
 * `AWS_OBO_ROLE_ARN` / `GOOGLE_APPLICATION_CREDENTIALS_JSON` from env at
 * construction time).
 *
 * Production wiring: `buildChatV2Deps.ts` resolves
 * `opts.synthCredentialBroker ?? getCredentialBroker()` (lazy singleton)
 * so the chat plugin gets one broker per process.
 */
export interface SynthCredentialBrokerLike {
  brokerFor: (userJwt: string, clouds: Array<'aws' | 'azure' | 'gcp'>) => Promise<unknown>;
}

/**
 * Minimal ToolResultCacheService surface the chat pipeline exercises — only
 * the two cross-user cache entry points. Kept structural so unit tests can
 * inject `{ searchCache: vi.fn(), cacheResult: vi.fn() }` stubs without
 * instantiating the real service (which would otherwise reach Milvus +
 * UniversalEmbeddingService at construction time).
 *
 * Wired into `executeMcpTool` at the buildChatV2Deps factory: every
 * MCP fall-through tool call gets a cache lookup before MCP execution and
 * a fire-and-forget cache write after a successful execution. Meta-tools
 * (Task, compose_visual, render_artifact, request_clarification,
 * memory_search, read_large_result, synth, synth_execute, browser_sandbox,
 * memorize, tool_search, agent_search, pattern_save, pattern_recall, agent_*)
 * bypass the wrap because they never route through executeMcpTool.
 *
 * Production wiring: `services/buildChatV2Deps.ts` resolves
 * `opts.toolResultCache ?? getToolResultCacheService()` (lazy singleton).
 */
export interface ToolResultCacheLike {
  isReady?: () => boolean;
  searchCache: (
    tenantId: string,
    toolName: string,
    toolArgs: unknown,
    queryText?: string,
    userId?: string,
    userGroups?: string[],
    isAdmin?: boolean,
  ) => Promise<{
    result: unknown;
    similarity: number;
    cacheId: string;
    toolName: string;
    cachedAt: Date;
    hitCount: number;
    resourceScope?: string;
    crossUserHit: boolean;
    originalUserId?: string;
  } | null>;
  cacheResult: (
    tenantId: string,
    userId: string,
    toolName: string,
    toolArgs: unknown,
    result: unknown,
    queryText?: string,
  ) => Promise<boolean>;
}

export interface RunChatDeps {
  /**
   * F2-followup (2026-05-12) — see ChatLoopDeps.recordCompletionMetrics.
   * Threaded through by runChat onto loopDeps. Optional in tests.
   */
  recordCompletionMetrics?: (args: ChatTurnMetricsArgs) => void | Promise<void>;
  providerManager: any;
  listAgents: () => Promise<Array<any>>;
  runSubagent: (spec: any, parentCtx?: any) => Promise<any>;
  executeMcpTool: (ctx: any, name: string, input: any) => Promise<any>;
  executeBrowserSandbox: (ctx: any, input: any) => Promise<any>;
  prismaLike?: any;
  toolRanker?: ToolRankerLike;
  routerTuning?: RouterTuningLike;
  /**
   * 2026-05-11 — LargeResultStorage adapter for ToolEnvelopeSplitter.
   *
   * Without this field, `runChat.ts` constructs `V3DispatchDeps` with
   * `largeResultStorage: undefined`, the splitter falls into its defensive
   * inline path, and multi-MB enterprise tool results (e.g. "list Azure
   * subs+RGs across 100 tenants") blow up the model context window.
   *
   * Production wiring: `buildChatV2Deps` resolves the lazy process
   * singleton via `getLargeResultStorageService()` and wraps it in a thin
   * adapter that forwards `(raw, {sessionId, toolUseId, expiresAt, toolName})`
   * → `LargeResultStorageService.storeResult({...}).resultId`.
   */
  largeResultStorage?: import('../../../../services/ToolEnvelopeSplitter.js').SplitterLargeResultStorage;
  /**
   * 2026-05-11 — Inline-vs-overflow byte threshold for ToolEnvelopeSplitter.
   * Defaults to the splitter's built-in 30KB. Surfaced on the deps struct
   * so admins can tune via SystemConfiguration in a future slice — for now
   * the chat factory hardcodes 30*1024.
   */
  thresholdBytes?: number;
  /**
   * Phase C.5 (2026-05-11) — CredentialBroker for the OBO-aware synth
   * dispatcher. The `synth` arm in dispatchTool routes through
   * `executeSynthOBO` which calls `broker.brokerFor(userJwt, clouds)` to
   * mint per-cloud short-lived credentials. When omitted (test paths or
   * mis-wired plugins), the synth dispatcher returns a structured
   * ok:false rather than crashing the loop — production MUST inject the
   * singleton via `buildChatV2Deps`.
   */
  synthCredentialBroker?: SynthCredentialBrokerLike;
  /**
   * Phase D.1 (2026-05-11) — Pipeline hook runner.
   *
   * Carries the singleton initialized at startup with the DLP / HITL /
   * audit / cost / SSE-sequencer built-ins so `runChat` + `chatLoop` can
   * call cross-cuts via `deps.hooks?.run(point, data, ctx)` without
   * re-acquiring the singleton at every call site.
   *
   * Optional: when omitted (unit-test paths that don't bootstrap startup)
   * the loop runs without cross-cuts — failing closed would block every
   * test that doesn't care about hooks.
   *
   * Production wiring: `services/buildChatV2Deps.ts` resolves
   * `opts.hooks ?? getHookRunner()` and sets this field. The runChat.ts
   * inline `getHookRunner()` fallback remains as a defensive guard for
   * call paths that build their own deps struct (codemode / probes).
   */
  hooks?: HookRunnerLike;
  /**
   * A2 (2026-05-12) — sub-agent transcript trace store.
   *
   * When set, `executeTask` persists the full sub-agent transcript +
   * stats keyed by an opaque `trace_handle` so the parent agent can
   * later call `read_subagent_trace(handle)` to recover the raw
   * transcript when a summary doesn't survive synthesis. Cognition's
   * "share full traces" principle.
   *
   * Production wiring: `buildChatV2Deps` wraps `LargeResultStorageService`
   * in a `LargeResultTraceStoreAdapter` that satisfies the `TraceStore`
   * interface and reuses the same Redis-backed multi-pod store as
   * envelope offloading. Test paths leave this undefined and TaskTool
   * runs in back-compat mode (no trace_handle on the result).
   */
  traceStore?: import('../../../../services/TaskTool.js').TraceStore;
  /**
   * F2 (2026-05-12) — OTel GenAI v1.37 tracer for chat / tool / agent spans.
   *
   * When set, `chatLoop` wraps the provider stream call in a `chat` span and
   * `dispatchChatToolCall` wraps each tool dispatch in `execute_tool` (with
   * `invoke_agent` for the Task tool sub-agent branch — per the OTel agent
   * spans spec). Attributes use the gen_ai.* v1.37 semconv so Datadog /
   * Honeycomb / Tempo / Langfuse ingest natively. Prom mirror via
   * gen_ai_*_total counters surfaces on /metrics for in-cluster Grafana.
   *
   * Production wiring: `buildChatV2Deps` resolves `opts.genAITracer ??
   * getGenAITracer()` (lazy singleton bound to the global OTel provider +
   * prom-client default register). Test paths leave undefined and the chat
   * loop runs without spans.
   *
   * Spec: docs/superpowers/plans/2026-05-12-chatmode-industry-bestpractices-followup.md §F2
   */
  genAITracer?: import('../../../../services/observability/GenAITracer.js').GenAITracer;
  /**
   * 2026-05-20 — ToolResultCacheService for cross-user semantic caching of
   * MCP tool results. When present, every MCP fall-through call hits the
   * cache before executing and writes successful results back, keyed by
   * tenant + resource-scope. RBAC enforced at search time per the service's
   * built-in `checkMCPAccess()` + SQL filter.
   *
   * Production wiring: `services/buildChatV2Deps.ts` resolves the lazy
   * singleton via `getToolResultCacheService()` and wraps `executeMcpTool`
   * with the cache-before / cache-after seams. Test paths can inject a
   * `{ searchCache: vi.fn(), cacheResult: vi.fn() }` stub.
   *
   * Optional: when omitted, executeMcpTool stays unwrapped (the legacy
   * cache-less path). Loop never breaks on cache misses or write failures
   * — both seams are wrapped in try/catch and degrade fail-open.
   */
  toolResultCache?: ToolResultCacheLike;
}
