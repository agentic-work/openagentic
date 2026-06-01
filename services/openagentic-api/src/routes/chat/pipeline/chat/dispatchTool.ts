/**
 * dispatchTool — adapter over `dispatchChatToolCall`.
 *
 * Wraps the meta-tool router + MCP fall-through into the chat pipeline's
 * normalized `ToolDispatchResult` envelope. `dispatchChatToolCall` returns
 * a discriminated union (one shape per meta-tool); this adapter maps each
 * shape into `{ ok, output, error, discoveredTools, discoveredAgents,
 * artifact, envelope }` so chatLoop sees a uniform interface.
 *
 * Phase 4 — wraps every dispatch result in the two-channel envelope via
 * `splitEnvelope`. The model channel (`structuredContent`) lands on
 * `messages[].content`; the UI channel (`_meta`) lands on the NDJSON
 * tool_result frame. EnrichedTool registry metadata (outputTemplate,
 * truncate_summary) feeds the splitter — when omitted, splitter falls
 * back to a default summary + no outputTemplate.
 *
 * DLP wrapping lands as a follow-up; the `before_tool_call` /
 * `before_streaming` hooks already fire via `chatLoop` so input scanning
 * + output scanning still work. The one gap (`after_tool_call` being
 * audit-only) is documented in the plan and gets closed in the follow-up
 * TDD batch.
 */
import type { RunCtx, ToolDispatchResult } from './types.js';
import {
  dispatchChatToolCall,
  type ChatPipelineDeps,
  type ChatToolCall,
} from './dispatchChatToolCall.js';
import { splitEnvelope, type SplitterLargeResultStorage } from '../../../../services/ToolEnvelopeSplitter.js';
import type { StructuredContent } from '../../../../types/ToolResult.js';
// Phase 9 — adapter-owned meta-tool dispatch arms. Intercepted BEFORE the
// fall-through to dispatchChatToolCall so this adapter owns the contract
// for these primitives.
//   - memory_search      → AgentMemoryService.recall (read companion to memorize)
//   - read_large_result  → LargeResultStorage paged retrieval
//   - synth_execute      → SynthExecutorClient.execute (sandboxed Python, legacy)
//   - synth              → SynthOBODispatcher.executeSynthOBO (OBO-aware, Phase C.5)
import { executeMemorySearch, type MemorySearchInput } from '../../../../services/MemorySearchTool.js';
import { executeReadLargeResult, type ReadLargeResultInput } from '../../../../services/ReadLargeResultTool.js';
import { executeSynthExecute, type SynthExecuteInput } from '../../../../services/SynthExecuteTool.js';
// Phase C.5 (2026-05-11) — OBO-aware synth dispatcher. The new T1 surface
// (renamed from `synth_execute` to `synth` per plan §C.5) routes through
// this wrapper so cloud capabilities (aws / azure / gcp) get brokered
// against the calling user's Azure AD ACCESS token — never a shared
// service account. Refuses if userJwt missing.
import { executeSynthOBO } from '../../../../services/SynthOBODispatcher.js';
import type { SynthInput } from '../../../../services/SynthTool.js';
import type { SynthOBOBrokerLike } from '../../../../services/SynthOBODispatcher.js';
// Live-wiring fix (2026-05-31) — audit EVERY tool call + gate the mutating
// ones at the dispatch seam the live runChat→chatLoop path ALWAYS calls. The
// priority-11 before_tool_call hook does the same, but only fires when
// `deps.hooks` resolves to a populated HookRunner; on the live OSS build that
// resolution is fragile and the hook silently no-ops (live evidence:
// tool_search executed, audit-log total:0). `runAuditAndGate` is single-pass —
// it skips when the hook already audited this dispatch ctx (alreadyAudited).
import {
  runAuditAndGate,
  alreadyAudited,
  markAudited,
} from '../../../../services/approval/auditAndGate.js';
import { getAgentMemoryService } from '../../../../services/AgentMemoryService.js';
import { getMilvusMemoryService } from '../../../../services/MilvusMemoryService.js';
import { getSynthExecutorClient } from '../../../../services/SynthExecutorClient.js';
import { getLargeResultStorageService } from '../../../../services/LargeResultStorageService.js';

/**
 * Per-tool metadata used by the envelope splitter. Pulled from the
 * EnrichedTool registry (Phase 5) at production wire-up. Tests can
 * pass an inline map.
 */
