/**
 * Job Completion Watcher
 *
 * Monitors background jobs and emits SSE events when they complete.
 * Allows AI to proactively notify users of completed work.
 */

import { EventEmitter } from 'events';
import type { Logger } from 'pino';
import type { UnifiedRedisClient } from '../utils/redis-client.js';

interface JobStatusChange {
  jobId: string;
  oldStatus: string;
  newStatus: 'completed' | 'failed';
  sessionId?: string;
  userId?: string;
  result?: string;
  error?: string;
  completedAt: number;
}

export class JobCompletionWatcher extends EventEmitter {
  private redis: UnifiedRedisClient;
  private logger: Logger;
  private pollingInterval: NodeJS.Timeout | null = null;
  private watchedJobs: Map<string, string> = new Map(); // jobId -> last known status

  // Configuration
  private readonly POLL_INTERVAL_MS = 5000; // Check every 5 seconds
  private readonly WATCH_PATTERN = 'background:job:*';

  constructor(redis: UnifiedRedisClient, logger: Logger) {
    super();
    this.redis = redis;
    this.logger = logger;
  }

  /**
   * Start watching for job completions
   */
  start(): void {
    if (this.pollingInterval) {
      this.logger.warn('JobCompletionWatcher already running');
      return;
    }

    this.logger.info({
      pollIntervalMs: this.POLL_INTERVAL_MS,
      pattern: this.WATCH_PATTERN
    }, 'Starting JobCompletionWatcher');

    this.pollingInterval = setInterval(() => {
      this.checkJobStatuses().catch((error: any) => {
        this.logger.error({ error: error.message }, 'Error checking job statuses');
      });
    }, this.POLL_INTERVAL_MS);

    // Also check immediately on start
    this.checkJobStatuses().catch((error: any) => {
      this.logger.error({ error: error.message }, 'Error in initial job status check');
    });
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.watchedJobs.clear();
      this.logger.info('Stopped JobCompletionWatcher');
    }
  }

  /**
   * Check all background jobs for status changes
   */
  private async checkJobStatuses(): Promise<void> {
    try {
      // Get all background job keys
      const keys = await this.redis.keys(this.WATCH_PATTERN);

      for (const key of keys) {
        const jobId = key.replace('background:job:', '');
        const jobDataStr = await this.redis.get(key);

        if (!jobDataStr) continue;

        const jobData = JSON.parse(jobDataStr);
        const currentStatus = jobData.status;
        const previousStatus = this.watchedJobs.get(jobId);

        // Check if status changed to completed or failed
        if (previousStatus && previousStatus !== currentStatus) {
          if (currentStatus === 'completed' || currentStatus === 'failed') {
            this.logger.info({
              jobId,
              oldStatus: previousStatus,
              newStatus: currentStatus,
              sessionId: jobData.metadata?.sessionId
            }, '🎉 Job status changed - emitting completion event');

            const statusChange: JobStatusChange = {
              jobId,
              oldStatus: previousStatus,
              newStatus: currentStatus,
              sessionId: jobData.metadata?.sessionId,
              userId: jobData.metadata?.userId,
              result: jobData.result,
              error: jobData.error,
              completedAt: jobData.completedAt || Date.now()
            };

            // Emit event for subscribers (SSE handlers will listen)
            this.emit('job:completed', statusChange);

            // Remove from watched list (job is done)
            this.watchedJobs.delete(jobId);
          }
        }

        // Track running jobs
        if (currentStatus === 'queued' || currentStatus === 'running') {
          this.watchedJobs.set(jobId, currentStatus);
        }
      }
    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Error in checkJobStatuses');
    }
  }

  /**
   * Get currently watched jobs (for debugging)
   */
  getWatchedJobs(): Array<{ jobId: string; status: string }> {
    return Array.from(this.watchedJobs.entries()).map(([jobId, status]) => ({
      jobId,
      status
    }));
  }
}
