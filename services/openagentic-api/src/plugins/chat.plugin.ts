/**
 * Chat Routes Plugin — Phase 3.1 of server.ts decomposition.
 *
 * This is the HIGH-LEVEL WRAPPER that groups all chat-domain route
 * registrations behind a single Fastify plugin export.  It is distinct from
 * `routes/chat/index.ts` (which IS itself a Fastify plugin — named `chatPlugin`
 * — that implements the actual chat handler logic).
 *
 * Sub-routes registered here:
 *  1. chatPlugin          — main modern chat system     → /api/chat/*
 *  2. approvalsRoutes     — HITL approval endpoint      → /api/chat/approvals/:id
 *  3. sandboxResultRoute  — browser-sandbox receiver    → /api/chat/sandbox-result
 *  4. agentEventRoute     — openagentic-proxy bridge          → /api/chat/agent-event
 *  5. agentEventRoute     — DUAL-MOUNT (alias)          → /api/agent-event
 *     (same handler, two prefixes — see Phase C.2 comment in server.ts)
 *
 * Constructor-time options that cannot be read from request.server.app are
 * accepted via ChatRoutesPluginOptions.  Runtime-available context (chatStorage,
 * providerManager, milvusClient) is read from request.server.app.X (decorated
 * by Phase 1's decorateApp call) when passed as undefined — the underlying
 * chatPlugin constructor requires chatStorage, so we fall through to
 * ctx.chatStorage if options.chatStorage is not supplied.
 *
 * All sub-registrations are wrapped in individual try/catch blocks matching the
 * style established in server.ts so a single failing sub-route never blocks the
 * others.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import type { AppContext } from '../context/AppContext.js';
import { getRedisClient } from '../utils/redis-client.js';
import { featureFlags } from '../config/featureFlags.js';
import { chatPlugin } from '../routes/chat/index.js';
import { approvalsRoutes, permissionsApprovalsRoutes } from '../routes/chat/approvals.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { sandboxResultRoute } from '../routes/chat/sandbox-result.route.js';
import type { ChatStorageService } from '../services/ChatStorageService.js';
import type { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';

export interface ChatRoutesPluginOptions {
  /**
   * Optional: override chatStorage from AppContext. When undefined the plugin
   * reads ctx.chatStorage from the decorated Fastify instance (request.server.app).
   */
  chatStorage?: ChatStorageService;

  /** Optional: override providerManager from AppContext. */
  providerManager?: ProviderManager;

  /** Optional: override milvusClient from AppContext. */
  milvusClient?: MilvusClient;

  /** Enable Chain of Thought display. Defaults to featureFlags.enableCoT (ENABLE_COT env var). */
  enableCoT?: boolean;

  /**
   * Maximum concurrent requests for the chat pipeline.  Default: 60.
   */
  maxConcurrentRequests?: number;

  /**
   * Request timeout in milliseconds for the chat pipeline.  Default: 120 000.
   */
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// The wrapper plugin (named `chatRoutesPlugin` to distinguish it from the
// underlying `chatPlugin` in routes/chat/index.ts).
// ---------------------------------------------------------------------------

