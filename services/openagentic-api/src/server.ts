/**
 * OpenAgentic Chat API Server
 * 
 * Main Fastify server implementation with comprehensive middleware stack,
 * route registration, database initialization, and health monitoring.
 * Supports both REST API and Server-Sent Events (SSE) for real-time chat.
 * 
 */

// Centralized model config — validates DEFAULT_MODEL is set, crashes if not.
// This import MUST be early so we fail fast before any other initialization.
import { MODELS } from './config/models.js';
const getDefaultModel = () => MODELS.default;

import { prisma } from './utils/prisma.js';
import { getSecrets, logSecrets } from './config/secrets.config.js';

import Fastify from 'fastify';
import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import axios from 'axios';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { swaggerOptions, swaggerUiOptions } from './config/swagger.config.js';
// Security
import { securityPlugin } from './middleware/security.js';
import { authMiddleware, adminMiddleware } from './middleware/unifiedAuth.js';
import { adminGuard } from './middleware/adminGuard.js';
// Routes (WebSocket-based chat-postgres.js removed)
import { settingsRoutes } from './routes/settings.js';
// admin-orchestrator deleted - auth handled in chat routes
// import { authRoutes } from './routes/auth.js';
import { ChatStorageService } from './services/ChatStorageService.js';
import { ModelHealthCheckService } from './services/ModelHealthCheck.js';
import { ChatCompletionService } from './routes/chat/services/ChatCompletionService.js';
import { ChatCacheService } from './routes/chat/services/ChatCacheService.js';
import { RAGService } from './services/RAGService.js';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { MilvusVectorService } from './services/MilvusVectorService.js';
import ToolSemanticCacheService from './services/ToolSemanticCacheService.js';
import { getToolSuccessTrackingService } from './services/ToolSuccessTrackingService.js';
import { getIntentLinkingService } from './services/IntentLinkingService.js';
import { createRepositoryContainer, getRepositoryContainer, shutdownRepositoryContainer } from './repositories/RepositoryContainer.js';
import { logger, loggers, logServiceStartup, logServiceShutdown } from './utils/logger.js';
import { setupMetrics, startMetricsUpdates } from './metrics/index.js';
import { httpMetricsMiddleware } from './metrics/metricsMiddleware.js';
import { CachedPromptService } from './services/CachedPromptService.js';
import { UserService } from './services/UserService.js';
import { InitializationService } from './services/InitializationService.js';
import { getRedisClient, initializeRedis } from './utils/redis-client.js';
import { validateAdminPortalConfiguration } from './startup/validateAdminPortal.js';
import { ragInitService } from './services/RAGInitService.js';
import { MCPToolIndexingService } from './services/MCPToolIndexingService.js';
import { ToolPgvectorSearchService, setToolPgvectorSearchService } from './services/ToolPgvectorSearchService.js';
import { JobCompletionWatcher } from './services/JobCompletionWatcher.js';
import { ProviderManager } from './services/llm-providers/ProviderManager.js';
import { SmartModelRouter, setSmartModelRouter, getSmartModelRouter } from './services/SmartModelRouter.js';
import { ProviderConfigService } from './services/llm-providers/ProviderConfigService.js';
import ModelCapabilityRegistry, { setModelCapabilityRegistry } from './services/ModelCapabilityRegistry.js';
// Auth and permissions for WebSocket handlers
import { validateAnyToken } from './auth/tokenValidator.js';
import { UserPermissionsService } from './services/UserPermissionsService.js';
// Modular plugins (HIGH-001 refactoring)
import authPlugin from './plugins/auth.plugin.js';
import setupPlugin from './plugins/setup.plugin.js';
import adminPlugin from './plugins/admin.plugin.js';
import healthPlugin from './plugins/health.plugin.js';
import userPlugin from './plugins/user.plugin.js';
import legacyRedirectsPlugin from './plugins/legacy-redirects.plugin.js';
// FedRAMP AC-4: Row-Level Security context injection
import { rlsContextHook } from './middleware/rls-context.js';
// Pipeline Hook System (v0.5.0 hardening)
import { initializeHookRunner } from './pipeline/hooks.js';
import { registerBuiltInHooks } from './pipeline/built-in-hooks.js';

// Global provider manager, smart model router, and chat storage - initialized in start() function
let providerManager: ProviderManager | null = null;
let smartModelRouter: SmartModelRouter | null = null;
let chatStorage: ChatStorageService;

// Initialize model health check service (will be updated with Fastify logger later)
let modelHealthCheck: ModelHealthCheckService;

// Prisma client imported from utils/prisma

// Pool removed - services now use Prisma ORM

// Initialize Milvus client for RAG service (REQUIRED)
let milvusClient;
let ragService;
let milvusVectorService;
let documentIndexingService: any = null;
let toolSemanticCache: ToolSemanticCacheService;
let toolSemanticCacheInitialized = false;
let repositoryContainer: any = null;
let jobCompletionWatcher: JobCompletionWatcher;

// Milvus connection retry logic with extended retries for container startup
async function connectToMilvus(retries = 3, delay = 2000): Promise<MilvusClient> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Use MILVUS_ADDRESS if available, otherwise construct from HOST and PORT
      const milvusAddress = process.env.MILVUS_ADDRESS || 
        `${process.env.MILVUS_HOST || 'milvus-standalone'}:${process.env.MILVUS_PORT || '19530'}`;
      
      if (attempt === 1 || attempt % 5 === 0) {
        loggers.services.info(`🔄 Attempting to connect to Milvus at: ${milvusAddress} (attempt ${attempt}/${retries})`);
      }
      
      const client = new MilvusClient({
        address: milvusAddress,
        username: process.env.MILVUS_USERNAME || process.env.MILVUS_USER,
        password: process.env.MILVUS_PASSWORD,
        timeout: 30000 // 30 second timeout
      });
      
      // Test connection with health check
      const healthCheck = await client.checkHealth();
      if (healthCheck.isHealthy) {
        loggers.services.info(`✅ Milvus connected successfully on attempt ${attempt}`);
        return client;
      } else {
        throw new Error(`Milvus health check failed: ${JSON.stringify(healthCheck)}`);
      }
    } catch (error) {
      // Only log every 5th attempt to reduce noise
      if (attempt % 5 === 0 || attempt === 1) {
        loggers.services.warn({ 
          err: error, 
          attempt, 
          maxRetries: retries,
          nextRetryIn: delay
        }, `❌ Milvus connection attempt ${attempt}/${retries} failed`);
      }
      
      if (attempt === retries) {
        loggers.services.error({ err: error }, '🚨 CRITICAL: Failed to connect to Milvus after all retry attempts');
        throw new Error(`Milvus connection failed after ${retries} attempts: ${error.message}`);
      }
      
      // Wait before next retry - use consistent delay for stability
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Milvus connection failed');
}

// Milvus will be initialized during service startup with retry logic

// Initialize Redis client early for use in services
const redisClient = getRedisClient();

// Declare promptService - will be initialized after Milvus is ready
let promptService: CachedPromptService;

// Initialize UserService for admin user creation
const userService = new UserService(loggers.services);

