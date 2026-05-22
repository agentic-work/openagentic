// @ts-nocheck — OpenAgenticProxyClient is enterprise-only in OSS edition
/**
 * Chat pipeline — entry point.
 *
 * Composes system prompt, builds tool array, calls chatLoop.
 *
 *   POST /api/chat/stream  →  stream.handler.ts dispatches  →
 *     await runChat(ctx, input, deps)
 *
 * Single chat path; the legacy strangler is gone (B-vrip step 5) and
 * the legacy V2 pipeline is fully deleted (B-vrip step 6 / #741).
 * This file's [chat] log tag is the surface ID.
 *
 * Reuses these load-bearing surfaces:
 *   - getAllBaseTools()              → 9 meta-tools
 *   - dispatchChatToolCall()         → tool name router (via dispatchTool.ts)
 *   - makeStreamAdapter()            → OpenAI ↔ Anthropic translation (via streamProvider.ts)
 *   - (legacy static composer)       → 7-section system prompt assembly (RIPPED Phase E.3)
 *   - (legacy sidecar composer)      → admin-tunable per-intent prompt module (RIPPED Phase E.3; content lives in RBAC overlay)
 *   - buildTaskToolDescription       → live agent-registry-driven Task tool description
 *   - All meta-tool handlers (executeTask, executeComposeVisual, etc.)
 *   - PermissionService              → glob allow/deny/ask + concurrency-safe SoT
 *
 * Architecture cleanups (post-rip):
 *   - intent classifier service (RIPPED 2026-05-10 Phase E.1)
 *   - ToolRanker cascade (RIPPED Phase E.2)
 *   - Legacy stage NDJSON frames the UI never consumes
 *
 * What runChat adds beyond the chatLoop primitive:
 *   - partitionToolCalls (read-parallel / write-serial dispatch)
 *   - Vercel opcode envelope (NDJSON 0/2/3/4/e)
 *   - Synthesis fallback for empty end_turn after tool_results
 */
import type {
  ChatLoopInput,
  ChatLoopDeps,
  ChatLoopResult,
  ContextMgmtLike,
  RunCtx,
  RunChatInput,
  RunChatDeps,
} from './types.js';
import { chatLoop } from './chatLoop.js';
// F0-2 (2026-05-12 audit) + Phase 2.4.2 §A6 (2026-05-12):
// HandoffDecisionService import REMOVED. emitHandoffIfNeeded had zero
// call sites after Phase E.1 deleted the intent signal that drove it.
// The service itself stays in services/HandoffDecisionService.ts for
// any future reuse. The local `buildModelHandoffOffer` builder in
// builders.ts was retired in Phase 2.4.2 §A6 (zero production callers).
// SDK still carries a canonical `buildModelHandoffOffer` at
// lib/agentic-sdk/agentic-events/builders.ts if revival ever needs a
// payload constructor. Pinned by
// no-handoff-offer.source-regression.test.ts.
// Phase 8 — ContextManagementService singleton for pre-loop + mid-loop
// compaction. Triggered at 65% (soft, pre-loop) and 85% (hard, mid-loop)
// usagePercentage thresholds per spec §4.4. Lazy-imported via the singleton
// export so unit tests can stub via `deps.contextMgmt` without booting Prisma.
import { contextManagementService } from '../../../../services/ContextManagementService.js';
import { makeStreamProvider } from './streamProvider.js';
import { makeDispatch, type V3DispatchDeps } from './dispatchTool.js';
import { computeConcurrencySafeNames, type RiskClassifier } from './toolRegistry.js';
import { extractUserJwt } from './extractUserJwt.js';
import { buildChatToolArray } from './toolRegistry.js';
import type { ChatPipelineDeps } from './dispatchChatToolCall.js';
// Phase E.3 + E.7 (2026-05-10) — legacy static + sidecar composer path
// ripped and the `PromptModuleAudience` union dropped alongside the
// V3MetricsRegistry.audienceRoutes counter + ResponseFeedback.audience
// column. The RBAC-keyed `chat-system-{admin,member}.md` selector is the
// only place role discrimination flows from now on.
import type { Logger } from 'pino';
import { getPermissionService } from '../../../../services/PermissionService.js';
import { SessionFactsBuilder } from '../../../../services/SessionFactsBuilder.js';
// Phase B.6 (rev-2): RBAC-keyed system prompt — the only path now.
// Legacy static + sidecar composer wires removed in Phase E.3.
import { getSystemPromptForRole } from '../../../../services/prompt/getSystemPromptForRole.js';
// Phase 9 — memory injection at turn start. Mirrors §10 of the spec:
// when AgentMemoryService.recall returns hits keyed off the user's first
// turn message, we prepend a `<memories>` block ABOVE the session-facts
// block ABOVE the user's actual content. Empty recall = no block.
import { getAgentMemoryService } from '../../../../services/AgentMemoryService.js';
import { buildUserMessageContent } from './buildUserMessageContent.js';
// Direct per-tool imports (legacy pipeline pattern) — the
// services/index.ts barrel does NOT re-export these execute* helpers, so
// we import each from its own service file.
import { executeRenderArtifact } from '../../../../services/RenderArtifactTool.js';
import { executeComposeVisual } from '../../../../services/ComposeVisualTool.js';
import { executeComposeApp } from '../../../../services/ComposeAppTool.js';
import { executeTask, buildTaskToolDescription } from '../../../../services/TaskTool.js';
import { executeRequestClarification } from '../../../../services/RequestClarificationTool.js';
import { executeBrowserSandbox as defaultExecuteBrowserSandbox } from '../../../../services/BrowserSandboxExecTool.js';
import { executeMemorize } from '../../../../services/MemorizeTool.js';
// Phase 3 — pull the HookRunner singleton initialized in startup/04-providers.ts.
// Built-in hooks (DLP/HITL/audit/cost/sequencer) are registered there once at
// boot; V3 chatLoop calls them per turn / per tool dispatch via deps.hooks.
import { getHookRunner } from '../../../../pipeline/hooks.js';
// Phase 5 — EnrichedTool registry feeds outputTemplate + truncate_summary
// per T1 tool into the envelope splitter. Loaded lazily + cached for 60s
// so chat turns don't hit the DB; cache invalidation is acceptable lag
// since admin edits are rare and the next-minute turn picks up the change.
import { EnrichedToolService, type EnrichedToolMetadata } from '../../../../services/EnrichedToolService.js';
// Phase 6 — openagentic-proxy client. RIPS the in-api legacy orchestrator
// path from the chat critical chain. Every Task tool dispatch from chat
// now crosses the api → openagentic-proxy HTTP boundary so the sub-agent's
// ReAct loop runs in the dedicated proxy service (process isolation,
// independent scaling, clean audit boundary).
import {
  OpenAgenticProxyClient,
  type OpenAgenticProxyExecuteResult,
} from '../../../../services/OpenAgenticProxyClient.js';
import type { SubagentSpec, SubagentRunResult } from '../../../../services/TaskTool.js';
// Phase 12 — V3MetricsRegistry singleton. Instrumenting at the V3 entry
// covers compaction triggers, memory injection, handoff offers, audience
// routes, model routes, and end-of-turn whole-turn duration. Per-tool /
// per-hook / per-subagent / envelope-overflow metrics are emitted from
// chatLoop.ts at their respective seams. The chatTurns + chatTurnDuration
// counter pair is the canonical "turn happened" signal.
import { v3Metrics, safeIncCounter, safeObserveHistogram } from '../../../../services/V3MetricsRegistry.js';