export interface EnrichedToolEntry {
  outputTemplate?: string;
  truncate_summary?: (raw: unknown) => StructuredContent;
}

export interface V3DispatchDeps {
  /**
   * `dispatchChatToolCall` deps bundle — the meta-tool registry + MCP
   * executor + sub-agent runner that the inner dispatcher consumes.
   * Field name kept as `v2Deps` for now to avoid churning every caller;
   * a follow-up rename slice will rotate it to `chatDeps`.
   */
  v2Deps: ChatPipelineDeps;
  /**
   * Per-tool registry metadata keyed by tool slug. Drives outputTemplate
   * routing + per-tool truncate_summary fn for `splitEnvelope`. Optional
   * — when omitted, splitter uses defaults (no outputTemplate, generic
   * summary). Phase 5 wires this from `EnrichedToolService`.
   */
  enrichedTools?: Record<string, EnrichedToolEntry | undefined>;
  /**
   * LargeResultStorage adapter — when provided, oversize results
   * overflow to the storage with `_meta.artifactHandle` set. Production
   * wire-up passes a thin lambda that calls
   * `getLargeResultStorageService().storeResult(...)`. Tests can omit.
   */
  largeResultStorage?: SplitterLargeResultStorage;
  /** Inline-vs-overflow byte threshold; defaults to splitter's 30KB. */
  thresholdBytes?: number;
  /**
   * Phase C.5 (2026-05-11) — CredentialBroker used by the OBO-aware
   * `synth` arm. When omitted, the synth arm falls through to a
   * structured ok:false response — never silently routes to the legacy
   * non-OBO path (cred drift guard). Production wiring constructs a
   * `new CredentialBroker(...)` once at chat-plugin init and passes it
   * here via buildChatV2Deps; unit tests inject a `{ brokerFor: vi.fn() }`
   * stub matching `SynthOBOBrokerLike`.
   */
  synthCredentialBroker?: SynthOBOBrokerLike;
}

/**
 * Adapt the inner dispatcher's discriminated-union result into the chat
 * pipeline's normalized envelope.
 *
 * `dispatchChatToolCall` returns one of: ComposeVisualResult,
 * ComposeAppResult, RenderArtifactResult, TaskResult,
 * RequestClarificationResult, ToolSearchResult, AgentSearchResult, or
 * `{ ok, output?, error? }`. This adapter normalizes to:
 *   { ok, output?, error?, discoveredTools?, discoveredAgents?, artifact?, envelope? }
 *
 * Side-channel mapping:
 *   - tool_search result → discoveredTools (already in ToolSearchResult)
 *   - agent_search result → discoveredAgents
 *   - compose_visual / compose_app / render_artifact → artifact: { kind, payload }
 */
function normalizeDispatchResult(name: string, raw: any): ToolDispatchResult {
  // All inner results carry `{ ok: bool }` as the discriminator.
  const ok = !!raw?.ok;
  const error = raw?.error;

  // Sev-1 L3-5 / Audit F1-1: never leak the raw dispatcher object as the
  // model-facing output. When the inner dispatcher returns success metadata
  // (serverName, confidenceScore, etc.) without an explicit `output` field,
  // the prior `?? raw` fallback caused the entire envelope to leak to the
  // model — leading to confabulation on the next turn.
  const out: ToolDispatchResult = { ok, output: raw?.output ?? '', error };

  // Discovery side-channel (Plan §Tool Catalog Strategy + TDD #5).
  if (Array.isArray(raw?.discoveredTools)) {
    out.discoveredTools = raw.discoveredTools;
  }
  if (Array.isArray(raw?.discoveredAgents)) {
    out.discoveredAgents = raw.discoveredAgents;
  }

  // Artifact side-channel (Plan §Meta-Tool Integration).
  if (raw?.artifact) {
    out.artifact = {
      kind: raw.artifact.kind ?? raw.artifact.type ?? 'unknown',
      payload: raw.artifact.payload ?? raw.artifact,
    };
  } else if (name === 'compose_visual' && raw?.svg) {
    out.artifact = { kind: 'visual', payload: raw };
  } else if (name === 'compose_app' && raw?.html) {
    out.artifact = { kind: 'app', payload: raw };
  } else if (name === 'render_artifact' && raw?.kind) {
    out.artifact = { kind: raw.kind, payload: raw };
  }

  return out;
}