// Initialize all services with first-time deployment tracking
async function initializeServices() {
  try {
    // Database schema is already initialized in start() function
    loggers.services.info('📋 Initializing system services and configurations...');
    
    // Initialize Redis client connection
    loggers.services.info('🔄 Initializing Redis client connection...');
    await initializeRedis(loggers.services);
    if (redisClient.isConnected()) {
      loggers.services.info('✅ Redis client connected successfully');

      // Start JobCompletionWatcher for autonomous job monitoring
      loggers.services.info('🔄 Starting JobCompletionWatcher for autonomous monitoring...');
      jobCompletionWatcher = new JobCompletionWatcher(redisClient, loggers.services);
      jobCompletionWatcher.start();
      loggers.services.info('✅ JobCompletionWatcher started - AI will auto-detect completed jobs');

      // Wire watcher events to SSE broadcasts for real-time notifications
      jobCompletionWatcher.on('job:completed', async (statusChange: any) => {
        loggers.services.info({
          jobId: statusChange.jobId,
          sessionId: statusChange.sessionId,
          status: statusChange.newStatus
        }, '📢 Broadcasting job completion to SSE clients');

        try {
          // Dynamic import to avoid circular dependencies
          const { broadcastJobCompletion } = await import('./routes/chat/handlers/stream.handler.js');
          broadcastJobCompletion({
            jobId: statusChange.jobId,
            sessionId: statusChange.sessionId,
            userId: statusChange.userId,
            result: statusChange.result,
            error: statusChange.error
          });

          loggers.services.info({
            jobId: statusChange.jobId,
            sessionId: statusChange.sessionId
          }, '✅ Job completion broadcasted to active SSE connections');
        } catch (error) {
          loggers.services.error({
            error: error.message,
            jobId: statusChange.jobId
          }, '❌ Failed to broadcast job completion');
        }
      });
    } else {
      loggers.services.warn('⚠️ Redis client failed to connect - continuing without cache');
    }

    // System prompts will be initialized by InitializationService in correct order
    loggers.services.info('📋 Prompt initialization will be handled by InitializationService');

    // Initialize CachedPromptService early (without Milvus initially)
    // Will be re-initialized with Milvus support later if Milvus connects
    promptService = new CachedPromptService(loggers.services, {
      enableCache: true,
      cacheTTL: 1800,
      cacheUserAssignments: true,
      cacheTemplates: true,
      milvusService: undefined // No Milvus yet
    });
    loggers.services.info('✅ CachedPromptService initialized (Milvus semantic search will be enabled if Milvus connects)');

    // Create InitializationService to handle first-time deployment
    const initService = new InitializationService(prisma, loggers.services);

    // Vault already initialized at startup - just verify it's available
    const vaultService = (global as any).vaultService;
    if (vaultService) {
      loggers.services.info('✅ Using Vault service initialized at startup');
    } else {
      loggers.services.warn('⚠️ Vault service not available - using environment variables');
    }
    
    // Check if system has been initialized
    const currentStatus = await initService.getInitializationStatus();
    loggers.services.info({
      isInitialized: currentStatus.isInitialized,
      completedComponents: currentStatus.completedComponents,
      lastInitialized: currentStatus.lastInitialized,
      version: currentStatus.version
    }, 'Current system initialization status');

    // Initialize RAG services (embedding models, vector DBs, etc.)
    loggers.services.info('🚀 Initializing RAG services...');
    const ragInitialized = await ragInitService.initialize();
    
    if (ragInitialized) {
      const ragHealth = ragInitService.getHealthStatus();
      loggers.services.info({
        healthy: ragHealth.healthy,
        embeddingProvider: ragHealth.components.embeddings.provider,
        embeddingModel: ragHealth.components.embeddings.model,
        milvusHealthy: ragHealth.components.milvus.healthy
      }, '✅ RAG services initialized successfully');

      // Semantic template routing is now handled by PromptTemplateSemanticService
      // (integrated into ChatPromptService and indexed during Milvus init)
      loggers.services.info('✅ Semantic template routing ready (Milvus-based)');

    } else {
      const ragError = ragInitService.getInitializationError();
      loggers.services.warn({ error: ragError }, '⚠️ RAG services failed to initialize - system will operate with limited capabilities');
      loggers.services.warn('💡 Set AZURE_OPENAI_EMBEDDING_DEPLOYMENT or AWS_EMBEDDING_MODEL_ID to enable embeddings');
    }

    // Initialize Adaptive Memory Services (UserMemory, UserProfile, FeedbackLearning)
    try {
      const { initUserMemoryService } = await import('./services/UserMemoryService.js');
      const { initUserProfileService } = await import('./services/UserProfileService.js');
      const { initFeedbackLearningService } = await import('./services/FeedbackLearningService.js');

      const milvusClient = (global as any).milvusClient || null;
      const embeddingService = (global as any).universalEmbeddingService || null;

      initUserMemoryService(prisma, redisClient.isConnected() ? redisClient as any : null, loggers.services, milvusClient, embeddingService);
      initUserProfileService(prisma, redisClient.isConnected() ? redisClient as any : null, loggers.services);
      initFeedbackLearningService(prisma, loggers.services);

      loggers.services.info('✅ Adaptive Memory services initialized (UserMemory, UserProfile, FeedbackLearning)');
    } catch (err) {
      loggers.services.warn({ err }, '⚠️ Adaptive Memory services failed to initialize - memory features will be limited');
    }

    // Initialize Bedrock Pricing Service (fetches live pricing from AWS API)
    if (process.env.AWS_BEDROCK_ENABLED === 'true') {
      loggers.services.info('💰 Initializing Bedrock Pricing Service...');
      try {
        const { bedrockPricingService } = await import('./services/BedrockPricingService.js');
        await bedrockPricingService.initialize();
        loggers.services.info({
          cachedModels: bedrockPricingService.getAllPricing().length
        }, '✅ Bedrock Pricing Service initialized (live AWS pricing)');
      } catch (err) {
        loggers.services.warn({ err }, '⚠️ Bedrock Pricing Service failed - using fallback pricing');
      }
    }

    // Initialize Azure AI Foundry Metrics Service (optional)
    loggers.services.info('📊 Initializing Azure AI Foundry Metrics Service...');
    try {
      const azureSubscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
      const azureResourceGroup = process.env.AZURE_RESOURCE_GROUP;
      const azureOpenAIAccount = process.env.AZURE_OPENAI_ACCOUNT_NAME;

      if (azureSubscriptionId && azureResourceGroup && azureOpenAIAccount) {
        const { initializeAIFoundryMetricsService } = await import('./services/AzureAIFoundryMetricsService.js');
        const aifMetricsService = initializeAIFoundryMetricsService({
          subscriptionId: azureSubscriptionId,
          resourceGroupName: azureResourceGroup,
          accountName: azureOpenAIAccount,
          metricsTimeRangeMinutes: parseInt(process.env.AIF_METRICS_TIME_RANGE_MINUTES || '10080'), // 7 days default
          refreshIntervalMinutes: parseInt(process.env.AIF_METRICS_REFRESH_INTERVAL_MINUTES || '5')
        }, loggers.services);

        // Start periodic collection
        await aifMetricsService.startPeriodicCollection();
        loggers.services.info({
          subscriptionId: azureSubscriptionId,
          resourceGroup: azureResourceGroup,
          account: azureOpenAIAccount
        }, '✅ Azure AI Foundry Metrics Service initialized and collecting metrics');
      } else {
        loggers.services.info('⏭️  Azure AI Foundry Metrics Service not configured (optional)');
        loggers.services.info('💡 Set AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and AZURE_OPENAI_ACCOUNT_NAME to enable AIF metrics');
      }
    } catch (error) {
      loggers.services.warn({ error }, '⚠️ Failed to initialize Azure AI Foundry Metrics Service - continuing without AIF metrics');
    }

    // MCP tool indexing will be initialized later after Milvus connection
    // to enable semantic search capabilities

    // Run first-time initialization with tracking (skips if already done)
    // Milvus is MANDATORY — no skip option
    const finalStatus = await initService.initializeSystem({
      skipIfDone: true,
      forceReinit: process.env.FORCE_REINIT === 'true',
      components: {
        prompts: true,
        adminUser: true,
        mcpServers: true,
        milvusCollections: true,
        mcpToolIndexing: true,
        azureValidation: true,
        systemSettings: true,
        databaseSchema: true
      }
    });

    loggers.services.info({
      isInitialized: finalStatus.isInitialized,
      completedComponents: finalStatus.completedComponents,
      componentCount: finalStatus.completedComponents.length
    }, '🎉 System initialization completed');

    // Legacy validation for backward compatibility
    // Validate admin user exists
    const userValidation = await userService.validateAdminUser();
    if (userValidation.configured && !userValidation.healthy) {
      loggers.services.error({
        adminEmail: userValidation.adminEmail,
        exists: userValidation.exists,
        isAdmin: userValidation.isAdmin
      }, '❌ CRITICAL: Admin user validation FAILED after initialization');
      throw new Error(`Admin user not properly configured: ${userValidation.adminEmail}`);
    }

    // Validate system prompts exist. Seed defaults on first boot if the
    // table is empty so a fresh install doesn't require a separate
    // `npm run db:seed:prompts` step.
    let promptValidation = await promptService.validateSystemPrompts();
    if (!promptValidation.healthy) {
      loggers.services.warn({
        missing: promptValidation.missing
      }, '⚠️ System prompt templates missing — seeding defaults from PROMPT_TEMPLATES');
      try {
        await promptService.ensureDefaultTemplates();
        promptValidation = await promptService.validateSystemPrompts();
      } catch (seedErr: any) {
        loggers.services.error({ err: seedErr?.message }, '❌ Seeding default prompt templates failed');
      }
      if (!promptValidation.healthy) {
        loggers.services.error({
          missing: promptValidation.missing,
          details: promptValidation.details
        }, '❌ CRITICAL: System prompt templates validation FAILED after seed attempt');
        throw new Error(`Missing system prompts: ${promptValidation.missing.join(', ')}`);
      }
    }
    
    // Embedding models are discovered dynamically from providers
    loggers.services.info('🔄 Embedding models will be discovered from configured providers...');

    // Initialize Milvus connection with retry logic (OPTIONAL - don't fail startup)
    // SKIP_MILVUS_SERVICES=true will skip all Milvus-dependent features for faster startup
    // Milvus is MANDATORY — connect with retry
    loggers.services.info('🔄 Connecting to Milvus vector database (MANDATORY)...');
    let milvusConnectAttempt = 0;
    while (true) {
      try {
        milvusConnectAttempt++;
        milvusClient = await connectToMilvus();
        loggers.services.info(`✅ Milvus connected (attempt ${milvusConnectAttempt})`);
        break;
      } catch (error: any) {
        if (milvusConnectAttempt >= 10) {
          loggers.services.fatal({ error: error.message }, '🚨 FATAL: Cannot connect to Milvus after 10 attempts');
          process.exit(1);
        }
        loggers.services.warn({ error: error.message, attempt: milvusConnectAttempt },
          `⚠️ Milvus connection attempt ${milvusConnectAttempt}/10 failed — retrying in ${milvusConnectAttempt * 3}s`);
        await new Promise(resolve => setTimeout(resolve, milvusConnectAttempt * 3000));
      }
    }

    // Initialize RAG service for prompt template semantic search
    ragService = new RAGService(milvusClient, loggers.services);
    const initResult = await ragService.initializeCollection();
    if (initResult.success) {
      // syncAllTemplates was removed in the OSS edition — templates index
      // via the per-template upsert path on first read instead.
      const syncFn = (ragService as any).syncAllTemplates;
      if (typeof syncFn === 'function') {
        const syncResult = await syncFn.call(ragService);
        loggers.services.info(`✅ RAG collection initialized, ${syncResult.synced || 0} templates synced`);
      } else {
        loggers.services.info('✅ RAG collection initialized (lazy template sync)');
      }
    }

    // Initialize MilvusVectorService for user artifacts and embeddings
    milvusVectorService = new MilvusVectorService(providerManager);
    await milvusVectorService.initialize();
    loggers.services.info('✅ MilvusVectorService initialized');

    // Re-initialize CachedPromptService with Milvus semantic search
    promptService = new CachedPromptService(loggers.services, {
      enableCache: true,
      cacheTTL: 1800,
      cacheUserAssignments: true,
      cacheTemplates: true,
      milvusService: milvusVectorService
    });

    // Document Indexing Service (non-critical)
    try {
      const { DocumentIndexingService } = await import('./services/DocumentIndexingService.js');
      documentIndexingService = new DocumentIndexingService(milvusClient, prisma, loggers.services);
      await documentIndexingService.initializeCollection();
      loggers.services.info('✅ Document Indexing Service initialized');
    } catch (error: any) {
      loggers.services.warn({ error: error.message }, '⚠️ Document Indexing Service init failed (non-critical)');
      documentIndexingService = null;
    }

    // Repository Container (non-critical)
    try {
      repositoryContainer = createRepositoryContainer({
        prisma,
        logger: loggers.services,
        cache: { defaultTTL: 3600, keyPrefix: 'repo', enableCaching: true }
      });
      loggers.services.info('✅ Repository Container initialized');
    } catch (error: any) {
      loggers.services.warn({ error: error.message }, '⚠️ Repository Container init failed');
      repositoryContainer = null;
    }

    // Export globals
    global.milvusVectorService = milvusVectorService;
    global.documentIndexingService = documentIndexingService;
    global.toolSemanticCache = toolSemanticCache;
    global.toolSemanticCacheInitialized = toolSemanticCacheInitialized;
    global.repositoryContainer = repositoryContainer;

    // Conversation Compaction Worker (non-critical)
    try {
      const { ConversationCompactionWorker } = await import('./services/ConversationCompactionWorker.js');
      const compactionWorker = new ConversationCompactionWorker({
        prisma, redis: redisClient, logger: loggers.services
      });
      await compactionWorker.start();
      global.compactionWorker = compactionWorker;
      loggers.services.info('✅ Conversation Compaction Worker started');
    } catch (error: any) {
      loggers.services.warn({ error: error.message }, '⚠️ Compaction Worker init failed (non-critical)');
      global.compactionWorker = null;
    }

    // Seed prompt modules on first deploy (non-critical)
    try {
      const countBefore = await prisma.promptModule.count();
      const { seedIfEmpty } = await import('./services/prompt/ModuleSeeder.js');
      await seedIfEmpty();
      const countAfter = await prisma.promptModule.count();
      const seeded = countAfter - countBefore;
      if (seeded > 0) {
        loggers.services.info({ count: seeded }, '[INIT] Seeded default prompt modules');
      }
      // Always ensure embeddings exist — not just when new modules are seeded.
      // On cold start or DB reset, the embedding table may be empty even though
      // modules exist. Without embeddings, semantic scoring returns 0 for all modules.
      try {
        const { ModuleEmbeddingService } = await import('./services/prompt/ModuleEmbeddingService.js');
        await ModuleEmbeddingService.ensureTable();
        const embeddingCount = await prisma.$queryRawUnsafe<any[]>('SELECT count(*) as c FROM prompt_module_embeddings').then(r => Number(r[0]?.c || 0)).catch(() => 0);
        const moduleCount = countAfter;
        if (embeddingCount < moduleCount) {
          const modules = await prisma.promptModule.findMany({ select: { id: true, name: true, description: true } });
          const embedded = await ModuleEmbeddingService.generateAndStoreEmbeddings(modules);
          loggers.services.info({ embedded, total: moduleCount }, '[INIT] Generated prompt module embeddings');
        } else {
          loggers.services.info({ embeddingCount, moduleCount }, '[INIT] Prompt module embeddings up to date');
        }
      } catch (embErr: any) {
        loggers.services.warn({ error: embErr.message }, '[INIT] Module embedding generation failed (non-fatal)');
      }
    } catch (seedErr: any) {
      loggers.services.warn({ error: seedErr.message }, '[INIT] Prompt module seeding failed (non-fatal)');
    }

    // SharedKBService — ensure the chunks table exists so
    // DatabaseService.ensureEmbeddingDimensions can size the halfvec column.
    try {
      const { getSharedKBService } = await import('./services/SharedKBService.js');
      const svc = getSharedKBService(loggers.services as any);
      await svc.ensureChunksTable();
      loggers.services.info('[INIT] SharedKB chunks table ready');
    } catch (sharedKbErr: any) {
      loggers.services.warn({ error: sharedKbErr.message }, '[INIT] SharedKB table init failed (non-fatal)');
    }

    loggers.services.info('🚀 All services initialized successfully');
  } catch (error) {
    loggers.services.error({ err: error }, 'Service initialization failed - this is critical');
    throw error; // Re-throw to prevent service startup
  }
}

// Service initialization is now done after server starts successfully

const server = Fastify({
  pluginTimeout: 60000, // 60 second plugin timeout
  bodyLimit: 104857600, // 100MB body limit (supports large image uploads via base64)
  // Trust proxy headers (X-Forwarded-Proto, X-Forwarded-For, etc.)
  // Required when running behind reverse proxy (nginx, k8s ingress) for:
  // - Correct HTTPS detection for secure cookies
  // - Proper client IP detection
  trustProxy: true,
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    serializers: {
      req: (req: any) => {
        // Skip serialization for health and metrics endpoints
        if (req.url === '/health' || req.url === '/api/health' ||
            req.url?.startsWith('/health/') ||
            req.url === '/metrics' || req.url === '/api/metrics') {
          return undefined;
        }
        return {
          method: req.method,
          url: req.url,
          hostname: req.hostname,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort
        };
      },
      res: (res: any) => ({
        statusCode: res.statusCode
      })
    },
    // Ignore noisy endpoints in request logging to reduce log spam
    hooks: {
      logMethod(inputArgs: any[], method: any) {
        const url = inputArgs[0]?.req?.url;

        // Skip ALL logging for health checks and metrics endpoints
        if (url === '/health' || url === '/api/health' ||
            url?.startsWith('/health/') ||
            url === '/metrics' || url === '/api/metrics') {
          // Completely skip logging for these endpoints
          return;
        }
        return method.apply(this, inputArgs);
      }
    }
  },
  disableRequestLogging: false,
  requestIdLogLabel: 'reqId',
});

