/**
 * Modern Chat API - Comprehensive implementation with TDD approach
 * 
 * Features:
 * - Server-Sent Events (SSE) streaming
 * - MCP integration with per-user instances
 * - Advanced prompt engineering
 * - Chain of Thought (CoT) support
 * - Multimedia handling
 * - Token tracking and analytics
 * - Comprehensive error handling
 */

import { FastifyPluginAsync } from 'fastify';
import { pino } from 'pino';
import type { Logger } from 'pino';
// V1 ChatPipeline removed in Wave 5 (chatmode-ux-mock-parity Phase 1).
// File deleted entirely. Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §142, §240.
import { buildChatV2Deps } from '../../services/buildChatV2Deps.js';
import { getBuiltInAgents } from '../../services/BuiltInAgentRegistry.js';
// Option B (2026-05-13) — chatmode reads agents from prisma.agent (DB SoT).
import { listAgentsFromDbSync } from '../../services/listAgentsFromDb.js';
import { resolveChatModel } from './resolveChatModel.js';
import type { ChatStreamHandlerDeps } from './handlers/stream.handler.js';
import { getPermissionService } from '../../services/PermissionService.js';
import { ChatSessionService } from './services/ChatSessionService.js';
import { ChatAuthService } from './services/ChatAuthService.js';
import { ChatValidationService } from './services/ChatValidationService.js';
import { ChatMCPService } from './services/ChatMCPService.js';
import { ChatCompletionService } from './services/ChatCompletionService.js';
import { ChatAnalyticsService } from './services/ChatAnalyticsService.js';
import { ChatCacheService } from './services/ChatCacheService.js';
import { ExtendedCapabilitiesService } from '../../services/ModelCapabilitiesService.js';
import { TitleGenerationService } from '../../services/TitleGenerationService.js';
// import { PromptTechniqueService } from '../../services/PromptTechniqueService.js'; // REMOVED: Prompt techniques disabled
import { DirectiveService } from '../../services/DirectiveService.js';
import { TokenUsageService } from '../../services/TokenUsageService.js';
import { SemanticCacheService } from '../../services/SemanticCache.js';
import { getRedisClient } from '../../utils/redis-client.js';
import { FileAttachmentService } from '../../services/FileAttachmentService.js';
// ImageGenerationService removed — image gen now goes through ProviderManager
import { RAGService } from '../../services/RAGService.js';
import { ModelHealthCheckService } from '../../services/ModelHealthCheck.js';
import { KnowledgeIngestionService } from '../../services/KnowledgeIngestionService.js';
// DiagramEnhancementService removed - diagrams now use React Flow client-side via system MCP
import { prisma } from '../../utils/prisma.js';
import { authMiddleware, authMiddlewarePlugin } from '../../middleware/unifiedAuth.js';
import { rateLimitMiddleware, rateLimitMiddlewarePlugin } from '../../middleware/rateLimiter.js';
import { requestLoggingMiddleware, loggingMiddlewarePlugin } from '../../middleware/logging.js';
import { streamHandler } from './handlers/stream.handler.js';
import { registerStreamTailRoute } from './stream-tail.route.js';
import { sessionHandler } from './handlers/session.handler.js';
import { messageHandler } from './handlers/message.handler.js';
import { ChatRequest, ChatError, ChatErrorCode } from './interfaces/chat.types.js';
import { getProviderManager } from '../../services/llm-providers/ProviderManager.js';

// Storage service interface
export interface IChatStorageService {
  createSession(options: any): Promise<any>;
  getSession(sessionId: string, userId?: string): Promise<any>;
  updateSession(sessionId: string, updates: any, userId?: string): Promise<any>;
  deleteSession(sessionId: string, userId?: string): Promise<void>;
  listSessions(options: any): Promise<any>;
  addMessage(sessionId: string, message: any): Promise<any>;
  getMessages(sessionId: string, options?: any): Promise<any>;
  updateMessage(messageId: string, updates: any): Promise<any>;
  deleteMessage(messageId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
  setRealTimeKnowledgeService?(service: any): void;
}

// Plugin configuration
export interface ChatPluginOptions {
  // Dependencies
  chatStorage: IChatStorageService;
  redis?: any;
  milvus?: any;
  getMilvus?: () => any; // Getter function for lazy loading Milvus service
  redisClient?: any; // Added for semantic search caching
  providerManager?: any; // ProviderManager for multi-provider LLM support