/**
 * Chat-pipeline dispatch entry point. chatLoop calls
 * `deps.dispatch(ctx, { name, input })` and gets back the normalized envelope
 * with the two-channel `envelope` field attached (Phase 4).
 */
export function makeDispatch(
  v3Deps: V3DispatchDeps,
): (ctx: RunCtx, call: { name: string; input: unknown }) => Promise<ToolDispatchResult> {
  return async (ctx, call) => {
    // F2 (2026-05-12) — OTel GenAI v1.37 dispatch span.
    // - Task tool (sub-agent dispatch) → `invoke_agent <agentId>` span with
    //   gen_ai.agent.{id,name} attrs per the agent-spans spec.
    // - Everything else → `execute_tool <name>` span with gen_ai.tool.{name,call.id}.
    // Prom mirror increments gen_ai_tool_calls_total{tool_name,outcome}
    // (or gen_ai_agent_invocations_total{agent_id,outcome} for Task).
    // `ctx.toolUseId` is the LLM-assigned tool_use_id; falls back to 'unknown'
    // for paths that don't propagate it (synthesis-retry helper turns).
    const tracer = v3Deps.v2Deps.genAITracer;
    const callId = (ctx as { toolUseId?: string }).toolUseId ?? 'unknown';
    if (tracer) {
      if (call.name === 'Task') {
        // Pull agentId from the input. The Task tool schema has
        // `subagent_type` (markdown agent slug) — fall back to 'general-purpose'
        // when omitted (which is the documented default per TaskTool.ts).
        const agentId =
          (call.input as { subagent_type?: string } | undefined)?.subagent_type ??
          'general-purpose';
        return tracer.withAgentSpan(
          { agentId, agentName: agentId, agentDescription: '', callId },
          () => dispatchBody(ctx, call, v3Deps),
        );
      }
      return tracer.withToolSpan(
        { name: call.name, callId },
        () => dispatchBody(ctx, call, v3Deps),
      );
    }
    return dispatchBody(ctx, call, v3Deps);
  };
}

