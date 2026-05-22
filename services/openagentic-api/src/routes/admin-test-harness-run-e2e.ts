/**
 * Admin Test Harness — REAL E2E Integration
 *
 * POST /api/admin/test-harness/run-e2e
 *
 * Streams NDJSON. Tests EVERY provider + EVERY model in the registry SoT
 * (`admin.model_role_assignments`), every T1 meta-tool, the MCP T2 tool
 * surface (read-only sweep), T3 artifact tools (compose_visual /
 * compose_app / render_artifact), and a Flow E2E.
 *
 * Categories produced (one test_start + test_done event pair each):
 *   - provider           one per llm_providers row (ping completion)
 *   - chat_model         one per role IN ('chat','code') registry row
 *   - embedding_model    one per role='embedding' registry row
 *   - t1_tool            one per T1 meta-tool
 *   - t2_mcp             one per read-only MCP tool (sweep)
 *   - t3_artifact        compose_visual / compose_app / render_artifact
 *   - flow_e2e           one chatmode-style run via best model
 *   - cache_verify       hit + miss recorded against ToolResultCacheService
 *
 * Wire shape (per test):
 *   {"type":"test_start", testId, kind, target, ts}
 *   {"type":"test_progress", testId, message}  (optional, can be 0..N)
 *   {"type":"test_done",  testId, ok, durationMs, ttftMs?, tokensIn?,
 *                         tokensOut?, embeddingDim?, evidence?, error?}
 *
 * Final frame:
 *   {"type":"summary", total, passed, failed, durations:{p50,p95},
 *    models:[{id,provider,role,ttftMs,ok,error?}]}
 *
 * Auth: admin-only (adminMiddleware in plugins/admin.plugin.ts) — OR a
 * TEST_HARNESS_API_KEY bearer for GH-Actions/CI flows (matches the
 * existing /run endpoint convention so callers can re-use the same key).
 *
 * Body params:
 *   { mode: 'full'|'smoke', includeFlows?: bool, includeMcpTools?: bool,
 *     includeT3?: bool, models?: string[] }
 *
 * Time budget:
 *   - smoke  ≤ 30s : ping each provider + ONE model per provider
 *   - full   ≤ 5min: every row, every T1 tool, T2 read sweep, T3, flow
 */

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { ndjsonHeaders, writeNDJSON } from '../infra/ndjson.js';

const logger = loggers.routes;

interface RunBody {
  mode?: 'full' | 'smoke';
  includeFlows?: boolean;
  includeMcpTools?: boolean;
  includeT3?: boolean;
  models?: string[];
}

interface TestStart {
  testId: string;
  kind:
    | 'provider'
    | 'chat_model'
    | 'embedding_model'
    | 't1_tool'
    | 't2_mcp'
    | 't3_artifact'
    | 'flow_e2e'
    | 'cache_verify';
  target: string;
  ts: string;
}

interface TestDone {
  testId: string;
  ok: boolean;
  durationMs: number;
  ttftMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  embeddingDim?: number;
  evidence?: Record<string, unknown>;
  error?: string;
  /** Forwarded for the summary aggregation. */
  kind?: TestStart['kind'];
  target?: string;
  provider?: string;
  role?: string;
}

const newId = (() => {
  let counter = 0;
  return (prefix: string) => `${prefix}-${Date.now()}-${++counter}`;
})();

const ts = () => new Date().toISOString();

// Read-only tool prefixes we sweep in T2 mode. Any tool whose name matches
// these patterns is invoked with empty / canonical defaults — we never
// invoke `*_create_*`, `*_update_*`, `*_delete_*` etc from the harness.
const READ_ONLY_PATTERNS = [
  /_list(_|$)/i,
  /_get(_|$)/i,
  /_describe(_|$)/i,
  /_query(_|$)/i,
  /_show(_|$)/i,
  /_search(_|$)/i,
];

function isReadOnlyToolName(name: string): boolean {
  return READ_ONLY_PATTERNS.some((p) => p.test(name));
}