/**
 * Phase 9 — render the `<memories>` block from a list of recall hits.
 *
 * Format:
 *   <memories>
 *     - {key}: {value}
 *     - ...
 *   </memories>
 *
 * Each value is HTML-escaped (& < > ") so memory content carrying angle
 * brackets / quotes can't accidentally close the tag or smuggle markup.
 * Block is budget-capped at ~2KB total — hits past the budget are dropped
 * tail-first (assumption: AgentMemoryService.recall returns highest-confidence
 * first via its `orderBy [{confidence:'desc'}, {updated_at:'desc'}]`).
 */
const MEMORY_BLOCK_BUDGET_BYTES = 2048;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMemoriesBlock(
  hits: Array<{ key: string; value: string; category?: string; confidence?: number }>,
): string {
  if (hits.length === 0) return '';
  const open = '<memories>';
  const close = '</memories>';
  const lines: string[] = [];
  let bytes = Buffer.byteLength(open, 'utf8') + Buffer.byteLength(close, 'utf8') + 2; // newlines
  for (const h of hits) {
    const line = `  - ${escapeHtml(h.key)}: ${escapeHtml(h.value)}`;
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1; // +1 for trailing \n
    if (bytes + lineBytes > MEMORY_BLOCK_BUDGET_BYTES) break;
    lines.push(line);
    bytes += lineBytes;
  }
  if (lines.length === 0) return '';
  return `${open}\n${lines.join('\n')}\n${close}`;
}

// Phase E.3 (2026-05-10) — resolveStaticBodies removed. The legacy
// static-composer path read 7 static-section bodies out of `prompt_modules`
// keyed by `injection.selector.slot`. The RBAC path reads two static
// .md files (`chat-system-{admin,member}.md`) instead. The
// `prompt_modules` table is ripped in Phase E.5.

/**
 * Default permission classifier — wraps the production `PermissionService`
 * singleton so unknown MCP tool names are classified by the real
 * glob-pattern rules (DEFAULT_ALLOW_TOOLS / DEFAULT_DENY_TOOLS in
 * PermissionService.ts:128-283) rather than universally falling to 'ask'.
 *
 * Fix for Sev-1 audit finding 2026-05-12: the prior `() => 'ask'` stub
 * forced EVERY MCP tool into a serial batch in `partitionToolCalls`,
 * defeating the parallel-tool concurrency model. The PermissionService
 * has had the right rules since the 2026-05-11 cascade rip; chatLoop
 * just wasn't consulting them.
 *
 * Now: `azure_list_*` / `*_get_*` / `*_describe_*` → 'allow' → parallel-safe.
 * `*_delete_*` / `*_drop_*` → 'deny' → serial (and gated behind HITL).
 *
 * The PermissionService.classifyName signature is sync + cached
 * (loadConfig runs once at singleton boot), so this stays on the hot path.
 *
 * Pinned by `concurrency-safety-classification.test.ts`.
 */
function makeDefaultClassifier(logger: Logger): RiskClassifier {
  const permissionService = getPermissionService(logger);
  return {
    classifyName: (name: string) => {
      try {
        return permissionService.classifyName(name);
      } catch {
        // Defensive — if classifyName throws (rules not loaded yet),
        // fall through to the conservative serial default. Never throws
        // in practice; the in-memory rules are loaded synchronously
        // during singleton construction.
        return 'ask';
      }
    },
  };
}

/**
 * Lazy + 60s-TTL cache of the EnrichedTool map. Built from
 * `EnrichedToolService.listEnabled()` at first access. Each entry is the
 * dispatcher-shaped metadata (`outputTemplate`, `truncate_summary` fn).
 *
 * Admin edits to the registry land via the admin UI; the next chat turn
 * after the TTL expires re-pulls. 60s is a deliberate trade — admin
 * iteration UX vs. DB hit rate at chat-stream cadence.
 */
