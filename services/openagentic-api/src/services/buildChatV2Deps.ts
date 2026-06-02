/**
 * buildChatV2Deps — assemble the `RunChatDeps` factory used by the
 * chatmode V2 pipeline. Called once at chatPlugin init; the resulting
 * struct is shared across every chat-stream request.
 *
 * Wire-up:
 *  - executeMemorize / executeRenderArtifact / executeComposeVisual /
 *    executeTask / executeRequestClarification — already pure modules in
 *    `services/`. We re-export them via the deps struct so the V2 dispatcher
 *    can DI-mock them in tests.
 *  - executeBrowserSandbox — wraps the existing BrowserSandboxExecTool.
 *  - executeMcpTool — fall-through path for every MCP tool. Calls
 *    MCPProxyClient (the existing mcp-proxy bridge) by tool name. The
 *    helper accepts `(ctx, name, input)` so the V2 dispatcher's signature
 *    is generic.
 *  - listAgents — returns the built-in agent set. Reads from
 *    BuiltInAgentRegistry's process-lifetime cache (initialized at api
 *    startup via 12-agent-registry.ts).
 *  - runSubagent — dispatches sub-agents via `chatLoopRecursor` (a child
 *    chatLoop turn). The legacy in-api orchestrator wiring was ripped in
 *    Phase E.8.g+h (2026-05-11); the recursor is now the only path.
 *  - prismaLike — the real Prisma client so the system-prompt assembler can read
 *    admin-edited section bodies from `prompt_modules`.
 *  - chatStorage (Wave 5) — when supplied, three persistence callbacks are
 *    surfaced for the stream handler to call directly:
 *      * `loadPriorMessages(sessionId, userId)` — wraps `getMessages` and
 *        translates rows to the V2 message shape.
 *      * `persistUserMessage(sessionId, content, opts)` — wraps `addMessage`
 *        with `role: 'user'`. Called BEFORE invoking V2.
 *      * `persistAssistantMessage(sessionId, content, opts)` — wraps
 *        `addMessage` with `role: 'assistant'` + model + tokenUsage. Called
 *        AFTER `assistant_message_stop`.
 *    All three swallow errors so a transient db blip never breaks the live
 *    wire — V1 used the same fail-open pattern.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §177-183, §272-302.
 */

import { executeMemorize } from './MemorizeTool.js';
import { executeRenderArtifact } from './RenderArtifactTool.js';
import { executeComposeVisual } from './ComposeVisualTool.js';
import { executeRequestClarification } from './RequestClarificationTool.js';
import { executeBrowserSandbox } from './BrowserSandboxExecTool.js';
import { executeTask } from './TaskTool.js';
import { autoEmitStreamingTable } from './autoEmitStreamingTable.js';
import { resolveMcpToolName } from './mcpToolNameResolver.js';
import { prisma } from '../utils/prisma.js';

/**
 * Phase F-tel-3 (2026-05-07): chat-side MCP tool telemetry.
 *
 * Both `makeExecuteMcpTool` (chat-v2 by-id route) and the registered-name
 * route inside this file POST to `${MCP_PROXY_URL}/mcp/tool`. Neither
 * surface wrote to the `mcp_usage` table — only the legacy in-api
 * orchestrator path (via MCPProxyClient.callTool, instrumented at 2c128ab8)
 * recorded usage. As a result, the dashboard MCP donut + per-server
 * CostTab stayed empty even when chat sessions executed dozens of tools
 * per turn.
 *
 * This helper records every chat-v2 tool dispatch to mcp_usage so the
 * admin dashboard rings light up from chat traffic too. Best-effort —
 * never fails the call on telemetry write error.
 */
async function recordChatMcpUsage(args: {
  ctx: any;
  toolName: string;
  input: unknown;
  ok: boolean;
  error?: string;
  startedAt: number;
}): Promise<void> {
  try {
    await prisma.mCPUsage.create({
      data: {
        user_id: String(args.ctx?.userId ?? args.ctx?.user?.id ?? 'system'),
        user_email: args.ctx?.user?.email ?? null,
        user_name: args.ctx?.user?.name ?? null,
        server_name: null, // chat-v2 routes by tool name; server resolved at proxy
        tool_name: args.toolName,
        method: 'tools/call',
        execution_time_ms: Date.now() - args.startedAt,
        success: args.ok,
        error_message: args.error ?? null,
        request_metadata: (args.input ?? {}) as any,
      },
    });
  } catch {
    // Best-effort — telemetry must never break a tool call
  }
}
// Phase E.8.g+h (2026-05-11) — chatLoopRecursor-backed sub-agent dispatch
// is the only path. The legacy in-api orchestrator class + its
// `makeRunSubagent` wrapper were ripped in this slice.
import {
  makeRunSubagentViaRecursorPerCall,
  type RecursorAgentLookupEntry,
} from './makeRunSubagentViaRecursor.js';
// Sub-agents discover tools by name via `tool_search` mid-turn. The
// parent's meta-tool surface (Task, compose_visual, render_artifact,
// request_clarification, browser_sandbox_exec, memorize, tool_search,
// agent_search) is materialized inside the recursor's child chatLoop turn
// via the same `getAllBaseTools()` registry — see chatLoopRecursor /
// makeRunSubagentViaRecursor for that path.

/**
 * Phase 31 — wrap a sub-agent's MCP executor with a post-success
 * streaming_table auto-emit hook. Every list-shaped tool result fires
 * a frame on parentCtx.emit; non-list results pass through unchanged.
 *
 * Exported for unit tests (buildChatV2Deps.autoTable.test.ts) without
 * needing the full deps factory.
 */
export function wrapWithAutoTableEmit(
  ctx: { emit?: (frameType: string, payload: unknown) => void } | null | undefined,
  inner: (toolName: string, input: unknown) =>
    Promise<{ ok: boolean; output?: string; error?: string }>,
) {
  return async (
    toolName: string,
    input: unknown,
  ): Promise<{ ok: boolean; output?: string; error?: string }> => {
    const r = await inner(toolName, input);
    // ALWAYS log invocation to trace the wrapper is firing (debug #32).
    try {
      const ctxAny = ctx as any;
      ctxAny?.logger?.info?.(
        {
          toolName,
          ok: r.ok,
          hasEmit: typeof ctx?.emit === 'function',
          outputType: typeof r.output,
          outputLen: typeof r.output === 'string' ? r.output.length : 0,
          outputPreview: typeof r.output === 'string' ? r.output.slice(0, 200) : null,
        },
        '[wrapWithAutoTableEmit] ENTRY',
      );
    } catch { /* noop */ }
    if (r.ok && typeof ctx?.emit === 'function') {
      try {
        const emitted = autoEmitStreamingTable({
          toolCallId: `${toolName}-${Date.now().toString(36)}`,
          toolName,
          result: r.output,
          write: (frame) => ctx.emit!(frame.type, frame),
        });
        try {
          const ctxAny = ctx as any;
          ctxAny?.logger?.info?.(
            { toolName, emitted },
            '[autoEmitStreamingTable] emit result',
          );
        } catch { /* noop */ }
      } catch (err) {
        try {
          const ctxAny = ctx as any;
          ctxAny?.logger?.warn?.({ toolName, err: String(err) }, '[autoEmitStreamingTable] threw');
        } catch { /* noop */ }
      }
    }
    return r;
  };
}
/**
 * 2026-05-20 — Wrap an MCP tool executor with the cross-user ToolResultCache.
 *
 * Cache-before:
 *   - Skip when `isUncacheableTool(name)` (weather / search / news / live).
 *   - Otherwise call `cache.searchCache(tenantId, name, input, queryText, userId, userGroups, isAdmin)`.
 *   - On a hit with similarity >= threshold AND RBAC pass, return the cached
 *     output WITHOUT calling the inner executor. Mark `_meta.cacheHit=true`
 *     on the structured-content object so the splitter forwards it to the UI.
 *
 * Cache-after:
 *   - Skip when `isUncacheableTool(name)`.
 *   - Skip when result is null/empty/error (ok:false or no output).
 *   - Otherwise fire-and-forget `cache.cacheResult(tenantId, userId, name, input, output, queryText)`
 *     with the `is_shared` flag derived via `shouldBeShared(name, resourceScope)`.
 *     The service's `cacheResult` already computes is_shared internally from
 *     extractResourceScope + getRequiredPermission, so we only need to pass
 *     the userId / tenantId / args / result — the cross-user flag is set
 *     atomically by the service.
 *
 * Failure handling: both seams are wrapped in try/catch and fail-open. A
 * cache miss / write failure NEVER blocks the dispatch — the inner executor
 * still runs and the result returns to the caller normally.
 *
 * Exported for unit tests (buildChatV2Deps.toolResultCache-deps.test.ts and
 * dispatchTool.cache-*.test.ts) without bootstrapping the full deps factory.
 *
 * 2026-05-20 PM — LAZY RESOLVER (#972 unstick).
 *
 * The `cache` argument may now be:
 *   - A concrete `ToolResultCacheLike` instance — captured immediately, used
 *     forever (legacy + test-injection path).
 *   - A resolver `() => ToolResultCacheLike | undefined | null` — invoked on
 *     EVERY call. This unsticks the live-deploy bug where buildChatV2Deps
 *     runs at pod startup BEFORE `getToolResultCacheService()` finishes its
 *     async init (Milvus collection + embedding client take ~2s). One-shot
 *     capture left `resolvedToolResultCache = undefined` for the pod
 *     lifecycle; the lazy resolver re-checks on each invocation and starts
 *     using the cache the moment init completes.
 *   - `undefined` / `null` — no wrap, inner executor returned verbatim.
 *
 * A one-time INFO log fires on the first call that successfully resolves
 * a live cache (post-init) — this is the prod-side proof that the lazy
 * path works.
 */

