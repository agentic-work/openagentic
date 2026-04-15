/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
import { ChatPipeline } from './pipeline/ChatPipeline.js';
import { getToolApprovalGate } from '../../services/ToolApprovalGate.js';
import { ChatSessionService } from './services/ChatSessionService.js';
import { ChatAuthService } from './services/ChatAuthService.js';
import { ChatValidationService } from './services/ChatValidationService.js';
import { ChatPromptService } from './services/ChatPromptService.js';
import { ChatMCPService } from './services/ChatMCPService.js';
import { ChatCompletionService } from './services/ChatCompletionService.js';
import { ChatAnalyticsService } from './services/ChatAnalyticsService.js';
import { ChatCacheService } from './services/ChatCacheService.js';
import { AzureTokenService } from '../../services/AzureTokenService.js';
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
import { sessionHandler } from './handlers/session.handler.js';
import { messageHandler } from './handlers/message.handler.js';
import { ChatRequest, ChatError, ChatErrorCode } from './interfaces/chat.types.js';

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

  // Initialize services - use fastify.log instead of pino logger
  const azureTokenService = new AzureTokenService(fastify.log);
  
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
    prompt: new ChatPromptService(options.chatStorage, fastify.log, options.redis, options.milvus), // Added Milvus for semantic routing
    mcp: new ChatMCPService(fastify.log),
    completion: completionService,
    capabilities: capabilitiesService,
    analytics: new ChatAnalyticsService(options.chatStorage, fastify.log),
    cache: cacheService,
    azureToken: azureTokenService,
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

  // Initialize pipeline
  const pipeline = new ChatPipeline(services, fastify.log, options.config || {});

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
        pipeline: pipeline.isHealthy(),
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

        // REMOVED: getOrchestrator() - using MCP Proxy integration
        // const orchestrator = services.mcp.getOrchestrator();

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
          // Create a minimal chat request to test tool visibility
          // Use requested model or default from environment
          const testRequest = {
            messages: [{ role: 'user', content: message }],
            model: process.env.DEFAULT_MODEL,
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

        // REMOVED: getOrchestrator() - using MCP Proxy integration
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
  fastify.get('/mcp/status', { preHandler: authMiddleware }, async (request: any, reply) => {
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
  fastify.get('/mcp-functions', { preHandler: authMiddleware }, async (request: any, reply) => {
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
    preHandler: authMiddleware,
    schema: {
      tags: ['Chat'],
      summary: 'List available AI models',
      description: 'Get all AI models available for chat completions with their capabilities and pricing',
      response: {
        200: {
          type: 'object',
          properties: {
            models: {
              type: 'array',
              items: { type: 'object', additionalProperties: true }
            },
            count: { type: 'number' }
          }
        },
        401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
        500: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }]
    }
  }, async (request, reply) => {
    try {
      // Use the simpler /api/models endpoint that already works
      const response = await fetch('http://localhost:8005/api/models', {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      return reply.send(data);
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch models from /api/models, falling back to Azure discovery');
      // Fallback to the original Azure discovery if needed
      const { getModelsHandler } = await import('./models.js');
      return getModelsHandler(request as any, reply, options.chatStorage);
    }
  });

  // Knowledge Base: Ingest content into shared (DLP-scrubbed) or private Milvus collection
  fastify.post('/knowledge/ingest', { preHandler: authMiddleware }, async (request: any, reply) => {
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
  fastify.post('/knowledge/search', { preHandler: authMiddleware }, async (request: any, reply) => {
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
  fastify.get('/models/available', { preHandler: authMiddleware }, async (request: any, reply) => {
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
  fastify.get('/models/default', { preHandler: authMiddleware }, async (request: any, reply) => {
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
  fastify.get('/capabilities', { preHandler: authMiddleware }, async (request, reply) => {
    const { getCapabilitiesHandler } = await import('./capabilities.js');
    return getCapabilitiesHandler(request as any, reply);
  });

  // Main streaming endpoint (requires authentication)
  fastify.post('/stream', {
    preHandler: authMiddleware,
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
  }, streamHandler(pipeline, logger));

  // Get available MCP tools (requires authentication)
  fastify.get('/tools', { preHandler: authMiddleware }, async (request: any, reply) => {
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
  fastify.post('/tool-approval/:requestId', { preHandler: authMiddleware }, async (request: any, reply) => {
    const { requestId } = request.params;
    const { approved } = request.body as { approved: boolean };
    const userId = request.user?.id || request.user?.userId || 'unknown';

    // Path 1: in-process inline chat ReAct loop pending approval
    const gate = getToolApprovalGate(logger);
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
  fastify.get('/tool-approvals/pending', { preHandler: authMiddleware }, async (request: any, reply) => {
    const gate = getToolApprovalGate(logger);
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

      const providerManager = (global as any).providerManager;

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
      const providerManager = (global as any).providerManager;
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