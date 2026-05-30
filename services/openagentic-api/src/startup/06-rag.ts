import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { createRepositoryContainer } from '../repositories/RepositoryContainer.js';
import { UserService } from '../services/UserService.js';
import { InitializationService } from '../services/InitializationService.js';
import { getRedisClient } from '../utils/redis-client.js';
import type { BootstrapStep } from './types.js';

export const INIT_RAG: BootstrapStep = {
  name: 'rag-init',
  critical: false,
  async run({ ctx }) {
    // Lazy imports to avoid loading native milvus bindings at module parse time
    const { RAGService } = await import('../services/RAGService.js');
    const { ragInitService } = await import('../services/RAGInitService.js');

    // RAG service — collection bootstrap only. The legacy
    // `syncAllTemplates()` step was ripped 2026-05-11 along with the
    // PromptTemplate model (chatmode-rip Phase E final cleanup); RAG no
    // longer ingests prompt templates.
    try {
      ctx.ragService = new RAGService(ctx.milvusClient!, loggers.services);
      const initResult = await ctx.ragService.initializeCollection();
      if (initResult.success) {
        loggers.services.info('✅ RAG collection initialized');
      }
    } catch (ragErr: any) {
      loggers.services.warn({ error: ragErr.message }, '⚠️ RAGService init failed (non-critical)');
    }

    // RAG init service (embedding models, vector DBs)
    try {
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
        loggers.services.info('✅ Semantic template routing ready (Milvus-based)');
      } else {
        const ragError = ragInitService.getInitializationError();
        loggers.services.warn({ error: ragError }, '⚠️ RAG services failed to initialize - system will operate with limited capabilities');
        loggers.services.warn('💡 Set AZURE_OPENAI_EMBEDDING_DEPLOYMENT or AWS_EMBEDDING_MODEL_ID to enable embeddings');
      }
    } catch (ragInitErr) {
      loggers.services.warn({ err: ragInitErr }, '⚠️ RAGInitService failed (non-critical)');
    }

    // Document Indexing Service
    try {
      const { DocumentIndexingService, setDocumentIndexingService } = await import('../services/DocumentIndexingService.js');
      ctx.documentIndexingService = new DocumentIndexingService(ctx.milvusClient!, prisma, loggers.services);
      await ctx.documentIndexingService.initializeCollection();
      setDocumentIndexingService(ctx.documentIndexingService);
      loggers.services.info('✅ Document Indexing Service initialized');
    } catch (error: any) {
      loggers.services.warn({ error: error.message }, '⚠️ Document Indexing Service init failed (non-critical)');
      ctx.documentIndexingService = null;
    }

    // Repository Container
    try {
      ctx.repositoryContainer = createRepositoryContainer({
        prisma,
        logger: loggers.services,
        cache: { defaultTTL: 3600, keyPrefix: 'repo', enableCaching: true }
      });
      loggers.services.info('✅ Repository Container initialized');
    } catch (error: any) {
      loggers.services.warn({ error: error.message }, '⚠️ Repository Container init failed');
      ctx.repositoryContainer = null;
    }

    // Export globals (Phase 4 removes)
    global.documentIndexingService = ctx.documentIndexingService;
    global.repositoryContainer = ctx.repositoryContainer;

    // Adaptive Memory Services
    try {
      const { initUserMemoryService } = await import('../services/UserMemoryService.js');
      const { initUserProfileService } = await import('../services/UserProfileService.js');
      const { initFeedbackLearningService } = await import('../services/FeedbackLearningService.js');
      const redisClient = getRedisClient();
      const milvusClient = ctx.milvusClient || null;
      const embeddingService = null; // UniversalEmbeddingService not wired to AppContext; UserMemoryService handles its own embedding
      initUserMemoryService(prisma, redisClient.isConnected() ? redisClient as any : null, loggers.services, milvusClient, embeddingService);
      initUserProfileService(prisma, redisClient.isConnected() ? redisClient as any : null, loggers.services);
      initFeedbackLearningService(prisma, loggers.services);
      loggers.services.info('✅ Adaptive Memory services initialized (UserMemory, UserProfile, FeedbackLearning)');
    } catch (err) {
      loggers.services.warn({ err }, '⚠️ Adaptive Memory services failed to initialize - memory features will be limited');
    }

    // Bedrock Pricing Service
    if (process.env.AWS_BEDROCK_ENABLED === 'true') {
      try {
        const { bedrockPricingService } = await import('../services/BedrockPricingService.js');
        await bedrockPricingService.initialize();
        loggers.services.info({ cachedModels: bedrockPricingService.getAllPricing().length },
          '✅ Bedrock Pricing Service initialized (live AWS pricing)');
      } catch (err) {
        loggers.services.warn({ err }, '⚠️ Bedrock Pricing Service failed - using fallback pricing');
      }
    }

    // Azure AI Foundry Metrics Service
    try {
      const azureSubscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
      const azureResourceGroup = process.env.AZURE_RESOURCE_GROUP;
      const azureOpenAIAccount = process.env.AZURE_OPENAI_ACCOUNT_NAME;
      if (azureSubscriptionId && azureResourceGroup && azureOpenAIAccount) {
        const { initializeAIFoundryMetricsService } = await import('../services/AzureAIFoundryMetricsService.js');
        const aifMetricsService = initializeAIFoundryMetricsService({
          subscriptionId: azureSubscriptionId,
          resourceGroupName: azureResourceGroup,
          accountName: azureOpenAIAccount,
          metricsTimeRangeMinutes: parseInt(process.env.AIF_METRICS_TIME_RANGE_MINUTES || '10080'),
          refreshIntervalMinutes: parseInt(process.env.AIF_METRICS_REFRESH_INTERVAL_MINUTES || '5')
        }, loggers.services);
        await aifMetricsService.startPeriodicCollection();
        loggers.services.info({ subscriptionId: azureSubscriptionId, resourceGroup: azureResourceGroup,
          account: azureOpenAIAccount }, '✅ Azure AI Foundry Metrics Service initialized and collecting metrics');
      } else {
        loggers.services.info('⏭️  Azure AI Foundry Metrics Service not configured (optional)');
      }
    } catch (error) {
      loggers.services.warn({ error }, '⚠️ Failed to initialize Azure AI Foundry Metrics Service - continuing without AIF metrics');
    }

    // First-time system initialization (InitializationService)
    try {
      const initService = new InitializationService(prisma, loggers.services);
      const currentStatus = await initService.getInitializationStatus();
      loggers.services.info({
        isInitialized: currentStatus.isInitialized,
        completedComponents: currentStatus.completedComponents,
        lastInitialized: currentStatus.lastInitialized,
        version: currentStatus.version
      }, 'Current system initialization status');

      const finalStatus = await initService.initializeSystem({
        skipIfDone: true,
        forceReinit: process.env.FORCE_REINIT === 'true',
        components: {
          prompts: true, adminUser: true, mcpServers: true,
          milvusCollections: true, mcpToolIndexing: true, azureValidation: true,
          systemSettings: true, databaseSchema: true
        }
      });
      loggers.services.info({
        isInitialized: finalStatus.isInitialized,
        completedComponents: finalStatus.completedComponents,
        componentCount: finalStatus.completedComponents.length
      }, '🎉 System initialization completed');

      // Admin user validation
      const userService = new UserService(loggers.services);
      const userValidation = await userService.validateAdminUser();
      if (userValidation.configured && !userValidation.healthy) {
        loggers.services.error({
          adminEmail: userValidation.adminEmail,
          exists: userValidation.exists,
          isAdmin: userValidation.isAdmin
        }, '❌ CRITICAL: Admin user validation FAILED after initialization');
      }

      // System prompt validation is deferred to step 09 (prompt-cache-init)
      // where ctx.promptService is freshly initialized.
    } catch (initErr: any) {
      loggers.services.warn({ error: initErr.message }, '⚠️ System initialization service failed (non-critical)');
    }

    // Conversation Compaction Worker
    try {
      const { ConversationCompactionWorker } = await import('../services/ConversationCompactionWorker.js');
      const redisClient = getRedisClient();
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

    // Phase E.4 (2026-05-10) — prompt-module seeding + embedding generation
    // REMOVED. The legacy dynamic composer + module seeder +
    // module-embedding stack was the DB-backed composable-prompt-module path;
    // the RBAC static prompts (`chat-system-{admin,member}.md`) +
    // per-request session-facts/memories overlay replace it. The
    // `prompt_modules` + `prompt_module_embeddings` tables are dropped in
    // Phase E.5.

    // SharedKB chunks table
    try {
      const { getSharedKBService } = await import('../services/SharedKBService.js');
      const svc = getSharedKBService(loggers.services as any);
      await svc.ensureChunksTable();
      loggers.services.info('[INIT] SharedKB chunks table ready');
    } catch (sharedKbErr: any) {
      loggers.services.warn({ error: sharedKbErr.message }, '[INIT] SharedKB table init failed (non-fatal)');
    }

    // learned_patterns Milvus collection — backs pattern_save / pattern_recall
    // T1 meta-tools. Non-critical: if Milvus is unreachable at boot the
    // collection auto-creates on the first save call.
    try {
      const { getLearnedPatternsService } = await import(
        '../services/LearnedPatternsService.js'
      );
      await getLearnedPatternsService(loggers.services as any).ensureCollection();
      loggers.services.info('[INIT] learned_patterns Milvus collection ready');
    } catch (lpErr: any) {
      loggers.services.warn(
        { error: lpErr?.message ?? String(lpErr) },
        '[INIT] learned_patterns collection init failed (non-fatal) — will retry on first pattern_save',
      );
    }

    // user_memories Milvus collection — backs AgentMemoryService dual-write
    // (Postgres + Milvus) and semantic recall path. Non-critical: if Milvus
    // is unreachable at boot, the collection auto-creates on the first
    // memorize tool call.
    try {
      const { getUserMemoriesService } = await import(
        '../services/UserMemoriesService.js'
      );
      await getUserMemoriesService(loggers.services as any).ensureCollection();
      loggers.services.info('[INIT] user_memories Milvus collection ready');
    } catch (umErr: any) {
      loggers.services.warn(
        { error: umErr?.message ?? String(umErr) },
        '[INIT] user_memories collection init failed (non-fatal) — will retry on first memory store',
      );
    }

    loggers.services.info('🚀 All RAG and supporting services initialized');
  },
};