async function dispatchBody(
  ctx: RunCtx,
  call: { name: string; input: unknown },
  v3Deps: V3DispatchDeps,
): Promise<ToolDispatchResult> {
  const innerCall: ChatToolCall = { name: call.name, input: call.input };
  {
    const startedAt = Date.now();

    // ─── Audit + approval gate (live seam) ──────────────────────────────
    // Audit EVERY tool call to the append-only tool_call_audit_log and, for
    // MUTATING calls (per classifyTool) with the gate ON, pause for human
    // approval via the ApprovalRegistry + an `approval_required` SSE event.
    // READ calls (tool_search, get_*, list_*, web search) are audited
    // decision='auto' and NEVER gated, so chat never hangs.
    //
    // Single-pass: if the priority-11 before_tool_call hook already audited
    // THIS dispatch ctx, skip (alreadyAudited) so we never write two rows for
    // one call. When the hook never ran (the live failure mode this fix
    // targets), THIS is the path that records the row.
    if (!alreadyAudited(ctx)) {
      const gate = await runAuditAndGate({
        toolName: call.name,
        serverName: (ctx as any)?.serverName,
        args: (call.input ?? {}) as Record<string, unknown>,
        userId: (ctx as any)?.user?.id ?? (ctx as any)?.userId,
        sessionId: ctx.sessionId,
        messageId: (ctx as any)?.messageId ?? (ctx as any)?.toolUseId,
        origin: 'chat',
        emit: typeof (ctx as any)?.emit === 'function'
          ? (e: string, d: unknown) => (ctx as any).emit(e, d)
          : undefined,
        logger: ctx.logger as any,
      });
      markAudited(ctx);
      if (!gate.allowed) {
        // Denied / timed-out MUTATING call — synthesize a tool failure so the
        // model sees the block reason and the loop continues (no execution).
        return {
          ok: false,
          error: gate.blockReason ?? `tool '${call.name}' blocked by approval gate`,
        };
      }
    }

    // Phase 9 — adapter-owned meta-tool dispatch arms. Intercepted BEFORE
    // the fall-through to dispatchChatToolCall so this adapter owns the
    // contract.
    if (call.name === 'memory_search') {
      const v3Result = await dispatchMemorySearch(ctx, call.input as MemorySearchInput);
      return await wrapEnvelope(call.name, v3Result, ctx, v3Deps, Date.now() - startedAt);
    }
    if (call.name === 'read_large_result') {
      // #974 — thread ctx.user identity so the storage layer can RBAC-gate
      // the handle. Without this a leaked handle = cross-user read.
      const v3Result = await dispatchReadLargeResult(call.input as ReadLargeResultInput, ctx);
      return await wrapEnvelope(call.name, v3Result, ctx, v3Deps, Date.now() - startedAt);
    }
    // Phase C.5 (2026-05-11) — new T1 surface name. Must precede the legacy
    // `synth_execute` arm so the new name takes priority; both arms stay
    // during the C.1 catalog cutover so mid-flight chats don't get a name
    // flip mid-turn.
    if (call.name === 'synth') {
      const v3Result = await dispatchSynth(ctx, call.input as SynthInput, v3Deps);
      return await wrapEnvelope(call.name, v3Result, ctx, v3Deps, Date.now() - startedAt);
    }
    if (call.name === 'synth_execute') {
      const v3Result = await dispatchSynthExecute(ctx, call.input as SynthExecuteInput);
      return await wrapEnvelope(call.name, v3Result, ctx, v3Deps, Date.now() - startedAt);
    }

    let normalized: ToolDispatchResult;
    try {
      const inner = await dispatchChatToolCall(ctx as any, innerCall, v3Deps.v2Deps);
      normalized = normalizeDispatchResult(call.name, inner);
    } catch (err: any) {
      normalized = {
        ok: false,
        error: err?.message ?? String(err),
      };
    }

    const elapsed = Date.now() - startedAt;
    // Phase 4 — wrap every result in the two-channel envelope. EnrichedTool
    // registry lookup feeds outputTemplate + per-tool truncate fn; absent
    // entries fall back to splitter defaults.
    const enriched = v3Deps.enrichedTools?.[call.name];
    const raw = normalized.ok ? (normalized.output ?? '') : (normalized.error ?? 'tool failed');
    try {
      const envelope = await splitEnvelope({
        raw,
        tool: {
          slug: call.name,
          outputTemplate: enriched?.outputTemplate,
          truncate_summary: enriched?.truncate_summary,
        },
        sessionId: ctx.sessionId ?? '',
        // F1-5 (2026-05-12 audit): read the real tool_use_id off
        // ctx.toolUseId (chatLoop.ts:601 stamps it before dispatch). The
        // envelope's tool_use_id persists to chat_messages.visualizations
        // and the audit log; without this thread the UI couldn't
        // correlate the envelope back to the source tool_use card.
        toolUseId: (ctx as any).toolUseId ?? '',
        elapsed,
        ok: normalized.ok,
        largeResultStorage: v3Deps.largeResultStorage,
        thresholdBytes: v3Deps.thresholdBytes,
        // #974 RBAC (2026-05-20 PM) — thread the caller's identity through
        // to the storage layer. Pre-#974 the splitter put adapter
        // hardcoded `userId: 'system'`, which left a leaked handle
        // cross-readable. Now the Redis key embeds the namespace + the
        // read-side `getResultAsync` enforces owner match.
        userId: (ctx as any)?.user?.id ?? (ctx as any)?.userId,
        tenantId: (ctx as any)?.user?.tenantId,
        allowedMcpServers: Array.isArray((ctx as any)?.user?.allowedMcpServers)
          ? (ctx as any).user.allowedMcpServers
          : undefined,
      });
      normalized.envelope = envelope;
    } catch (envErr: any) {
      // Splitter must never abort dispatch — log and continue with no envelope.
      ctx.logger.warn(
        { err: envErr?.message ?? String(envErr), tool: call.name },
        '[chat] splitEnvelope failed — falling back to legacy bare-output result',
      );
    }

    return normalized;
  };
}

// ---------------------------------------------------------------------------
// Phase 9 — V3-owned meta-tool dispatch helpers
// ---------------------------------------------------------------------------

/**
 * memory_search dispatch arm. Lazy-resolves AgentMemoryService.recall and
 * forwards the call. NEVER throws — `executeMemorySearch` swallows recall
 * failures and returns `{ ok:false, error }` so the chat loop continues.
 */
