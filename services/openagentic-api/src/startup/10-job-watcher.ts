import { JobCompletionWatcher } from '../services/JobCompletionWatcher.js';
import { getRedisClient, initializeRedis } from '../utils/redis-client.js';
import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

export const START_JOB_WATCHER: BootstrapStep = {
  name: 'job-watcher-start',
  critical: false,
  async run({ ctx }) {
    try {
      loggers.services.info('🔄 Initializing Redis client connection...');
      await initializeRedis(loggers.services);
      const redisClient = getRedisClient();

      if (redisClient.isConnected()) {
        loggers.services.info('✅ Redis client connected successfully');

        // Start JobCompletionWatcher for autonomous job monitoring
        loggers.services.info('🔄 Starting JobCompletionWatcher for autonomous monitoring...');
        ctx.jobCompletionWatcher = new JobCompletionWatcher(redisClient, loggers.services);
        ctx.jobCompletionWatcher.start();
        loggers.services.info('✅ JobCompletionWatcher started - AI will auto-detect completed jobs');

        // Wire watcher events to SSE broadcasts for real-time notifications
        ctx.jobCompletionWatcher.on('job:completed', async (statusChange: any) => {
          loggers.services.info({
            jobId: statusChange.jobId,
            sessionId: statusChange.sessionId,
            status: statusChange.newStatus
          }, '📢 Broadcasting job completion to SSE clients');

          try {
            const { broadcastJobCompletion } = await import('../routes/chat/handlers/stream.handler.js');
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
          } catch (error: any) {
            loggers.services.error({
              error: error.message,
              jobId: statusChange.jobId
            }, '❌ Failed to broadcast job completion');
          }
        });
      } else {
        loggers.services.warn('⚠️ Redis client failed to connect - continuing without cache');
      }
    } catch (error) {
      loggers.services.warn({ err: error }, '⚠️ JobCompletionWatcher initialization failed (non-critical)');
    }
  },
};
