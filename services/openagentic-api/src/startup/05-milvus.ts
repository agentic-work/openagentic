import { loggers } from '../utils/logger.js';
import { setMilvusClient } from '../utils/MilvusConnectionManager.js';
import type { BootstrapStep } from './types.js';

async function connectToMilvus() {
  const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
  const milvusAddress = process.env.MILVUS_ADDRESS ||
    `${process.env.MILVUS_HOST || 'milvus-standalone'}:${process.env.MILVUS_PORT || '19530'}`;

  let milvusConnectAttempt = 0;
  while (true) {
    try {
      milvusConnectAttempt++;
      const client = new MilvusClient({
        address: milvusAddress,
        username: process.env.MILVUS_USERNAME || process.env.MILVUS_USER,
        password: process.env.MILVUS_PASSWORD,
        timeout: 30000,
      });
      const healthCheck = await client.checkHealth();
      if (healthCheck.isHealthy) {
        loggers.services.info(`✅ Milvus connected (attempt ${milvusConnectAttempt})`);
        return client;
      }
      throw new Error(`Milvus health check failed: ${JSON.stringify(healthCheck)}`);
    } catch (error: any) {
      if (milvusConnectAttempt >= 10) {
        loggers.services.fatal({ error: error.message }, '🚨 FATAL: Cannot connect to Milvus after 10 attempts');
        throw new Error(`Milvus connection failed after 10 attempts: ${error.message}`);
      }
      loggers.services.warn({ error: error.message, attempt: milvusConnectAttempt },
        `⚠️ Milvus connection attempt ${milvusConnectAttempt}/10 failed — retrying in ${milvusConnectAttempt * 3}s`);
      await new Promise(resolve => setTimeout(resolve, milvusConnectAttempt * 3000));
    }
  }
}

export const INIT_MILVUS: BootstrapStep = {
  name: 'milvus-init',
  critical: true,
  async run({ ctx }) {
    loggers.services.info('🔄 Connecting to Milvus vector database (MANDATORY)...');

    ctx.milvusClient = await connectToMilvus();
    setMilvusClient(ctx.milvusClient);

    // Initialize MilvusVectorService for user artifacts and embeddings
    const { MilvusVectorService } = await import('../services/MilvusVectorService.js');
    ctx.milvusVectorService = new MilvusVectorService(ctx.providerManager as any);
    await ctx.milvusVectorService.initialize();
    loggers.services.info('✅ MilvusVectorService initialized');

    // Export global (Phase 4 removes)
    global.milvusVectorService = ctx.milvusVectorService;
  },
};