// Module-level flag so the "resolver returned live cache" log fires exactly
// once per pod lifetime. Multiple buildChatV2Deps() instances share the same
// observable, which matches operator intuition ("did the cache ever wake up?").
let __lazyResolverFirstHitLogged = false;

/**
 * Optional L1 (Redis exact-match) cache tier. Per-user, sub-ms latency,
 * read BEFORE the L2 semantic cache. See `RedisToolResultCacheL1.ts`.
 *
 * When `opts.l1Cache` is provided, the wrap does:
 *   1. L1.searchExact → hit → return immediately with _meta.cacheLayer:'L1'
 *   2. L2.searchCache → hit → write-through to L1 + return
 *   3. inner execute → on success: fire-and-forget BOTH L1.storeExact and L2.cacheResult
 *
 * When `opts.l1Cache` is absent/undefined, the wrap is byte-identical to the
 * pre-L1 L2-only behavior. Every L1 op is wrapped in try/catch — Redis
 * down or throwing falls through to L2 and inner, never propagates.
 */
export interface WrapOpts {
  /** Optional L1 Redis exact-match cache (per-user). */
  l1Cache?: { searchExact: (...args: any[]) => Promise<unknown | null>; storeExact: (...args: any[]) => Promise<boolean> } | null;
  /** L1 TTL override (seconds). Default 300. */
  l1TtlSeconds?: number;
}

export function wrapWithToolResultCache(
  cache: ToolResultCacheLike | (() => ToolResultCacheLike | undefined | null) | undefined | null,
  inner: (ctx: any, name: string, input: any) => Promise<{ ok: boolean; output?: unknown; error?: string }>,
  opts: WrapOpts = {},
): (ctx: any, name: string, input: any) => Promise<{ ok: boolean; output?: unknown; error?: string }> {
  const l1Cache = opts.l1Cache ?? null;
  const l1TtlSeconds = opts.l1TtlSeconds ?? 300;

  // No-op fast path: callers that explicitly disabled caching (null/undefined)
  // get the inner executor verbatim — zero overhead, identity-preserved so the
  // existing "wrapWithToolResultCache returns inner verbatim" test still pins.
  // Note: the identity-preservation only applies when BOTH L1 and L2 are absent.
  if ((cache === undefined || cache === null) && !l1Cache) return inner;

  // Decide once at wrap time whether the input is a resolver or a concrete
  // cache. Resolver path re-checks on every call; concrete path captures.
  const isResolver = typeof cache === 'function';

  return async (ctx, name, input) => {
    // Re-resolve per call when a resolver was passed. Captured-cache path
    // returns the same instance every time.
    const liveCache: ToolResultCacheLike | undefined | null = isResolver
      ? (cache as () => ToolResultCacheLike | undefined | null)()
      : (cache as ToolResultCacheLike);

    if (!liveCache && !l1Cache) {
      // Neither L1 nor L2 ready — fall through to inner, preserving the
      // pre-cache pipeline behavior.
      return inner(ctx, name, input);
    }

    // First-resolution observability — proves the lazy path works in prod.
    if (isResolver && !__lazyResolverFirstHitLogged) {
      __lazyResolverFirstHitLogged = true;
      try {
        ctx?.logger?.info?.(
          { toolName: name },
          '[ToolResultCache] resolver returned live cache on first call (post-init)',
        );
      } catch { /* noop */ }
    }

    const tenantId: string = String(ctx?.user?.tenantId ?? ctx?.tenantId ?? '');
    const userId: string = String(ctx?.userId ?? ctx?.user?.id ?? '');
    const userGroups: string[] = Array.isArray(ctx?.user?.groups) ? ctx.user.groups : [];
    const isAdmin: boolean = !!ctx?.user?.isAdmin;
    const queryText: string | undefined =
      typeof ctx?.userMessage === 'string'
        ? ctx.userMessage
        : (typeof ctx?.user?.lastMessage === 'string' ? ctx.user.lastMessage : undefined);

    // ─── L1 (Redis exact-match) cache-before ──────────────────────────
    // Per-user, sub-ms latency, read BEFORE L2 semantic. Same exact tool +
    // args within TTL window short-circuits the entire dispatch including
    // L2 vector search. Resilient — any L1 throw falls through silently.
    if (l1Cache && !isUncacheableTool(name)) {
      try {
        const l1Hit = await l1Cache.searchExact(tenantId, userId, name, input);
        if (l1Hit !== null && l1Hit !== undefined) {
          try {
            ctx?.logger?.info?.(
              { toolName: name, cacheLayer: 'L1' },
              '[TOOL-CACHE] L1 HIT (Redis exact-match) — skipping MCP execution',
            );
          } catch { /* noop */ }
          const wrapped =
            l1Hit && typeof l1Hit === 'object'
              ? { ...(l1Hit as object), _meta: { ...(((l1Hit as any)?._meta) ?? {}), cacheHit: true, cacheLayer: 'L1' } }
              : { value: l1Hit, _meta: { cacheHit: true, cacheLayer: 'L1' } };
          return { ok: true, output: wrapped };
        }
      } catch (err) {
        try {
          ctx?.logger?.warn?.(
            { err: String(err), toolName: name },
            '[TOOL-CACHE] L1 searchExact threw — falling through to L2',
          );
        } catch { /* noop */ }
      }
    }

    // ─── L2 (Milvus/pgvector semantic) cache-before ───────────────────
    if (liveCache && !isUncacheableTool(name)) {
      try {
        const hit = await liveCache.searchCache(
          tenantId,
          name,
          input,
          queryText,
          userId,
          userGroups,
          isAdmin,
        );
        if (hit && hit.result !== undefined && hit.result !== null) {
          try {
            ctx?.logger?.info?.(
              {
                toolName: name,
                cacheId: hit.cacheId,
                similarity: hit.similarity,
                crossUserHit: hit.crossUserHit,
                hitCount: hit.hitCount,
              },
              '[TOOL-CACHE] HIT — skipping MCP execution',
            );
          } catch { /* noop */ }
          // Mark cache-hit on the structured output so the UI can render
          // a "cached" badge. We wrap the cached value in an object whose
          // top-level _meta carries the cacheHit flag — the envelope
          // splitter passes _meta through to the UI channel.
          const wrapped =
            hit.result && typeof hit.result === 'object'
              ? { ...(hit.result as object), _meta: { ...(((hit.result as any)?._meta) ?? {}), cacheHit: true, cacheLayer: 'L2', cacheSimilarity: hit.similarity, crossUserHit: hit.crossUserHit } }
              : { value: hit.result, _meta: { cacheHit: true, cacheLayer: 'L2', cacheSimilarity: hit.similarity, crossUserHit: hit.crossUserHit } };

          // Write-through: populate L1 so the next exact repeat hits L1
          // instead of paying the L2 vector round-trip again. Fire-and-forget.
          if (l1Cache) {
            void l1Cache.storeExact(tenantId, userId, name, input, hit.result, l1TtlSeconds).catch(() => {});
          }

          return { ok: true, output: wrapped };
        }
      } catch (err) {
        try {
          ctx?.logger?.warn?.(
            { err: String(err), toolName: name },
            '[TOOL-CACHE] searchCache threw — falling through to MCP execution',
          );
        } catch { /* noop */ }
      }
    }

    // ─── Inner execute ────────────────────────────────────────────────
    const result = await inner(ctx, name, input);

    // ─── Cache-after ──────────────────────────────────────────────────
    if (
      !isUncacheableTool(name) &&
      result &&
      result.ok === true &&
      result.output !== undefined &&
      result.output !== null &&
      result.output !== ''
    ) {
      // Fire-and-forget — never block the dispatch on cache write failures.
      // BOTH layers get populated: L1 (Redis exact) for fast repeat hits,
      // L2 (Milvus semantic) for cross-user paraphrase hits.
      if (l1Cache) {
        void l1Cache.storeExact(tenantId, userId, name, input, result.output, l1TtlSeconds).catch(() => {});
      }
      if (liveCache) {
        void (async () => {
          try {
            const resourceScope = extractResourceScope(name, input);
            // `shouldBeShared` is informational (logging / metrics) — the
            // service computes is_shared internally from
            // extractResourceScope + getRequiredPermission. We log the
            // local derivation for parity / observability.
            const localShared = shouldBeShared(name, resourceScope);
            try {
              ctx?.logger?.debug?.(
                { toolName: name, resourceScope, isShared: localShared },
                '[TOOL-CACHE] caching result (fire-and-forget)',
              );
            } catch { /* noop */ }
            await liveCache.cacheResult(tenantId, userId, name, input, result.output, queryText);
          } catch (err) {
            try {
              ctx?.logger?.warn?.(
                { err: String(err), toolName: name },
                '[TOOL-CACHE] cacheResult threw (fire-and-forget non-fatal)',
              );
            } catch { /* noop */ }
          }
        })();
      }
    }

    return result;
  };
}