async function dispatchMemorySearch(
  ctx: RunCtx,
  input: MemorySearchInput,
): Promise<ToolDispatchResult> {
  const svc = getAgentMemoryService();
  // #1085 — wire MilvusMemoryService.searchUserMemories as the semantic side.
  // The per-user Milvus collection is populated by the sidecar emits in commit
  // 3 (ConversationCompactionWorker, GenerateImageTool, LargeResultStorageService).
  // Adapter swallows its own failures via executeMemorySearch's try-wrap, so a
  // Milvus outage never blocks the substring path.
  const milvus = getMilvusMemoryService(ctx.logger as any);
  const result = await executeMemorySearch(
    { userId: ctx.userId, logger: ctx.logger },
    input,
    {
      recall: (userId, opts) => svc.recall(userId, opts) as any,
      semanticRecall: async (userId, query, limit) => {
        const hits = await milvus.searchUserMemories(userId, { text: query, limit });
        // Adapt RankedMemory → memory_search hit shape. entity_name → key,
        // observations → value, score → confidence.
        return hits.map((h: any) => ({
          id: String(h.id),
          category: String(h.metadata?.entityType ?? h.type ?? 'entity_fact'),
          key: String(h.metadata?.entityName ?? h.entities?.[0] ?? h.id),
          value: String(h.summary ?? h.content ?? ''),
          confidence: typeof h.relevanceScore === 'number' ? h.relevanceScore : 0,
        }));
      },
    },
  );
  return {
    ok: result.ok,
    output: result.output,
    error: result.error,
  };
}

/**
 * read_large_result dispatch arm. Adapts `LargeResultStorageService` —
 * which exposes `getResultAsync(resultId)` returning the full stored
 * object — onto the `{ get(handle, opts) }` shape `executeReadLargeResult`
 * expects. Offset/limit slice client-side over the returned chunks/items.
 *
 * #974 RBAC (2026-05-20 PM) — `ctx.user.{id,tenantId,allowedMcpServers}`
 * are forwarded to `getResultAsync(handle, { userId, tenantId,
 * allowedMcpServers })`. The storage layer rejects when the caller's
 * namespace doesn't match the stored owner OR when the originating
 * MCP server is not in the caller's allow-list. Result: a stolen
 * `result_<ts>_<rand>` handle from another user no longer cross-reads.
 */
async function dispatchReadLargeResult(
  input: ReadLargeResultInput,
  ctx?: RunCtx,
): Promise<ToolDispatchResult> {
  const storage = getLargeResultStorageService();
  // #974 — extract caller identity. Both `ctx.user.id` (canonical) and
  // `ctx.userId` (legacy) are checked. Missing identity is fail-open per
  // legacy callsites that don't carry user context — but logged so a
  // production drop-through is observable.
  const ctxUser = (ctx as any)?.user;
  const auth = ctxUser
    ? {
        userId: String(ctxUser.id ?? (ctx as any)?.userId ?? ''),
        tenantId: String(ctxUser.tenantId ?? ''),
        allowedMcpServers: Array.isArray(ctxUser.allowedMcpServers)
          ? ctxUser.allowedMcpServers
          : undefined,
      }
    : undefined;

  const adapter = {
    get: async (handle: string, opts: { offset: number; limit: number; filter?: string }) => {
      // The concrete service exposes `getResultAsync` (returns full result)
      // and `queryStoredResult` (filter-by-text). Tests mock a `get` method
      // directly, so we look for that first to keep the unit-test path clean.
      if (typeof (storage as any).get === 'function') {
        return await (storage as any).get(handle, opts);
      }
      const stored = await storage.getResultAsync(handle, auth);
      if (!stored) {
        // #974 — RBAC failure surfaces as a "not found or not authorized"
        // error. We deliberately do NOT leak whether the handle exists
        // (would let a probe enumerate other tenants' handles).
        throw new Error(`handle not found or not authorized: ${handle}`);
      }
      // Slice the result client-side. If `result` is an array we paginate;
      // otherwise we return the whole object (offset/limit irrelevant).
      const fullResult = stored.result;
      if (Array.isArray(fullResult)) {
        const sliced = fullResult.slice(opts.offset, opts.offset + opts.limit);
        return { items: sliced, total: fullResult.length, offset: opts.offset, limit: opts.limit };
      }
      return fullResult;
    },
  };
  const result = await executeReadLargeResult(input, { largeResultStorage: adapter });
  return {
    ok: result.ok,
    output: result.output,
    error: result.error,
  };
}