let enrichedToolsCache: { fetchedAt: number; map: Record<string, EnrichedToolMetadata> } | null = null;
const ENRICHED_TOOLS_TTL_MS = 60_000;

async function loadEnrichedToolsMap(
  prismaLike: any,
  logger: { warn: (...args: any[]) => void },
): Promise<Record<string, EnrichedToolMetadata>> {
  const now = Date.now();
  if (enrichedToolsCache && now - enrichedToolsCache.fetchedAt < ENRICHED_TOOLS_TTL_MS) {
    return enrichedToolsCache.map;
  }
  if (!prismaLike?.enrichedTool) {
    // Test paths or pre-migration boots — service unusable.
    enrichedToolsCache = { fetchedAt: now, map: {} };
    return enrichedToolsCache.map;
  }
  try {
    const svc = new EnrichedToolService(prismaLike);
    const rows = await svc.listEnabled();
    const map: Record<string, EnrichedToolMetadata> = {};
    for (const row of rows) {
      const md = svc.toMetadata(row);
      map[md.slug] = md;
    }
    enrichedToolsCache = { fetchedAt: now, map };
    return map;
  } catch (err: any) {
    logger.warn(
      { err: err?.message ?? String(err) },
      '[chat] EnrichedTool registry load failed — falling back to empty map',
    );
    enrichedToolsCache = { fetchedAt: now, map: {} };
    return enrichedToolsCache.map;
  }
}

/** Test-only: clear the in-memory cache so unit tests start fresh. */
export function _resetEnrichedToolsCacheForTests(): void {
  enrichedToolsCache = null;
}

/**
 * Build the V3 sub-agent dispatch adapter.
 *
 * Maps the chatLoop's `runSubagent(spec, parentCtx)` signature into an
 * `OpenAgenticProxyClient.executeAgent(...)` call. The adapter:
 *
 *   - Constructs the OpenAgenticProxyClient lazily on first dispatch (so
 *     module load doesn't crash when env vars are missing — unit tests
 *     can call runChat directly without bootstrapping).
 *   - Pulls `OPENAGENTIC_PROXY_URL` (default in-cluster service URL) and
 *     `OPENAGENTIC_PROXY_INTERNAL_KEY` (no default — fail-CLOSED) from env.
 *   - Forwards the parent's userId / sessionId / OBO tokens so the
 *     sub-agent's downstream MCP fanouts authenticate AS the user.
 *   - Uses `parentCtx.toolUseId` (set by chatLoop's wrappedDispatch) as
 *     the correlation id when present; otherwise generates a fresh
 *     UUID. Either way the proxy gets a stable per-dispatch id.
 *   - Surfaces proxy failures as `{ ok: false, error }` so the chat
 *     loop's Task tool returns a structured failure to the model.
 *
 * Spec §7: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md
 */