// Custom JSON content type parser that handles empty bodies gracefully
// This fixes FST_ERR_CTP_EMPTY_JSON_BODY errors when clients send Content-Type: application/json with empty body
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
  try {
    // Handle empty body - return empty object instead of error
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    const json = JSON.parse(body);
    done(null, json);
  } catch (err: any) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

// Custom request hook to handle metrics logging
server.addHook('onRequest', async (request, reply) => {
  const start = Date.now();
  
  // Add finish handler for custom logging
  reply.raw.on('finish', () => {
    const duration = Date.now() - start;
    
    // Special handling for metrics endpoint - minimal logging
    if (request.url === '/metrics' || request.url === '/api/metrics') {
      // Only log if there's an error or it's slow
      if (reply.statusCode >= 400 || duration > 100) {
        loggers.server.warn({
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          duration
        }, `Metrics scrape: ${reply.statusCode} in ${duration}ms`);
      }
      // Skip normal logging for successful, fast metrics requests
      return;
    }
    
    // Skip health check and metrics logging for successful requests to reduce noise
    if (!request.url.startsWith('/health') && !request.url.startsWith('/api/health') && !request.url.startsWith('/metrics')) {
      const logMethod = reply.statusCode >= 500 ? 'error' : 
                        reply.statusCode >= 400 ? 'warn' : 
                        'debug'; // Use debug for normal requests to reduce noise
      
      loggers.server[logMethod]({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration,
        userAgent: request.headers['user-agent'],
        ip: request.ip
      }, `${request.method} ${request.url} ${reply.statusCode} ${duration}ms`);
    }
  });
});

// Register plugins
// Configure CORS to only allow frontend
const UI_HOST_PORT = process.env.UI_HOST_PORT || '8080';
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
      process.env.FRONTEND_URL || `http://localhost:${UI_HOST_PORT}`,
      `http://openagentic-ui:${process.env.UI_PORT || '80'}`,
      `http://${process.env.API_HOST || 'openagentic-api'}:${process.env.API_PORT || '8000'}`,
      `http://localhost:${UI_HOST_PORT}`,  // The configured host UI port (default 8080)
      `http://127.0.0.1:${UI_HOST_PORT}`,
      'http://localhost',       // Local through Caddy (port 80)
      'http://localhost:3000',  // Local development
      'http://localhost:3001',  // Alternative local port
      'http://localhost:8080',  // Default compose UI port
      'http://127.0.0.1',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:8080',
    ].filter((origin): origin is string => Boolean(origin));

// Register cookie parser for cookie-based auth
await server.register(fastifyCookie, {
  secret: process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => {
    const s = cryptoRandomBytes(64).toString('hex');
    console.error('[CRITICAL] Neither JWT_SECRET nor SIGNING_SECRET is set — using ephemeral cookie secret');
    return s;
  })(),
  parseOptions: {}
});

await server.register(cors as any, {
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return cb(null, true);

    // Check if origin is allowed (exact match to prevent subdomain spoofing)
    if (allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-User-ID',
    'X-OpenAgentic-Frontend',
    'X-Timestamp',
    'X-Signature',
  ],
});

// Register Prisma client
server.decorate('prisma', prisma);

// Rate limiting -- per-user, configurable via admin console (admin_settings table)
// Defaults are sensible fallbacks; admin can override via Admin > Platform Settings
try {
  const rateLimit = (await import('@fastify/rate-limit')).default;
  await server.register(rateLimit, {
    // Dynamic max: read from Redis (set by admin console at platform:rate_limits)
    // Admin can update live without restart via Admin > Platform Settings
    max: async (request: any) => {
      try {
        const { getRedisClient } = await import('./utils/redis-client.js');
        const redis = getRedisClient();
        const configStr = await redis.get('platform:rate_limits');
        const config = configStr ? JSON.parse(configStr) : null;
        const isAdmin = request.user?.isAdmin || request.user?.role === 'admin';
        if (isAdmin) return config?.adminMax || 300;
        const tier = request.user?.rateLimitTier || 'default';
        return config?.tiers?.[tier] || config?.defaultMax || 120;
      } catch {
        // Fallback when Redis unavailable: admins get generous limit
        const isAdmin = request.user?.isAdmin || request.user?.role === 'admin';
        return isAdmin ? 600 : 120;
      }
    },
    timeWindow: '1 minute',
    keyGenerator: (request: any) => {
      return request.user?.userId || request.user?.id || request.ip;
    },
    allowList: (request: any) => {
      const isInternal = request.headers['x-request-from'] === 'internal';
      const isHealth = request.url === '/health' || request.url === '/api/health';
      // WebSocket upgrades MUST be exempt — rate limiting WS handshakes
      // causes rapid connect/disconnect storms on long-lived streams.
      const isWebSocket = request.url?.includes('/ws/') || request.headers?.upgrade === 'websocket';
      return isInternal || isHealth || isWebSocket;
    },
    errorResponseBuilder: (_request: any, context: any) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Max ${context.max} requests per ${context.after}. Try again later.`,
    }),
  });
  loggers.server.info('Rate limiting enabled (admin-configurable via admin_settings.rate_limits)');
} catch (err: any) {
  loggers.server.warn({ error: err.message }, 'Rate limiting not available -- continuing without');
}

// Register Swagger/OpenAPI documentation
await server.register(swagger, swaggerOptions);
await server.register(swaggerUi, swaggerUiOptions);
loggers.server.info('📚 Swagger/OpenAPI documentation registered at /api/swagger');

// Register shared schemas with Fastify so $ref works in route schemas
// These schemas are also defined in swagger.config.ts for OpenAPI spec
const sharedSchemas = swaggerOptions.openapi?.components?.schemas;
if (sharedSchemas) {
  for (const [schemaName, schemaDefinition] of Object.entries(sharedSchemas)) {
    server.addSchema({
      $id: `#/components/schemas/${schemaName}`,
      ...(schemaDefinition as object)
    });
  }
  loggers.server.info(`📐 Registered ${Object.keys(sharedSchemas).length} shared schemas with Fastify`);
}

// NOTE: OpenAPI spec generation moved to after all routes are registered
// See generateOpenAPISpec() function called in start() after registerAllRoutes()

// Function to generate OpenAPI spec - called after server.ready() in start()
async function generateOpenAPISpec() {
  try {
    const spec = server.swagger();
    const outputDir = join(process.cwd(), 'docs');
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, 'openapi.json');
    writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
    loggers.server.info({ path: outputPath, paths: Object.keys(spec.paths || {}).length }, '📄 OpenAPI spec generated');
  } catch (error) {
    loggers.server.warn({ error }, 'Failed to generate static OpenAPI spec - will be available at /api/swagger/json');
  }
}

// Initialize services that need Fastify logger
// Create cache and completion services (legacy - kept for backward compatibility)
const redisClientForCache = getRedisClient();
const cacheService = new ChatCacheService(redisClientForCache, server.log);
const completionService = new ChatCompletionService(server.log, cacheService);
// Model health check will be initialized after providerManager is created

// WebSocket support removed - using HTTP POST + SSE instead

// Register multipart for file uploads
await server.register(import('@fastify/multipart') as any, {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit - supports large image uploads
    files: 10 // Max 10 files per request
  }
});

// Register WebSocket support for real-time MCP monitoring
await server.register(import('@fastify/websocket') as any);

// Basic health check for Kubernetes liveness/readiness probes
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// NOTE: securityPlugin DISABLED - it is redundant with the existing auth stack:
// - CORS: handles origin validation (registered above)
// - unifiedAuth: handles API key + Azure AD token validation (per-route)
// - rateLimiter middleware: handles rate limiting (per-route via rateLimiter.ts)
// - adminMiddleware: handles admin-only route protection
// The securityPlugin's @fastify/rate-limit (wrapped with fastify-plugin) breaks
// Fastify encapsulation and applies global hooks that block health/metrics endpoints.
// await server.register(securityPlugin);