  // Configuration
  config?: {
    enableMCP?: boolean;
    enablePromptEngineering?: boolean;
    enableAnalytics?: boolean;
    enableCaching?: boolean;
    enableSemanticSearch?: boolean; // Added for semantic prompt selection
    enableCoT?: boolean; // Enable Chain of Thought display
    maxConcurrentRequests?: number;
    requestTimeoutMs?: number;
  };
}

// Main chat plugin
export const chatPlugin: FastifyPluginAsync<ChatPluginOptions> = async (fastify, options) => {
  const logger: any = pino({
    name: 'chat-api',
    level: process.env.LOG_LEVEL || 'info'
  });

  // Validate required dependencies
  if (!options.chatStorage) {
    throw new Error('ChatStorageService is required');
  }

  // Initialize capabilities service for intelligent model selection
  const capabilitiesService = new ExtendedCapabilitiesService({
    autoDiscovery: true,
    cacheCapabilities: true,
    discoveryIntervalMs: 300000 // 5 minutes
  });
  
  // Initialize advanced services
  const titleService = new TitleGenerationService({
    maxLength: 60,
    includeContext: true
  });
  
  // REMOVED: PromptTechniqueService disabled per user directive
  // const promptTechniqueService = new PromptTechniqueService(
  //   fastify.log as Logger
  // );

  const directiveService = new DirectiveService(fastify.log as Logger);
  
  const tokenUsageService = new TokenUsageService(
    fastify.log as Logger
  );
  
  // SemanticCacheService needs a CacheManager, not redis/milvus directly
  const redisClient = options.redis ? getRedisClient() : null;
  const semanticCache = redisClient ? new SemanticCacheService(
    redisClient,
    fastify.log as Logger
  ) : undefined;
  
  const fileAttachmentService = new FileAttachmentService({
    uploadDir: process.env.UPLOAD_DIR || '/tmp/uploads',
    thumbnailDir: process.env.THUMBNAIL_DIR || '/tmp/thumbnails'
  }, fastify.log as Logger);
  
  const ragService = options.milvus ? new RAGService(
    options.milvus,
    fastify.log
  ) : undefined;

  // Initialize KnowledgeIngestionService if Milvus is available
  const knowledgeIngestionService = options.milvus ? new KnowledgeIngestionService(
    options.milvus,
    fastify.log as Logger
  ) : undefined;
  
  // RealTimeKnowledgeService removed (dead code cleanup v0.6.0)
  // Automatic chat ingestion into Milvus was never fully activated
  const realTimeKnowledgeService = undefined;
  
  // DiagramEnhancementService removed - diagrams now use React Flow client-side via system MCP

  // Initialize cache service early so it can be passed to other services
  const cacheService = new ChatCacheService(options.redis, fastify.log);

  // Create completion service - use ProviderManager if available, otherwise fall back to ChatCompletionService
  let completionService: any;
  if (options.providerManager) {
    // Use ProviderManager for multi-provider support
    completionService = options.providerManager;
    fastify.log.info('Using ProviderManager for LLM completions');
  } else {
    // Fall back to legacy ChatCompletionService (Azure OpenAI only)
    completionService = new ChatCompletionService(fastify.log, cacheService);
    fastify.log.warn('ProviderManager not available - using legacy ChatCompletionService (Azure OpenAI only)');
  }

  // Create model health check with completion service
  const modelHealthCheck = new ModelHealthCheckService(
    fastify.log,
    completionService
  );

  const services = {
    session: new ChatSessionService(options.chatStorage, fastify.log, cacheService),
    auth: new ChatAuthService(fastify.log),
    validation: new ChatValidationService(fastify.log, options.chatStorage),
    mcp: new ChatMCPService(fastify.log),
    completion: completionService,
    capabilities: capabilitiesService,
    analytics: new ChatAnalyticsService(options.chatStorage, fastify.log),
    cache: cacheService,
    redis: options.redis,
    // Pass getter function or use direct milvus option
    milvus: options.milvus,
    getMilvus: options.getMilvus, // Pass the getter function directly
    // Advanced services
    titleService,
    promptTechniqueService: undefined, // REMOVED: Prompt techniques disabled
    directiveService,
    tokenUsageService,
    semanticCache,
    fileAttachmentService,
    ragService,
    modelHealthCheck,
    knowledgeIngestionService,
    realTimeKnowledgeService
  };

  // Phase E.8.g+h (2026-05-11): the legacy in-api orchestrator factory
  // was ripped along with the orchestrator class itself. Sub-agent
  // dispatch now goes through `chatLoopRecursor` via
  // `makeRunSubagentViaRecursorPerCall`, wired below through the
  // `recursorGetAgents` deps slot. Build V2 pipeline deps in place of
  // the V1 ChatPipeline instance. The deps struct is shared across every
  // chat-stream request; per-request inputs (mcpTools, model,
  // priorMessages) are sourced through the streamHandler's
  // `ChatStreamHandlerDeps` (below).

  // TASK #524 — wire wave-1 services into V2 deps so the pipeline can
  // (a) classify intent, (b) rank/subset MCP tools per intent, (c) emit
  // intent_classified + tool_shortlist NDJSON frames the UI consumes.
  // Each handle is best-effort: when a singleton is unavailable (early
  // boot, test harness), the V2 pipeline degrades to defaults.
  const ctx = (fastify as any).app;
  // Phase E.1 (2026-05-10) — intentClassifier wiring REMOVED.
  // Spec §50: model decides; no pre-LLM classifier.

  // RouterTuningService — instantiate if missing on AppContext (it's not
  // currently a tracked AppContext field). Singleton-cached internally.
  //
  // Capture the underlying service in a separate `const` before wrapping so
  // the closure does NOT self-reference. Earlier shape:
  //
  //   wave1RouterTuning = getRouterTuningService(...);
  //   wave1RouterTuning = { getTuning: () => wave1RouterTuning.getTuning() };
  //
  // ...left the arrow body referring to the wrapper itself (since
  // `wave1RouterTuning` was reassigned), so every `getTuning()` call
  // infinite-recursed and threw `Maximum call stack size exceeded`. The
  // resulting cascade fallback dropped MCP tools to 0 across every chatmode
  // turn from 2026-04-29 17:14 EDT (commit 85b6a539) onward. Pinned by
  // `__tests__/architecture/no-router-tuning-self-reference.source-regression.test.ts`.
  let wave1RouterTuning: any;
  try {
    const { getRouterTuningService } = await import('../../services/RouterTuningService.js');
    const redis = getRedisClient();
    const tuningService = getRouterTuningService(prisma, redis as any);
    // The pipeline needs `getTuning()`, but RouterTuningService exposes that
    // method directly. Map to the `RouterTuningLike` shape — closure
    // captures the const above, NOT the outer wrapper variable.
    wave1RouterTuning = { getTuning: () => tuningService.getTuning() };
  } catch (err: any) {
    fastify.log.warn({ err: err?.message }, '[chat] RouterTuningService init failed — V2 pipeline will use built-in topK defaults');
  }

  // Phase E.2 (2026-05-10) — per-intent tool ranker rip. The chat-side
  // ranker dep stays optional in BuildChatV2DepsOptions for back-compat
  // with the V2 pipeline stub; we pass `undefined` so the deps factory
  // skips the ranker wiring entirely. tool discovery now happens via the
  // model invoking `tool_search` mid-turn (Phase B-vrip).
  const wave1ToolRanker: any = undefined;

  // T1 ARCHITECTURE (2026-05-02) — built-in agent dispatch wiring. When
  // the Task tool dispatches a built-in agent (cloud-operations,
  // code-execution, etc.) the sub-agent runner hands the sub-agent the
  // same T1 meta-tool surface the parent ships — [Task, compose_visual,
  // render_artifact, request_clarification, browser_sandbox_exec,
  // memorize, tool_search, agent_search]. NO wholesale wildcard
  // expansion (the previous `expandAgentTools` pre-T1 path drowned small
  // models in 120 cloud tools). The sub-agent discovers operational
  // tools at run-time via `tool_search`. Frontmatter `tools:
  // ["azure_*", ...]` becomes metadata only — kept for telemetry /
  // future tool_search query biasing, but no longer materialized.
  //
  // The dispatch object stays `getBuiltInAgents + listMcpProxyTools`-
  // shaped because the sub-agent dispatch still needs the proxy snapshot
  // for discovered-name hydration paths and telemetry. mcp-proxy /tools
  // is an unauthenticated catalog read; auth/identity is applied at tool
  // execution time, not listing. (OSS is local-auth only — no OBO.)
  //
  // SEV-1 fix 2026-05-01 — built unconditionally. The dispatch resolver
  // needs only `getBuiltInAgents` + `listMcpProxyTools`, NOT the ranker.
  // The previous `wave1ToolRanker ? {…} : undefined` ternary blanked the
  // dispatch object whenever ranker init threw at boot (transient
  // redis/milvus/embeddings unavailability) — that propagated
  // `undefined` into the sub-agent dispatch, the inner guard
  // `if (builtInDeps?.getBuiltInAgents && builtInDeps.listMcpProxyTools)`
  // failed, sub-agents were dispatched with EMPTY scope. Tying the
  // resolver to the ranker was the root cause of "sub-agents don't run
  // tools." Pinned by
  // wave2-builtin-dispatch-unconditional.source-regression.test.ts.
  const wave2BuiltInDispatch = {
    // Option B (2026-05-13) — chatmode now reads its sub-agent registry
    // from `prisma.agent` via `listAgentsFromDbSync`. The DB is the single
    // source of truth; the 8 markdown built-ins are seeded into the DB at
    // boot by `14-agent-md-to-db-seeder.ts`. Admin-created custom agents
    // appear in the same lookup because they live in the same table.
    //
    // The cached snapshot reads sync; the underlying refresh is async +
    // TTL'd (60s) so admin-write → chatmode-visibility latency stays
    // bounded. Admin agent CRUD writes call `invalidateAgentsFromDbCache`
    // to force fresh reads immediately (mirrors the provider hot-reload
    // pattern in [[feedback_provider_hot_reload_after_write]]).
    //
    // Cold-start fallback: when the cache is empty (first turn before
    // refresh resolves), this falls back to the markdown-loaded
    // `getBuiltInAgents()` so chatmode never sees an empty registry
    // mid-boot.
    getBuiltInAgents: () => {
      const dbAgents = listAgentsFromDbSync();
      if (dbAgents.length > 0) {
        return dbAgents;
      }
      try {
        return getBuiltInAgents();
      } catch {
        return [];
      }
    },
    listMcpProxyTools: async () => {
      const resp = await services.mcp.listTools(undefined, 'system');
      return (resp?.tools as any[]) ?? [];
    },
  };

  const v2Deps = buildChatV2Deps({
    providerManager: options.providerManager,
    prismaLike: prisma,
    // Wave 5 — wire the chatStorage singleton so the deps struct surfaces
    // loadPriorMessages / persistUserMessage / persistAssistantMessage. The
    // stream handler reads these directly off the v2Deps via the
    // streamHandlerDeps mapping below; without them the V2 pipeline would
    // forget every prior turn and lose history.
    // Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §272-302.
    chatStorage: options.chatStorage as any,
    // Phase E.1 — intentClassifier dep dropped.
    toolRanker: wave1ToolRanker,
    routerTuning: wave1RouterTuning,
    // TASK #535 v2 — built-in agent cascade dispatch.
    builtInDispatch: wave2BuiltInDispatch,
    // Phase E.8.g+h — `deps.runSubagent` is recursor-backed by default.
    // The caller MUST stamp `parentCtx[RECURSOR_CTX_SLOTS.parentDeps]`
    // + `[parentSequencer]` + `[parentTurnId]` onto the per-turn RunCtx
    // BEFORE dispatch. Without those slots, sub-agent dispatch returns
    // a structured "not wired" error rather than crashing the turn — see
    // `makeRunSubagentViaRecursorPerCall` in makeRunSubagentViaRecursor.ts.
    //
    // NOTE: runChat.ts currently overwrites deps.runSubagent with
    // `makeOpenAgenticProxyRunSubagent(ctx)` (out-of-process openagentic-proxy
    // dispatch). The recursor path here is the in-process alternative
    // that lands when the per-turn ctx slots are wired in runChat.
    recursorGetAgents: wave2BuiltInDispatch.getBuiltInAgents as any,
  });

  // Per-request helpers wired into the stream handler. listMcpTools comes
  // from the existing ChatMCPService; pickModel goes through resolveChatModel
  // so the DB-backed default-chat-model continues to be the SoT.
  // Wave 5: loadPriorMessages / persistUserMessage / persistAssistantMessage
  // forward to the chatStorage-backed callbacks attached to v2Deps.
  const streamHandlerDeps: ChatStreamHandlerDeps = {
    v2Deps,
    loadPriorMessages: v2Deps.loadPriorMessages,
    persistUserMessage: v2Deps.persistUserMessage,
    persistAssistantMessage: v2Deps.persistAssistantMessage,
    listMcpTools: async (authHeader: string | undefined, userId: string) => {
      const resp = await services.mcp.listTools(authHeader, userId);
      const tools = (resp?.tools as any[]) ?? [];
      // #516 — MCP Proxy returns native MCP shape ({name, description,
      // inputSchema, server}); meta-tools are OpenAI shape. OllamaProvider's
      // convertToolsToOllama filters on `.function?.name`, so unnormalized
      // MCP tools get silently dropped. Normalize at this boundary so the
      // V2 pipeline + every provider downstream operate on a single shape.
      const { normalizeToolArray } = await import('../../utils/normalizeMcpToolToOpenAI.js');
      return normalizeToolArray(tools);
    },
    pickModel: async (input) => {
      // Look up the session's persisted model (set by /sessions PUT).
      let sessionModel: string | undefined;
      try {
        const session = await prisma.chatSession.findUnique({
          where: { id: input.sessionId },
          select: { metadata: true },
        });
        const meta: any = session?.metadata ?? {};
        sessionModel = typeof meta?.model === 'string' ? meta.model : undefined;
      } catch {
        /* swallow */
      }

      // Q1-fix-10 — read the prior assistant message's stamped taskType
      // for conversation-context inheritance. The router classifier uses
      // this to keep agentic follow-ups ("break it down by day") routed
      // to a capable model instead of falling through to pure-chat → gpt-
      // oss:20b. Best-effort: any failure (no prior message, no metadata,
      // db error) silently yields undefined and the classifier behaves
      // as fresh-prompt path.
      let priorClassification: string | undefined;
      try {
        const last = await prisma.chatMessage.findFirst({
          where: { session_id: input.sessionId, role: 'assistant' },
          orderBy: { created_at: 'desc' },
          select: { metadata: true },
        });
        const m: any = last?.metadata ?? null;
        const t = m && typeof m.taskType === 'string' ? m.taskType : undefined;
        if (t) priorClassification = t;
      } catch {
        /* swallow — fresh-prompt classification on db blip */
      }

      // Sentinel passthroughs: callers that send 'smart-router'/'auto'/empty
      // should fall through to the SmartModelRouter (or DB default); only
      // a real concrete model id counts as an explicit override.
      const explicit = input.requestedModel;
      const isSentinel =
        !explicit ||
        explicit === 'auto' ||
        explicit === 'smart-router' ||
        explicit.trim() === '';
      // Pull SmartModelRouter from AppContext (decorated by server.ts at
      // bootstrap). When present, resolveChatModel consults it for the
      // intent='chat'/'unclear'/null cheapest-for-chat branch (C3) — the
      // step that makes the Smart-Router agency layering actually fire on
      // live chat. When absent, falls through to the DB-backed default.
      const appCtx = (fastify as any).app;
      const smartRouter = appCtx?.smartModelRouter ?? null;
      return resolveChatModel({
        explicitModel: isSentinel ? null : explicit,
        sessionModel,
        message: input.message,
        // VISION (sev1): forward the image-bearing-turn signal so the router
        // request content is shaped as an image_url array → requiresVision=true
        // → vision-capable candidate filter fires (steers to Sonnet/Opus/
        // Gemini/gpt-4o instead of the vision:false default chat model).
        hasVision: input.hasVision,
        smartRouter,
        priorClassification,
      });
    },
  };

  // Surfaced for the /health endpoint below — V2 pipeline doesn't carry
  // construction state (just deps), so the closest "isHealthy" signal is
  // whether the providerManager dep was supplied.
  const pipelineHealthy = (): boolean => Boolean(v2Deps.providerManager);

  // Register middleware
  await fastify.register(loggingMiddlewarePlugin, { logger: fastify.log });

  // Register rate limiting middleware with Redis backing
  await fastify.register(rateLimitMiddlewarePlugin, {
    rateLimitPerMinute: options.config?.maxConcurrentRequests || 60,
    rateLimitPerHour: (options.config?.maxConcurrentRequests || 60) * 20, // 20x the per-minute limit
    redis: options.redis
  });

  // Error handler
  fastify.setErrorHandler<ChatError>((error, request, reply) => {
    logger.error({ 
      error: error.message, 
      code: error.code,
      url: request.url,
      method: request.method 
    }, 'Chat API error');

    const statusCode = getStatusCodeFromError(error);
    
    reply.code(statusCode).send({
      error: {
        code: error.code || ChatErrorCode.INTERNAL_ERROR,
        message: error.message,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { details: error.details })
      }
    });
  });