function makeOpenAgenticProxyRunSubagent(
  ctx: RunCtx,
): (spec: SubagentSpec, parentCtx?: any) => Promise<SubagentRunResult> {
  let cachedClient: OpenAgenticProxyClient | null = null;
  let cachedClientErr: Error | null = null;

  const getClient = (): OpenAgenticProxyClient | null => {
    if (cachedClient) return cachedClient;
    if (cachedClientErr) return null;
    const baseUrl =
      process.env.OPENAGENTIC_PROXY_URL ||
      'http://openagentic-openagentic-proxy:3300';
    const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY ?? '';
    try {
      cachedClient = new OpenAgenticProxyClient({
        baseUrl,
        internalKey,
        logger: ctx.logger,
      });
      return cachedClient;
    } catch (err: any) {
      cachedClientErr = err;
      ctx.logger.warn(
        { err: err?.message ?? String(err) },
        '[chat] OpenAgenticProxyClient construction failed — sub-agent dispatch unavailable. ' +
        'Verify OPENAGENTIC_PROXY_INTERNAL_KEY is set to the production secret (NOT a dev-secret literal).',
      );
      return null;
    }
  };

  return async (spec, parentCtx) => {
    const startedAt = Date.now();
    const client = getClient();
    if (!client) {
      return {
        ok: false,
        error:
          'OpenAgenticProxyClient unavailable — chatmode sub-agent dispatch is not wired. ' +
          'Set OPENAGENTIC_PROXY_INTERNAL_KEY to the production secret.',
        turns: 0,
        tokens: 0,
        durationMs: Date.now() - startedAt,
        toolsUsed: [],
      };
    }

    // Parent identity preference order:
    //   1. parentCtx (per-tool-dispatch ctx, may carry tool_use_id)
    //   2. enclosing chatLoop ctx
    const userId = parentCtx?.userId ?? ctx.userId ?? spec.parentUserId ?? '';
    const sessionId = parentCtx?.sessionId ?? ctx.sessionId ?? spec.parentSessionId ?? '';
    const parentToolUseId =
      parentCtx?.toolUseId ??
      // Falls back to a stable per-call id so the proxy always has a
      // correlation key even when the chatLoop hasn't plumbed tool_use_id
      // through dispatchCtx yet.
      `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // OBO tokens — prefer the V3 ctx.user surface that the chat path
    // hydrates from request auth; fall back to parentCtx.user when set
    // (some test paths inject directly).
    const userObj = parentCtx?.user ?? ctx.user ?? {};
    const userToken = userObj?.accessToken ?? userObj?.userToken ?? undefined;
    const userIdToken = userObj?.idToken ?? userObj?.userIdToken ?? undefined;

    let result: OpenAgenticProxyExecuteResult;
    try {
      result = await client.executeAgent({
        userId,
        sessionId,
        parentToolUseId,
        agentName: spec.role,
        task: spec.prompt,
        userToken,
        userIdToken,
      });
    } catch (err: any) {
      ctx.logger.error(
        { err: err?.message ?? String(err), role: spec.role },
        '[chat] OpenAgenticProxyClient.executeAgent threw — surfacing as sub-agent failure',
      );
      return {
        ok: false,
        error: err?.message ?? String(err),
        turns: 0,
        tokens: 0,
        durationMs: Date.now() - startedAt,
        toolsUsed: [],
      };
    }

    return {
      ok: result.ok,
      output: result.output ?? '',
      error: result.error,
      // V3 doesn't track turns separately (the proxy handles its own
      // ReAct loop) — surface a single-turn marker so the UI's
      // SubAgentCard renders correctly.
      turns: result.ok ? 1 : 0,
      tokens: result.tokens ?? 0,
      durationMs: result.durationMs ?? Date.now() - startedAt,
      toolsUsed: result.toolsUsed ?? [],
    };
  };
}

/**
 * Chat pipeline entry point. `stream.handler.ts` dispatches every chat
 * turn through this function; deps + input are built per-request from
 * `buildChatV2Deps` (legacy name, slated for rename) + the request body.
 */
export async function runChat(
  ctx: RunCtx,
  input: RunChatInput,
  deps: RunChatDeps & {
    /** Optional risk classifier; defaults to a conservative MEDIUM-everything stub. */
    classifier?: RiskClassifier;
    /**
     * Phase 8 — ContextManagementService for pre-loop + mid-loop compaction.
     * When omitted, defaults to the production singleton. Tests inject a
     * stub to avoid booting Prisma. Spec §4.4.
     */
    contextMgmt?: ContextMgmtLike;
    // F0-2 (2026-05-12 audit): handoffDecision dep REMOVED. Phase E.1
    // intent-classifier rip (2026-05-10) deleted the only signal that
    // drove the handoff decision; the call path went dead. The emit
    // function had zero call sites. Ripped per the queued follow-up.
  },
): Promise<ChatLoopResult> {
  // Phase 12 — whole-turn timing seam. Captured at function entry so
  // chatTurnDuration covers everything (compaction → memory → handoff
  // → composer → chatLoop). Resolved in a finally block at the end
  // (see chatLoop wrap below).
  const v3TurnStartedAt = Date.now();
  // Phase C.6 — surface the user's Azure AD ACCESS token via the typed
  // ctx.userJwt accessor so OBO-aware dispatchers (synth, future tools)
  // don't have to sniff ctx.user shape. extractUserJwt explicitly refuses
  // idToken to prevent silent 401s at ARM/STS downstream. Set on the
  // existing ctx so all sub-paths (chatLoop, dispatchTool, hooks) see it.
  ctx.userJwt = extractUserJwt(ctx.user);
  // Phase 8 — pre-loop compaction trigger. BEFORE building the system
  // prompt or invoking chatLoop, consult the ContextManagementService.
  // When `usagePercentage >= 65` (soft threshold), call compactContext()
  // so the chat-loop's first provider call sees a smaller buffer.
  //
  // Design notes:
  //   - Skips entirely when sessionId is missing (stateless / test paths).
  //   - Best-effort — failures are logged + swallowed; the user's turn
  //     still runs. Compaction is a perf/UX optimisation, not a gate.
  //   - Threshold check is the percentage, not `needsCompaction`. The
  //     ContextManagementService's `needsCompaction` flag flips at 70/85/95
  //     (light/medium/aggressive); V3's pre-loop fires earlier (65 SOFT)
  //     so the percentage is the gate.
  //   - Awaited (not fire-and-forget) so chatLoop sees post-compaction state.
  //
  // Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §4.4
  const ctxMgmt: ContextMgmtLike = (deps as any).contextMgmt ?? contextManagementService;
  if (ctx.sessionId) {
    try {
      const usage = await ctxMgmt.getContextUsage(ctx.sessionId, input.model);
      if (usage.usagePercentage >= 65) {
        ctx.logger.info(
          {
            sessionId: ctx.sessionId,
            usagePercentage: usage.usagePercentage,
            currentTokens: usage.currentTokens,
            maxTokens: usage.maxTokens,
            model: input.model,
          },
          '[chat] pre-loop compaction triggered (>=65% soft threshold)',
        );
        // Phase 12 — pre-loop compaction trigger metric.
        safeIncCounter(v3Metrics.compactionTriggers, { trigger_point: 'preloop' });
        const result = await ctxMgmt.compactContext(ctx.sessionId, input.model);
        if (typeof result?.tokensFreed === 'number') {
          safeObserveHistogram(v3Metrics.compactionTokensFreed, result.tokensFreed);
        }
        ctx.logger.info(
          {
            sessionId: ctx.sessionId,
            tokensFreed: result?.tokensFreed,
            messagesRemoved: result?.messagesRemoved,
          },
          '[chat] pre-loop compaction complete',
        );
      }
    } catch (err: any) {
      ctx.logger.warn(
        { err: err?.message ?? String(err), sessionId: ctx.sessionId },
        '[chat] pre-loop compaction failed (non-fatal — chatLoop continues)',
      );
    }
  }

  // F0-2 (2026-05-12 audit): Phase 10 TFC handoff_offer code path REMOVED.
  // `emitHandoffIfNeeded` was defined but had zero call sites after the
  // Phase E.1 intent-classifier rip (2026-05-10) deleted the only signal
  // that drove it. Pinned by no-handoff-offer.source-regression.test.ts.

  // Phase E.1 (2026-05-10) — pre-loop intent classification REMOVED.
  // Spec §50: model decides; handoff offers no longer driven by a
  // pre-LLM intent label. Model can self-signal incapability via
  // request_clarification or it just answers.

  // Phase E.7 (2026-05-10) — `audience` variable + audienceRoutes metric
  // RIPPED. Role discrimination at chat time is done purely via the
  // system-prompt file selector (chat-system-{admin,member}.md); a
  // separate audience string adds no information beyond `isAdmin`.
  const isAdmin: boolean =
    (ctx as any)?.user?.isAdmin === true ||
    (input as any)?.user?.isAdmin === true ||
    false;
  ctx.logger.info(
    {
      isAdmin,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
    },
    '[chat] RBAC role selected',
  );

  // 1. Task tool description — live agent registry.
  const agents = await deps.listAgents();
  const taskToolDescription = await buildTaskToolDescription(agents);

  // 2. Tool array — meta-tools ONLY on turn 1.
  //
  // Per Plan §Tool Catalog Strategy: ship the 9 meta-tools (~3k tokens)
  // and let the model invoke `tool_search` to pull in the right MCP
  // candidates as it needs them. Discovery results land via the
  // chatLoop's `acceptDiscovered` side-channel and become available on
  // the next turn.
  //
  // RIPPED 2026-05-08: previously this passed `input.mcpTools` (the full
  // MCP catalog, ~270-340 entries) into buildChatToolArray. That undid
  // the 2026-04-30 cascade-rip migration and caused the model to
  // keyword-match across hundreds of tool descriptions instead of doing
  // semantic discovery. Live evidence: turn-1 toolCount=342 with meta=6,
  // azure=74, aws=67, gcp=56, k8s=33, admin_system=18, other=88. Model
  // never narrowed because the catalog was already in front of it.
  //
  // Contract: meta-only at turn 1. tool_search is in the meta catalog;
  // model invokes it; discoveryHook expands `tools` for turn N+1.
  //
  // ORDER NOTE (Task 5, 2026-05-11): tool array is built BEFORE the
  // system prompt so the same array can be threaded into
  // getSystemPromptForRole(deps.tools). The dynamic <tool-catalog>
  // section + the static discovery-flow bullets read enabledTools off
  // that array; without the wire-in the catalog section renders empty.
  const tools = await buildChatToolArray({
    mcpTools: [],
    taskToolDescription,
    // #843 (2026-05-14) — gate the Task sub-agent dispatcher on the
    // dispatching model's structural capability. Small/cheap models
    // physically don't see Task; they call MCP tools directly.
    selectedModel: input.model,
  });

  // 3. System prompt — rev-2 RBAC path (the only path now).
  //
  // Spec (`docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md`):
  // load `prompts/chat-system-{admin,member}.md`, append <session-facts>
  // + <memories> via plain functions. No DB composer, no intent
  // classifier, no audience filter, no priority sort. Total system
  // prompt ≤ 5000 tokens (Claude Code budget). Legacy static + sidecar
  // composer + DB-module prompt assembler torn down in Phase E.3.
  const role = isAdmin ? 'admin' : 'member';
  const memSvc = getAgentMemoryService();
  // Sprint W (2026-05-19): USE_DB_PROMPT env-gate ripped. rbacService is
  // ALWAYS the primary source when present on AppContext (set by startup
  // step 09). Falls through to disk .md file only on DB failure.
  // Admins edit prompts at /admin#rbac-system-prompts; changes propagate
  // LIVE via redis pubsub `prompt:invalidate` without a container rebuild.
  const rbacService = (ctx as any)?.app?.rbacSystemPromptService
    ?? (ctx as any)?.deps?.rbacSystemPromptService;

  const systemPrompt: string = await getSystemPromptForRole(role, {
    userId: ctx.userId ?? '',
    sessionId: ctx.sessionId ?? '',
    tenantId: (ctx as any)?.user?.tenantId ?? '',
    modelInUse: input.model,
    userMessage: input.userMessage,
    priorTurnCount: (input.priorMessages ?? []).length,
  }, {
    // Memory.3 (2026-05-19) — semantic recall path: pass userMessage so
    // AgentMemoryService routes to Milvus embedding-based top-K rather than
    // the old `key LIKE %userMessage%` substring match. The param name `key`
    // is preserved for backwards compat with the caller (getSystemPromptForRole)
    // which passes input.userMessage as this argument.
    memoryRecall: async (userId, key) => {
      const hits = await memSvc.recall(userId, { userMessage: key, limit: 5 });
      return hits.map((h: any) => ({
        key: h.key,
        value: h.value,
        category: h.category,
        confidence: h.confidence,
      }));
    },
    rbacService,
    // Task 5 (2026-05-11) — thread the live tool array into the prompt
    // composer so the dynamic <tool-catalog> block lists exactly what
    // the model has on this turn AND the static discovery-flow section
    // gates its tool-name-anchored bullets on enabledTools.has(X). Same
    // array reference passed to provider.createCompletion below.
    tools,
    // #790 (2026-05-13) — global READ-ONLY platform toggle. When ON,
    // the composer appends a <read-only-mode> notice so the model
    // knows write tool_calls will be rejected at the platform level
    // (otherwise it happily emits mutations the PermissionService
    // deny-overrides at evaluate() time, burning turns).
    readOnlyMode: getPermissionService(ctx.logger as any).getReadOnlyMode(),
  });

  // P1 #940 (2026-05-18) — grounding T1 system-prompt addendum.
  // The chat-input-toolbar's SearchCheck toggle flips
  // useGroundingStore.enabled, the UI forwards it as
  // `groundingEnabled` on the chat request body. When ON, append a
  // one-line instruction so the model invokes the existing web_search
  // MCP tool to verify factual claims and emits a final verdict line
  // ("Verified by web (N sources):" / "Mixed:" / "Refuted:"). No new
  // tool needed — leverages the MCP catalog already present on the turn.
  // The UI's MessageBubble matches the verdict-line shape and renders a
  // grounding chip below the final synthesis.
  const groundedSystemPrompt: string = input.groundingEnabled === true
    ? `${systemPrompt}\n\n<grounding-mode>\nThe user enabled GROUNDING for this turn. Before sending your final answer:\n1. Identify the 1-3 most load-bearing factual claims in your response (dates, version numbers, statistics, named events, quotes, "current" / "latest" / "top" / "best" claims).\n2. Invoke the \`web_search\` tool with a precise query for each claim.\n3. Synthesize the answer using the search results as the source of truth — correct any drift between your priors and the live web.\n4. End your final assistant message with EXACTLY TWO contiguous closing lines, in this order:\n   (a) A one-sentence verdict claim on a line of its own, prefixed \`Verdict:\` — this is the load-bearing factual summary the chip surfaces to the user. Keep it to ONE sentence (no paragraphs, no bullet lists). It must be a declarative statement of what the web actually said, NOT a meta-comment on the verification process.\n   (b) IMMEDIATELY BELOW the Verdict line, a single \`Grounding:\` status line in EXACTLY this shape:\n      \`Grounding: verified by web (N sources)\` — if every checked claim matched\n      \`Grounding: mixed (N sources, M counterpoints)\` — if at least one claim was contradicted\n      \`Grounding: refuted (N sources)\` — if the web disagreed with most claims\n      \`Grounding: insufficient (no authoritative source found)\` — if web_search returned thin or off-topic results\n   The Verdict line MUST be on its own line ABOVE the Grounding status line. Do not paraphrase the schema.\n   Worked example (follow this shape verbatim):\n   \`\`\`\n   Verdict: OAuth 2.0 is the current authorization framework defined by RFC 6749 and is still in active use across major identity providers in 2026.\n   Grounding: verified by web (3 sources)\n   \`\`\`\n5. IMMEDIATELY AFTER the Grounding status line, emit a single \`<grounding-sources>\` JSON block listing the URLs you actually relied on, in the order you used them. Schema:\n   \`<grounding-sources>[\n     {"url": "https://example.com/page", "title": "Short human-readable label"},\n     ...\n   ]</grounding-sources>\`\n   - \`url\` MUST be an http(s) URL pulled from a \`web_search\` tool result. Never fabricate URLs.\n   - \`title\` SHOULD be a concise label (≤80 chars) drawn from the search result's title or page name.\n   - Include ONE entry per source you cited in the verdict count. If you said "3 sources", emit exactly 3 entries.\n   - When the verdict is \`insufficient\` (no usable sources), emit an empty array: \`<grounding-sources>[]</grounding-sources>\`.\n   - Do NOT include any commentary, code fences, or markdown inside the block — raw JSON only.\n</grounding-mode>`
    : systemPrompt;

  ctx.logger.info(
    {
      role,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      promptChars: groundedSystemPrompt.length,
      promptTokensEst: Math.ceil(groundedSystemPrompt.length / 4),
      groundingEnabled: input.groundingEnabled === true,
    },
    '[chat] RBAC system prompt composed',
  );

  // 4. Concurrency-safe set — meta-tools static + MCP via classifier.
  // Sev-1 (2026-05-12) — default classifier now wraps PermissionService
  // singleton so `azure_list_*` / `*_get_*` / `*_describe_*` get
  // 'allow' → parallel-safe. Previously every MCP tool fell to 'ask'
  // (serial), defeating concurrency. Pinned by
  // concurrency-safety-classification.test.ts.
  const classifier = deps.classifier ?? makeDefaultClassifier(ctx.logger as any);
  const concurrencySafeNames = computeConcurrencySafeNames(tools, classifier);

  // 5. Prior messages + user message (with attachment hydration).
  //
  // Phase 7 — `<session-facts>` injection. On the FIRST chat-loop turn
  // (priorMessages empty / no prior session-facts), prepend a compact
  // ambient-context block ABOVE the user's actual message. The block
  // gives the model ground truth for things it otherwise hallucinates
  // (current ISO timestamp, user role, tenant, session id, model in use).
  //
  // Implementation note: the chatLoop appends a SECOND user message on
  // synthesis-retry turns (V3 chatLoop.ts:240) — that's a different
  // intra-turn sequencing concern, not a fresh session. The session-facts
  // block fires only when `priorMessages` is empty (turn 1). Subsequent
  // chat-stream turns within the same session also re-fire because
  // priorMessages will already include them; the contract is "once per
  // chatLoop invocation," not "once per session" — refresh is the desired
  // behavior so the timestamp / model in use stay current.
  const factsBuilder = new SessionFactsBuilder();
  const userRole: 'admin' | 'member' = isAdmin ? 'admin' : 'member';
  const sessionFactsBlock = factsBuilder.render(
    factsBuilder.build({
      userId: ctx.userId ?? '',
      userRole,
      tenantId: (ctx as any)?.user?.tenantId ?? '',
      sessionId: ctx.sessionId ?? '',
      priorTurnCount: (input.priorMessages ?? []).length,
      modelInUse: input.model,
    }),
  );

  // Phase 9 — memory injection. Pull persistent memories for this user
  // keyed by the first-turn message; render a `<memories>` block above the
  // session-facts block. Best-effort — failures are swallowed so the turn
  // still runs. Budget-capped at 2KB to keep the prompt lean.
  let memoriesBlock = '';
  try {
    const memSvc = getAgentMemoryService();
    const recallLimit = 5; // hard upper bound — block budget caps further
    // Memory.3 (2026-05-19) — semantic recall path: userMessage embedding
    // via Milvus top-K instead of old `key LIKE %input.userMessage%` substring
    // match. Fixes "Van said sub id is X, later asks — model says I don't know."
    const hits = await memSvc.recall(ctx.userId ?? 'anonymous', {
      userMessage: input.userMessage,
      limit: recallLimit,
    });
    // Phase 12 — memory injection metric: outcome hit|miss + per-turn hit count.
    safeIncCounter(v3Metrics.memoryInjection, {
      outcome: hits.length > 0 ? 'hit' : 'miss',
    });
    safeObserveHistogram(v3Metrics.memorySearchHits, hits.length);
    if (hits.length > 0) {
      memoriesBlock = renderMemoriesBlock(hits);
      if (memoriesBlock) {
        ctx.logger.info(
          {
            sessionId: ctx.sessionId,
            userId: ctx.userId,
            hitCount: hits.length,
            blockBytes: Buffer.byteLength(memoriesBlock, 'utf8'),
          },
          '[chat] memory injection — prepending <memories> block to first-turn user message',
        );
      }
    }
  } catch (err: any) {
    ctx.logger.warn(
      { err: err?.message ?? String(err), sessionId: ctx.sessionId },
      '[chat] memory injection failed — continuing without <memories> block',
    );
  }

  const hydratedUser = await buildUserMessageContent(input.userMessage, input.attachments);
  // For string content, prepend the facts block to the same user message
  // (single user role message keeps the OAI normalizer happy and avoids
  // emitting two adjacent user roles to providers that re-glue them).
  // For array (multimodal) content, prepend a text block in front so the
  // attachments' image_url / file blocks remain after the facts.
  //
  // Phase 9 — memoriesBlock prepended ABOVE sessionFactsBlock when present:
  //   <memories>...</memories>\n\n<session-facts>...</session-facts>\n\n{user}
  const ambientBlock = memoriesBlock
    ? `${memoriesBlock}\n\n${sessionFactsBlock}`
    : sessionFactsBlock;
  let userContent: any;
  if (typeof hydratedUser === 'string') {
    userContent = `${ambientBlock}\n\n${hydratedUser}`;
  } else if (Array.isArray(hydratedUser)) {
    userContent = [{ type: 'text', text: ambientBlock }, ...hydratedUser];
  } else {
    userContent = hydratedUser;
  }

  const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }> = [
    ...(input.priorMessages ?? []),
    {
      role: 'user',
      content: userContent,
    },
  ];

  // Phase 6 — openagentic-proxy sub-agent dispatch.
  //
  // Every Task-tool dispatch crosses the api → openagentic-proxy HTTP boundary
  // so the sub-agent's ReAct loop runs in the dedicated proxy service.
  // The default `deps.runSubagent` (from buildChatV2Deps — recursor-backed
  // post Phase E.8.g+h) is OVERWRITTEN here, not preserved as a fallback.
  // Half-states are forbidden per `feedback_best_long_term_no_shortcuts.md`.
  //
  // Construction is fail-CLOSED: when `OPENAGENTIC_PROXY_INTERNAL_KEY` is unset
  // OR is a dev-secret literal, the OpenAgenticProxyClient constructor throws.
  // The adapter swallows the throw at first call (since unit tests can
  // call runChat directly without setting env) and returns a structured
  // sub-agent failure result so the loop continues cleanly. In production
  // the helm chart projects the real key from External Secrets at boot.
  const proxyRunSubagent: (
    spec: SubagentSpec,
    parentCtx?: any,
  ) => Promise<SubagentRunResult> = makeOpenAgenticProxyRunSubagent(ctx);

  // 6. ChatPipelineDeps for dispatchChatToolCall (the V2 surface V3 reuses).
  const v2Deps: ChatPipelineDeps = {
    executeComposeVisual,
    executeComposeApp,
    executeRenderArtifact,
    executeTask: executeTask as any,
    executeRequestClarification,
    executeBrowserSandbox: deps.executeBrowserSandbox ?? defaultExecuteBrowserSandbox,
    executeMemorize,
    executeMcpTool: deps.executeMcpTool,
    listSubagentTypes: deps.listAgents,
    runSubagent: proxyRunSubagent,
    // A2 (2026-05-12) — forward optional sub-agent trace store so
    // dispatchChatToolCall's Task arm threads it into TaskDeps and
    // executeTask returns `trace_handle` on the result.
    traceStore: (deps as RunChatDeps).traceStore,
    // F2 (2026-05-12) — OTel GenAI tracer so makeDispatch wraps each
    // tool call (execute_tool / invoke_agent spans, prom mirrors).
    genAITracer: (deps as RunChatDeps).genAITracer,
  };

  // 7. EnrichedTool registry — Phase 5. Drives per-tool outputTemplate +
  // truncate_summary in the envelope splitter. Lazy-loaded + 60s cached;
  // admin edits propagate to the next chat turn after TTL.
  const enrichedTools = await loadEnrichedToolsMap(deps.prismaLike, ctx.logger);
  // Convert to the dispatch-tool entry shape (drops `slug` field — keys carry it).
  const enrichedToolsForDispatch: Record<string, { outputTemplate?: string; truncate_summary?: any }> = {};
  for (const [slug, md] of Object.entries(enrichedTools)) {
    enrichedToolsForDispatch[slug] = {
      outputTemplate: md.outputTemplate,
      truncate_summary: md.truncate_summary,
    };
  }

  // 8. ChatLoop deps — streaming provider + dispatch.
  //
  // Phase C.5 (2026-05-11) — propagate the CredentialBroker through to the
  // dispatch layer so the `synth` arm can broker cloud capabilities on
  // behalf of the calling user. When deps.synthCredentialBroker is unset
  // (unit tests / mis-wired plugin), the synth arm returns a structured
  // ok:false at dispatch time — no production crash, just a clear hint to
  // wire the broker.
  const v3DispatchDeps: V3DispatchDeps = {
    v2Deps,
    enrichedTools: enrichedToolsForDispatch,
    synthCredentialBroker: (deps as RunChatDeps).synthCredentialBroker,
    // 2026-05-11 — thread LargeResultStorage + thresholdBytes through to
    // the dispatch layer so ToolEnvelopeSplitter offloads enterprise-scale
    // tool results to Redis (with `_meta.artifactHandle` for paged
    // retrieval via `read_large_result`) instead of inlining multi-MB
    // payloads that blow up the model context window.
    largeResultStorage: deps.largeResultStorage,
    thresholdBytes: deps.thresholdBytes,
  };
  const loopInput: ChatLoopInput = {
    userMessage: input.userMessage, // already in messages[]; chatLoop uses it for logging only
    priorMessages: messages.slice(0, -1), // exclude the last user message; chatLoop appends it
    systemPrompt: groundedSystemPrompt,
    tools,
    model: input.model,
    // Admin-tunable cap, threaded from stream.handler via
    // ChatLoopConfigService.getMaxTurns(). chatLoop throws if this is
    // not a positive integer.
    maxTurns: input.maxTurns,
    concurrencySafeNames,
    // Z.ET (2026-05-19) — thread the per-turn extended thinking toggle
    // into chatLoop so it reaches ProviderRequest → AnthropicProvider.
    extendedThinkingEnabled: input.extendedThinkingEnabled,
  };
  // Patch: the chatLoop appends `userMessage` to messages itself, but we already
  // hydrated multimodal attachments via buildUserMessageContent. Replace the
  // chatLoop's append-user-message step by passing priorMessages = messages
  // (with the user msg already in) and sending an empty userMessage.
  const loopInputWithFullPrior: ChatLoopInput = {
    ...loopInput,
    priorMessages: messages,
    userMessage: '',
  };
  // Phase 3 / Phase D.1 (2026-05-11) — wire the HookRunner.
  //
  // Precedence:
  //   1. `deps.hooks` — set by `buildChatV2Deps` per-tenant / per-request
  //      (default: the process singleton initialized at startup with DLP /
  //      HITL / audit / cost / sequencer built-ins; test paths can override
  //      via opts.hooks).
  //   2. `getHookRunner()` — defensive fallback for callers that build a
  //      deps struct without going through buildChatV2Deps (codemode /
  //      probes / older test paths).
  //   3. `undefined` — fail-soft when neither is available (unit tests that
  //      never bootstrap startup). chatLoop runs without cross-cuts rather
  //      than crashing.
  //
  // Phase D.1 changed step 1 from "ignore deps.hooks; always use the
  // inline singleton" to "prefer deps.hooks." Before D.1, opts.hooks
  // overrides in `buildChatV2Deps` never reached chatLoop because runChat
  // overwrote `loopDeps.hooks` with the inline `getHookRunner()`.
  let hookRunner: any;
  if (deps.hooks) {
    hookRunner = deps.hooks;
  } else {
    try {
      hookRunner = getHookRunner();
    } catch (err) {
      ctx.logger.debug(
        { err: (err as Error).message },
        '[chat] HookRunner not initialized — running without DLP/HITL/audit cross-cuts (test path?)',
      );
      hookRunner = undefined;
    }
  }

  const loopDeps: ChatLoopDeps = {
    streamProvider: makeStreamProvider(deps.providerManager) as any,
    dispatch: makeDispatch(v3DispatchDeps),
    hooks: hookRunner,
    // Phase 8 — propagate the compaction service into chatLoop so the
    // mid-loop hook (after each tool_results push) can fire compactContext
    // at the 85% HARD threshold. Same instance used for the pre-loop check.
    contextMgmt: ctxMgmt,
    // F2 (2026-05-12) — forward OTel GenAI tracer so chatLoop opens a
    // chat span per turn (and prom mirror increments gen_ai_chat_turns_total).
    genAITracer: (deps as RunChatDeps).genAITracer,
    // F2-followup (2026-05-12) — forward streaming-chat metrics emitter
    // so TTFT / TPOT / operation_duration / token_usage / finish_reasons
    // histograms populate on /metrics.
    recordCompletionMetrics: (deps as RunChatDeps).recordCompletionMetrics,
    // Phase E.1 (2026-05-10) — onMidLoopHandoffTrigger callback REMOVED.
    // Spec §50: model decides; pre-LLM classifier is gone so the
    // mid-loop handoff path has no intent signal to drive a decision.
    // handoffDecision dep still wired but unreferenced.
  };

  // Phase E.1 — intent classifier RIPPED. The turnIntent label is
  // now always 'unknown' (telemetry metrics still get a label slot).
  const turnIntent = 'unknown';
  safeIncCounter(v3Metrics.modelRoutes, { model: input.model, intent: turnIntent });
  try {
    const result = await chatLoop(ctx, loopInputWithFullPrior, loopDeps);
    safeIncCounter(v3Metrics.chatTurns, {
      intent: turnIntent,
      model: input.model,
    });
    safeObserveHistogram(
      v3Metrics.chatTurnDuration,
      { intent: turnIntent },
      (Date.now() - v3TurnStartedAt) / 1000,
    );
    return result;
  } catch (err) {
    // Still record duration on failure so the dashboard sees the bad turn.
    safeIncCounter(v3Metrics.chatTurns, {
      intent: turnIntent,
      model: input.model,
    });
    safeObserveHistogram(
      v3Metrics.chatTurnDuration,
      { intent: turnIntent },
      (Date.now() - v3TurnStartedAt) / 1000,
    );
    throw err;
  }
}
