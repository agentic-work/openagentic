import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import type { BootstrapStep } from './types.js';

// #1055: Milvus segment-load after a fresh helm install (or any
// data-tier restart) can take 5+ min for the api's ~10 collections.
// Split the retry budget: fatal connection failures fail fast at
// FATAL_MAX_ATTEMPTS; transient collection-recovery polls for up to
// RECOVERY_MAX_ATTEMPTS × RECOVERY_INTERVAL_MS so the boot survives
// a cold Milvus.
const FATAL_MAX_ATTEMPTS = 10;
const RECOVERY_MAX_ATTEMPTS = 30;
const RECOVERY_INTERVAL_MS = 10000;

export const INIT_TOOL_CACHE: BootstrapStep = {
  name: 'tool-cache-init',
  critical: true,
  async run({ ctx }) {
    loggers.services.info('🔄 Initializing Tool Semantic Cache for MCP tools (MANDATORY)...');

    // Lazy imports to avoid loading native milvus bindings at module parse time
    const ToolSemanticCacheService = (await import('../services/ToolSemanticCacheService.js')).default;
    const { ToolPgvectorSearchService, setToolPgvectorSearchService } = await import('../services/ToolPgvectorSearchService.js');
    const { UniversalEmbeddingService } = await import('../services/UniversalEmbeddingService.js');

    // Retry Milvus connection: split-budget on recovering vs fatal (#1055).
    let milvusConnected = false;
    let fatalAttempt = 0;
    let recoveryAttempt = 0;
    while (true) {
      try {
        ctx.toolSemanticCache = new ToolSemanticCacheService(ctx.providerManager as any);
        await ctx.toolSemanticCache.initialize();
        ctx.toolSemanticCacheInitialized = true;
        milvusConnected = true;
        loggers.services.info(`✅ Tool Semantic Cache connected to Milvus (fatalAttempt=${fatalAttempt}, recoveryAttempt=${recoveryAttempt})`);
        break;
      } catch (error: any) {
        if (error?.name === 'MilvusRecoveringError') {
          recoveryAttempt++;
          if (recoveryAttempt >= RECOVERY_MAX_ATTEMPTS) {
            loggers.services.fatal(`🚨 FATAL: Milvus still recovering after ${RECOVERY_MAX_ATTEMPTS} attempts (${(RECOVERY_MAX_ATTEMPTS * RECOVERY_INTERVAL_MS) / 1000}s) — collections never finished loading`);
            break;
          }
          loggers.services.warn({ recoveryAttempt, reason: error.message },
            `⏳ Milvus collections still loading — waiting ${RECOVERY_INTERVAL_MS / 1000}s (recovery ${recoveryAttempt}/${RECOVERY_MAX_ATTEMPTS})`);
          await new Promise(resolve => setTimeout(resolve, RECOVERY_INTERVAL_MS));
          continue;
        }
        fatalAttempt++;
        if (fatalAttempt >= FATAL_MAX_ATTEMPTS) {
          break;
        }
        loggers.services.warn({ error: error.message, fatalAttempt },
          `⚠️ Milvus connection attempt ${fatalAttempt}/${FATAL_MAX_ATTEMPTS} failed — retrying in ${fatalAttempt * 3}s`);
        await new Promise(resolve => setTimeout(resolve, fatalAttempt * 3000));
      }
    }

    if (!milvusConnected) {
      loggers.services.fatal(`🚨 FATAL: Cannot connect to Milvus (fatalAttempts=${fatalAttempt}, recoveryAttempts=${recoveryAttempt}) — shutting down`);
      throw new Error(`Cannot connect to Milvus after ${fatalAttempt} fatal + ${recoveryAttempt} recovery attempts`);
    }

    // #1058: MCP tool indexing runs in BACKGROUND — must NEVER block bootstrap.
    //
    // The blocking version (pre-#1058) hung indefinitely on cold helm-install
    // because Milvus reports `insertedCount: "0"` after a successful flush;
    // autoIndexToolsWhenReady then loops on `rowCount: 0 → force re-index` with
    // no upper bound, the await in step 08 never resolves, the api stays 0/1
    // Ready, and k8s eventually CrashLoopBackOffs the pod.
    //
    // Step 07 (`mcp-index`) already populates the PostgreSQL pgvector primary
    // source of truth before this step runs. Milvus is a "FALLBACK/resilience
    // replica" — the api is fully serviceable on pgvector alone. Indexing into
    // Milvus completes opportunistically in the background; tool search degrades
    // gracefully to pgvector if Milvus indexing never finishes.
    loggers.services.info('🔄 MCP tool semantic-cache indexing dispatched to background (non-blocking) — pgvector primary remains available');
    ctx.toolSemanticCache!.autoIndexToolsWhenReady()
      .then(async () => {
        loggers.services.info('✅ Background MCP tool indexing complete');
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
            loggers.services.warn({ reason: verification.reason },
              '⚠️ Post-indexing verification did not pass — tool search falls back to pgvector (api remains Ready)');
          }
        } catch (verifyErr: any) {
          loggers.services.warn({ error: verifyErr.message },
            '⚠️ Tool search verification failed (non-critical, api remains Ready)');
        }
      })
      .catch((err: any) => {
        loggers.services.error({ error: err?.message, stack: err?.stack },
          '⚠️ Background MCP tool indexing failed — tool search falls back to pgvector (api remains Ready)');
      });

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