import {
  getBuiltInAgents,
  type BuiltInAgentRegistryEntry,
} from './BuiltInAgentRegistry.js';
// Option B (2026-05-13) — chatmode reads sub-agent registry from prisma.agent
// (DB SoT) instead of the 8 markdown files. listAgentsFromDb returns rows
// with the same shape the Task tool consumers expect.
import { listAgentsFromDb, type DbBackedAgentEntry } from './listAgentsFromDb.js';
import type {
  AgentRegistryEntry,
  SubagentSpec,
  SubagentRunResult,
} from './TaskTool.js';
import type {
  RunChatDeps,
  ToolRankerLike,
  RouterTuningLike,
  HookRunnerLike,
  ToolResultCacheLike,
} from '../routes/chat/pipeline/chat/types.js';
// 2026-05-20 — cross-user semantic cache for MCP tool results. The lazy
// singleton already initializes at boot (see startup/06-rag.ts); we just
// surface it on the deps struct and wrap `executeMcpTool` with the
// cache-before / cache-after seams. Meta-tools bypass the wrap because
// they never route through executeMcpTool.
import {
  getToolResultCacheService,
  isUncacheableTool,
  shouldBeShared,
  extractResourceScope,
} from './ToolResultCacheService.js';
import { getRedisToolResultCacheL1 } from './RedisToolResultCacheL1.js';
// Live-wiring fix (2026-05-31) — audit + approval-gate the MCP-execution
// convergence point. In V2 discovery-mode the model gets meta tools +
// tool_search and the REAL MCP tools (web_search + every mutating cloud/k8s
// tool) are executed mid-turn through `executeMcpTool` → mcp-proxy, NOT
// guaranteed to pass the dispatchBody seam. `auditMcpExecutionSeam` wraps the
// executor so every named MCP tool call is audited (READ→auto; MUTATING→gate)
// at the proxy invocation itself. Single-pass via the shared alreadyAudited/
// markAudited ctx flag so a call that ALSO hit dispatchBody is audited once.
import { auditMcpExecutionSeam } from './approval/auditAndGate.js';
// Phase D.1 (2026-05-11) — wire HookRunner singleton into the chat deps
// factory. Built-in hooks (DLP / HITL / audit / cost / SSE sequencer) self-
// register against this singleton at boot via `registerBuiltInHooks` in
// `pipeline/built-in-hooks.ts`; before D.1 the chat deps struct never
// surfaced the runner so every `deps.hooks?.run(...)` in chatLoop was a
// no-op. runChat.ts kept an inline fallback that built its own loopDeps
// — the gap was the deps factory consumed by the chat plugin.
import { getHookRunner } from '../pipeline/hooks.js';
import { recordCompletionMetrics as recordCompletionMetricsHelper } from './llm-providers/recordCompletionMetrics.js';
// 2026-05-11 — wire LargeResultStorage adapter into the chat deps factory.
// Mirrors the HookRunner wire-up (D.1) — before this slice the deps struct
// never surfaced the storage, so every ToolEnvelopeSplitter dispatch ran
// with `largeResultStorage: undefined` and multi-MB tool results blew up
// the model context. Production wiring resolves the singleton; tests can
// override via `setLargeResultStorageServiceInstance(...)`.
import { getLargeResultStorageService } from './LargeResultStorageService.js';
import type { SplitterLargeResultStorage } from './ToolEnvelopeSplitter.js';
import type { TraceStore } from './TaskTool.js';
import { getGenAITracer, type GenAITracer } from './observability/GenAITracer.js';

// ---------------------------------------------------------------------------
// MCP fall-through executor
// ---------------------------------------------------------------------------

/**
 * Build the `executeMcpTool` dep. The V2 dispatch layer routes everything
 * not in the meta-tool registry through this helper. Implementation: hit
 * the MCP proxy `/mcp/tool` endpoint by name.
 *
 * The MCP proxy infers the server from the tool name — every tool returned
 * by `/tools` carries a `server` field, and the proxy keeps an in-memory
 * map of (toolName → serverName). Posting to `/mcp/tool` with `{tool, arguments}`
 * (no explicit `server`) makes the proxy resolve the server itself.
 *
 * OBO HEADER PLUMB (LIVE 2026-04-30 fix):
 *   - Azure-AD user with valid JWT access token → Authorization: Bearer
 *     <accessToken> (the MCP proxy uses this assertion for OBO).
 *   - idToken present → X-Azure-ID-Token + X-AWS-ID-Token headers (these
 *     have audience = app's client ID, required for OBO; access token
 *     has audience = ARM, which AAD rejects with AADSTS500131).
 *   - userId / userEmail → X-User-Id / X-User-Email (workspace isolation).
 *   - api-key / local user → fallback to internal HS256 JWT (MCP proxy
 *     validates it with shared JWT_SECRET).
 *   - Anonymous → API_INTERNAL_KEY (service-to-service).
 *
 * Without these headers, oap-azure-mcp returns
 * "No user token provided (expected 'userAccessToken')" — exactly what
 * was happening live. ctx.user is populated by the chat plugin from the
 * decoded JWT + Azure-token DB lookup (mirrors V1 auth.stage).
 */
/**
 * Optional dependency used to look up the DB-persisted Azure access_token.
 * When wired + the user is azure-ad authenticated, the function consults the
 * DB instead of trusting ctx.user.accessToken — which is the inbound bearer
 * (often an id_token from the SPA session). Without this lookup mcp-proxy's
 * OBO exchange fails with AADSTS240002 ("Input id_token cannot be used as
 * 'urn:ietf:params:oauth:grant-type:jwt-bearer' grant"). Regression pinned
 * by buildChatV2Deps.obo-db-token.test.ts (LIVE 2026-05-11).
 */
interface AzureTokenServiceLike {
  getOrRefreshToken: (userId: string) => Promise<{ access_token: string } | null>;
}

