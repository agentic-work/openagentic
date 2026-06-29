import { loggers } from '../utils/logger.js';
import { setMilvusClient } from '../utils/MilvusConnectionManager.js';
import { classifyMilvusHealth, MilvusRecoveringError } from '../utils/milvusHealth.js';
import type { BootstrapStep } from './types.js';

// #1055: Milvus segment-load can take 5+ min on a fresh helm install
// when collections are large. Budget recovery polling at 30 × 10s.
// Fatal failures (DNS, connection refused, non-Success error_code)
// still fail fast at FATAL_MAX_ATTEMPTS.
const FATAL_MAX_ATTEMPTS = 10;
const RECOVERY_MAX_ATTEMPTS = 30;
const RECOVERY_INTERVAL_MS = 10000;

async function connectToMilvus() {
  const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
  const milvusAddress = process.env.MILVUS_ADDRESS ||
    `${process.env.MILVUS_HOST || 'milvus-standalone'}:${process.env.MILVUS_PORT || '19530'}`;

  let fatalAttempt = 0;
  let recoveryAttempt = 0;
  while (true) {
    try {
      const client = new MilvusClient({
        address: milvusAddress,
        username: process.env.MILVUS_USERNAME || process.env.MILVUS_USER,
        password: process.env.MILVUS_PASSWORD,
        timeout: 30000,
      });
      const healthCheck = await client.checkHealth();
      const state = classifyMilvusHealth(healthCheck);
      if (state === 'ready') {
        loggers.services.info(`Milvus connected (fatalAttempt=${fatalAttempt}, recoveryAttempt=${recoveryAttempt})`);
        return client;
      }
      if (state === 'recovering') {
        throw new MilvusRecoveringError(`Milvus collections still loading: ${JSON.stringify(healthCheck.reasons)}`);
      }
      throw new Error(`Milvus health check failed: ${JSON.stringify(healthCheck)}`);
    } catch (error: any) {
      if (error?.name === 'MilvusRecoveringError') {
        recoveryAttempt++;
        if (recoveryAttempt >= RECOVERY_MAX_ATTEMPTS) {
          loggers.services.fatal({ error: error.message }, `FATAL: Milvus still recovering after ${RECOVERY_MAX_ATTEMPTS} attempts (${(RECOVERY_MAX_ATTEMPTS * RECOVERY_INTERVAL_MS) / 1000}s)`);
          throw error;
        }
        loggers.services.warn({ recoveryAttempt }, `Milvus collections still loading — waiting ${RECOVERY_INTERVAL_MS / 1000}s (recovery ${recoveryAttempt}/${RECOVERY_MAX_ATTEMPTS})`);
        await new Promise(resolve => setTimeout(resolve, RECOVERY_INTERVAL_MS));
        continue;
      }
      fatalAttempt++;
      if (fatalAttempt >= FATAL_MAX_ATTEMPTS) {
        loggers.services.fatal({ error: error.message }, `FATAL: Cannot connect to Milvus after ${FATAL_MAX_ATTEMPTS} fatal attempts`);
        throw new Error(`Milvus connection failed after ${FATAL_MAX_ATTEMPTS} attempts: ${error.message}`);
      }
      loggers.services.warn({ error: error.message, attempt: fatalAttempt },
        `⚠️ Milvus connection attempt ${fatalAttempt}/${FATAL_MAX_ATTEMPTS} failed — retrying in ${fatalAttempt * 3}s`);
      await new Promise(resolve => setTimeout(resolve, fatalAttempt * 3000));
    }
  }
}

export const INIT_MILVUS: BootstrapStep = {
  name: 'milvus-init',
  critical: true,
  async run({ ctx }) {
    loggers.services.info('Connecting to Milvus vector database (MANDATORY)...');

    ctx.milvusClient = await connectToMilvus();
    setMilvusClient(ctx.milvusClient);

    // Initialize MilvusVectorService for user artifacts and embeddings
    const { MilvusVectorService } = await import('../services/MilvusVectorService.js');
    ctx.milvusVectorService = new MilvusVectorService(ctx.providerManager as any);
    await ctx.milvusVectorService.initialize();
    loggers.services.info('MilvusVectorService initialized');

    // Export global (Phase 4 removes)
    global.milvusVectorService = ctx.milvusVectorService;
  },
};