const chatRoutesPlugin: FastifyPluginAsync<ChatRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  options: ChatRoutesPluginOptions,
) => {
  loggers.routes.info('Registering chat routes plugin...');

  // Resolve deps — prefer explicit options, fall back to AppContext decoration.
  // `fastify.app` is available here because decorateApp() runs before this plugin
  // is registered in server.ts.
  const ctx: AppContext | undefined = fastify.app;
  const chatStorage = options.chatStorage ?? ctx?.chatStorage;
  const providerManager = options.providerManager ?? ctx?.providerManager;
  const milvusClient = options.milvusClient ?? ctx?.milvusClient;

  // Redis client — obtained via the same singleton getter used in server.ts.
  const redisClient = getRedisClient();

  // ── 1. Main modern chat system ──────────────────────────────────────────
  try {
    await fastify.register(chatPlugin, {
      prefix: '/api/chat',
      chatStorage,
      redis: redisClient as any,
      // Pass both milvus and getMilvus for ValidationStage MemoryContextService
      milvus: milvusClient,
      getMilvus: () =>
        ctx?.milvusVectorService ??
        milvusClient,
      providerManager: providerManager as any,
      config: {
        enableMCP: true,
        enablePromptEngineering: true,
        enableAnalytics: true,
        enableCaching: true,
        enableCoT: options.enableCoT ?? featureFlags.enableCoT,
        maxConcurrentRequests: options.maxConcurrentRequests ?? 60,
        requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
      },
    });
    loggers.routes.info('New modern chat system registered at /api/chat');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register new chat system');
  }

  // ── 2. HITL approval endpoint ───────────────────────────────────────────
  // Sev-0 fix (2026-05-12 audit): both approval route surfaces wear
  // authMiddleware on `onRequest`. Previously these were registered
  // un-authenticated, letting any HTTP client resolve any pending
  // approval by guessing requestId. Combined with the ownership check
  // in PermissionService.submitApproval (same audit), cross-user
  // approval bypass is now closed at TWO layers.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('onRequest', authMiddleware);
      await instance.register(approvalsRoutes);
    }, { prefix: '/api/chat' });
    loggers.routes.info('HITL approval routes registered at /api/chat/approvals/:id (authMiddleware)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register HITL approval routes');
  }

  // ── 2b. v3 UI permissions/approvals endpoint (Sev-0 #85, 2026-05-12) ───
  // ChatContainer ca76ab76 POSTs to /api/permissions/approvals/:id/(approve|deny).
  try {
    await fastify.register(async (instance) => {
      instance.addHook('onRequest', authMiddleware);
      await instance.register(permissionsApprovalsRoutes);
    }, { prefix: '/api' });
    loggers.routes.info('Permissions-approvals routes registered at /api/permissions/approvals/:id/{approve,deny} (authMiddleware)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register permissions-approvals routes');
  }

  // ── 3. Browser-sandbox result receiver ─────────────────────────────────
  // Task #158 — in-browser Python/JS analysis tool. UI posts exec results here
  // after running snippets requested via `browser_exec_request` NDJSON frames.
  try {
    await fastify.register(sandboxResultRoute, { prefix: '/api/chat' });
    loggers.routes.info('Sandbox result route registered at /api/chat/sandbox-result');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register sandbox result route');
  }

  // ── 4 + 5. Agent-event bridge — dual-mount ─────────────────────────────
  // Task #84 — openagentic-proxy bridge. Lets sub-agents report progress back into
  // the parent chat stream. Auth via X-Internal-Secret (internal svc).
  //
  // Phase C.2 (2026-04-23): the handler is namespace-agnostic — it keys on
  // the opaque `turnId` field of the POST body and publishes to
  // getAgentEventStore(). We mount it under BOTH prefixes so non-chat
  // callers (flows engine, /api/workflows executions) can POST to
  // `/api/agent-event` without routing through the chat namespace.
  // Agent-proxy's hardcoded /api/chat/agent-event callback URL keeps
  // working unchanged — both paths share the same route + dedupe LRU.
  //
  // Each mount is wrapped in its own try/catch so a failure of one does NOT
  // suppress the other — ops logs will reflect the true partial-mount state.
  let agentEventModule: any = null;
  try {
    agentEventModule = await import('../routes/chat/agent-event.route.js');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to import agent event route module');
  }

  if (agentEventModule) {
    const { agentEventRoute } = agentEventModule;

    try {
      await fastify.register(agentEventRoute, { prefix: '/api/chat' });
      loggers.routes.info('Agent event bridge route registered at /api/chat/agent-event');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register agent event bridge route at /api/chat');
    }

    try {
      await fastify.register(agentEventRoute, { prefix: '/api' });
      loggers.routes.info('Agent event bridge route registered at /api/agent-event');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register agent event bridge route at /api');
    }
  }

  loggers.routes.info('Chat routes plugin registered successfully');
};

export default fp(chatRoutesPlugin, {
  name: 'chat-routes',
  dependencies: [],
});
