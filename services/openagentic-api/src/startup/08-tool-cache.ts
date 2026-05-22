import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import type { BootstrapStep } from './types.js';

export const INIT_TOOL_CACHE: BootstrapStep = {
  name: 'tool-cache-init',
  critical: true,
  async run({ ctx }) {
    loggers.services.info('🔄 Initializing Tool Semantic Cache for MCP tools (MANDATORY)...');

    // Lazy imports to avoid loading native milvus bindings at module parse time
    const ToolSemanticCacheService = (await import('../services/ToolSemanticCacheService.js')).default;
    const { ToolPgvectorSearchService, setToolPgvectorSearchService } = await import('../services/ToolPgvectorSearchService.js');
    const { UniversalEmbeddingService } = await import('../services/UniversalEmbeddingService.js');

    // Retry Milvus connection with exponential backoff
    let milvusConnected = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        ctx.toolSemanticCache = new ToolSemanticCacheService(ctx.providerManager as any);
        await ctx.toolSemanticCache.initialize();
        ctx.toolSemanticCacheInitialized = true;
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
      throw new Error('Cannot connect to Milvus after 10 attempts');
    }

    // Index ALL MCP tools into Milvus (BLOCKING)
    loggers.services.info('🔄 Indexing ALL MCP tools into Milvus (BLOCKING)...');
    await ctx.toolSemanticCache!.autoIndexToolsWhenReady();
    loggers.services.info('✅ MCP tools indexed in Milvus — semantic search operational');

    // Post-index verification
    let verificationFailed: string | null = null;
    try {
      const { verifyToolSearch } = await import('../services/startup-helpers/verifyToolSearch.js');
      const verifyTimeoutMs = Number.parseInt(process.env.TOOL_INDEX_VERIFY_TIMEOUT_MS ?? '15000', 10);
      const verification = await verifyToolSearch(ctx.toolSemanticCache!, verifyTimeoutMs, loggers.services as any);
      if (verification.ok) {
        const stats = (await ctx.toolSemanticCache!.getCacheStats?.()) || ({} as any);
        loggers.services.info({
          sampleTools: verification.sampleToolNames,
          totalIndexed: (stats as any).totalTools || 'unknown',
        }, '✅ POST-INDEX VERIFICATION: Semantic search returning results');
      } else {
        verificationFailed = `Post-indexing verification did not pass: ${verification.reason}`;
        loggers.services.warn(`⚠ ${verificationFailed} — continuing startup (set TOOL_INDEX_VERIFY_REQUIRED=true to hard-fail)`);
      }
    } catch (verifyErr: any) {
      loggers.services.warn({ error: verifyErr.message }, '⚠️ Tool search verification failed (non-critical)');
    }
    // Hard-fail check is OUTSIDE the try-catch so the orchestrator receives the throw
    if (verificationFailed && process.env.TOOL_INDEX_VERIFY_REQUIRED === 'true') {
      loggers.services.fatal(`🚨 FATAL: ${verificationFailed}`);
      throw new Error(verificationFailed);
    }

    // ToolPgvectorSearchService
    try {
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

    // Wire singleton accessor so non-plugin consumers can use getToolSemanticCache()
    if (ctx.toolSemanticCache) {
      const { setToolSemanticCache } = await import('../services/ToolSemanticCacheService.js');
      setToolSemanticCache(ctx.toolSemanticCache);
    }
    // Export globals (Phase 4 removes — bare global.X writes remain until Phase 5)
    global.toolSemanticCache = ctx.toolSemanticCache;
    global.toolSemanticCacheInitialized = ctx.toolSemanticCacheInitialized;
  },
};