async function buildMcpProxyHeaders(
  ctx: any,
  azureTokenService?: AzureTokenServiceLike,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const user = ctx?.user ?? {};
  const userToken: string | undefined = user.accessToken;
  const idToken: string | undefined = user.idToken;
  const userId: string | undefined = user.id;
  const userEmail: string | undefined = user.email;
  const userName: string | undefined = user.name;
  const isAdmin: boolean = !!user.isAdmin;
  const userGroups: string[] = Array.isArray(user.groups) ? user.groups : [];
  const authMethod: string | undefined = user.authMethod;

  const isAzureAdAuth = authMethod === 'azure-ad';
  const isApiKeyAuth = authMethod === 'api-key';
  const isLocalAuth = authMethod === 'local';
  const isValidAzureJwt =
    isAzureAdAuth && !!userToken && userToken.split('.').length === 3;

  if (isValidAzureJwt) {
    // OBO assertion MUST be an Azure access_token (audience = this app's
    // client_id), NOT an id_token. Look up the DB-persisted access_token
    // when the service is wired; fall back to inbound bearer otherwise.
    let oboToken = userToken!;
    if (azureTokenService && userId) {
      try {
        const info = await azureTokenService.getOrRefreshToken(userId);
        if (info?.access_token) {
          oboToken = info.access_token;
        }
      } catch {
        // Graceful fallback: keep the inbound bearer rather than dropping
        // auth entirely. A silent 401 at dispatch is harder to debug than
        // an OBO failure with a valid trace.
      }
    }
    headers['Authorization'] = `Bearer ${oboToken}`;
  } else if ((isApiKeyAuth || isLocalAuth || !userToken) && userId) {
    // Internal HS256 JWT for non-Azure authenticated users.
    const jwtSecret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
    if (jwtSecret) {
      try {
        // Dynamic ESM import (createRequire equivalent) — dist is ESM so
        // bare `require()` ReferenceErrors. Importing inline keeps the
        // hot path narrow: only fires for local-auth/api-key users.
        const jwt = (await import('jsonwebtoken')).default;
        const internalToken = jwt.sign(
          {
            userId,
            email: userEmail || '',
            name: userName || '',
            isAdmin,
            groups: userGroups,
            source: isApiKeyAuth ? 'api-key-internal' : 'local-internal',
          },
          jwtSecret,
          { expiresIn: '5m' },
        );
        headers['Authorization'] = `Bearer ${internalToken}`;
      } catch {
        const apiInternalKey = process.env.API_INTERNAL_KEY || '';
        headers['Authorization'] = `Bearer ${apiInternalKey}`;
      }
    } else {
      const apiInternalKey = process.env.API_INTERNAL_KEY || '';
      headers['Authorization'] = `Bearer ${apiInternalKey}`;
    }
  } else if (userToken) {
    // Unknown auth method but has a token — pass it.
    headers['Authorization'] = `Bearer ${userToken}`;
  } else {
    // Anonymous fallback: service-to-service via API_INTERNAL_KEY.
    const apiInternalKey = process.env.API_INTERNAL_KEY || '';
    headers['Authorization'] = `Bearer ${apiInternalKey}`;
  }

  // OBO ID token (audience = app client ID, NOT a resource URL). Both
  // Azure ARM and AWS Identity Center MCP servers consume the same idToken.
  if (idToken) {
    headers['X-Azure-ID-Token'] = idToken;
    headers['X-AWS-ID-Token'] = idToken;
  }

  // Workspace isolation hints. MCP servers fall back to userEmail/userId
  // when no OBO token is available (Google auth, API keys, local).
  if (userEmail) headers['X-User-Email'] = userEmail;
  if (userId) headers['X-User-Id'] = userId;

  return headers;
}

/**
 * Build an MCP tool executor with Claude-Code-style tool-name resolution.
 *
 * Mirrors `~/anthropic/src/Tool.ts:findToolByName` (primary + aliases) +
 * `~/anthropic/src/services/mcp/normalization.ts:normalizeNameForMCP`
 * (char-class normalization, `[^a-zA-Z0-9_-]` → `_`).
 *
 * `getRegisteredTools` is called at most once per request; the result is
 * memoized for `RESOLVER_CACHE_TTL_MS` so repeated tool calls within one
 * sub-agent ReAct loop don't re-fetch the index. When the call throws
 * (proxy briefly unreachable), the resolver fails soft — the model's
 * raw name is forwarded to the proxy so we don't black-hole the request.
 */
const RESOLVER_CACHE_TTL_MS = 30_000;

/**
 * Fallback provider-type label when the registry returns null mid-turn
 * (e.g. soft-deleted model). Keeps /metrics series labels stable rather
 * than dropping the emit. Cosmetic; the per-provider drill-down loses
 * fidelity for the affected turns but req-counts + TTFT histograms
 * still aggregate correctly under the model dimension.
 */
const UNKNOWN_PROVIDER = 'unknown';