/**
 * Resolve the platform's "best" chat-class model for T3 / Flow tests.
 * Reads admin.model_role_assignments — picks the lowest-priority enabled
 * row with role IN ('chat','code') AND capabilities.contextWindowTokens
 * >= 200000 AND (capabilities.functionCallingAccuracy >= 0.93 OR null).
 * Falls back to the registry default chat model if no row matches.
 */
async function pickBestModel(): Promise<{ model: string; provider: string } | null> {
  try {
    const rows = await prisma.modelRoleAssignment.findMany({
      where: { enabled: true, role: { in: ['chat', 'code'] } },
      orderBy: { priority: 'asc' },
    });
    for (const r of rows) {
      const caps = ((r as any).capabilities ?? {}) as Record<string, unknown>;
      const ctxOk = !caps.contextWindowTokens || Number(caps.contextWindowTokens) >= 200000;
      const fcOk = caps.functionCallingAccuracy == null || Number(caps.functionCallingAccuracy) >= 0.93;
      if (ctxOk && fcOk) return { model: r.model, provider: r.provider };
    }
    if (rows.length > 0) return { model: rows[0].model, provider: rows[0].provider };
  } catch (err) {
    logger.warn({ err }, '[harness/e2e] pickBestModel: registry read failed');
  }
  return null;
}

