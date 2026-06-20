import { loggers } from '../utils/logger.js';
import { getRedisClient } from '../utils/redis-client.js';
import { prisma } from '../utils/prisma.js';
import type { BootstrapStep } from './types.js';

export const INIT_MCP_INDEX: BootstrapStep = {
  name: 'mcp-index',
  critical: false,
  async run() {
    // Index to PostgreSQL with pgvector for hybrid search
    try {
      // Lazy import to avoid loading native milvus bindings at module parse time
      const { MCPToolIndexingService } = await import('../services/MCPToolIndexingService.js');
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
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
      // Boot-time guard: Milvus + embedding calls can hang silently on stale connection state.
      // Step is non-critical so bound it; the outer catch logs the warn and boot continues.
      const timeoutMs = Number.parseInt(process.env.MCP_INDEX_BOOT_TIMEOUT_MS ?? '120000', 10);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const indexPromise = pgIndexingService.indexAllMCPTools(false);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`indexAllMCPTools timed out after ${timeoutMs}ms — boot continuing`)),
          timeoutMs,
        );
      });
      try {
        await Promise.race([indexPromise, timeoutPromise]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
      loggers.services.info('✅ MCP tools synced to PostgreSQL with pgvector embeddings');

      // Start periodic re-indexing (every 30 min)
      pgIndexingService.startPeriodicIndexing?.();
      loggers.services.info('🔄 Periodic MCP tool re-indexing started (30-min interval)');

      // Note: usecases collection with pre-baked tool_chain_yaml was
      // considered (#766) and rejected as an anti-pattern. Pre-authored
      // workflow recipes go stale + encode platform opinions + are
      // brittle (ServiceNow / LangGraph / Zapier all proved this).
      // Right abstraction: `learned_patterns` (#767) where the MODEL
      // self-curates successful chains as EXEMPLARS (hints, not
      // prescriptions), per the design discussion captured in
      // task #766 (deleted).
    } catch (pgError: any) {
      loggers.services.warn({ error: pgError.message }, '⚠️ PostgreSQL tool indexing failed (Milvus primary is OK)');
    }
  },
};