  // Health check
  fastify.get('/health', async (request, reply) => {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        pipeline: pipelineHealthy(),
        storage: await services.session.healthCheck(),
        mcp: await services.mcp.healthCheck(),
        cache: await services.cache.healthCheck()
      }
    };

    const allHealthy = Object.values(health.services).every(status => status);

    reply.code(allHealthy ? 200 : 503).send(health);
  });
  
  // Debug endpoints (with auth middleware)
  fastify.register(async (fastify) => {
    // Apply auth middleware to all routes in this plugin
    fastify.addHook('preHandler', authMiddleware);
    
    // Debug endpoint to check auth
    fastify.get('/debug/auth', async (request: any, reply) => {
      const authHeader = request.headers.authorization;
      return reply.send({
        hasAuthHeader: !!authHeader,
        authHeaderValue: authHeader ? `${authHeader.substring(0, 20)}...` : null,
        user: request.user || null,
        timestamp: new Date().toISOString()
      });
    });

    // Debug endpoint to test tool availability for AI model
    fastify.get('/debug/tools', async (request: any, reply) => {
      try {
        const userId = request.user?.id || request.user?.userId;
        const authHeader = request.headers.authorization;
        
        // Get tools from MCP service
        const toolsResponse = await services.mcp.listTools(authHeader, userId);

        return reply.send({
          userId,
          hasAuthHeader: !!authHeader,
          mcpService: {
            tools: toolsResponse.tools || [],
            toolsByServer: toolsResponse.toolsByServer || {},
            totalTools: toolsResponse.tools?.length || 0
          },
          orchestrator: {
            available: false,
            note: 'Using direct LLM provider integration - orchestrator removed'
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        return reply.code(500).send({
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Debug endpoint to trace chat pipeline
    fastify.post('/debug/chat-pipeline', async (request: any, reply) => {
      try {
        const { message } = request.body as { message: string };
        const userId = request.user?.id || request.user?.userId;
        
        if (!message) {
          return reply.code(400).send({ error: 'Message required' });
        }

        // Create a debug context to trace pipeline execution
        const debugContext = {
          user: request.user,
          message,
          userId,
          stages: [],
          tools: {
            available: [],
            called: [],
            results: []
          },
          timestamp: new Date().toISOString()
        };

        // Get available tools
        const authHeader = request.headers.authorization;
        const toolsResponse = await services.mcp.listTools(authHeader, userId);
        debugContext.tools.available = toolsResponse.tools || [];

        // Test if chat completion service can see tools
        const completionService = services.completion;
        let toolsInCompletion = null;
        try {
          // Create a minimal chat request to test tool visibility.
          // DB is SoT — the diagnostic probe uses whatever model the admin
          // currently has configured, not a stale env var.
          const { ModelConfigurationService } = await import('../../services/ModelConfigurationService.js');
          const probeModel = await ModelConfigurationService.getDefaultChatModel().catch(() => undefined);
          const testRequest = {
            messages: [{ role: 'user', content: message }],
            model: probeModel,
            tools: toolsResponse.tools,
            user: request.user
          };
          
          toolsInCompletion = {
            toolsPassedToModel: testRequest.tools?.length || 0,
            toolsAvailable: testRequest.tools || []
          };
        } catch (e) {
          toolsInCompletion = { error: e.message };
        }

        debugContext.stages.push({
          stage: 'tool_discovery',
          toolsFound: toolsResponse.tools?.length || 0,
          toolsInCompletion
        });

        return reply.send(debugContext);
      } catch (error) {
        return reply.code(500).send({
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Debug endpoint to manually execute a tool
    fastify.post('/debug/execute-tool', async (request: any, reply) => {
      try {
        const { toolName, args } = request.body as { toolName: string; args: any };
        const userId = request.user?.id || request.user?.userId;
        const authHeader = request.headers.authorization;
        
        if (!toolName) {
          return reply.code(400).send({ error: 'toolName required' });
        }

        return reply.code(500).send({
          error: 'Direct tool execution not supported with MCP Proxy integration',
          note: 'Tools are executed automatically during chat completions',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        return reply.code(500).send({
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
      }
    });
  });

  // Get MCP status
  fastify.get('/mcp/status', { onRequest: authMiddleware }, async (request: any, reply) => {
    try {
      const authHeader = request.headers.authorization;
      const userId = request.user?.id || request.user?.userId;
      const mcpHealth = await services.mcp.healthCheck();
      const toolsResponse = await services.mcp.listTools(authHeader, userId);
      
      const status = {
        connected: mcpHealth,
        servers: {},  
        totalTools: toolsResponse.tools?.length || 0,
        lastUpdated: new Date().toISOString()
      };
      
      // Group tools by server
      if (toolsResponse.toolsByServer) {
        Object.entries(toolsResponse.toolsByServer).forEach(([serverId, tools]) => {
          status.servers[serverId] = {
            name: serverId === 'azure-mcp' ? 'Azure MCP' : serverId === 'memory-mcp' ? 'Memory MCP' : serverId,
            connected: true,
            toolCount: Array.isArray(tools) ? tools.length : 0,
            lastSeen: new Date().toISOString(),
            status: 'active'
          };
        });
      }
      
      logger.info(`MCP Status: ${status.totalTools} tools across ${Object.keys(status.servers).length} servers`);
      return reply.send(status);
    } catch (error) {
      logger.error({ error }, 'Failed to get MCP status');
      return reply.code(200).send({ 
        connected: false, 
        servers: {}, 
        totalTools: 0, 
        error: 'MCP service unavailable',
        lastUpdated: new Date().toISOString()
      });
    }
  });

  // Get MCP functions (alias for tools) - used by UI
  fastify.get('/mcp-functions', { onRequest: authMiddleware }, async (request: any, reply) => {
    try {
      const authHeader = request.headers.authorization;
      const userId = request.user?.id || request.user?.userId;
      
      logger.info({ 
        hasUser: !!request.user,
        userId,
        userObject: request.user,
        method: request.method,
        url: request.url 
      }, 'MCP functions endpoint called');
      
      if (!userId) {
        logger.warn('No user ID found in request for MCP functions');
        return reply.send({ 
          tools: {
            functions: []
          }
        });
      }
      
      try {
        const toolsResponse = await services.mcp.listTools(authHeader, userId);
        const tools = toolsResponse.tools || toolsResponse.functions || toolsResponse;
        logger.info({
          userId,
          toolsResponseType: typeof toolsResponse,
          hasTools: !!toolsResponse.tools,
          hasFunctions: !!toolsResponse.functions,
          toolCount: Array.isArray(tools) ? tools.length : 'not-array'
          // Removed toolsResponse to prevent massive log pollution
        }, 'Got response from MCP service');
        
        // Format as expected by UI
        return reply.send({ 
          tools: {
            functions: Array.isArray(tools) ? tools : []
          }
        });
      } catch (error) {
        logger.warn({ error }, 'MCP Orchestrator not available, returning empty functions list');
        return reply.send({ 
          tools: {
            functions: []
          }
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to list MCP functions');
      return reply.code(500).send({ error: 'Failed to list MCP functions' });
    }
  });

  // Get available OpenAI models - import from models handler
  fastify.get('/models', {
    onRequest: authMiddleware,
    schema: {
      tags: ['Chat'],
      summary: 'List available AI models',
      description: 'Get all AI models available for chat completions with their capabilities and pricing',
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            models: {
              type: 'array',
              items: { type: 'object', additionalProperties: true }
            },
            count: { type: 'number' },
            defaultModel: { type: 'string' },
            codemodeDefault: { type: ['string', 'null'] },
            availableCount: { type: 'number' },
            capabilities: { type: 'array', items: { type: 'string' } },
            providers: { type: 'array', items: { type: 'string' } },
            lastUpdated: { type: 'string' },
            provider_status: { type: 'object', additionalProperties: true },
            metadata: { type: 'object', additionalProperties: true }
          }
        },
        401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
        500: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }]
    }
  }, async (request, reply) => {
    // Always use the local handler so codemodeDefault + provider-aware
    // fields are preserved. The earlier internal-fetch proxy returned a
    // stripped {models, count} payload that broke the codemode default
    // resolver in the UI (it couldn't read codemodeDefault and fell back
    // to stale localStorage picks).
    const { getModelsHandler } = await import('./models.js');
    return getModelsHandler(request as any, reply, options.chatStorage);
  });

  // Knowledge Base: Ingest content into shared (DLP-scrubbed) or private Milvus collection
  fastify.post('/knowledge/ingest', { onRequest: authMiddleware }, async (request: any, reply) => {
    const user = request.user;
    const xUserId = request.headers['x-user-id'] as string;
    const userId = (user?.id?.startsWith('service-') && xUserId) ? xUserId : (user?.id || user?.userId);
    const body = request.body as any;

    if (!body?.content || !body?.collection) {
      return reply.code(400).send({ error: 'content and collection (shared|private) are required' });
    }

    try {
      const { ChatRAGService } = await import('../../services/ChatRAGService.js');
      const ragService = new ChatRAGService(fastify.log as any);
      const result = await ragService.ingestContent(
        body.content,
        body.collection as 'shared' | 'private',
        userId,
        body.metadata || {}
      );
      return reply.send({ success: true, ...result });
    } catch (error: any) {
      fastify.log.error({ error: error.message, userId }, 'Knowledge ingestion failed');
      return reply.code(500).send({ error: 'Ingestion failed', message: error.message });
    }
  });

  // Knowledge Base: Search knowledge bases
  fastify.post('/knowledge/search', { onRequest: authMiddleware }, async (request: any, reply) => {
    const user = request.user;
    const userId = user?.id || user?.userId;
    const body = request.body as any;

    if (!body?.query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    try {
      const { ChatRAGService } = await import('../../services/ChatRAGService.js');
      const ragService = new ChatRAGService(fastify.log as any);
      const result = await ragService.getRAGContext(body.query, userId, body.topK || 5);
      return reply.send({ success: true, results: result.results, searchTimeMs: result.searchTimeMs });
    } catch (error: any) {
      fastify.log.error({ error: error.message, userId }, 'Knowledge search failed');
      return reply.code(500).send({ error: 'Search failed', message: error.message });
    }
  });

  // List available models with permission check (UI model selector)
  fastify.get('/models/available', { onRequest: authMiddleware }, async (request: any, reply) => {
    const user = request.user;
    const isAdmin = user?.isAdmin === true;
    const prismaClient = prisma;

    let canSelectModels = isAdmin;
    if (!isAdmin && prismaClient) {
      try {
        const dbUser = await prismaClient.user.findUnique({
          where: { id: user?.id || user?.userId },
          select: { ui_preferences: true }
        });
        canSelectModels = (dbUser?.ui_preferences as any)?.allow_model_selection === true;
      } catch {}
    }

    if (!canSelectModels) {
      return reply.send({ models: [], canSelect: false, defaultMode: 'smart-router' });
    }

    try {
      const providers = await prismaClient.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null, status: 'active' },
        orderBy: { priority: 'asc' }
      });

      const models = providers.flatMap((p: any) => {
        const config = p.model_config as any || {};
        return [config.chatModel].filter(Boolean).map((m: string) => ({
          id: m,
          provider: p.provider_type,
          displayName: p.display_name || p.name,
          priority: p.priority
        }));
      });

      return reply.send({ models, canSelect: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Get default model from DB (used by workflows and code mode)
  fastify.get('/models/default', { onRequest: authMiddleware }, async (request: any, reply) => {
    try {
      const { ModelResolutionService } = await import('../../services/ModelResolutionService.js');
      const resolver = new ModelResolutionService(prisma, fastify.log as any);
      const model = await resolver.getDefaultModel();
      return reply.send({ model });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Get AI capabilities for this deployment
  fastify.get('/capabilities', { onRequest: authMiddleware }, async (request, reply) => {
    const { getCapabilitiesHandler } = await import('./capabilities.js');
    return getCapabilitiesHandler(request as any, reply);
  });

  // Main streaming endpoint (requires authentication)
  fastify.post('/stream', {
    onRequest: authMiddleware,
    schema: {
      tags: ['Chat'],
      summary: 'Stream chat completion',
      description: 'Send a message and receive streaming AI response via Server-Sent Events (SSE)',
      body: {
        type: 'object',
        required: ['message', 'sessionId'],
        properties: {
          message: { type: 'string', description: 'User message content' },
          sessionId: { type: 'string', description: 'Chat session ID' },
          model: { type: 'string', description: 'Model identifier (e.g., gpt-4, claude-3-opus)' },
          promptTechniques: {
            type: 'array',
            items: { type: 'string' },
            description: 'Prompt engineering techniques to apply'
          },
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                originalName: { type: 'string' },
                mimeType: { type: 'string' },
                size: { type: 'number' },
                data: { type: 'string', description: 'Base64 encoded file data' }
              }
            }
          },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                content: { type: 'string' },
                type: { type: 'string' }
              }
            }
          }
        }
      },
      response: {
        200: {
          description: 'Server-Sent Events stream',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                description: 'SSE stream with event: and data: lines. Events: message, tool_call, tool_result, done, error, thinking, metadata'
              }
            }
          }
        }
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }]
    }
  }, streamHandler(streamHandlerDeps, logger));

  // Durable-stream resume endpoint — GET /api/chat/stream/:sessionId/tail
  // See `stream-tail.route.ts` for the contract. Task #154.
  registerStreamTailRoute(fastify, { authMiddleware, logger });

  // Get available MCP tools (requires authentication)
  fastify.get('/tools', { onRequest: authMiddleware }, async (request: any, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.info('No Azure AD token provided for tools request - returning limited tools');
      }
      
      // Get userId from authenticated request
      const userId = request.user?.id || request.user?.oid || request.user?.userId;
      if (!userId) {
        logger.error('No user ID found in request for tools endpoint');
        return reply.code(401).send({ error: 'Authentication required' });
      }
      
      try {
        const toolsResponse = await services.mcp.listTools(authHeader, userId);
        const toolCount = toolsResponse.tools?.length || 0;
        const serverCount = Object.keys(toolsResponse.toolsByServer || {}).length;
        
        logger.info({ userId, toolCount, serverCount }, `Returning ${toolCount} tools from ${serverCount} servers for user ${userId}`);
        return reply.send({ tools: toolsResponse });
      } catch (error) {
        logger.warn({ error }, 'MCP Orchestrator not available, returning empty tools list');
        return reply.send({ tools: { tools: [], toolsByServer: {}, functions: [] } });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to list tools');
      return reply.code(500).send({ error: 'Failed to list tools' });
    }
  });

  // Session management endpoints (with auth middleware)
  fastify.register(async (fastify) => {
    // Apply auth middleware to all routes in this plugin
    fastify.addHook('preHandler', authMiddleware);

    fastify.post('/sessions', {
      schema: {
        tags: ['Chat'],
        summary: 'Create chat session',
        description: 'Create a new chat session for the authenticated user',
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Session title' },
            model: { type: 'string', description: 'Default model for this session' },
            metadata: { type: 'object', description: 'Additional metadata' }
          }
        },
        response: {
          201: { type: 'object', additionalProperties: true },
          401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }]
      }
    }, sessionHandler.create(services.session));

    fastify.get('/sessions', {
      schema: {
        tags: ['Chat'],
        summary: 'List chat sessions',
        description: 'Get all chat sessions for the authenticated user',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string', description: 'Maximum number of sessions to return' },
            offset: { type: 'string', description: 'Number of sessions to skip' },
            sortBy: { type: 'string', enum: ['updated_at', 'created_at'] },
            sortOrder: { type: 'string', enum: ['asc', 'desc'] }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              sessions: {
                type: 'array',
                items: { type: 'object', additionalProperties: true }
              },
              total: { type: 'number' }
            }
          },
          401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }]
      }
    }, sessionHandler.list(services.session));

    fastify.get('/sessions/:sessionId', {
      schema: {
        tags: ['Chat'],
        summary: 'Get chat session',
        description: 'Get a specific chat session by ID',
        params: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId']
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
          404: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }]
      }
    }, sessionHandler.get(services.session));

    fastify.put('/sessions/:sessionId', {
      schema: {
        tags: ['Chat'],
        summary: 'Update chat session',
        description: 'Update a chat session title or metadata',
        params: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId']
        },
        body: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            metadata: { type: 'object' },
            isActive: { type: 'boolean' }
          }
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
          404: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }]
      }
    }, sessionHandler.update(services.session));

    fastify.delete('/sessions/:sessionId', {
      schema: {
        tags: ['Chat'],
        summary: 'Delete chat session',
        description: 'Delete a chat session and all its messages',
        params: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId']
        },
        response: {
          204: {
            type: 'null',
            description: 'Session deleted successfully'
          },
          401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
          404: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }]
      }
    }, sessionHandler.delete(services.session));

    fastify.get('/sessions/search', {
      schema: {
        tags: ['Chat'],
        summary: 'Search chat sessions',
        description: 'Search chat sessions by title or content',
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search query' },
            limit: { type: 'string' },
            offset: { type: 'string' }
          },
          required: ['q']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              sessions: {
                type: 'array',
                items: { type: 'object', additionalProperties: true }
              },
              total: { type: 'number' }
            }
          },
          401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }]
      }
    }, sessionHandler.search(services.session));
  });

  // Message management endpoints (with auth middleware)
  fastify.register(async (fastify) => {
    // Apply auth middleware to all routes in this plugin  
    fastify.addHook('preHandler', authMiddleware);
    
    fastify.get('/sessions/:sessionId/messages', messageHandler.list(services.session));
    fastify.post('/sessions/:sessionId/messages', async (request, reply) => {
      // Redirect to the streaming endpoint
      return reply.code(301).send({
        error: 'Redirect to streaming endpoint',
        message: 'Use POST /api/chat/stream for sending messages',
        streamEndpoint: '/api/chat/stream'
      });
    });
    fastify.get('/sessions/:sessionId/messages/:messageId', messageHandler.get(services.session));
    fastify.delete('/sessions/:sessionId/messages/:messageId', messageHandler.delete(services.session));
  });

  // Analytics endpoints (admin only)
  fastify.register(async (fastify) => {
    fastify.addHook('preHandler', async (request, reply): Promise<void> => {
      if (!(request as any).user?.isAdmin) {
        return reply.code(403).send({
          error: {
            code: 'ADMIN_REQUIRED',
            message: 'Administrative privileges required'
          }
        });
      }
      return; // Explicit return when user is admin
    });
    
    fastify.get('/analytics/usage', async (request, reply) => {
      const usage = await services.analytics.getUsageStats(request.query as any);
      return reply.send(usage);
    });
    
    fastify.get('/analytics/performance', async (request, reply) => {
      const metrics = await services.analytics.getPerformanceMetrics(request.query as any);
      return reply.send(metrics);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HITL: Tool Approval endpoint — UI calls this to approve/deny MCP tools
  // ═══════════════════════════════════════════════════════════════════════
  fastify.post('/tool-approval/:requestId', { onRequest: authMiddleware }, async (request: any, reply) => {
    const { requestId } = request.params;
    const { approved } = request.body as { approved: boolean };
    const userId = request.user?.id || request.user?.userId || 'unknown';

    // Path 1: in-process inline chat ReAct loop pending approval
    const gate = getPermissionService(logger);
    const inProcessResolved = gate.submitApproval(requestId, approved, userId);

    // Path 2: HITL-A — sub-agent (openagentic-proxy) listens on hitl:result:{requestId}
    // Redis pub/sub. openagentic-proxy AgentRunner subscribes BEFORE emitting the SSE
    // event, so the race window is closed — a publish is sufficient. Publish
    // unconditionally so both paths converge on a single approval id and the chat
    // UI doesn't need to know which path it goes through.
    let redisPublished = false;
    try {
      const { getRedisClient } = await import('../../utils/redis-client.js');
      const redis = getRedisClient();
      const channel = `hitl:result:${requestId}`;
      const payload = JSON.stringify({
        decision: approved ? 'approved' : 'denied',
        approvedBy: userId,
        requestId,
        timestamp: Date.now(),
      });
      const recipients = await redis.publish(channel, payload);
      redisPublished = true;
      logger.info({ requestId, recipients }, '[HITL] Redis publish to hitl:result channel');
    } catch (err: any) {
      logger.debug({ err: err.message, requestId }, '[HITL] Redis publish failed (sub-agent listeners may miss event)');
    }

    if (!inProcessResolved && !redisPublished) {
      return reply.code(404).send({ error: 'Approval request not found or expired' });
    }

    logger.info({ requestId, approved, userId, inProcess: inProcessResolved, viaRedis: redisPublished }, '[HITL] Approval response submitted via API');
    return reply.send({ ok: true, requestId, approved, inProcess: inProcessResolved, viaRedis: redisPublished });
  });

  // HITL: Get pending approvals (admin or current user)
  fastify.get('/tool-approvals/pending', { onRequest: authMiddleware }, async (request: any, reply) => {
    const gate = getPermissionService(logger);
    const pending = gate.getPendingApprovals();
    return reply.send({ approvals: pending });
  });

  // Image generation endpoint (uses ProviderManager with failover)
  fastify.post('/generate-image', async (request, reply) => {
    try {
      const body = request.body as any;
      const { prompt, size, quality, style, userId, sessionId } = body;

      if (!prompt || typeof prompt !== 'string') {
        return reply.code(400).send({ error: 'Prompt is required and must be a string' });
      }

      const providerManager = getProviderManager();

      const result = await providerManager.generateImage({
        prompt,
        size: size || '1024x1024',
        n: 1
      });

      // Store image in MinIO and return URL (so agents/callers get a usable URL)
      let imageUrl: string | undefined;
      let imageId: string | undefined;
      try {
        const { ImageStorageService } = await import('../../services/ImageStorageService.js');
        const storageService = new ImageStorageService(logger as any);
        const effectiveUserId = userId || (request as any).user?.id || 'system';
        imageId = await storageService.storeImage(
          result.imageBase64,
          prompt,
          effectiveUserId,
          { model: result.model, format: 'png', revisedPrompt: result.revisedPrompt }
        );
        const cleanId = imageId.replace(/\.png$/, '');
        imageUrl = `/api/images/${cleanId}.png`;
        logger.info({ imageId: cleanId, userId: effectiveUserId }, 'Image stored in MinIO');
      } catch (storeErr: any) {
        logger.warn({ err: storeErr.message }, 'Failed to store image in MinIO');
      }

      return reply.send({
        success: true,
        imageBase64: result.imageBase64,
        imageUrl,
        imageId,
        revisedPrompt: result.revisedPrompt,
        responseTime: result.generationTimeMs,
        model: result.model,
        provider: result.provider
      });
    } catch (error: any) {
      logger.error('Image generation endpoint error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });

  // Test image generation endpoint
  fastify.get('/test-image-generation', async (request, reply) => {
    try {
      const providerManager = getProviderManager();
      const result = await providerManager.generateImage({
        prompt: 'Test image generation with GPT-5-chat'
      });

      return reply.send({
        success: true,
        imageBase64: result.imageBase64,
        revisedPrompt: result.revisedPrompt,
        responseTime: result.generationTimeMs,
        model: result.model,
        provider: result.provider
      });
    } catch (error: any) {
      logger.error('Image generation test error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });

  // User data management endpoints
  fastify.register(async (fastify) => {
    fastify.addHook('preHandler', authMiddleware);
    
    // Soft delete user's own chats or admin delete any user's chats
    fastify.post('/delete-my-chats', async (request, reply) => {
      const { softDeleteUserChatsHandler } = await import('./user-data-management.js');
      return softDeleteUserChatsHandler(request as any, reply);
    });
    
    // Get chat statistics (admin or own stats)
    fastify.get('/stats/:userId', async (request, reply) => {
      const { getUserChatStatsHandler } = await import('./user-data-management.js');
      return getUserChatStatsHandler(request as any, reply);
    });
  });

  // Admin-only data management endpoints
  fastify.register(async (fastify) => {
    fastify.addHook('preHandler', async (request, reply): Promise<void> => {
      if (!(request as any).user?.isAdmin) {
        return reply.code(403).send({
          error: {
            code: 'ADMIN_REQUIRED',
            message: 'Administrative privileges required'
          }
        });
      }
      return; // Explicit return when user is admin
    });
    
    // Admin: permanently delete old soft-deleted messages
    fastify.post('/permanent-delete-old', async (request, reply) => {
      const { permanentDeleteOldMessagesHandler } = await import('./user-data-management.js');
      return permanentDeleteOldMessagesHandler(request as any, reply);
    });
  });

  // MCP management endpoints (admin only)
  fastify.register(async (fastify) => {
    fastify.addHook('preHandler', async (request, reply): Promise<void> => {
      if (!(request as any).user?.isAdmin) {
        return reply.code(403).send({
          error: {
            code: 'ADMIN_REQUIRED',
            message: 'Administrative privileges required'
          }
        });
      }
      return; // Explicit return when user is admin
    });
    
    fastify.get('/mcp/servers', async (request, reply) => {
      const servers = await services.mcp.listServers();
      return reply.send({ servers });
    });
    
    fastify.get('/mcp/instances', async (request, reply) => {
      const instances = await services.mcp.listInstances();
      return reply.send({ instances });
    });
    
    fastify.post('/mcp/instances/:serverId/restart', async (request, reply) => {
      const { serverId } = request.params as { serverId: string };
      await services.mcp.restartServer(serverId);
      return reply.send({ success: true });
    });
  });

  logger.info('Modern Chat API initialized successfully');
};

// Helper functions
function getStatusCodeFromError(error: ChatError): number {
  switch (error.code) {
    case ChatErrorCode.AUTHENTICATION_REQUIRED:
      return 401;
    case ChatErrorCode.INVALID_SESSION:
    case ChatErrorCode.INVALID_MESSAGE:
      return 400;
    case ChatErrorCode.RATE_LIMITED:
      return 429;
    case ChatErrorCode.TOKEN_LIMIT_EXCEEDED:
      return 413;
    default:
      return 500;
  }
}

function adminOnlyMiddleware(request: any, reply: any, done: any) {
  if (!request.user?.isAdmin) {
    return reply.code(403).send({
      error: {
        code: 'ADMIN_REQUIRED',
        message: 'Administrative privileges required'
      }
    });
  }
  done();
}

export default chatPlugin;