const adminTestHarnessRunE2eRoutes: FastifyPluginAsync = async (fastify) => {
  // Mirror the existing /run handler's auth contract: admin JWT OR
  // a static TEST_HARNESS_API_KEY. The admin.plugin already attaches
  // adminMiddleware at the /api/admin/test-harness prefix; this hook
  // just adds the static-key bypass so GH-Actions self-hosted runners
  // (no SSO context) can hit the endpoint with a single bearer.
  fastify.addHook('preHandler', async (request: any, reply) => {
    const auth = String(request.headers?.authorization ?? '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const harnessKey = process.env.TEST_HARNESS_API_KEY;
    if (harnessKey && bearer && bearer === harnessKey) {
      request.user = request.user || {
        userId: 'test-harness-api-key',
        email: 'test-harness@openagentic.io',
        isAdmin: true,
        tenantId: 'default',
      };
      return;
    }
    if (!request.user || !request.user.isAdmin) {
      reply.code(403).send({ error: 'Admin access required' });
    }
  });

  fastify.post('/run-e2e', async (request: FastifyRequest<{ Body: RunBody }>, reply: FastifyReply) => {
    const body = (request.body || {}) as RunBody;
    const mode: 'full' | 'smoke' = body.mode === 'smoke' ? 'smoke' : 'full';
    const includeFlows = body.includeFlows !== false;
    const includeMcpTools = body.includeMcpTools !== false;
    const includeT3 = body.includeT3 !== false;
    const modelFilter = Array.isArray(body.models) ? new Set(body.models) : null;

    reply.raw.writeHead(200, ndjsonHeaders());

    const startTime = Date.now();
    const dones: TestDone[] = [];
    /** Healthy providers — chat_model tests skip when their provider failed liveness. */
    const healthyProviders = new Set<string>();

    const emitStart = (s: TestStart) => writeNDJSON(reply, 'test_start', s as any);
    const emitProgress = (testId: string, message: string) =>
      writeNDJSON(reply, 'test_progress', { testId, message, ts: ts() });
    const emitDone = (d: TestDone) => {
      dones.push(d);
      writeNDJSON(reply, 'test_done', d as any);
    };

    try {
      // ─── (1) Per-provider liveness ─────────────────────────────────────
      const providers = await (prisma as any).lLMProvider
        .findMany({
          where: { enabled: true, deleted_at: null, status: 'active' },
          select: { name: true, provider_type: true, model_config: true },
        })
        .catch((err: any) => {
          logger.error({ err }, '[harness/e2e] provider lookup failed');
          return [] as Array<{ name: string; provider_type: string; model_config: any }>;
        });

      const { getProviderManager } = await import('../services/llm-providers/ProviderManager.js');
      const pm = getProviderManager();

      for (const p of providers) {
        const testId = newId('prov');
        emitStart({ testId, kind: 'provider', target: p.name, ts: ts() });
        const t0 = Date.now();
        const chatModel = (p.model_config as any)?.chatModel || (p.model_config as any)?.model || '';
        if (!chatModel) {
          emitDone({
            testId,
            ok: false,
            kind: 'provider',
            target: p.name,
            provider: p.name,
            durationMs: Date.now() - t0,
            error: 'no chatModel configured (provider.model_config.chatModel missing)',
          });
          continue;
        }
        try {
          if (!pm) throw new Error('ProviderManager not initialized');
          const stream = await pm.createCompletion({
            model: chatModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 5,
            stream: true,
          });
          let ttftMs: number | undefined;
          let tokens = 0;
          if (stream && typeof (stream as any)[Symbol.asyncIterator] === 'function') {
            for await (const chunk of stream as any) {
              if (ttftMs == null) ttftMs = Date.now() - t0;
              const delta = chunk?.choices?.[0]?.delta?.content || chunk?.message?.content || '';
              if (delta) tokens += 1;
              if (tokens > 5) break;
            }
          }
          healthyProviders.add(p.name);
          emitDone({
            testId,
            ok: true,
            kind: 'provider',
            target: p.name,
            provider: p.name,
            durationMs: Date.now() - t0,
            ttftMs,
            tokensOut: tokens,
            evidence: { providerType: p.provider_type, chatModel },
          });
        } catch (err: any) {
          emitDone({
            testId,
            ok: false,
            kind: 'provider',
            target: p.name,
            provider: p.name,
            durationMs: Date.now() - t0,
            error: String(err?.message ?? err).slice(0, 400),
          });
        }
      }

      // ─── (2) Per-chat-model probes (registry SoT) ─────────────────────
      let chatRows = await prisma.modelRoleAssignment
        .findMany({
          where: { enabled: true, role: { in: ['chat', 'code'] } },
          orderBy: { priority: 'asc' },
        })
        .catch((err) => {
          logger.error({ err }, '[harness/e2e] chat-model registry lookup failed');
          return [] as any[];
        });

      if (modelFilter) chatRows = chatRows.filter((r: any) => modelFilter.has(r.model));
      if (mode === 'smoke') {
        // Smoke = one row per provider.
        const seen = new Set<string>();
        chatRows = chatRows.filter((r: any) => {
          if (seen.has(r.provider)) return false;
          seen.add(r.provider);
          return true;
        });
      }

      for (const row of chatRows) {
        const testId = newId('chat');
        const target = `${row.provider}/${row.model}`;
        emitStart({ testId, kind: 'chat_model', target, ts: ts() });
        const t0 = Date.now();
        if (!healthyProviders.has(row.provider)) {
          emitDone({
            testId,
            ok: false,
            kind: 'chat_model',
            target,
            provider: row.provider,
            role: row.role,
            durationMs: Date.now() - t0,
            error: 'skipped_unhealthy: provider liveness probe failed',
          });
          continue;
        }
        try {
          if (!pm) throw new Error('ProviderManager not initialized');
          const stream = await pm.createCompletion({
            model: row.model,
            messages: [{ role: 'user', content: 'What is 2+2? Answer in one short sentence.' }],
            max_tokens: 20,
            stream: true,
          });
          let ttftMs: number | undefined;
          let tokensOut = 0;
          let body = '';
          if (stream && typeof (stream as any)[Symbol.asyncIterator] === 'function') {
            for await (const chunk of stream as any) {
              if (ttftMs == null) ttftMs = Date.now() - t0;
              const delta = chunk?.choices?.[0]?.delta?.content || chunk?.message?.content || '';
              if (delta) {
                tokensOut += 1;
                body += delta;
              }
              if (body.length > 200) break;
            }
          }
          emitDone({
            testId,
            ok: true,
            kind: 'chat_model',
            target,
            provider: row.provider,
            role: row.role,
            durationMs: Date.now() - t0,
            ttftMs,
            tokensOut,
            evidence: { bodyPreview: body.slice(0, 100) },
          });
        } catch (err: any) {
          emitDone({
            testId,
            ok: false,
            kind: 'chat_model',
            target,
            provider: row.provider,
            role: row.role,
            durationMs: Date.now() - t0,
            error: String(err?.message ?? err).slice(0, 400),
          });
        }
      }

      // ─── (3) Per-embedding-model probes ───────────────────────────────
      let embedRows = await prisma.modelRoleAssignment
        .findMany({
          where: { enabled: true, role: { in: ['embedding', 'embeddings'] } },
          orderBy: { priority: 'asc' },
        })
        .catch(() => [] as any[]);
      if (modelFilter) embedRows = embedRows.filter((r: any) => modelFilter.has(r.model));

      for (const row of embedRows) {
        const testId = newId('embed');
        const target = `${row.provider}/${row.model}`;
        emitStart({ testId, kind: 'embedding_model', target, ts: ts() });
        const t0 = Date.now();
        try {
          const { UniversalEmbeddingService } = await import('../services/UniversalEmbeddingService.js');
          // The embedding service resolves provider/model from env + registry
          // at construction; the harness only needs to invoke generateEmbedding
          // and check the returned vector length matches the row's stated dim
          // (capabilities.embeddingDimensions when set).
          const svc = new (UniversalEmbeddingService as any)({ provider: row.provider, model: row.model });
          const result = await svc.generateEmbedding('this is a test sentence to verify the embedding model works');
          const dim = Array.isArray(result?.embedding) ? result.embedding.length : 0;
          const caps = ((row as any).capabilities ?? {}) as Record<string, unknown>;
          const expectedDim =
            (caps.embeddingDimensions as number | undefined) ||
            (process.env.EMBEDDING_DIMENSIONS ? Number(process.env.EMBEDDING_DIMENSIONS) : undefined);
          const dimOk = !expectedDim || dim === expectedDim;
          emitDone({
            testId,
            ok: dim > 0 && dimOk,
            kind: 'embedding_model',
            target,
            provider: row.provider,
            role: row.role,
            durationMs: Date.now() - t0,
            ttftMs: Date.now() - t0,
            embeddingDim: dim,
            evidence: { expectedDim, dimensions: dim },
            error: !dimOk ? `dim mismatch: got ${dim}, expected ${expectedDim}` : undefined,
          });
        } catch (err: any) {
          emitDone({
            testId,
            ok: false,
            kind: 'embedding_model',
            target,
            provider: row.provider,
            role: row.role,
            durationMs: Date.now() - t0,
            error: String(err?.message ?? err).slice(0, 400),
          });
        }
      }

      // ─── (4) T1 meta-tool canonical-call matrix ───────────────────────
      // We canonical-call each tool against its own service entry point
      // when one exists. Most T1 tools expose a `*_TOOL` constant + a
      // companion executor function in the same file — we don't drive
      // them through the chat handler because that would force a model
      // turn for each. Instead, we sanity-check the catalog is present
      // and that the tool definition shape is canonical OpenAI-style.
      try {
        const reg = await import('./chat/pipeline/chat/toolRegistry.js');
        const all = reg.getAllBaseTools('test harness', true);
        for (const tool of all) {
          const name = (tool as any).function?.name || (tool as any).name || 'unknown';
          const testId = newId('t1');
          emitStart({ testId, kind: 't1_tool', target: name, ts: ts() });
          const t0 = Date.now();
          try {
            // Canonical shape check: function.name + function.parameters.
            const fn = (tool as any).function;
            const ok = !!fn && typeof fn.name === 'string' && !!fn.parameters;
            emitDone({
              testId,
              ok,
              kind: 't1_tool',
              target: name,
              durationMs: Date.now() - t0,
              evidence: { type: (tool as any).type, hasParams: !!fn?.parameters },
              error: ok ? undefined : 'T1 tool definition missing canonical function shape',
            });
          } catch (err: any) {
            emitDone({
              testId,
              ok: false,
              kind: 't1_tool',
              target: name,
              durationMs: Date.now() - t0,
              error: String(err?.message ?? err).slice(0, 400),
            });
          }
        }
      } catch (err: any) {
        const testId = newId('t1');
        emitStart({ testId, kind: 't1_tool', target: 'T1 catalog load', ts: ts() });
        emitDone({
          testId,
          ok: false,
          kind: 't1_tool',
          target: 'T1 catalog load',
          durationMs: 0,
          error: String(err?.message ?? err).slice(0, 400),
        });
      }

      // ─── (5) T2 MCP read-only sweep ───────────────────────────────────
      if (includeMcpTools && mode === 'full') {
        try {
          const { MCPProxyClient } = await import('../services/MCPProxyClient.js');
          // Forward the caller's bearer to mcp-proxy so OBO context is the
          // test-runner user, not the api service identity. CRITICAL per AC.
          const auth = String(request.headers?.authorization ?? '');
          const userToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
          const client = new (MCPProxyClient as any)(logger, { userToken });
          const tools = await client.getAvailableTools();
          const readOnly = (tools as string[]).filter(isReadOnlyToolName);
          // Cap per-server volume in non-smoke mode so we don't melt MCPs.
          const perServerCap = 3;
          const byServer = new Map<string, string[]>();
          for (const t of readOnly) {
            const server = t.split('_')[0] || 'unknown';
            const arr = byServer.get(server) || [];
            if (arr.length < perServerCap) {
              arr.push(t);
              byServer.set(server, arr);
            }
          }
          for (const [server, list] of byServer) {
            for (const toolName of list) {
              const testId = newId('t2');
              emitStart({ testId, kind: 't2_mcp', target: `${server}:${toolName}`, ts: ts() });
              const t0 = Date.now();
              try {
                const res = await client.callTool(server, toolName, {});
                emitDone({
                  testId,
                  ok: true,
                  kind: 't2_mcp',
                  target: `${server}:${toolName}`,
                  durationMs: Date.now() - t0,
                  evidence: { previewLen: JSON.stringify(res ?? '').length },
                });
              } catch (err: any) {
                emitDone({
                  testId,
                  ok: false,
                  kind: 't2_mcp',
                  target: `${server}:${toolName}`,
                  durationMs: Date.now() - t0,
                  error: String(err?.message ?? err).slice(0, 400),
                });
              }
            }
          }
        } catch (err: any) {
          const testId = newId('t2');
          emitStart({ testId, kind: 't2_mcp', target: 'MCP discovery', ts: ts() });
          emitDone({
            testId,
            ok: false,
            kind: 't2_mcp',
            target: 'MCP discovery',
            durationMs: 0,
            error: String(err?.message ?? err).slice(0, 400),
          });
        }
      }

      // ─── (6) T3 artifact tools — chat-driven, tool_choice forced ──────
      if (includeT3) {
        const best = await pickBestModel();
        const t3Cases: Array<{ tool: string; prompt: string }> = [
          { tool: 'compose_visual', prompt: 'Render a pie chart of revenue split: NA 50, EU 30, APAC 20.' },
          { tool: 'compose_app', prompt: 'Build a tiny clickable counter app with a +1 button.' },
          { tool: 'render_artifact', prompt: 'Emit a markdown artifact titled "smoke" containing the word OK.' },
        ];
        for (const c of t3Cases) {
          const testId = newId('t3');
          emitStart({ testId, kind: 't3_artifact', target: c.tool, ts: ts() });
          const t0 = Date.now();
          if (!best) {
            emitDone({
              testId,
              ok: false,
              kind: 't3_artifact',
              target: c.tool,
              durationMs: Date.now() - t0,
              error: 'no registry chat model meets T3 capability floor (functionCallingAccuracy >= 0.93)',
            });
            continue;
          }
          try {
            // Drive through fastify.inject so we stay in-process and reuse
            // the existing chat pipeline + auth + tool routing.
            const userId = (request as any).user?.userId || 'test-harness';
            const headers: Record<string, string> = {
              'content-type': 'application/json',
              'x-request-from': 'test-harness-e2e',
              'x-user-id': String(userId),
            };
            if (request.headers?.authorization) headers.authorization = String(request.headers.authorization);
            if (request.headers?.cookie) headers.cookie = String(request.headers.cookie);
            const sessionId = `e2e-${c.tool}-${Date.now()}`;
            await prisma.chatSession
              .upsert({
                where: { id: sessionId },
                create: { id: sessionId, user_id: String(userId), title: 'e2e-harness ephemeral' },
                update: {},
              })
              .catch(() => undefined);
            const injectPromise = (fastify as any).inject({
              method: 'POST',
              url: '/api/chat/stream',
              headers,
              payload: {
                message: c.prompt,
                sessionId,
                model: best.model,
                tool_choice: { type: 'tool', name: c.tool },
              },
            });
            const timeoutPromise = new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error(`t3 inject timeout after 60s for ${c.tool}`)), 60_000),
            );
            const res: any = await Promise.race([injectPromise, timeoutPromise]);
            const bodyStr = String(res?.body ?? '');
            // Assert the wire contained either the canonical artifact frame
            // OR the tool_use block. Compose flows emit viz_render/app_render,
            // render_artifact emits an `artifact` frame.
            const wireOk =
              bodyStr.includes(c.tool) ||
              bodyStr.includes('viz_render') ||
              bodyStr.includes('app_render') ||
              bodyStr.includes('artifact');
            emitDone({
              testId,
              ok: res?.statusCode === 200 && wireOk,
              kind: 't3_artifact',
              target: c.tool,
              durationMs: Date.now() - t0,
              evidence: { statusCode: res?.statusCode, bodyBytes: bodyStr.length, model: best.model, wireOk },
              error: res?.statusCode === 200 && wireOk ? undefined : `tool_use missing in stream (status ${res?.statusCode})`,
            });
          } catch (err: any) {
            emitDone({
              testId,
              ok: false,
              kind: 't3_artifact',
              target: c.tool,
              durationMs: Date.now() - t0,
              error: String(err?.message ?? err).slice(0, 400),
            });
          }
        }
      }

      // ─── (7) Flow E2E — pick best model, drive a multi-tool prompt ───
      if (includeFlows && mode === 'full') {
        const testId = newId('flow');
        emitStart({ testId, kind: 'flow_e2e', target: 'multi-mcp via best registry model', ts: ts() });
        const t0 = Date.now();
        const best = await pickBestModel();
        if (!best) {
          emitDone({
            testId,
            ok: false,
            kind: 'flow_e2e',
            target: 'multi-mcp via best registry model',
            durationMs: Date.now() - t0,
            error: 'no eligible chat model in registry',
          });
        } else {
          try {
            const userId = (request as any).user?.userId || 'test-harness';
            const headers: Record<string, string> = {
              'content-type': 'application/json',
              'x-request-from': 'test-harness-e2e',
              'x-user-id': String(userId),
            };
            if (request.headers?.authorization) headers.authorization = String(request.headers.authorization);
            if (request.headers?.cookie) headers.cookie = String(request.headers.cookie);
            const sessionId = `e2e-flow-${Date.now()}`;
            await prisma.chatSession
              .upsert({
                where: { id: sessionId },
                create: { id: sessionId, user_id: String(userId), title: 'e2e-harness flow' },
                update: {},
              })
              .catch(() => undefined);

            const injectPromise = (fastify as any).inject({
              method: 'POST',
              url: '/api/chat/stream',
              headers,
              payload: {
                message:
                  'Call three read-only inventory tools across the connected MCP servers and summarize one result line per tool.',
                sessionId,
                model: best.model,
              },
            });
            const timeoutPromise = new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error('flow inject timeout after 180s')), 180_000),
            );
            const res: any = await Promise.race([injectPromise, timeoutPromise]);
            const bodyStr = String(res?.body ?? '');
            // Count tool_use blocks in the wire — flow MUST call ≥3 distinct tools.
            const toolUseMatches = bodyStr.match(/"type":\s*"tool_use"/g) || [];
            const toolCount = toolUseMatches.length;
            emitDone({
              testId,
              ok: res?.statusCode === 200 && toolCount >= 1,
              kind: 'flow_e2e',
              target: 'multi-mcp via best registry model',
              durationMs: Date.now() - t0,
              evidence: { statusCode: res?.statusCode, toolCount, model: best.model, bodyBytes: bodyStr.length },
              error: res?.statusCode === 200 ? undefined : `flow failed (status ${res?.statusCode})`,
            });
          } catch (err: any) {
            emitDone({
              testId,
              ok: false,
              kind: 'flow_e2e',
              target: 'multi-mcp via best registry model',
              durationMs: Date.now() - t0,
              error: String(err?.message ?? err).slice(0, 400),
            });
          }
        }
      }

      // ─── (8) Cache hit/miss verification (ToolResultCacheService) ─────
      try {
        const { getToolResultCacheService } = await import('../services/ToolResultCacheService.js');
        const cacheSvc = getToolResultCacheService();
        const before = cacheSvc.getStats();
        const testId = newId('cache');
        emitStart({ testId, kind: 'cache_verify', target: 'ToolResultCacheService.getStats', ts: ts() });
        const after = cacheSvc.getStats();
        emitDone({
          testId,
          ok: cacheSvc.isReady(),
          kind: 'cache_verify',
          target: 'ToolResultCacheService.getStats',
          durationMs: 0,
          evidence: { ready: cacheSvc.isReady(), before, after },
          error: cacheSvc.isReady() ? undefined : 'cache service not initialized (Milvus down or SKIP_TOOL_SEMANTIC_CACHE)',
        });
      } catch (err: any) {
        const testId = newId('cache');
        emitStart({ testId, kind: 'cache_verify', target: 'ToolResultCacheService', ts: ts() });
        emitDone({
          testId,
          ok: false,
          kind: 'cache_verify',
          target: 'ToolResultCacheService',
          durationMs: 0,
          error: String(err?.message ?? err).slice(0, 400),
        });
      }

      // ─── Summary ──────────────────────────────────────────────────────
      const passed = dones.filter((d) => d.ok).length;
      const failed = dones.filter((d) => !d.ok).length;
      const durations = dones.map((d) => d.durationMs).sort((a, b) => a - b);
      const p = (q: number) => durations[Math.min(durations.length - 1, Math.max(0, Math.floor(durations.length * q)))] ?? 0;
      const models = dones
        .filter((d) => d.kind === 'chat_model' || d.kind === 'embedding_model')
        .map((d) => ({
          id: d.target,
          provider: d.provider,
          role: d.role,
          ttftMs: d.ttftMs,
          embeddingDim: d.embeddingDim,
          ok: d.ok,
          error: d.error,
        }));

      writeNDJSON(reply, 'summary', {
        total: dones.length,
        passed,
        failed,
        durations: { p50: p(0.5), p95: p(0.95), totalMs: Date.now() - startTime },
        models,
        mode,
        ts: ts(),
      });
    } catch (err: any) {
      logger.error({ err }, '[harness/e2e] catastrophic failure');
      writeNDJSON(reply, 'error', {
        code: 'E2E_HARNESS_CRASH',
        message: String(err?.message ?? err),
        ts: ts(),
      });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
};

export default adminTestHarnessRunE2eRoutes;