export function makeExecuteMcpToolWithResolver(
  getRegisteredTools?: () => Promise<Array<{ name: string; aliases?: string[] } | string>>,
  azureTokenService?: AzureTokenServiceLike,
): (ctx: any, name: string, input: any) => Promise<{ ok: boolean; output?: unknown; error?: string }> {
  let cachedTools: Array<{ name: string; aliases?: string[] } | string> | null = null;
  let cacheExpiresAt = 0;

  async function loadRegistered(): Promise<Array<{ name: string; aliases?: string[] } | string> | null> {
    if (!getRegisteredTools) return null;
    const now = Date.now();
    if (cachedTools && now < cacheExpiresAt) return cachedTools;
    try {
      const t = await getRegisteredTools();
      cachedTools = Array.isArray(t) ? t : null;
      cacheExpiresAt = now + RESOLVER_CACHE_TTL_MS;
      return cachedTools;
    } catch {
      // Fail soft — forward raw name to the proxy.
      return null;
    }
  }

  return async (ctx: any, name: string, input: any) => {
    let canonicalName = name;
    const registered = await loadRegistered();
    if (registered && registered.length > 0) {
      const resolved = resolveMcpToolName(name, registered);
      if (resolved.ok === false) {
        return { ok: false, error: resolved.error };
      }
      canonicalName = resolved.canonicalName;
    }

    const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
    const reqId = `chat-v2-${Date.now()}`;
    const startedAt = Date.now();
    try {
      const resp = await fetch(`${mcpProxyUrl}/mcp/tool`, {
        method: 'POST',
        headers: await buildMcpProxyHeaders(ctx, azureTokenService),
        body: JSON.stringify({
          tool: canonicalName,
          arguments: input ?? {},
          id: reqId,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const error = `MCP proxy returned ${resp.status}: ${text.substring(0, 300)}`;
        void recordChatMcpUsage({ ctx, toolName: canonicalName, input, ok: false, error, startedAt });
        return { ok: false, error };
      }
      const data = await resp.json();
      if (data?.error) {
        const error = typeof data.error === 'string' ? data.error : (data.error?.message ?? 'MCP error');
        void recordChatMcpUsage({ ctx, toolName: canonicalName, input, ok: false, error, startedAt });
        return { ok: false, error };
      }
      // Unwrap nested {result:{result:...}} envelope if present.
      let result: unknown = data?.result ?? data;
      if (result && typeof result === 'object' && 'result' in (result as any)) {
        result = (result as any).result;
      }
      // E1.5 (2026-05-12) — Bug 2 fix: do NOT JSON.stringify structured
      // results. The prior `JSON.stringify(result ?? {})` wrap caused every
      // structured MCP body to land in `structuredContent.data` as a JSON
      // string. That string then rendered in the UI's JsonView with 6
      // layers of escape sequences (`\\\\\\\"`) because each layer added
      // another stringify pass (splitter → tool_result.content → wire →
      // prisma JSON column → hydrate → JsonView). Pass structured objects
      // through verbatim; strings stay strings.
      // Pinned by buildChatV2Deps.e15McpResultShape.test.ts.
      const output: unknown = result ?? '';
      void recordChatMcpUsage({ ctx, toolName: canonicalName, input, ok: true, startedAt });
      return { ok: true, output };
    } catch (err: any) {
      const error = `MCP fetch failed: ${err?.message ?? String(err)}`;
      void recordChatMcpUsage({ ctx, toolName: canonicalName, input, ok: false, error, startedAt });
      return { ok: false, error };
    }
  };
}

function makeExecuteMcpTool(
  azureTokenService?: AzureTokenServiceLike,
): (ctx: any, name: string, input: any) => Promise<any> {
  return async (ctx: any, name: string, input: any) => {
    const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
    const reqId = `chat-v2-${Date.now()}`;
    const startedAt = Date.now();
    try {
      const resp = await fetch(`${mcpProxyUrl}/mcp/tool`, {
        method: 'POST',
        headers: await buildMcpProxyHeaders(ctx, azureTokenService),
        body: JSON.stringify({
          tool: name,
          arguments: input ?? {},
          id: reqId,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const error = `MCP proxy returned ${resp.status}: ${text.substring(0, 300)}`;
        void recordChatMcpUsage({ ctx, toolName: name, input, ok: false, error, startedAt });
        return { ok: false, error };
      }
      const data = await resp.json();
      if (data?.error) {
        const error = typeof data.error === 'string' ? data.error : (data.error?.message ?? 'MCP error');
        void recordChatMcpUsage({ ctx, toolName: name, input, ok: false, error, startedAt });
        return { ok: false, error };
      }
      // Unwrap nested {result:{result:...}} envelope if present.
      let result: unknown = data?.result ?? data;
      if (result && typeof result === 'object' && 'result' in (result as any)) {
        result = (result as any).result;
      }
      // E1.5 (2026-05-12) — Bug 2 fix: see twin in makeExecuteMcpToolWithResolver.
      const output: unknown = result ?? '';
      void recordChatMcpUsage({ ctx, toolName: name, input, ok: true, startedAt });
      return { ok: true, output };
    } catch (err: any) {
      const error = `MCP fetch failed: ${err?.message ?? String(err)}`;
      void recordChatMcpUsage({ ctx, toolName: name, input, ok: false, error, startedAt });
      return { ok: false, error };
    }
  };
}

// ---------------------------------------------------------------------------
// listAgents — pull built-in registry entries
// ---------------------------------------------------------------------------

/**
 * Convert a `BuiltInAgentRegistryEntry` to TaskTool's `AgentRegistryEntry`
 * shape. The Task tool description builder only reads agent_type +
 * display_name + description; tools / model / body stay on the registry
 * entry for the runSubagent dispatcher.
 */
function toAgentRegistryEntry(
  e: BuiltInAgentRegistryEntry | DbBackedAgentEntry,
): AgentRegistryEntry {
  return {
    agent_type: e.agent_type,
    display_name: e.display_name,
    description: e.description,
  };
}

/**
 * Option B (2026-05-13) — DB-backed agent registry for the chatmode Task
 * tool. Reads `prisma.agent` via `listAgentsFromDb()` (only
 * `is_default=true AND enabled=true` rows). Admin-created custom agents
 * appear immediately because they go to the same table.
 *
 * The legacy markdown loader (`getBuiltInAgents()`) is now obsolete; the
 * boot seeder `14-agent-md-to-db-seeder.ts` upserts the 8 markdown built-
 * ins into the DB on every boot so the DB stays canonical.
 */
function makeListAgents(): () => Promise<AgentRegistryEntry[]> {
  return async () => {
    const agents = await listAgentsFromDb();
    return agents.map(toAgentRegistryEntry);
  };
}

// ---------------------------------------------------------------------------
// Built-in agent dispatch deps — minimal shape consumed by both the
// recursor sub-agent path (via `recursorGetAgents`) and the MCP tool
// resolver (via `listMcpProxyTools`). Phase E.8.g+h (2026-05-11): the
// in-api orchestrator-coupled `toolRanker` + `BuiltInAgentScope` types
// were ripped along with the legacy `makeRunSubagent` wrapper and the
// orchestrator class itself.
// ---------------------------------------------------------------------------

export interface BuiltInDispatchDeps {
  /** Synchronous accessor to the cached BuiltInAgentRegistry. */
  getBuiltInAgents?: () => ReadonlyArray<{ agent_type: string; tools?: string[] }>;
  /** Lazily fetch the live MCP proxy tool list at dispatch time. */
  listMcpProxyTools?: () => Promise<any[]>;
}

// ---------------------------------------------------------------------------
// Top-level factory
// ---------------------------------------------------------------------------

/**
 * Subset of ChatStorageService that buildChatV2Deps needs. Defining the
 * minimal shape inline keeps the dependency a structural type — the test
 * doubles don't need to instantiate the full service.
 */
export interface ChatStorageLike {
  getMessages: (sessionId: string, options?: any) => Promise<any[]>;
  addMessage: (sessionId: string, message: any) => Promise<{ id: string }>;
}

/** Options bag for `persistUserMessage` / `persistAssistantMessage`. */
export interface PersistMessageOptions {
  userId: string;
  model?: string;
  tokenUsage?: any;
  toolCalls?: any[];
  toolResults?: any[];
  toolNamesUsed?: string[];
  metadata?: Record<string, any>;
  /**
   * Inline render frames (visual_render / app_render / streaming_table /
   * inline_widget / sub_agent_complete) collected during streaming.
   * Written to `chat_messages.visualizations` so widgets survive a session
   * reload — without this, the only persistence is the assistant prose.
   *
   * Sev-0 2026-05-08: `toolCalls` / `toolResults` (already declared above)
   * also carry the structured tool fan-out from tool_executing /
   * tool_result frames so ToolCallGroup rehydrates on session reload.
   */
  visualizations?: any[];
  /**
   * Sev-0 #924/#925/#926 — canonical ContentBlock[] chronology built by
   * accumulating wire frames (thinking_delta / text_delta / tool_executing /
   * tool_result / visual_render / app_render / follow_up / ...) at the
   * stream handler. Written to `chat_messages.content_blocks` Json column
   * so the rehydrated message renders byte-identical DOM to the live stream.
   *
   * When absent (legacy callers, tests), ChatStorageService writes NULL —
   * MessageBubble falls back to reconstructing from the legacy
   * toolCalls/thinkingSteps[] reconstruction path.
   */
  contentBlocks?: any[];
}

export interface BuildChatV2DepsOptions {
  /** ProviderManager singleton (createCompletion entry-point). */
  providerManager: { createCompletion: (req: any, target?: string) => Promise<any> };
  /** Real Prisma client; used by the system-prompt assembler to read prompt_modules. */
  prismaLike?: any;
  /**
   * ChatStorageService singleton (Wave 5). When supplied, the deps struct
   * surfaces `loadPriorMessages` / `persistUserMessage` / `persistAssistantMessage`
   * for the stream handler. When omitted (e.g. unit tests not exercising
   * persistence), the three callbacks are absent and the handler runs without
   * history / persistence — fine for first-message smoke tests.
   */
  chatStorage?: ChatStorageLike;
  /**
   * Optional AzureTokenService — when wired, buildMcpProxyHeaders looks up
   * the DB-persisted Azure access_token for OBO instead of trusting the
   * inbound bearer (which is often an id_token from the SPA session and
   * fails AADSTS240002 at the OBO exchange). Pinned by
   * buildChatV2Deps.obo-db-token.test.ts (LIVE 2026-05-11).
   */
  azureTokenService?: AzureTokenServiceLike;
  /** Override the MCP fall-through (tests). */
  executeMcpTool?: (ctx: any, name: string, input: any) => Promise<any>;
  /** Override the browser sandbox executor (tests). */
  executeBrowserSandbox?: (ctx: any, input: any) => Promise<any>;
  /** Override the listAgents source (tests). */
  listAgents?: () => Promise<AgentRegistryEntry[]>;
  /** Override the sub-agent runner (tests). */
  runSubagent?: (
    spec: SubagentSpec,
    parentCtx?: any,
  ) => Promise<SubagentRunResult>;
  /**
   * TASK #524 — Legacy ranker-service singleton. Optional: when omitted
   * the chat pipeline passes the full mcpTools array through unranked.
   * The ranker service itself was deleted in Phase E.2 (2026-05-10); the
   * field is retained on the deps struct as a typed back-compat slot for
   * older callers and gets dropped in a follow-up rip.
   */
  toolRanker?: ToolRankerLike;
  /**
   * TASK #524 — RouterTuningService singleton. Drove the legacy
   * per-intent top-K lookup at the chat pipeline boundary (ripped in
   * Phase E.10 alongside the ranker). Field retained on the deps struct
   * as a typed back-compat slot; same drop schedule as `toolRanker`.
   */
  routerTuning?: RouterTuningLike;
  /**
   * Built-in agent dispatch deps — feeds two consumers:
   *   - `recursorGetAgents` fallback (sub-agent dispatch)
   *   - `listMcpProxyTools` for the MCP tool-name resolver cache
   * Phase E.8.g+h (2026-05-11): in-api orchestrator-coupled `toolRanker` /
   * built-in-scope types were ripped along with the legacy in-process
   * sub-agent wrapper.
   */
  builtInDispatch?: BuiltInDispatchDeps;
  /**
   * Synchronous accessor feeding the recursor's agent registry lookup.
   * Typically passes the chat plugin's `getBuiltInAgents()` callback (the
   * same one used by `builtInDispatch`) but kept as its own slot so tests
   * can inject inline arrays without the full BuiltInDispatchDeps surface.
   *
   * Optional — when omitted, the deps factory falls back to
   * `builtInDispatch?.getBuiltInAgents` if available; otherwise sub-agent
   * dispatch returns `{ ok:false, error:/registry/i }`.
   *
   * Caller contract: the per-turn driver MUST stamp
   * `parentCtx[RECURSOR_CTX_SLOTS.parentDeps]` + `[parentSequencer]` +
   * `[parentTurnId]` onto the RunCtx BEFORE sub-agent dispatch fires.
   * Without these slots, dispatch returns a structured "not wired" error
   * rather than crashing the turn — see `makeRunSubagentViaRecursorPerCall`.
   */
  recursorGetAgents?: () => ReadonlyArray<RecursorAgentLookupEntry | any>;
  /**
   * Phase D.1 (2026-05-11) — explicit HookRunner override.
   *
   * When omitted (production), the factory pulls the process singleton via
   * `getHookRunner()`. When the singleton has never been initialized
   * (test paths that don't bootstrap startup), the factory silently sets
   * `deps.hooks` to undefined so the loop runs without cross-cuts —
   * matches the runChat.ts inline fallback contract.
   *
   * Tests inject a mock runner directly to assert hook dispatch without
   * touching the process-global singleton.
   */
  hooks?: HookRunnerLike;
  /**
   * 2026-05-11 — LargeResultStorage adapter override (tests). When omitted,
   * the factory builds a thin adapter wrapping `getLargeResultStorageService()`
   * (the lazy Redis-backed singleton).
   */
  largeResultStorage?: SplitterLargeResultStorage;
  /**
   * 2026-05-11 — Inline-vs-overflow byte threshold override (tests / tuning).
   * Defaults to 30 * 1024 (the splitter's built-in threshold).
   */
  thresholdBytes?: number;
  /**
   * A2 (2026-05-12) — sub-agent transcript trace store override (tests).
   *
   * When omitted, the factory builds a `LargeResultTraceStoreAdapter` that
   * wraps `getLargeResultStorageService()` so traces share the same
   * Redis-backed multi-pod store as envelope offloading. The adapter
   * encodes the transcript + stats + role + prompt into a single result
   * blob and returns `{ handle: resultId }` — the parent agent later
   * calls `read_subagent_trace(handle)` to retrieve it.
   *
   * Tests inject a fake `{ store: vi.fn() }` to assert dispatch without
   * touching Redis.
   */
  traceStore?: import('./TaskTool.js').TraceStore;
  /**
   * F2 (2026-05-12) — OTel GenAI v1.37 tracer override (tests).
   *
   * When omitted (production), the factory pulls `getGenAITracer()` —
   * a lazy singleton bound to the global OTel provider + prom-client
   * default register. `/metrics` surfaces gen_ai_*_total counters
   * regardless of OTLP exporter configuration; OTLP shipping kicks in
   * when OTEL_EXPORTER_OTLP_ENDPOINT (or equivalent) is set at boot.
   *
   * Tests pass a fake `GenAITracer` constructed with a NodeTracerProvider's
   * tracer + omitted prom register so spans are captured by an
   * InMemorySpanExporter without touching the production registry.
   */
  genAITracer?: GenAITracer;
  /**
   * 2026-05-20 — ToolResultCacheService override (tests).
   *
   * When omitted (production), the factory resolves the lazy singleton via
   * `getToolResultCacheService()` and wraps `executeMcpTool` with the
   * cache-before / cache-after seams. Test paths inject a
   * `{ searchCache: vi.fn(), cacheResult: vi.fn() }` stub or pass `null`
   * to opt out entirely. When the singleton is unavailable (init failed)
   * the wrap silently degrades — executeMcpTool stays unwrapped and the
   * pipeline runs without caching.
   */
  toolResultCache?: ToolResultCacheLike | null;
  /**
   * L1 (Redis exact-match) cache override (tests). When omitted (production),
   * the factory resolves `getRedisToolResultCacheL1()` and wires it ahead of
   * the L2 semantic cache. See `RedisToolResultCacheL1.ts`.
   */
  l1Cache?: { searchExact: (...args: any[]) => Promise<unknown | null>; storeExact: (...args: any[]) => Promise<boolean> } | null;
}

/**
 * The persistence helpers are attached to the same struct that holds the
 * chat pipeline deps. The stream handler reads `loadPriorMessages` /
 * `persistUserMessage` / `persistAssistantMessage` from this struct
 * directly; the pipeline itself doesn't see them — it consumes only the
 * inputs the handler passes via `RunChatInput.priorMessages`.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §272-302.
 */
export interface ChatV2DepsWithPersistence extends RunChatDeps {
  /**
   * Load prior conversation turns for `sessionId`, translated to the V2
   * message shape (`{role, content}`). Returns [] on storage error so a
   * transient db blip degrades to a fresh-conversation turn rather than
   * killing the request.
   */
  loadPriorMessages?: (
    sessionId: string,
    userId: string,
  ) => Promise<Array<{ role: 'user' | 'assistant' | 'tool'; content: any }>>;
  /** Persist the incoming user message; called before invoking V2. */
  persistUserMessage?: (
    sessionId: string,
    content: string,
    opts: PersistMessageOptions,
  ) => Promise<void>;
  /**
   * Persist the final assistant message; called after V2 emits
   * `assistant_message_stop`.
   */
  persistAssistantMessage?: (
    sessionId: string,
    content: string,
    opts: PersistMessageOptions,
  ) => Promise<void>;
}

/**
 * Build the canonical RunChatDeps + Wave-5 persistence helpers used by
 * the chatmode V2 stream handler. Composed once at plugin init; reused
 * across every chat-stream request.
 *
 * The four pure tool executors (memorize / render_artifact / compose_visual /
 * request_clarification / executeTask) are imported as functions — they
 * have no construction state and DI-mock cleanly in tests.
 */
export function buildChatV2Deps(opts: BuildChatV2DepsOptions): ChatV2DepsWithPersistence {
  // Phase E.8.g+h (2026-05-11) — runSubagent selection. Precedence:
  //   1. explicit opts.runSubagent override (test injection)
  //   2. default: makeRunSubagentViaRecursorPerCall (recursor-backed
  //      child chatLoop dispatch — the only production path)
  //
  // The legacy in-api orchestrator wiring + the `useRecursor` strangler
  // flag were ripped in this slice. Sub-agent dispatch always goes
  // through the recursor unless the caller explicitly overrides
  // `runSubagent` (test injection).
  let resolvedRunSubagent: (
    spec: SubagentSpec,
    parentCtx?: any,
  ) => Promise<SubagentRunResult>;
  if (opts.runSubagent) {
    resolvedRunSubagent = opts.runSubagent;
  } else {
    const getAgents =
      opts.recursorGetAgents ??
      opts.builtInDispatch?.getBuiltInAgents ??
      (() => [] as any[]);
    resolvedRunSubagent = makeRunSubagentViaRecursorPerCall({
      getAgents: getAgents as any,
    });
  }

  // Phase D.1 (2026-05-11) — HookRunner resolution.
  //   1. explicit opts.hooks (test injection — wins over the singleton)
  //   2. getHookRunner() — the process singleton set at startup with
  //      DLP / HITL / audit / cost / SSE sequencer built-ins registered
  //   3. undefined — fail-soft: when neither is available (unit tests
  //      that never bootstrap startup), the loop runs without cross-cuts
  //      rather than throwing at deps construction time.
  let resolvedHooks: HookRunnerLike | undefined;
  if (opts.hooks) {
    resolvedHooks = opts.hooks;
  } else {
    try {
      resolvedHooks = getHookRunner() as unknown as HookRunnerLike;
    } catch {
      // Singleton not initialized — test path. Loop will skip cross-cuts.
      resolvedHooks = undefined;
    }
  }

  // 2026-05-11 — LargeResultStorage adapter resolution.
  //   1. explicit opts.largeResultStorage (test injection — wins; tests
  //      that don't need offload can pass `null`-ish nothing and accept
  //      the singleton)
  //   2. wrap `getLargeResultStorageService()` in a thin adapter that
  //      satisfies `SplitterLargeResultStorage.put` semantics.
  //
  // The wrapper forwards the splitter's `(raw, opts)` shape into the
  // service's `storeResult({ userId, tenantId, sessionId, toolName,
  // toolCallId, result })` shape and returns the resultId (the splitter
  // writes it onto `_meta.artifactHandle` so the model can call
  // `read_large_result(handle)` for paged retrieval).
  //
  // #974 RBAC (2026-05-20 PM) — `userId` + `tenantId` are now threaded
  // through from the dispatchTool ctx via `putOpts.{userId,tenantId}`.
  // The pre-#974 hardcoded `userId: 'system'` left chat-pipeline offloads
  // un-namespaced, which meant a stolen handle could cross-read any
  // tenant's data. With this fix, the Redis key embeds
  // `${tenantId}:${userId}:${resultId}` and `getResultAsync(handle, auth)`
  // rejects on owner mismatch. Sub-agent trace store path still passes
  // 'system' (it's the only callsite that doesn't know user context).
  let resolvedLargeResultStorage: SplitterLargeResultStorage | undefined;
  if (opts.largeResultStorage) {
    resolvedLargeResultStorage = opts.largeResultStorage;
  } else {
    resolvedLargeResultStorage = {
      put: async (raw, putOpts) => {
        try {
          const svc = getLargeResultStorageService();
          const info = await svc.storeResult({
            userId: putOpts.userId ?? 'system',
            tenantId: putOpts.tenantId ?? '',
            sessionId: putOpts.sessionId,
            toolName: putOpts.toolName ?? 'unknown',
            toolCallId: putOpts.toolUseId,
            result: raw,
          });
          return info.resultId;
        } catch (err) {
          // Re-throw — splitEnvelope's defensive path keeps inline content
          // when the adapter throws; we don't want to silently drop data.
          throw err;
        }
      },
    };
  }

  // 2026-05-11 — Inline-vs-overflow byte threshold. Defaults to the
  // splitter's built-in 30KB. Surfaced on the deps struct so a future
  // admin-tunable knob can override per-tenant.
  const resolvedThresholdBytes = opts.thresholdBytes ?? 30 * 1024;

  // A2 (2026-05-12) — sub-agent transcript trace store.
  //   1. explicit opts.traceStore wins (tests inject a fake).
  //   2. otherwise, wrap `getLargeResultStorageService()` in a thin
  //      adapter that satisfies the TraceStore contract: encode the
  //      transcript + stats + role + prompt into one storage blob and
  //      return `{ handle: resultId }`. Best-effort — if Redis is
  //      unreachable the underlying service logs and throws; TaskTool
  //      catches and continues without a handle.
  //
  // `userId` is the caller's userId when present on the TaskTool ctx
  // (defensive: ctx may surface it as either userId or as part of a
  // wrapper). For the adapter we route through the same Redis bucket
  // as envelope offloading so the boot janitor can age traces out by
  // the same TTL (48h, per LargeResultStorageService).
  let resolvedTraceStore: TraceStore | undefined;
  if (opts.traceStore) {
    resolvedTraceStore = opts.traceStore;
  } else {
    resolvedTraceStore = {
      store: async (payload) => {
        const svc = getLargeResultStorageService();
        // Pack the trace into a single result object. LargeResultStorageService
        // is content-agnostic — chunks/summary are computed by its writer.
        const blob = {
          kind: 'subagent_trace',
          role: payload.role,
          prompt: payload.prompt,
          output: payload.output ?? null,
          error: payload.error ?? null,
          stats: payload.stats,
        };
        const info = await svc.storeResult({
          userId: payload.userId ?? 'system',
          sessionId: payload.sessionId ?? 'unknown',
          toolName: '__subagent_trace__',
          toolCallId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          result: blob,
        });
        return { handle: info.resultId };
      },
    };
  }

  // 2026-05-20 — ToolResultCacheService resolution. Precedence:
  //   1. explicit opts.toolResultCache (test injection — wins; `null` opts-out)
  //   2. LAZY getToolResultCacheService() — re-evaluated on EVERY call.
  //      ToolResultCacheService init is ASYNC (Milvus collection + embedding
  //      client take ~2s). buildChatV2Deps runs at pod startup BEFORE init
  //      completes. One-shot capture left `resolvedToolResultCache=undefined`
  //      for the pod lifecycle (#972 unstick). Lazy resolver re-checks per
  //      call: first call falls through to inner, post-init calls use the
  //      cache. The wrap fires a one-time INFO log when the resolver first
  //      returns a live cache.
  //   3. undefined — fail-soft: wrap is a no-op, executeMcpTool stays
  //      unwrapped, dispatch behaves like the pre-cache pipeline.
  let resolvedToolResultCache: ToolResultCacheLike | undefined;
  let lazyToolResultCacheResolver:
    | (() => ToolResultCacheLike | undefined | null)
    | undefined;

  if (opts.toolResultCache === null) {
    // Explicit opt-out — wrap is a no-op, no resolver.
    resolvedToolResultCache = undefined;
    lazyToolResultCacheResolver = undefined;
  } else if (opts.toolResultCache) {
    // Explicit injection — capture verbatim (legacy test path).
    resolvedToolResultCache = opts.toolResultCache;
    lazyToolResultCacheResolver = undefined;
  } else {
    // Production path — LAZY resolver. Defer the singleton resolution
    // to the per-call wrap so pod-startup races against async init no
    // longer leave the cache permanently disabled.
    resolvedToolResultCache = undefined;
    lazyToolResultCacheResolver = () => {
      try {
        const svc = getToolResultCacheService() as unknown as ToolResultCacheLike;
        // `isReady()` exists on the production service; respect it so the
        // wrap doesn't fan out searchCache/cacheResult while Milvus is mid-init.
        // ToolResultCacheLike doesn't require isReady() so tests that mock the
        // cache without it still work.
        const maybeReady = (svc as { isReady?: () => boolean } | undefined)?.isReady;
        if (typeof maybeReady === 'function') {
          return maybeReady.call(svc) ? svc : undefined;
        }
        return svc;
      } catch {
        return undefined;
      }
    };
  }

  // Build the inner MCP executor first (resolver-based with OBO headers).
  const innerExecuteMcpTool =
    opts.executeMcpTool ??
    makeExecuteMcpToolWithResolver(opts.builtInDispatch?.listMcpProxyTools, opts.azureTokenService);

  // Wrap with cross-user cache. Meta-tools bypass this because they never
  // route through executeMcpTool (see dispatchChatToolCall.ts — the MCP
  // fall-through happens only after every meta-tool branch returns).
  //
  // Wrap input precedence:
  //   - lazyToolResultCacheResolver (production) → wrap re-checks per call
  //   - resolvedToolResultCache (test injection) → wrap captures once
  //   - both undefined (opt-out / no path) → no wrap, inner returned verbatim
  // L1 Redis exact-match cache — per-user, sub-ms latency, sits IN FRONT of
  // the L2 semantic cache. Lazy-resolved via singleton so it works regardless
  // of Redis init ordering (Redis connects fast, but the singleton is cheap
  // either way). Tests inject via opts.l1Cache when they need to override.
  const l1Cache = opts.l1Cache ?? getRedisToolResultCacheL1();

  const cacheWrappedExecuteMcpTool = lazyToolResultCacheResolver
    ? wrapWithToolResultCache(lazyToolResultCacheResolver, innerExecuteMcpTool, { l1Cache })
    : resolvedToolResultCache
      ? wrapWithToolResultCache(resolvedToolResultCache, innerExecuteMcpTool, { l1Cache })
      : wrapWithToolResultCache(null, innerExecuteMcpTool, { l1Cache });

  // Live-wiring fix (2026-05-31) — audit + approval-gate seam wraps the cache
  // wrap as the OUTERMOST layer. A denied/timed-out MUTATING call returns a
  // synthetic block BEFORE the cache search/store OR the proxy POST runs, so a
  // mutation never reaches mcp-proxy and never poisons the tool-result cache.
  // READ calls pass straight through (audited 'auto', never gated → no hang).
  // Single-pass: when the dispatchBody seam already audited THIS dispatch ctx
  // (the common path — same ctx object flows dispatchBody → dispatchChatToolCall
  // → executeMcpTool), the seam skips its audit and just executes.
  const wrappedExecuteMcpTool = auditMcpExecutionSeam(cacheWrappedExecuteMcpTool);

  const base: RunChatDeps = {
    providerManager: opts.providerManager,
    listAgents: opts.listAgents ?? makeListAgents(),
    runSubagent: resolvedRunSubagent,
    executeMcpTool: wrappedExecuteMcpTool,
    toolResultCache: resolvedToolResultCache,
    executeBrowserSandbox: opts.executeBrowserSandbox ?? executeBrowserSandbox,
    prismaLike: opts.prismaLike,
    // Phase E.1 — intentClassifier dropped. ToolRanker / routerTuning
    // pass-through retained (separate Phase E rips).
    toolRanker: opts.toolRanker,
    routerTuning: opts.routerTuning,
    hooks: resolvedHooks,
    // 2026-05-11 — LargeResultStorage + threshold so runChat threads them
    // into V3DispatchDeps and ToolEnvelopeSplitter actually offloads.
    largeResultStorage: resolvedLargeResultStorage,
    thresholdBytes: resolvedThresholdBytes,
    // A2 (2026-05-12) — sub-agent trace store. runChat forwards this onto
    // v2Deps so dispatchChatToolCall's Task arm threads it into TaskDeps
    // and executeTask returns trace_handle on the result.
    traceStore: resolvedTraceStore,
    // F2 (2026-05-12) — OTel GenAI v1.37 tracer for chat/tool/agent spans.
    // Lazy singleton bound to global OTel provider + prom-client default
    // register. /metrics surfaces gen_ai_*_total counters; OTLP exporter
    // (when configured) ships spans to Datadog / Honeycomb / Tempo.
    genAITracer: opts.genAITracer ?? getGenAITracer(),
    // F2-followup (2026-05-12) — wire chatLoop's per-turn metrics emit
    // into the existing recordCompletionMetrics helper. This populates
    // the legacy TTFT/TPOT/operation_duration/token_usage/finish_reasons
    // histograms on /metrics for every streaming chat turn — the same
    // helper non-streaming chat + embeddings already use.
    // Provider type is derived from the model via providerManager.
    recordCompletionMetrics: async (args) => {
      // Best-effort provider lookup. Falls back to UNKNOWN_PROVIDER when the
      // registry returns null mid-turn (soft-deleted model). The fallback
      // keeps /metrics series labels stable rather than dropping the emit.
      let providerType: string = UNKNOWN_PROVIDER;
      let providerName: string | undefined;
      try {
        const pm = opts.providerManager as
          | { getProviderForModel?: (m: string) => unknown }
          | undefined;
        const p = pm?.getProviderForModel?.(args.model) as
          | { type?: string; name?: string }
          | undefined;
        if (p?.type) providerType = p.type;
        if (p?.name) providerName = p.name;
      } catch {
        // keep UNKNOWN_PROVIDER fallback
      }
      const errored = args.errorClass !== undefined;
      await recordCompletionMetricsHelper(
        errored
          ? {
              providerName: providerName ?? 'streaming',
              providerType,
              model: args.model,
              startedAt: args.startedAt,
              streaming: true,
              userId: args.userId,
              sessionId: args.sessionId,
              messageId: args.messageId,
              error: new Error(args.errorMessage ?? args.errorClass ?? 'unknown'),
            }
          : {
              providerName: providerName ?? 'streaming',
              providerType,
              startedAt: args.startedAt,
              streaming: true,
              timeToFirstTokenMs: args.timeToFirstTokenMs,
              userId: args.userId,
              sessionId: args.sessionId,
              messageId: args.messageId,
              response: {
                model: args.model,
                choices: [{ finish_reason: args.stopReason }],
                usage: args.usage
                  ? {
                      prompt_tokens: args.usage.input,
                      completion_tokens: args.usage.output,
                      total_tokens: args.usage.input + args.usage.output,
                      ...(args.usage.cacheRead !== undefined
                        ? { prompt_tokens_details: { cached_tokens: args.usage.cacheRead } }
                        : {}),
                      ...(args.usage.reasoning !== undefined
                        ? {
                            completion_tokens_details: {
                              reasoning_tokens: args.usage.reasoning,
                            },
                          }
                        : {}),
                    }
                  : undefined,
              } as any,
            },
      );
    },
  };

  const storage = opts.chatStorage;
  if (!storage) {
    return base;
  }

  // Load prior turns and reshape to the V2 message envelope. The V2 loop
  // accepts {role: 'user'|'assistant'|'tool', content: any}; storage rows
  // carry extra fields (id, timestamp, metadata) that V2 ignores.
  const loadPriorMessages: ChatV2DepsWithPersistence['loadPriorMessages'] = async (
    sessionId,
    _userId,
  ) => {
    try {
      const rows = await storage.getMessages(sessionId, { limit: 50 });
      if (!Array.isArray(rows)) return [];
      const out: Array<{ role: 'user' | 'assistant' | 'tool'; content: any }> = [];
      for (const r of rows) {
        const role = (r?.role ?? '').toString().toLowerCase();
        if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;
        out.push({ role: role as any, content: r.content ?? '' });
      }
      return out;
    } catch {
      return [];
    }
  };

  const persistUserMessage: ChatV2DepsWithPersistence['persistUserMessage'] = async (
    sessionId,
    content,
    persistOpts,
  ) => {
    try {
      await storage.addMessage(sessionId, {
        role: 'user',
        content,
        userId: persistOpts.userId,
        metadata: persistOpts.metadata,
      });
    } catch {
      // Fail-open: persistence errors must not abort the live stream.
    }
  };

  const persistAssistantMessage: ChatV2DepsWithPersistence['persistAssistantMessage'] = async (
    sessionId,
    content,
    persistOpts,
  ) => {
    try {
      await storage.addMessage(sessionId, {
        role: 'assistant',
        content,
        userId: persistOpts.userId,
        model: persistOpts.model,
        tokenUsage: persistOpts.tokenUsage,
        // Sev-0 — structured tool fan-out (tool_executing/tool_result frames).
        // Already on PersistMessageOptions; passing through here so storage
        // writes the dedicated tool_calls / tool_results columns.
        toolCalls: persistOpts.toolCalls,
        toolResults: persistOpts.toolResults,
        toolNamesUsed: persistOpts.toolNamesUsed,
        metadata: persistOpts.metadata,
        visualizations: persistOpts.visualizations,
        // Sev-0 #924/#925/#926 — canonical ContentBlock[] chronology.
        // ChatStorageService.addMessage writes to chat_messages.content_blocks
        // Json column when present.
        contentBlocks: persistOpts.contentBlocks,
      });
    } catch {
      // Fail-open.
    }
  };

  return {
    ...base,
    loadPriorMessages,
    persistUserMessage,
    persistAssistantMessage,
  };
}

// Re-export the tool executors so callers (chat plugin, tests) can
// inject explicit overrides without re-importing every individual module.
export {
  executeMemorize,
  executeRenderArtifact,
  executeComposeVisual,
  executeRequestClarification,
  executeTask,
};