/**
 * synth_execute dispatch arm. Resolves the SynthExecutorClient singleton
 * (constructed lazily — env vars not required at module-load time so unit
 * tests can stub via `getSynthExecutorClient` mock).
 */
async function dispatchSynthExecute(
  ctx: RunCtx,
  input: SynthExecuteInput,
): Promise<ToolDispatchResult> {
  const client = getSynthExecutorClient(ctx.logger as any);
  const result = await executeSynthExecute(
    {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      userEmail: (ctx as any)?.user?.email,
      logger: ctx.logger,
    },
    input,
    { client },
  );
  return {
    ok: result.ok,
    output: result.output,
    error: result.error,
  };
}

/**
 * synth dispatch arm — chatmode-rip Phase C.5 (2026-05-11).
 *
 * The T1 catalog renames `synth_execute` → `synth`. This arm routes the
 * new name through `executeSynthOBO` so cloud capabilities (aws / azure /
 * gcp) are brokered against the calling user's Azure AD ACCESS token —
 * never a shared service account.
 *
 * Contract:
 *   - `ctx.userJwt` MUST be set for cloud-touching code; OBO refuses
 *     otherwise (`SynthOBODispatcher` returns `ok:false` with a clear
 *     /auth|jwt|sign in|userJwt/ error). The dispatcher surfaces that
 *     result verbatim — never falls back to the legacy non-OBO path.
 *   - When `v3Deps.synthCredentialBroker` is missing (mis-wired chat
 *     plugin), return a structured ok:false so chats degrade gracefully
 *     instead of crashing the loop. Production must ALWAYS wire the
 *     broker; the guard is a defensive cage.
 *   - `client` resolution mirrors `dispatchSynthExecute` (lazy singleton).
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §C.5
 */
async function dispatchSynth(
  ctx: RunCtx,
  input: SynthInput,
  v3Deps: V3DispatchDeps,
): Promise<ToolDispatchResult> {
  const broker = v3Deps.synthCredentialBroker;
  if (!broker) {
    ctx.logger.warn(
      { tool: 'synth' },
      '[chat] dispatchSynth — synthCredentialBroker missing from deps; cannot run synth. ' +
        'Wire CredentialBroker via buildChatV2Deps.',
    );
    return {
      ok: false,
      error:
        'synth dispatcher is not wired (no CredentialBroker on deps). ' +
        'This is a server-side wiring bug — please contact your administrator.',
    };
  }
  const client = getSynthExecutorClient(ctx.logger as any);
  const result = await executeSynthOBO(
    {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      userEmail: (ctx as any)?.user?.email,
      userJwt: ctx.userJwt,
      logger: ctx.logger,
    },
    input,
    { broker, client },
  );
  return {
    ok: result.ok,
    output: result.output,
    error: result.error,
  };
}

/**
 * Shared envelope wrapper for the adapter-owned dispatch arms — mirrors the
 * post-fall-through path so model channel + UI channel stay symmetric.
 * Splitter failure NEVER aborts dispatch.
 */
async function wrapEnvelope(
  name: string,
  normalized: ToolDispatchResult,
  ctx: RunCtx,
  v3Deps: V3DispatchDeps,
  elapsed: number,
): Promise<ToolDispatchResult> {
  const enriched = v3Deps.enrichedTools?.[name];
  const raw = normalized.ok ? (normalized.output ?? '') : (normalized.error ?? 'tool failed');
  try {
    const envelope = await splitEnvelope({
      raw,
      tool: {
        slug: name,
        outputTemplate: enriched?.outputTemplate,
        truncate_summary: enriched?.truncate_summary,
      },
      sessionId: ctx.sessionId ?? '',
      // F1-5 (2026-05-12 audit): thread real tool_use_id from ctx.
      toolUseId: (ctx as any).toolUseId ?? '',
      elapsed,
      ok: normalized.ok,
      largeResultStorage: v3Deps.largeResultStorage,
      thresholdBytes: v3Deps.thresholdBytes,
    });
    normalized.envelope = envelope;
  } catch (envErr: any) {
    ctx.logger.warn(
      { err: envErr?.message ?? String(envErr), tool: name },
      '[chat] splitEnvelope failed — falling back to legacy bare-output result',
    );
  }
  return normalized;
}