// Add security response headers globally (moved from securityPlugin)
server.addHook('onSend', async (_request, reply) => {
  reply.headers({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' wss: https:; font-src 'self' data:; frame-ancestors 'none';",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
});

// Setup metrics (before routes so /metrics endpoint is available)
setupMetrics();

// Register HTTP metrics middleware to track all requests
server.addHook('onRequest', httpMetricsMiddleware());

// FedRAMP AC-4: Set Row-Level Security context for every authenticated request.
// Runs as preHandler so it executes AFTER auth middleware populates request.user.
// If no user is set (unauthenticated endpoints), the hook is a no-op.
server.addHook('preHandler', rlsContextHook);

// NOTE: The following routes have been moved to health.plugin.ts (HIGH-001 refactoring):
// - /metrics, /api/metrics (Prometheus metrics)
// - /api/openapi.json (OpenAPI spec)
// - /model-health (Model health check)
// - /prompt-health (Prompt validation)
// - /prompts/debug (Prompt debug info)

// Route registration will happen after database initialization

// Create function to register all routes after database is ready
async function registerAllRoutes() {
  loggers.routes.info('📝 Registering all application routes...');

  // Register Auth routes via modular plugin (HIGH-001 refactoring)
  try {
    await server.register(authPlugin, {
      authProvider: process.env.AUTH_PROVIDER || 'azure-ad'
    });
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register auth plugin');
  }

  // First-run Setup wizard endpoints (unauthenticated; idempotent — see
  // src/routes/setup.ts for the overwrite guard via MAGIC_BOOT_TOKEN).
  try {
    await server.register(setupPlugin);
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register setup plugin');
  }

  // Register Health & Monitoring routes via modular plugin (HIGH-001 refactoring)
  try {
    await server.register(healthPlugin, {
      prisma,
      modelHealthCheck,
      adminGuard
    });
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register health plugin');
  }

  // Register User routes via modular plugin (HIGH-001 refactoring)
  try {
    const mcpProxyUrl = process.env.MCP_PROXY_URL ||
      `${process.env.MCP_PROXY_PROTOCOL || 'http'}://${process.env.MCP_PROXY_HOST || 'mcp-proxy'}:${process.env.MCP_PROXY_PORT || '3100'}`;
    await server.register(userPlugin, {
      prisma,
      authMiddleware,
      mcpProxyUrl
    });
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user plugin');
  }

  // Register Legacy Redirects plugin for backward compatibility (HIGH-001 refactoring)
  try {
    await server.register(legacyRedirectsPlugin);
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register legacy redirects plugin');
  }

  // Register Documentation Chat plugin (docs assistant SSE endpoint)
  try {
    const docsPlugin = (await import('./plugins/docs.plugin.js')).default;
    await server.register(docsPlugin, { prefix: '/api/docs' });
    loggers.routes.info('Documentation chat plugin registered at /api/docs/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register docs chat plugin');
  }

  // Register NEW modern chat system
  try {
    const { chatPlugin } = await import('./routes/chat/index.js');
    await server.register(chatPlugin, {
      prefix: '/api/chat',
      chatStorage,
      redis: redisClient as any,
      // Pass both milvus and getMilvus for ValidationStage MemoryContextService initialization
      milvus: milvusClient,
      getMilvus: () => global.milvusVectorService || milvusVectorService || milvusClient,
      providerManager: providerManager as any, // Pass ProviderManager for multi-provider LLM support
      config: {
        enableMCP: true,
        enablePromptEngineering: true,
        enableAnalytics: true,
        enableCaching: true,
        enableCoT: process.env.ENABLE_COT === 'true', // Enable Chain of Thought display (from docker-compose.yml)
        maxConcurrentRequests: 60,
        requestTimeoutMs: 120000
      }
    });
    loggers.routes.info('New modern chat system registered at /api/chat');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register new chat system');
  }

  // Register HITL approval endpoint
  try {
    const { approvalsRoutes } = await import('./routes/chat/approvals.js');
    await server.register(approvalsRoutes, { prefix: '/api/chat' });
    loggers.routes.info('HITL approval routes registered at /api/chat/approvals/:id');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register HITL approval routes');
  }

  // Register Settings routes
  await server.register(settingsRoutes, { prefix: '/api/settings' });

  // Register Version routes (public - no auth required)
  try {
    const { versionRoutes } = await import('./routes/version.js');
    await server.register(versionRoutes, { prefix: '/api' });
    loggers.routes.info('Version routes registered at /api/version, /api/version/changelog, /api/version/latest');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register version routes');
  }

  // Register Feedback routes (thumbs up/down, copy tracking)
  try {
    const { feedbackRoutes } = await import('./routes/feedback.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(feedbackRoutes);
    }, { prefix: '/api/feedback' });
    loggers.routes.info('Feedback routes registered at /api/feedback/* with auth middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register feedback routes');
  }

  // NOTE: Admin Feedback Analytics routes registered via plugins/admin.plugin.ts at /api/admin/feedback/*

  // Register User Memory routes (adaptive memory system)
  try {
    const { userMemoryRoutes } = await import('./routes/user-memory.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(userMemoryRoutes);
    }, { prefix: '/api/user-memory' });
    loggers.routes.info('User Memory routes registered at /api/user-memory/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user memory routes');
  }

  // Register Workflow routes (OpenAgenticflow CRUD, execution, versioning)
  try {
    const { workflowRoutes } = await import('./routes/workflows.js');
    await server.register(workflowRoutes, { prefix: '/api/workflows' });
    loggers.routes.info('Workflow routes registered at /api/workflows/* (CRUD, execute, versions)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register workflow routes');
  }

  // Register Embed routes (embeddable workflow widgets)
  try {
    const { embedRoutes } = await import('./routes/embed.js');
    await server.register(embedRoutes, { prefix: '/embed' });
    loggers.routes.info('Embed routes registered at /embed/* (widget, iframe, execute)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register embed routes');
  }

  // Register Workflow Approval routes (Human-in-the-Loop HITL)
  try {
    const { workflowApprovalRoutes } = await import('./routes/workflow-approvals.js');
    await server.register(workflowApprovalRoutes, { prefix: '/api/workflows/approvals' });
    loggers.routes.info('Workflow approval routes registered at /api/workflows/approvals/* (HITL)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register workflow approval routes');
  }

  // Register Workflow Marketplace routes (template discovery, publishing, forking, ratings)
  try {
    const { workflowMarketplaceRoutes } = await import('./routes/workflow-marketplace.js');
    await server.register(workflowMarketplaceRoutes, { prefix: '/api/workflows/marketplace' });
    loggers.routes.info('Workflow marketplace routes registered at /api/workflows/marketplace/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register workflow marketplace routes');
  }

  // Register Orchestration routes (concurrent subagent execution)
  try {
    const orchestrateRoutes = (await import('./routes/orchestrate.js')).default;
    await server.register(orchestrateRoutes);
    loggers.routes.info('Orchestration routes registered at /api/orchestrate/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register orchestration routes');
  }

  // Register User Context routes (Phase 16 - Unified Cross-Mode Memory Layer)
  try {
    const userContextRoutes = (await import('./routes/user-context.js')).default;
    await server.register(userContextRoutes);
    loggers.routes.info('User context routes registered at /api/user-context/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user context routes');
  }

  // Register Admin routes via modular plugin (HIGH-001 refactoring)
  // This plugin handles all admin routes including:
  // - Admin core, portal enhanced, system, slider, rate-limits, chargeback
  // - Tiered function calling, prompts, audit chat, LLM metrics
  // - Conditional: Ollama admin
  try {
    await server.register(adminPlugin, {
      ollamaEnabled: process.env.OLLAMA_ENABLED === 'true'
    });
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin plugin');
  }

  // Register OpenAI-Compatible API routes for external integrations
  // This provides /api/v1/chat/completions and /api/v1/models endpoints
  // that route through the ProviderManager for multi-provider LLM support
  try {
    const openaiCompatibleRoutes = (await import('./routes/openai-compatible.js')).default;
    await server.register(async (instance) => {
      instance.addHook('preHandler', async (request, reply) => {
        return authMiddleware(request, reply);
      });
      await instance.register(openaiCompatibleRoutes, {
        providerManager: providerManager as any,
        logger: loggers.routes
      });
    }, { prefix: '/api' });
    loggers.routes.info('OpenAI-compatible routes registered at /api/v1/chat/completions, /api/v1/models');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register OpenAI-compatible routes');
  }

  // NOTE: Most Admin routes are now registered via adminPlugin above (HIGH-001 refactoring)
  // Keeping some here temporarily until full migration is complete

  // Register Admin API Token Management routes
  try {
    const { default: adminApiTokenRoutes } = await import('./routes/admin-api-tokens.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminApiTokenRoutes);
    });
    loggers.routes.info('Admin API Token Management routes registered at /api/admin/tokens/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin API token routes');
  }

  // Register Admin Prompting routes (techniques like Few-Shot, ReAct, etc.)
  try {
    const { default: adminPromptingRoutes } = await import('./routes/admin-prompting.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminPromptingRoutes);
    }, { prefix: '/api/admin/prompting' });
    loggers.routes.info('Admin prompting techniques routes registered at /api/admin/prompting with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin prompting routes');
  }

  // NOTE: Admin LLM Provider Management routes (deployment state, pause/resume, capabilities, credential rotation)
  // are registered via adminPlugin → admin.ts → admin/llm-providers.ts. Do NOT duplicate here.

  // Register Admin Workflow Management routes (cross-user workflow + execution management)
  try {
    const { default: adminWorkflowRoutes } = await import('./routes/admin/workflows.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminWorkflowRoutes);
    }, { prefix: '/api/admin/workflows' });
    loggers.routes.info('Admin workflow routes registered at /api/admin/workflows with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin workflow routes');
  }

  // Register Admin Agent Management routes
  try {
    const { adminAgentRoutes } = await import('./routes/admin-agents.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminAgentRoutes);
    }, { prefix: '/api/admin/agents' });
    loggers.routes.info('Admin agent routes registered at /api/admin/agents');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin agent routes');
  }

  // Register Admin Agent Schedule routes (stub — in-memory, no DB table yet)
  try {
    const { adminAgentScheduleRoutes } = await import('./routes/admin-agent-schedules.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminAgentScheduleRoutes);
    }, { prefix: '/api/admin/agent-schedules' });
    loggers.routes.info('Admin agent schedule routes registered at /api/admin/agent-schedules');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin agent schedule routes');
  }

  // Register Agent routes (non-admin, accessible to all authenticated users)
  try {
    const { agentRoutes } = await import('./routes/agents.js');
    await server.register(agentRoutes, { prefix: '/api/agents' });
    loggers.routes.info('Agent routes registered at /api/agents');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register agent routes');
  }

  // Register Admin MCP Inspector Proxy (secure access to MCP Inspector UI)
  try {
    const { default: adminMCPInspectorRoutes } = await import('./routes/admin-mcp-inspector.js');
    await server.register(adminMCPInspectorRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Admin MCP Inspector proxy routes registered at /api/admin/mcp-inspector');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP inspector routes');
  }

  // Register Admin MCP Access Control routes (manage which groups can access which MCPs)
  try {
    // Register Admin Tools routes (tool execution mode / read-only kill switch)
    const { default: adminToolsRoutes } = await import('./routes/admin-tools.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminToolsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Tools routes registered at /api/admin/tools/*');

    const { default: adminMCPAccessRoutes } = await import('./routes/admin-mcp-access.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMCPAccessRoutes);
    }, { prefix: '/api/admin/mcp' });
    loggers.routes.info('Admin MCP Access Control routes registered at /api/admin/mcp with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP access control routes');
  }

  // NOTE: Admin MCP Tools routes are registered via plugins/admin.plugin.ts

  // Register Admin User Permissions routes
  try {
    const { default: adminUserPermissionsRoutes } = await import('./routes/admin-user-permissions.js');
    // NOTE: This route file needs internal adminMiddleware protection
    await server.register(adminUserPermissionsRoutes);
    loggers.routes.info('Admin User Permissions routes registered at /api/admin/user-management/*, /api/admin/groups/*, /api/admin/permissions/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin user permissions routes');
  }

  // Register Auth Access Control routes (manage allowed users/admins for OAuth)
  try {
    const { authAccessRoutes } = await import('./routes/admin/auth-access.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Admin-only access
      await instance.register(authAccessRoutes);
    }, { prefix: '/api/admin/auth' });
    loggers.routes.info('Auth Access Control routes registered at /api/admin/auth/* (users, domains, access-requests) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register auth access control routes');
  }

  // Register Pipeline Control routes
  try {
    const { default: pipelineControlRoutes } = await import('./routes/admin/pipeline-control.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(pipelineControlRoutes);
    }, { prefix: '/api/admin/pipeline' });
    loggers.routes.info('Pipeline control routes registered at /api/admin/pipeline with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline control routes');
  }

  // Register Pipeline Summary routes (legacy endpoints for compatibility)
  try {
    const { default: pipelineStatusRoutes } = await import('./routes/admin/pipeline.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(pipelineStatusRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Pipeline summary routes registered at /api/admin/pipeline/summary and /api/admin/pipeline/history with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline summary routes');
  }

  // Register Admin Semantic Prompts routes
  try {
    // Admin semantic prompts routes removed - semantic routing now handled by PromptTemplateSemanticService
    // Templates are automatically indexed in Milvus during initialization
    loggers.routes.info('Semantic template routing managed by PromptTemplateSemanticService (Milvus-based)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin semantic prompts routes');
  }

  // Register Prompt Templates routes
  try {
    const { default: promptTemplateRoutes } = await import('./routes/prompt-templates.js');
    await server.register(promptTemplateRoutes, { prefix: '/api/prompt-templates' });
    loggers.routes.info('Prompt templates routes registered at /api/prompt-templates');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register prompt templates routes');
  }

  // Register Azure AD Sync routes
  try {
    const { azureADSyncRoutes } = await import('./routes/azure-ad-sync.js');
    await server.register(azureADSyncRoutes);
    loggers.routes.info('Azure AD sync routes registered at /api/auth/azure/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Azure AD sync routes');
  }

  // Register Account Linking routes
  try {
    const { accountLinkingRoutes } = await import('./routes/account-linking.js');
    await server.register(accountLinkingRoutes);
    loggers.routes.info('Account linking routes registered at /api/accounts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register account linking routes');
  }

  // Register Storage routes for secure token/data storage (converted to Fastify)
  try {
    const storageRoutes = (await import('./routes/storage.js')).default;
    await server.register(storageRoutes, { prefix: '' });
    loggers.routes.info('Storage routes registered at /api/storage/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register storage routes');
  }

  // NOTE: Legacy diagram render routes (Mermaid/PlantUML/D2) removed
  // Diagrams are now generated client-side using React Flow via the system MCP

  // Register Image routes (Milvus-backed image storage with semantic search)
  try {
    const { imageRoutes } = await import('./routes/images.js');
    await server.register(imageRoutes, { prefix: '' });
    loggers.routes.info('Image routes registered at /api/images/* (Milvus vector storage with semantic search)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register image routes');
  }

  // MCP Inspector removed - no longer using orchestrator

  // Register Files routes - DISABLED: duplicate with file-attachment routes
  // try {
  //   const { default: filesRoutes } = await import('./routes/files.js');
  //   await server.register(filesRoutes, { prefix: '/api/files' });
  //   loggers.routes.info('Files routes registered at /api/files/*');
  // } catch (error) {
  //   loggers.routes.error({ err: error }, 'Failed to register files routes');
  // }

  // Register Health routes
  try {
    const { default: healthRoutes } = await import('./routes/health.js');
    await server.register(healthRoutes, { prefix: '/api' });
    loggers.routes.info('Health routes registered at /api/health/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register health routes');
  }

  // NOTE: Version routes already registered earlier in registerAllRoutes() (line ~887)
  // DO NOT duplicate here.

  // Register System Config routes (public - no auth required)
  try {
    const { systemConfigRoutes } = await import('./routes/system-config.js');
    await server.register(systemConfigRoutes, { prefix: '/api/system' });
    loggers.routes.info('System config routes registered at /api/system/config (workflow engine detection)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register system config routes');
  }

  // Register Embeddings routes (OpenAI-compatible endpoint using UniversalEmbeddingService)
  try {
    const { default: embeddingsRoutes } = await import('./routes/embeddings.js');
    await server.register(embeddingsRoutes, { prefix: '/api/embeddings' });
    loggers.routes.info('Embeddings routes registered at /api/embeddings (uses UniversalEmbeddingService)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register embeddings routes');
  }

  // Register Admin Embeddings config routes
  try {
    const { default: adminEmbeddingsRoutes } = await import('./routes/admin-embeddings.js');
    await server.register(adminEmbeddingsRoutes, { prefix: '/api/admin/embeddings' });
    loggers.routes.info('Admin embeddings routes registered at /api/admin/embeddings/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin embeddings routes');
  }

  // Register Internal Result Storage routes (for MCP servers)
  try {
    const { registerResultStorageRoutes } = await import('./routes/internal/result-storage.js');
    await registerResultStorageRoutes(server);
    loggers.routes.info('Internal result storage routes registered at /api/internal/result-storage/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register internal result storage routes');
  }

  // Register Internal HITL Policy routes (for openagentic-proxy to read DB hitl_policy)
  try {
    const { registerHitlPolicyRoutes } = await import('./routes/internal/hitl-policy.js');
    await registerHitlPolicyRoutes(server);
    loggers.routes.info('Internal HITL policy routes registered at /api/internal/hitl/policy');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register internal HITL policy routes');
  }

  // Register Internal Prompt Compose routes (for openagentic-proxy and workflow engine)
  try {
    const { registerPromptComposeRoutes } = await import('./routes/internal/prompt-compose.js');
    await server.register(registerPromptComposeRoutes, { prefix: '/api/internal/prompt' });
    loggers.routes.info('Internal Prompt Compose routes registered at /api/internal/prompt/compose');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register internal prompt compose routes');
  }

  // Register Agent Persistence routes (for openagentic-proxy to store execution data)
  try {
    const { registerAgentPersistenceRoutes } = await import('./routes/internal/agent-persistence.js');
    await server.register(registerAgentPersistenceRoutes);
    loggers.routes.info('Agent persistence routes registered at /api/internal/agent-*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register agent persistence routes');
  }

  // Register MCP Logs routes (for mcp-proxy to send logs)
  try {
    const { default: mcpLogsRoutes } = await import('./routes/mcp-logs.js');
    await server.register(mcpLogsRoutes, { prefix: '/api' });
    loggers.routes.info('MCP logs routes registered at /api/mcp-logs/* (no auth for internal service)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register MCP logs routes');
  }

  // Register Documentation routes
  try {
    const { docsRoutes } = await import('./routes/docs/index.js');
    await server.register(docsRoutes, { prefix: '/api' });
    loggers.routes.info('Documentation routes registered at /api/docs/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register documentation routes');
  }

  // Register Background Jobs routes (with auth middleware)
  try {
    const backgroundJobsRoutes = await import('./routes/background-jobs.js');
    await server.register(async (instance) => {
      instance.addHook('onRequest', authMiddleware);
      await instance.register(backgroundJobsRoutes.default);
    });
    loggers.routes.info('Background jobs routes registered at /api/background-jobs/* with auth middleware and SSE support');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register background jobs routes');
  }

  // Register AI/ML Services routes (models, capabilities)
  try {
    const { aiMlServicesPlugin } = await import('./routes/ai-ml-services/index.js');
    await server.register(aiMlServicesPlugin, {
      prefix: '/api',
      providerManager: providerManager as any
    });
    loggers.routes.info('AI/ML Services routes registered at /api/models/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register AI/ML services routes');
  }

  // Native workflow routes are already registered at /api/workflows (line 1073)
  // No proxy needed - workflows are handled by the built-in routes

  // MCP Management Services routes managed through provider manager

  // Register Monitoring WebSocket routes (for UI admin panel)
  try {
    const { monitoringWebSocketRoutes } = await import('./routes/monitoring-websocket.js');
    await server.register(monitoringWebSocketRoutes, { prefix: '/api/monitoring' });
    loggers.routes.info('Monitoring WebSocket routes registered at /api/monitoring/ws');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register monitoring WebSocket routes');
  }

  // NOTE: User routes (/api/user/permissions, /api/user/available-tools) moved to user.plugin.ts (HIGH-001 refactoring)

  // Register Memory & Vector Services routes
  try {
    const { memoryVectorPlugin } = await import('./routes/memory-vector/index.js');
    await server.register(memoryVectorPlugin, { prefix: '/api/memories' });
    loggers.routes.info('Memory & Vector Services routes registered at /api/memories/*, /api/vectors/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register memory & vector services routes');
  }

  // Register Admin Analytics routes
  try {
    const { default: adminAnalyticsRoutes } = await import('./routes/admin-analytics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAnalyticsRoutes);
    }, { prefix: '/api/admin/analytics' });
    loggers.routes.info('Admin Analytics routes registered at /api/admin/analytics/* (per-user cost & model usage) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin analytics routes');
  }

  // Register Admin Roles routes (RBAC)
  try {
    const { default: adminRolesRoutes } = await import('./routes/admin-roles.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminRolesRoutes);
    }, { prefix: '/api/admin/roles' });
    loggers.routes.info('Admin Roles routes registered at /api/admin/roles/* (RBAC) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin roles routes');
  }

  // Register Admin Messages routes
  try {
    const { default: adminMessagesRoutes } = await import('./routes/admin-messages.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMessagesRoutes);
    }, { prefix: '/api/admin/messages' });
    loggers.routes.info('Admin Messages routes registered at /api/admin/messages/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin messages routes');
  }

  // Register Admin Performance Metrics routes
  try {
    const { default: adminMetricsRoutes } = await import('./routes/admin-metrics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminMetricsRoutes);
    }, { prefix: '/api/admin/metrics' });
    loggers.routes.info('Admin Performance Metrics routes registered at /api/admin/metrics/* (Prometheus metrics, Redis, Milvus) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin metrics routes');
  }

  // Register Admin Azure AI Foundry Metrics routes
  try {
    const { default: adminAIFMetricsRoutes } = await import('./routes/admin-aif-metrics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAIFMetricsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Azure AI Foundry Metrics routes registered at /api/admin/aif-metrics/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin AIF metrics routes');
  }

  // Register Advanced Prompting Services routes
  try {
    const { advancedPromptingPlugin } = await import('./routes/advanced-prompting/index.js');
    await server.register(advancedPromptingPlugin, { prefix: '/api' });
    loggers.routes.info('Advanced Prompting Services routes registered at /api/prompts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register advanced prompting routes');
  }

  // Register File & Attachment Services routes
  try {
    const { fileAttachmentPlugin } = await import('./routes/file-attachment/index.js');
    await server.register(fileAttachmentPlugin, { prefix: '/api/files' });
    loggers.routes.info('File & Attachment Services routes registered at /api/files/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register file attachment routes');
  }

  // Register Azure Integration Services routes  
  try {
    const { azureIntegrationPlugin } = await import('./routes/azure-integration/index.js');
    await server.register(azureIntegrationPlugin, { prefix: '/api/azure' });
    loggers.routes.info('Azure Integration Services routes registered at /api/azure/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Azure integration routes');
  }

  // Register Admin Audit routes for comprehensive user activity monitoring
  try {
    const { default: adminAuditRoutes } = await import('./routes/admin-audit.js');
    await server.register(adminAuditRoutes);
    loggers.routes.info('Admin Audit routes registered at /api/admin/audit/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit routes');
  }

  // Register Admin Audit Logs routes (session logs, stats, export) - SOC2 compliance
  try {
    const { default: adminAuditLogsRoutes } = await import('./routes/admin-audit-logs.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminAuditLogsRoutes);
    });
    loggers.routes.info('Admin Audit Logs routes registered at /api/admin/audit-logs/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit logs routes');
  }

  // Register Admin Credential Audit routes (Bolt 03 - credential change audit trail)
  try {
    const { default: adminCredentialAuditRoutes } = await import('./routes/admin-credential-audit.js');
    await server.register(adminCredentialAuditRoutes);
    loggers.routes.info('Admin Credential Audit routes registered at /api/admin/audit/credentials/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin credential audit routes');
  }

  // Register Admin Dashboard Metrics routes (Grafana-style time-series metrics)
  try {
    const { default: adminDashboardMetricsRoutes } = await import('./routes/admin-dashboard-metrics.js');
    await server.register(adminDashboardMetricsRoutes);
    loggers.routes.info('Admin Dashboard Metrics routes registered at /api/admin/dashboard/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin dashboard metrics routes');
  }

  // Register MCP Management routes
  try {
    const { default: mcpManagementRoutes } = await import('./routes/admin/mcp-management.js');
    await server.register(mcpManagementRoutes);
    loggers.routes.info('MCP Management routes registered at /api/admin/mcp/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register MCP management routes');
  }

  // Register Grafana Proxy routes (admin-only access to Grafana dashboards)
  try {
    const { grafanaProxyRoutes } = await import('./routes/admin/grafana-proxy.js');
    await server.register(grafanaProxyRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Grafana proxy routes registered at /api/admin/grafana/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Grafana proxy routes');
  }

  // Register Pipeline Log routes (admin observability — pipeline log viewer)
  try {
    const { pipelineLogRoutes } = await import('./routes/admin/pipeline-log.js');
    await server.register(pipelineLogRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Pipeline Log routes registered at /api/admin/pipeline-log/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline log routes');
  }

  // Data Sources
  try {
    const { default: dataSourceRoutes } = await import('./routes/data-sources.js');
    await server.register(dataSourceRoutes, { prefix: '/api' });
    loggers.routes.info('✅ Data Source routes registered');
  } catch (error: any) {
    loggers.routes.error({ err: error }, 'Failed to register data source routes');
  }

  // NOTE: Old MCP proxy routes removed - replaced by:
  // 1. Unified MCP routes at /api/v1/mcp/* (see routes/v1/mcp.ts)
  // 2. 301 redirects from /mcp/* -> /api/v1/mcp/* (see bottom of this file)

  // Register Admin Integration Management routes (Slack/Teams CRUD + webhook receivers)
  try {
    const { default: adminIntegrationRoutes } = await import('./routes/admin-integrations.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminIntegrationRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Integration routes registered at /api/admin/integrations/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin integration routes');
  }

  // Register Admin Prompt Techniques routes (ready to integrate)
  try {
    const { default: adminTechniqueRoutes } = await import('./routes/admin-techniques.js');
    await server.register(adminTechniqueRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Admin Prompt Techniques routes registered at /api/admin/techniques/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin technique routes');
  }

  // Register Admin DLP routes (rules, exemptions, audit log)
  try {
    const { default: dlpRoutes } = await import('./routes/admin/dlp.js');
    await server.register(dlpRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Admin DLP routes registered at /api/admin/dlp/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin DLP routes');
  }

  // Admin Prompt Modules routes are now registered by admin.plugin.ts +
  // memory-ai.plugin.ts (Phase E12 cleanup). Re-registering here would
  // collide on /api/admin/prompts/effectiveness.

  // Shared Knowledge Base admin API (sources, documents, ingest, search)
  try {
    const { default: sharedKBRoutes } = await import('./routes/admin/shared-kb.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(sharedKBRoutes);
    }, { prefix: '/api/admin/shared-kb' });
    loggers.routes.info('Admin Shared KB routes registered at /api/admin/shared-kb/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin shared KB routes');
  }

  // Register Model Capabilities routes (has service, needs integration)
  try {
    const { default: capabilityRoutes } = await import('./routes/capabilities.js');
    await server.register(capabilityRoutes, { prefix: '/api/models' });
    loggers.routes.info('Model Capabilities routes registered at /api/models/capabilities/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register model capability routes');
  }

  // Register Dynamic Model Selector routes (has service, needs integration)
  try {
    const { modelSelectorRoutes } = await import('./routes/model-selector.js');
    await server.register(modelSelectorRoutes, { prefix: '/api/models' });
    loggers.routes.info('Dynamic Model Selector routes registered at /api/models/selector/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register model selector routes');
  }

  // Image analysis removed - images are handled through chat interface
  // The model capabilities system determines which model to use for vision tasks

  // Register Artifacts routes (✅ COMPLETED - integrated with MilvusVectorService)
  try {
    const artifactsRoutes = (await import('./routes/artifacts.js')).default;
    await server.register(artifactsRoutes, { prefix: '' });
    loggers.routes.info('Artifacts routes registered at /api/artifacts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register artifacts routes');
  }

  // Register Export routes (PDF/DOCX export with artifact storage)
  try {
    const exportRoutes = (await import('./routes/export.js')).default;
    await server.register(async (instance) => {
      instance.addHook('onRequest', authMiddleware);
      await instance.register(exportRoutes);
    }, { prefix: '/api/export' });
    loggers.routes.info('Export routes registered at /api/export/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register export routes');
  }

  // Register User Settings routes (✅ COMPLETED - integrated with UserSettingsService)
  try {
    const userSettingsRoutes = (await import('./routes/user-settings.js')).default;
    await server.register(userSettingsRoutes, { prefix: '' });
    loggers.routes.info('User Settings routes registered at /api/user/settings/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user settings routes');
  }

  // Register Formatting Capabilities routes
  try {
    const { default: formattingRoutes } = await import('./routes/formatting.js');
    await server.register(formattingRoutes, { prefix: '/api/formatting' });
    loggers.routes.info('Formatting capabilities routes registered at /api/formatting/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register formatting routes');
  }

  // Register Rendering routes for Pure Frontend Architecture
  try {
    const { default: renderRoutes } = await import('./routes/render.js');
    await server.register(renderRoutes, { prefix: '/api/render' });
    loggers.routes.info('Rendering routes registered at /api/render/* (charts, diagrams, markdown, code)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register rendering routes');
  }

  // Note: metrics.js was skipped - conflicts with existing metrics system in server.ts

  // Register Agent Admin routes (agent registry, dashboard, execution history)
  try {
    const agentAdminRoutes = (await import('./routes/admin/agentic-loops.js')).default;
    await server.register(async (instance) => {
      await instance.register(agentAdminRoutes);
    }, { prefix: '/api' });
    loggers.routes.info('Agent admin routes registered at /api/admin/agentic/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Agent admin routes');
  }

  // Register Synth (Tool Synthesis) routes
  try {
    const { SynthService } = await import('./services/SynthService.js');
    const { registerAdminSynthRoutes } = await import('./routes/admin-synth.js');
    const { registerSynthRoutes } = await import('./routes/synth.js');

    // Create shared SynthService instance (singleton)
    const synthService = SynthService.getInstance(loggers.routes);
    const synthContext = { synthService };

    // Admin Synth routes
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await registerAdminSynthRoutes(instance, synthContext);
    }, { prefix: '/api/admin/synth' });
    loggers.routes.info('Admin Synth routes registered at /api/admin/synth/* with admin middleware');

    // User Synth routes
    await server.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await registerSynthRoutes(instance, synthContext);
    }, { prefix: '/api/synth' });
    loggers.routes.info('Synth user routes registered at /api/synth/* with auth middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Synth routes');
  }

  // Register Artifact Function routes (OAT-backed function registration, execution, approval)
  try {
    const { default: artifactFunctionRoutes, agentExecutionApprovalRoutes } = await import('./routes/artifact-functions.js');
    await server.register(artifactFunctionRoutes, { prefix: '/api/artifact-functions' });
    loggers.routes.info('Artifact Function routes registered at /api/artifact-functions/*');

    await server.register(agentExecutionApprovalRoutes, { prefix: '/api/agent-executions' });
    loggers.routes.info('Agent Execution Approval routes registered at /api/agent-executions/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Artifact Function routes');
  }

  // ============================================================================
  // API v1 Router - Standardized versioned API
  // ============================================================================
  // This is the NEW standardized API with versioning.
  // All new development should use /api/v1/* endpoints.
  // Legacy /api/* routes are kept for backward compatibility but will be deprecated.
  try {
    const { v1Router } = await import('./routes/v1/index.js');
    await server.register(v1Router, { prefix: '/api/v1' });
    loggers.routes.info('✅ API v1 router registered at /api/v1/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register API v1 router');
  }

  // NOTE: Legacy MCP redirects moved to legacy-redirects.plugin.ts (HIGH-001 refactoring)

  loggers.routes.info('✅ All application routes registered successfully');
}

// API v1 is now the standard - legacy routes redirect to v1

// Start server
const start = async () => {
  // Load and validate secrets configuration FIRST
  loggers.services.info('🔐 Loading secrets configuration...');
  try {
    const secrets = getSecrets(loggers.services);
    logSecrets(secrets, loggers.services);

    // Store secrets globally for other services to use
    (global as any).appSecrets = secrets;
    loggers.services.info('✅ Secrets configuration loaded and validated');
  } catch (error) {
    loggers.services.warn({ err: error }, '⚠️ Secrets configuration partially loaded — some secrets may use runtime-generated values. Server will continue starting.');
  }
  
  // Initialize Vault for additional secret management
  loggers.services.info('🔐 Initializing Vault for secret rotation...');
  try {
    const { VaultInitService } = await import('./services/VaultInitService.js');
    const vaultService = new VaultInitService(loggers.services);
    await vaultService.initialize();
    // Store vault service globally for other services to use
    (global as any).vaultService = vaultService;
    loggers.services.info('✅ Vault service initialized for secret rotation');
  } catch (error) {
    loggers.services.warn({ err: error }, '⚠️ Vault initialization failed - using static secrets only');
  }

  // NOW initialize database schema after secrets are loaded
  loggers.database.info('🔄 Initializing database schema and structure...');
  try {
    const { DatabaseService } = await import('./services/DatabaseService.js');
    await DatabaseService.initialize();
    loggers.database.info('✅ Database schema initialization completed successfully');
    } catch (error) {
    loggers.database.error({ err: error }, '🚨 CRITICAL: Database schema initialization failed');
    process.exit(1); // Exit - we can't continue without the database schema
  }

  // Initialize LLM Provider Manager (needed for title generation)
  loggers.services.info('🤖 Initializing LLM Provider Manager...');
  try {
    const configService = new ProviderConfigService(loggers.services);
    const config = await configService.loadProviderConfig();
    providerManager = new ProviderManager(loggers.services, config);
    await providerManager.initialize();

    // Set global reference for route handlers (v1/models, etc.)
    (global as any).providerManager = providerManager;

    // Set singleton accessor for ModelCapabilityGate and other services
    const { setProviderManager, subscribeProviderReload } = await import('./services/llm-providers/ProviderManager.js');
    setProviderManager(providerManager);

    // Subscribe to Redis provider:reload for multi-replica instant propagation
    subscribeProviderReload(loggers.services).catch(() => {});

    loggers.services.info('✅ LLM Provider Manager initialized successfully');

    // Initialize Model Capability Registry for dynamic model pricing and capabilities
    // CRITICAL: This is needed for LLMMetricsService to calculate costs properly
    loggers.services.info('📊 Initializing Model Capability Registry for pricing and capabilities...');
    try {
      const modelCapabilityRegistry = new ModelCapabilityRegistry(loggers.services, prisma);
      await modelCapabilityRegistry.initialize();
      setModelCapabilityRegistry(modelCapabilityRegistry);

      const allModels = modelCapabilityRegistry.getAllModels();
      loggers.services.info({
        cachedModels: allModels.length,
        modelsWithPricing: allModels.filter(m => m.inputCostPer1k !== undefined).length
      }, '✅ Model Capability Registry initialized - costs will be tracked accurately');
    } catch (registryError) {
      loggers.services.warn({ err: registryError }, '⚠️ Model Capability Registry initialization failed - using fallback pricing');
    }

    // Initialize model health check with providerManager
    modelHealthCheck = new ModelHealthCheckService(loggers.services, providerManager);
    loggers.services.info('✅ Model Health Check Service initialized with ProviderManager');

    // Initialize Smart Model Router for intelligent model selection
    // Routes simple queries to Ollama (FREE), complex/tool queries to Vertex AI
    try {
      smartModelRouter = new SmartModelRouter(loggers.services, {
        providerManager
      });
      await smartModelRouter.initialize();
      setSmartModelRouter(smartModelRouter);

      const models = smartModelRouter.getAllModels();
      loggers.services.info({
        modelCount: models.length,
        models: models.map(m => ({
          id: m.modelId,
          provider: m.provider,
          cost: `$${m.cost.inputPer1kTokens}/1k tokens`,
          functionCalling: m.capabilities.functionCalling ? `${(m.capabilities.functionCallingAccuracy * 100).toFixed(0)}%` : 'N/A'
        }))
      }, '✅ Smart Model Router initialized - Ollama preferred for simple queries (FREE)');

      // Pre-warm Ollama model into GPU VRAM so first user request gets instant TTFT.
      // Without this, first request after restart takes 2-5s for model loading.
      try {
        const warmStart = Date.now();
        await providerManager.createCompletion({
          model: 'gpt-oss',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          stream: false,
        });
        loggers.services.info({ warmupMs: Date.now() - warmStart }, '🔥 Ollama model pre-warmed — first user request will be fast');
      } catch (warmErr: any) {
        loggers.services.warn({ error: warmErr?.message }, '⚠️ Ollama warm-up failed (non-fatal) — first request will be slower');
      }

      // Schedule periodic feedback ingestion for self-improving routing
      setTimeout(() => {
        smartModelRouter?.updateFromFeedback(prisma).catch(() => {});
      }, 60_000); // First run after 60s
      setInterval(() => {
        smartModelRouter?.updateFromFeedback(prisma).catch(() => {});
      }, 30 * 60_000); // Then every 30 minutes

    } catch (routerError) {
      loggers.services.warn({ err: routerError }, '⚠️ Smart Model Router initialization failed - using default model selection');
    }
  } catch (error) {
    loggers.services.warn({ err: error }, '⚠️ LLM Provider Manager initialization failed - title generation will be disabled');
  }

  // ========================================================================
  // AgentRegistry — seed default agents to database on startup
  // ========================================================================
  try {
    const { AgentRegistry } = await import('./services/AgentRegistry.js');
    const agentRegistry = new AgentRegistry();
    await agentRegistry.initialize();
    loggers.services.info('✅ AgentRegistry initialized — default agents seeded to database');
  } catch (agentErr) {
    loggers.services.warn({ err: agentErr }, '⚠️ AgentRegistry initialization failed — agents may need manual seeding');
  }

  // ========================================================================
  // Workflow templates — seed built-in templates if DB is empty
  // ========================================================================
  // Previously SEED_WORKFLOW_TEMPLATES was only invoked via the manual
  // POST /api/workflows/seed-templates endpoint. Fresh envs (downstream envs, stg)
  // never got the call so their flows workspace showed zero templates
  // while the local test env had 66+ (because a dev ran the endpoint at
  // some point). Auto-seed on startup fixes that gap. Idempotent: the
  // upsert-by-name logic in the seeder is reused so repeat runs update
  // existing templates without duplicating.
  try {
    const { autoSeedWorkflowTemplates } = await import('./routes/workflows.js');
    if (typeof autoSeedWorkflowTemplates === 'function') {
      const result = await autoSeedWorkflowTemplates();
      loggers.services.info(
        { created: result.created, updated: result.updated, skipped: result.skipped },
        '✅ Workflow templates seeded (auto)'
      );
    }
  } catch (tplErr) {
    loggers.services.warn({ err: tplErr }, '⚠️ Workflow template auto-seed failed — flows workspace may be empty');
  }

  // ========================================================================
  // DLP Scanner — load persisted config, seed default exemptions
  // ========================================================================
  try {
    const { initializeDLPScanner } = await import('./services/DLPScannerService.js');
    const dlpScanner = await initializeDLPScanner(loggers.services);
    (global as any).dlpScanner = dlpScanner;
    const rules = dlpScanner.getRules();
    const enabled = rules.filter(r => r.enabled).length;
    loggers.services.info({ totalRules: rules.length, enabledRules: enabled }, '✅ DLP Scanner initialized with persisted config');
  } catch (dlpErr) {
    loggers.services.warn({ err: dlpErr }, '⚠️ DLP Scanner initialization failed — scanning disabled');
  }

  // ========================================================================
  // MANDATORY: Tool Semantic Cache — Milvus + pgvector + embeddings
  // The platform CANNOT function without semantic tool search.
  // ALL MCP tools MUST be indexed before the API accepts requests.
  // ========================================================================
  loggers.services.info('🔄 Initializing Tool Semantic Cache for MCP tools (MANDATORY)...');

  // Retry Milvus connection with exponential backoff (entrypoint already waited for health)
  let milvusConnected = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      toolSemanticCache = new ToolSemanticCacheService(providerManager);
      await toolSemanticCache.initialize();
      toolSemanticCacheInitialized = true;
      milvusConnected = true;
      loggers.services.info(`✅ Tool Semantic Cache connected to Milvus (attempt ${attempt})`);
      break;
    } catch (error: any) {
      loggers.services.warn({ error: error.message, attempt },
        `⚠️ Milvus connection attempt ${attempt}/10 failed — retrying in ${attempt * 3}s`);
      await new Promise(resolve => setTimeout(resolve, attempt * 3000));
    }
  }

  if (!milvusConnected) {
    loggers.services.fatal('🚨 FATAL: Cannot connect to Milvus after 10 attempts — shutting down');
    process.exit(1);
  }

  // Index ALL MCP tools into Milvus. Best-effort on boot: the MCP proxy may
  // not have spawned every subprocess yet on a fresh install, and single-user
  // OSS deploys don't have a second replica to pick up the slack. Don't kill
  // the API if we end up with 0 tools — background re-index fires on the first
  // chat and the UI works fine with a shrinking tool set in the meantime.
  loggers.services.info('🔄 Indexing ALL MCP tools into Milvus…');
  try {
    await toolSemanticCache.autoIndexToolsWhenReady();
    loggers.services.info('✅ MCP tools indexed in Milvus');
  } catch (error: any) {
    loggers.services.warn({ error: error.message }, '⚠️ MCP tool indexing failed (non-fatal) — first request will re-trigger indexing');
  }

  try {
    const testResults = await toolSemanticCache.searchToolsAsOpenAIFunctions('kubernetes pods logs', 5);
    if (!testResults || testResults.length === 0) {
      loggers.services.warn('⚠️ Post-indexing verification: 0 tools found — will reindex on first chat request');
    } else {
      const stats = await toolSemanticCache.getCacheStats?.() || {} as any;
      loggers.services.info({
        verificationResults: testResults.length,
        sampleTools: testResults.slice(0, 3).map((t: any) => t.function?.name || t.name),
        totalIndexed: (stats as any).totalTools || 'unknown'
      }, '✅ POST-INDEX VERIFICATION: Semantic search returning results');
    }
  } catch (verifyError: any) {
    loggers.services.warn({ error: verifyError.message }, '⚠️ Post-indexing verification failed (non-fatal)');
  }

  // Also index to PostgreSQL with pgvector for hybrid search
  try {
    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    const { getRedisClient } = await import('./utils/redis-client.js');
    const milvusAddress = process.env.MILVUS_ADDRESS ||
      `${process.env.MILVUS_HOST || 'milvus'}:${process.env.MILVUS_PORT || '19530'}`;
    const milvus = new MilvusClient({ address: milvusAddress });
    const redis = getRedisClient();

    const pgIndexingService = new MCPToolIndexingService(
      loggers.services as any,
      milvus,
      redis,
      prisma
    );
    await pgIndexingService.indexAllMCPTools(false);
    loggers.services.info('✅ MCP tools synced to PostgreSQL with pgvector embeddings');

    // Start periodic re-indexing (every 30 min) to catch MCP server changes
    pgIndexingService.startPeriodicIndexing?.();
    loggers.services.info('🔄 Periodic MCP tool re-indexing started (30-min interval)');
  } catch (pgError: any) {
    loggers.services.warn({ error: pgError.message }, '⚠️ PostgreSQL tool indexing failed (Milvus primary is OK)');
  }

  // Initialize ToolPgvectorSearchService for pgvector-first tool search
  try {
    const { UniversalEmbeddingService } = await import('./services/UniversalEmbeddingService.js');
    const embeddingService = new UniversalEmbeddingService(loggers.services);
    const toolPgvectorSearch = new ToolPgvectorSearchService(prisma, embeddingService, loggers.services as any);
    await toolPgvectorSearch.initialize();
    setToolPgvectorSearchService(toolPgvectorSearch);
    loggers.services.info({ ready: toolPgvectorSearch.isReady() },
      '✅ ToolPgvectorSearchService initialized — pgvector-first tool search enabled');
  } catch (pgSearchError: any) {
    loggers.services.warn({ error: pgSearchError.message },
      '⚠️ ToolPgvectorSearchService init failed (Milvus fallback active)');
  }

  // Initialize Tool Success Tracking Service
  loggers.services.info('🔄 Initializing Tool Success Tracking Service...');
  try {
    const toolSuccessTracker = getToolSuccessTrackingService();
    await toolSuccessTracker.initialize();
    loggers.services.info('✅ Tool Success Tracking Service initialized');
  } catch (error) {
    loggers.services.warn({ error: error.message }, '⚠️ Tool Success Tracking init failed (non-critical)');
  }

  // Initialize Intent Linking Service
  loggers.services.info('🔄 Initializing Intent Linking Service...');
  try {
    const intentLinking = getIntentLinkingService();
    await intentLinking.initialize();
    loggers.services.info('✅ Intent Linking Service initialized');
  } catch (error) {
    loggers.services.warn({ error: error.message }, '⚠️ Intent Linking init failed (non-critical)');
    // Non-critical - continue without intent linking
  }

  // Initialize chat storage service (migrated to Prisma)
  chatStorage = new ChatStorageService(
    {
      // Prisma uses DATABASE_URL env var, maxConnections still supported for compatibility
      maxConnections: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '10'),
      providerManager: providerManager || undefined  // Pass provider manager
    },
    loggers.storage
  );

  // Now initialize chat storage after schema exists
  loggers.database.info('Initializing PostgreSQL chat storage...');
  try {
    await chatStorage.initialize();
    loggers.database.info('PostgreSQL chat storage initialized successfully');
    
    // Start periodic metrics updates (using Prisma)
    startMetricsUpdates();
    loggers.server.info('Started periodic metrics updates');
    } catch (error) {
    loggers.database.error({ 
      err: error,
      databaseUrl: process.env.POSTGRES_URL ? '[SET]' : '[NOT SET]',
      host: process.env.POSTGRES_HOST || 'postgres',
      port: process.env.POSTGRES_PORT || '5432',
      database: process.env.POSTGRES_DB || 'openagentic'
    }, 'Failed to initialize PostgreSQL chat storage - this is a critical error');
    process.exit(1); // Exit with error - database is required
  }

  // Log configuration
  loggers.server.info({
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT || 'Not configured',
    azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'Not configured',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
  }, 'API Key Authentication Configuration');
  
  // Model health check removed - DB-driven provider config handles model availability
  // Providers are validated via admin console, not startup probe
  loggers.services.info('Model health check skipped (DB-driven provider config)');
  
  // Check prompt templates in database
  console.log('\n' + '='.repeat(80));
  console.log('📝 PROMPT_HEALTHCHECK: DATABASE PROMPT VERIFICATION');
  console.log('='.repeat(80));
  
  try {
    loggers.services.info('Retrieving all system prompts from database...');
    
    // Get all system prompts from the database
    const systemPrompts = await prisma.systemPrompt.findMany({
      where: { is_active: true },
      orderBy: { created_at: 'asc' }
    });
    
    // Get all prompt templates from the database  
    const promptTemplates = await prisma.promptTemplate.findMany({
      where: { is_active: true },
      orderBy: { is_default: 'desc' }
    });
    
    console.log(`📊 Found ${systemPrompts.length} system prompts and ${promptTemplates.length} prompt templates in database`);
    console.log('\n🔍 SYSTEM PROMPTS FROM DATABASE:');
    console.log('-'.repeat(80));
    
    if (systemPrompts.length === 0) {
      console.log('❌ NO SYSTEM PROMPTS FOUND IN DATABASE!');
    } else {
      systemPrompts.forEach((prompt, index) => {
        console.log(`  ${index + 1}. [${prompt.id}] ${prompt.name} (Default: ${prompt.is_default}, Active: ${prompt.is_active})`);
      });
    }
    
    console.log('\n🎯 PROMPT TEMPLATES FROM DATABASE:');
    console.log('-'.repeat(80));
    
    if (promptTemplates.length === 0) {
      console.log('❌ NO PROMPT TEMPLATES FOUND IN DATABASE!');
    } else {
      promptTemplates.forEach((template, index) => {
        console.log(`  ${index + 1}. [${template.id}] ${template.name} (Category: ${template.category || 'N/A'}, Default: ${template.is_default}, Active: ${template.is_active})`);
      });
    }
    
    // Summary
    const defaultSystemPrompt = systemPrompts.find(p => p.is_default);
    const defaultTemplate = promptTemplates.find(t => t.is_default);
    
    console.log('\n📋 PROMPT HEALTH SUMMARY:');
    console.log('-'.repeat(40));
    console.log(`✅ System Prompts: ${systemPrompts.length} found`);
    console.log(`✅ Prompt Templates: ${promptTemplates.length} found`);
    console.log(`${defaultSystemPrompt ? '✅' : '❌'} Default System Prompt: ${defaultSystemPrompt ? defaultSystemPrompt.name : 'MISSING'}`);
    console.log(`${defaultTemplate ? '✅' : '❌'} Default Template: ${defaultTemplate ? defaultTemplate.name : 'MISSING'}`);
    console.log('✨ PROMPT_HEALTHCHECK COMPLETED - Database content verified!\n');
    console.log('='.repeat(80) + '\n');
    
    loggers.services.info({
      systemPromptsCount: systemPrompts.length,
      promptTemplatesCount: promptTemplates.length,
      hasDefaultSystemPrompt: !!defaultSystemPrompt,
      hasDefaultTemplate: !!defaultTemplate
    }, 'Prompt healthcheck completed successfully');
    
    } catch (error) {
    console.log(`❌ PROMPT_HEALTHCHECK ERROR: ${error}`);
    console.log('='.repeat(80) + '\n');
    loggers.services.error({ err: error }, 'Prompt healthcheck failed');
  }

  // Database initialization is handled by entrypoint script
  loggers.server.info('Database initialization handled by entrypoint script');

  // CRITICAL FIX: Initialize all system services FIRST (including Redis and Milvus)
  // Routes depend on these services being initialized
  try {
    loggers.services.info('🔄 Initializing all system services (Redis, Milvus, etc.)...');
    await initializeServices();
    loggers.services.info('✅ All system services initialized successfully');
  } catch (err) {
    loggers.services.error({ err }, 'Service initialization failed - server cannot start');
    process.exit(1); // Exit if services can't initialize
  }

  // Initialize Pipeline Hook System (v0.5.0 hardening)
  // Hooks enable DLP scanning, HITL gates, cost tracking, event sequencing as pluggable observers
  try {
    loggers.services.info('🔄 Initializing Pipeline Hook System...');
    const hookRunner = initializeHookRunner(loggers.services);
    registerBuiltInHooks(hookRunner, loggers.services);
    loggers.services.info('✅ Pipeline Hook System initialized — hooks active');
  } catch (err) {
    loggers.services.warn({ err }, '⚠️ Pipeline Hook System init failed — continuing without hooks');
  }

  // Register all routes AFTER services are initialized
  // Routes can now access initialized milvusClient and redisClient
  try {
    loggers.routes.info('🔄 Registering all routes with initialized services...');
    await registerAllRoutes();
    loggers.routes.info('✅ All routes registered successfully');
  } catch (err) {
    loggers.routes.error({ err }, 'Route registration failed - server cannot start');
    process.exit(1); // Exit if routes can't register
  }

  // Seed LLM providers from environment variables to database
  // This ensures DB is the single source of truth while allowing initial config via env vars
  try {
    const { seedLLMProviders } = await import('./services/LLMProviderSeeder.js');
    await seedLLMProviders();
    loggers.services.info('✅ LLM provider seeding complete');

    // Load embedding config from DB into the global cache so all UniversalEmbeddingService instances use it.
    //
    // Picker policy (2026-04-11 — was sev-0, see docs/rules/no-hardcoded-models.md):
    //   1. If EMBEDDING_PROVIDER env var is set, prefer the enabled provider
    //      whose provider_type matches (or an alias of it).
    //   2. Otherwise, pick the first enabled provider that has
    //      capabilities.embeddings=true AND model_config.embeddingModel set.
    //   3. Otherwise, set nothing — UniversalEmbeddingService falls back to env vars.
    //
    // The old findFirst({orderBy: priority ASC}) was non-deterministic when
    // multiple providers shared priority, causing ollama to win over a
    // properly-configured azure-openai and breaking every embedding call
    // with a 404 on nomic-embed-text.
    try {
      const { setDbEmbeddingConfig } = await import('./services/UniversalEmbeddingService.js');
      const providerMap: Record<string, string> = {
        'azure-openai': 'azure-openai', 'vertex-ai': 'vertex-ai',
        'aws-bedrock': 'aws-bedrock', 'ollama': 'ollama',
        'openai': 'openai-compatible', 'anthropic': 'openai-compatible',
      };
      // Aliases for env var matching
      const envProviderAliases: Record<string, string> = {
        'azure': 'azure-openai', 'azureopenai': 'azure-openai', 'azure-openai': 'azure-openai',
        'aws': 'aws-bedrock', 'bedrock': 'aws-bedrock', 'aws-bedrock': 'aws-bedrock',
        'gcp': 'vertex-ai', 'vertex': 'vertex-ai', 'vertex-ai': 'vertex-ai',
        'ollama': 'ollama',
        'openai': 'openai-compatible', 'openai-compatible': 'openai-compatible',
      };
      const envRequested = process.env.EMBEDDING_PROVIDER?.toLowerCase();
      const envResolvedType = envRequested ? envProviderAliases[envRequested] : undefined;

      // Fetch all enabled providers with embeddings capability, ordered by priority.
      const candidates = await prisma.lLMProvider.findMany({
        where: { enabled: true },
        orderBy: { priority: 'asc' },
      });
      const embeddingCapable = candidates.filter(p => {
        const caps = (p.capabilities as Record<string, any>) || {};
        const mc = (p.model_config as Record<string, any>) || {};
        return caps.embeddings === true && mc.embeddingModel;
      });

      // Prefer env-matched provider; otherwise first embedding-capable non-ollama;
      // otherwise any embedding-capable provider.
      const envMatch = envResolvedType
        ? embeddingCapable.find(p => p.provider_type === envResolvedType)
        : undefined;
      const nonOllama = embeddingCapable.find(p => p.provider_type !== 'ollama');
      const embeddingProvider = envMatch || nonOllama || embeddingCapable[0];

      if (embeddingProvider) {
        const mc = (embeddingProvider.model_config as Record<string, any>) || {};
        const pc = (embeddingProvider.provider_config as Record<string, any>) || {};
        const embProvider = providerMap[embeddingProvider.provider_type] || 'openai-compatible';
        setDbEmbeddingConfig({
          provider: embProvider as any,
          ollamaBaseUrl: pc.baseUrl,
          ollamaModel: mc.embeddingModel,
          gcpProjectId: pc.projectId,
          gcpLocation: pc.location || pc.region,
          gcpModel: mc.embeddingModel,
          azureEndpoint: pc.baseUrl || pc.endpoint,
          azureDeployment: mc.embeddingModel,
          endpoint: pc.baseUrl,
          model: mc.embeddingModel,
          dimensions: pc.embeddingDimensions ? parseInt(pc.embeddingDimensions) : undefined,
        });
        loggers.services.info({
          provider: embProvider,
          model: mc.embeddingModel,
          source: envMatch ? 'env-matched' : (nonOllama ? 'non-ollama-preferred' : 'first-capable'),
          envRequested: envRequested || null,
          embeddingCapableCount: embeddingCapable.length,
        }, '✅ DB-backed embedding config loaded');
      } else {
        loggers.services.warn({
          envRequested: envRequested || null,
          totalEnabledProviders: candidates.length,
        }, '⚠️ No embedding-capable provider in DB — UniversalEmbeddingService will fall back to env vars');
      }
    } catch (dbEmbErr) {
      loggers.services.debug({ err: dbEmbErr }, 'Could not load DB embedding config (will use env vars)');
    }
  } catch (err) {
    loggers.services.warn({ err }, '⚠️ LLM provider seeding failed - continuing with existing DB config');
  }

  // CRITICAL: Validate admin portal SOT configuration BEFORE starting server
  try {
    loggers.services.info('🔍 Validating admin portal SOT configuration...');
    await validateAdminPortalConfiguration();
    loggers.services.info('✅ Admin portal SOT validation passed');
  } catch (err) {
    loggers.services.error({ err }, '❌ Admin portal SOT validation failed - server cannot start');
    loggers.services.error('SOLUTION: Initialize admin portal with proper prompt templates using initialization services');
    process.exit(1); // Exit if admin portal is not properly configured
  }

  try {
    const { logIntegrityAtBoot } = await import('./utils/oss-integrity.js');
    logIntegrityAtBoot(loggers.services);
  } catch (err) {
    loggers.services.warn({ err }, 'OSS integrity check could not run');
  }

  try {
    const port = parseInt(process.env.PORT || process.env.API_PORT || '8000');
    await server.listen({ port, host: '0.0.0.0' });

    // Disable Node.js 18+ default requestTimeout (5 min) for long-lived SSE streams
    // SSE connections can run for hours during complex agentic workloads (tool loops, thinking)
    // The server-side SSE keepalive (3s pings) keeps the connection alive at the proxy layer
    server.server.requestTimeout = 0;
    server.server.headersTimeout = 0;

    // Generate OpenAPI spec AFTER server is listening (server.ready() is called by listen)
    await generateOpenAPISpec();

    logServiceStartup(logger, port);

    // Log centralized model configuration
    logger.info({
      defaultModel: getDefaultModel(),
      tiersSource: 'database (ModelConfigurationService.getSliderTiers())',
      anthropic: MODELS.anthropic,
    }, 'Model configuration loaded from environment');

    // Start the workflow cron scheduler (fire-and-forget, non-fatal)
    try {
      const { startWorkflowScheduler } = await import('./services/WorkflowScheduler.js');
      await startWorkflowScheduler();
      loggers.services.info('✅ WorkflowScheduler started');
    } catch (schedulerErr) {
      loggers.services.warn({ err: schedulerErr }, '⚠️ WorkflowScheduler failed to start (non-fatal)');
    }

    // Start Ollama model sync service (every 60s — keeps DB in sync with Ollama hosts)
    if (process.env.OLLAMA_ENABLED === 'true') {
      try {
        const { getOllamaModelSyncService } = await import('./services/OllamaModelSyncService.js');
        const ollamaSyncService = getOllamaModelSyncService();
        ollamaSyncService.start();
        loggers.services.info('✅ OllamaModelSyncService started (60s interval)');
      } catch (ollamaSyncErr) {
        loggers.services.warn({ err: ollamaSyncErr }, '⚠️ OllamaModelSyncService failed to start (non-fatal)');
      }
    }

    // Start background memory compaction scheduler (every 6 hours)
    try {
      const MEMORY_COMPACTION_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
      const MEMORY_COMPACTION_THRESHOLD = 100; // compact users with >100 entries
      const MEMORY_COMPACTION_LOCK_KEY = 'memory_compaction:global_lock';
      const MEMORY_COMPACTION_LOCK_TTL = 3600; // 1 hour lock TTL

      const runMemoryCompaction = async () => {
        const compactionLogger = loggers.services.child({ scheduler: 'MemoryCompaction' });
        const redis = getRedisClient();

        // Acquire Redis lock to prevent concurrent runs across replicas
        if (redis?.isConnected?.()) {
          try {
            const locked = await (redis as any).set(MEMORY_COMPACTION_LOCK_KEY, process.pid.toString(), { EX: MEMORY_COMPACTION_LOCK_TTL, NX: true });
            if (!locked) {
              compactionLogger.info('Memory compaction skipped — another instance holds the lock');
              return;
            }
          } catch (lockErr) {
            compactionLogger.warn({ err: lockErr }, 'Redis lock acquisition failed — proceeding anyway');
          }
        }

        compactionLogger.info('Memory compaction started');
        const startTime = Date.now();

        try {
          // Find users with >THRESHOLD memory entries
          const heavyUsers: { user_id: string; count: bigint }[] = await prisma.$queryRaw`
            SELECT user_id, COUNT(*) as count
            FROM "UserMemoryEntry"
            WHERE is_summary = false
            GROUP BY user_id
            HAVING COUNT(*) > ${MEMORY_COMPACTION_THRESHOLD}
          `;

          if (heavyUsers.length === 0) {
            compactionLogger.info('No users exceed memory threshold — nothing to compact');
            return;
          }

          compactionLogger.info({ userCount: heavyUsers.length }, 'Found users needing memory compaction');

          const { getUserMemoryService } = await import('./services/UserMemoryService.js');
          const memoryService = getUserMemoryService();

          let compacted = 0;
          let failed = 0;

          for (const { user_id, count } of heavyUsers) {
            try {
              await memoryService.compactUserMemories(user_id);
              compacted++;
              compactionLogger.debug({ userId: user_id, entries: Number(count) }, 'User memories compacted');
            } catch (err: any) {
              failed++;
              compactionLogger.warn({ userId: user_id, error: err.message }, 'User memory compaction failed');
            }
          }

          compactionLogger.info({
            compacted,
            failed,
            totalUsers: heavyUsers.length,
            durationMs: Date.now() - startTime,
          }, 'Memory compaction finished');

        } catch (err: any) {
          compactionLogger.error({ error: err.message, durationMs: Date.now() - startTime }, 'Memory compaction failed');
        } finally {
          // Release Redis lock
          if (redis?.isConnected?.()) {
            (redis as any).del(MEMORY_COMPACTION_LOCK_KEY).catch(() => {});
          }
        }
      };

      // Run first compaction after 5 minutes (let the server warm up)
      setTimeout(() => {
        runMemoryCompaction().catch(() => {});
      }, 5 * 60 * 1000);

      // Then run every 6 hours
      setInterval(() => {
        runMemoryCompaction().catch(() => {});
      }, MEMORY_COMPACTION_INTERVAL);

      loggers.services.info('✅ Memory compaction scheduler started (every 6h, threshold >100 entries)');
    } catch (compactionErr) {
      loggers.services.warn({ err: compactionErr }, '⚠️ Memory compaction scheduler failed to start (non-fatal)');
    }

    loggers.server.info({
      endpoints: [
        `http://localhost:${port}/health`,
        `http://localhost:${port}/api/chat/*`,
        `http://localhost:${port}/settings`,
        `http://localhost:${port}/api/auth/local/*`
      ],
      authentication: 'API Key only',
      initializationComplete: true,
      authenticationSeeded: true
    }, '🤔 OpenAgenticChat API started successfully - all seeding complete, ready to think!');
  } catch (err) {
    loggers.server.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

start();

// Graceful shutdown
const gracefulShutdown = async () => {
  logServiceShutdown(logger, 'Graceful shutdown initiated');

  // Force exit after 30s to prevent hanging
  const forceExitTimer = setTimeout(() => {
    loggers.services.error('Graceful shutdown timed out after 30s — forcing exit');
    process.exit(1);
  }, 30_000);
  forceExitTimer.unref();

  // Stop WorkflowScheduler
  try {
    const { stopWorkflowScheduler } = await import('./services/WorkflowScheduler.js');
    stopWorkflowScheduler();
    loggers.services.info('WorkflowScheduler stopped');
  } catch (error) {
    loggers.services.warn({ error }, 'Error stopping WorkflowScheduler');
  }

  // Stop JobCompletionWatcher
  if (jobCompletionWatcher) {
    try {
      jobCompletionWatcher.stop();
      loggers.services.info('JobCompletionWatcher stopped');
    } catch (error) {
      loggers.services.warn({ error }, 'Error stopping JobCompletionWatcher');
    }
  }

  // Close Fastify server (stop accepting new requests)
  try {
    await server.close();
    loggers.services.info('Fastify server closed');
  } catch (error) {
    loggers.services.warn({ error }, 'Error closing Fastify server');
  }

  // Disconnect Prisma (drain connection pool)
  try {
    const { prisma } = await import('./utils/prisma.js');
    await prisma.$disconnect();
    loggers.services.info('Prisma disconnected');
  } catch (error) {
    loggers.services.warn({ error }, 'Error disconnecting Prisma');
  }

  // Close Milvus connection
  if (milvusClient) {
    try {
      await milvusClient.closeConnection();
      loggers.services.info('Milvus connection closed');
    } catch (error) {
      loggers.services.warn({ error }, 'Error closing Milvus connection');
    }
  }

  // Disconnect Redis
  try {
    const redis = getRedisClient();
    if (redis?.isConnected()) {
      await redis.disconnect();
      loggers.services.info('Redis disconnected');
    }
  } catch (error) {
    loggers.services.warn({ error }, 'Error disconnecting Redis');
  }

  loggers.services.info('Graceful shutdown complete');
  process.exit(0);
};

// These are already handled in logger.ts setupGlobalErrorHandlers
// but we need the graceful shutdown logic for server.close()
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
