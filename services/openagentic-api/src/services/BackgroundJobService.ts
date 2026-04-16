/**
 * Background Job Service
 *
 * Manages background job persistence and retrieval across Redis (active jobs)
 * and PostgreSQL (historical jobs).
 *
 * Features:
 * - Automatic archival of completed/failed jobs from Redis to database
 * - Unified retrieval across Redis and database
 * - Configurable retention policies
 * - Periodic cleanup of old Redis entries
 */

import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';

interface BackgroundJobTodo {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

interface BackgroundJobData {
  id: string;
  type: 'analysis' | 'processing' | 'computation' | 'research';
  prompt: string;
  model: string;
  priority: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  progress?: string;
  todos: BackgroundJobTodo[];
  logs: string[];
  metadata: {
    sessionId?: string;
    userId?: string;
    conversationContext?: string;
    tags?: string[];
  };
}

export class BackgroundJobService {
  private prisma: PrismaClient;
  private redis: Redis;
  private archivalInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly REDIS_TTL = 86400; // 24 hours in seconds
  private readonly DB_RETENTION_DAYS = 90; // Keep in database for 90 days
  private readonly ARCHIVAL_INTERVAL_MS = 300000; // Archive every 5 minutes
  private readonly ARCHIVE_AFTER_HOURS = 1; // Archive jobs older than 1 hour

  constructor(prisma: PrismaClient, redis: Redis) {
    this.prisma = prisma;
    this.redis = redis;
  }

  /**
   * Start periodic archival of completed jobs
   */
  startPeriodicArchival(): void {
    if (this.archivalInterval) {
      logger.warn('Periodic archival already running');
      return;
    }

    logger.info('Starting periodic background job archival', {
      intervalMs: this.ARCHIVAL_INTERVAL_MS,
      archiveAfterHours: this.ARCHIVE_AFTER_HOURS
    });

    this.archivalInterval = setInterval(async () => {
      try {
        await this.archiveCompletedJobs();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Error during periodic archival');
      }
    }, this.ARCHIVAL_INTERVAL_MS);
  }

  /**
   * Stop periodic archival
   */
  stopPeriodicArchival(): void {
    if (this.archivalInterval) {
      clearInterval(this.archivalInterval);
      this.archivalInterval = null;
      logger.info('Stopped periodic background job archival');
    }
  }

  /**
   * Archive completed/failed jobs from Redis to database
   */
  async archiveCompletedJobs(): Promise<number> {
    try {
      const now = Date.now();
      const archiveThreshold = now - (this.ARCHIVE_AFTER_HOURS * 60 * 60 * 1000);

      // Get all job IDs from queue
      const queuedJobIds = await this.redis.zrange('background_job_queue', 0, -1);

      // Get all user job sets
      const userJobKeys = await this.redis.keys('user_jobs:*');
      const allUserJobIds: string[] = [];
      for (const key of userJobKeys) {
        const jobIds = await this.redis.smembers(key);
        allUserJobIds.push(...jobIds);
      }

      // Combine all job IDs
      const allJobIds = [...new Set([...queuedJobIds, ...allUserJobIds])];

      let archivedCount = 0;

      for (const jobId of allJobIds) {
        const jobData = await this.redis.get(`background_job:${jobId}`);
        if (!jobData) continue;

        const job: BackgroundJobData = JSON.parse(jobData);

        // Only archive completed/failed jobs older than threshold
        if (
          (job.status === 'completed' || job.status === 'failed') &&
          job.completedAt &&
          job.completedAt < archiveThreshold
        ) {
          await this.archiveJob(job);
          archivedCount++;
        }
      }

      if (archivedCount > 0) {
        logger.info(`Archived ${archivedCount} background jobs to database`);
      }

      return archivedCount;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to archive completed jobs');
      throw error;
    }
  }

  /**
   * Archive a single job to the database
   */
  async archiveJob(job: BackgroundJobData): Promise<void> {
    try {
      // Check if already exists in database
      const existing = await this.prisma.backgroundJob.findUnique({
        where: { id: job.id }
      });

      if (existing) {
        logger.debug({ jobId: job.id }, 'Job already archived');
        return;
      }

      // Insert into database
      await this.prisma.backgroundJob.create({
        data: {
          id: job.id,
          type: job.type,
          prompt: job.prompt,
          model: job.model,
          priority: job.priority,
          status: job.status,
          created_at: new Date(job.createdAt),
          started_at: job.startedAt ? new Date(job.startedAt) : null,
          completed_at: job.completedAt ? new Date(job.completedAt) : null,
          result: job.result || null,
          error: job.error || null,
          progress: job.progress || null,
          todos: (job.todos || []) as any,
          logs: (job.logs || []) as any,
          metadata: (job.metadata || {}) as any,
          user_id: job.metadata.userId || null,
          session_id: job.metadata.sessionId || null,
        }
      });

      // Remove from Redis after successful archival
      await this.redis.del(`background_job:${job.id}`);
      await this.redis.zrem('background_job_queue', job.id);

      if (job.metadata.userId) {
        await this.redis.srem(`user_jobs:${job.metadata.userId}`, job.id);
      }

      logger.debug({ jobId: job.id }, 'Job archived to database and removed from Redis');
    } catch (error: any) {
      logger.error({ error: error.message, jobId: job.id }, 'Failed to archive job');
      throw error;
    }
  }

  /**
   * Get all jobs for a user from both Redis and database
   */
  async getUserJobs(userId: string): Promise<any[]> {
    const jobs: any[] = [];

    // Get jobs from Redis (active jobs)
    const redisJobs = await this.getRedisJobs(userId);
    jobs.push(...redisJobs);

    // Get jobs from database (historical jobs)
    const dbJobs = await this.getDatabaseJobs(userId);
    jobs.push(...dbJobs);

    // Sort by creation time (newest first)
    jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return jobs;
  }

  /**
   * Get jobs from Redis for a user
   */
  private async getRedisJobs(userId: string): Promise<any[]> {
    const jobs: any[] = [];

    try {
      const userJobIds = await this.redis.smembers(`user_jobs:${userId}`);
      const queuedJobIds = await this.redis.zrange('background_job_queue', 0, -1);
      const allJobIds = [...new Set([...userJobIds, ...queuedJobIds])];

      for (const jobId of allJobIds) {
        const jobData = await this.redis.get(`background_job:${jobId}`);
        if (!jobData) continue;

        const job: BackgroundJobData = JSON.parse(jobData);

        // Only include jobs for this user
        if (!job.metadata.userId || job.metadata.userId === userId) {
          jobs.push({
            jobId: job.id,
            status: job.status,
            type: job.type,
            priority: job.priority,
            createdAt: new Date(job.createdAt).toISOString(),
            startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
            completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : undefined,
            runningFor: job.startedAt && job.status === 'running'
              ? `${Math.round((Date.now() - job.startedAt) / 1000)}s`
              : undefined,
            duration: job.completedAt && job.startedAt
              ? `${Math.round((job.completedAt - job.startedAt) / 1000)}s`
              : undefined,
            progress: job.progress,
            error: job.error,
            todos: job.todos || [],
            recentLogs: job.logs ? job.logs.slice(-10) : [],
            totalLogs: job.logs ? job.logs.length : 0,
            hasResult: !!job.result,
            source: 'redis'
          });
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to get Redis jobs');
    }

    return jobs;
  }

  /**
   * Get jobs from database for a user
   */
  private async getDatabaseJobs(userId: string): Promise<any[]> {
    try {
      const dbJobs = await this.prisma.backgroundJob.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 100 // Limit to last 100 jobs
      });

      return dbJobs.map(job => {
        const createdAt = job.created_at.getTime();
        const startedAt = job.started_at?.getTime();
        const completedAt = job.completed_at?.getTime();

        return {
          jobId: job.id,
          status: job.status,
          type: job.type,
          priority: job.priority,
          createdAt: job.created_at.toISOString(),
          startedAt: job.started_at?.toISOString(),
          completedAt: job.completed_at?.toISOString(),
          runningFor: startedAt && job.status === 'running'
            ? `${Math.round((Date.now() - startedAt) / 1000)}s`
            : undefined,
          duration: completedAt && startedAt
            ? `${Math.round((completedAt - startedAt) / 1000)}s`
            : undefined,
          progress: job.progress,
          error: job.error,
          todos: Array.isArray(job.todos) ? job.todos : [],
          recentLogs: Array.isArray(job.logs) ? (job.logs as string[]).slice(-10) : [],
          totalLogs: Array.isArray(job.logs) ? (job.logs as string[]).length : 0,
          hasResult: !!job.result,
          source: 'database'
        };
      });
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to get database jobs');
      return [];
    }
  }

  /**
   * Get a specific job by ID from either Redis or database
   */
  async getJob(jobId: string, userId: string): Promise<any | null> {
    // Try Redis first (active jobs)
    const redisData = await this.redis.get(`background_job:${jobId}`);
    if (redisData) {
      const job: BackgroundJobData = JSON.parse(redisData);

      // Check authorization
      if (job.metadata.userId && job.metadata.userId !== userId) {
        return null;
      }

      return {
        jobId: job.id,
        status: job.status,
        type: job.type,
        priority: job.priority,
        prompt: job.prompt,
        model: job.model,
        createdAt: new Date(job.createdAt).toISOString(),
        startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
        completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : undefined,
        runningFor: job.startedAt && job.status === 'running'
          ? `${Math.round((Date.now() - job.startedAt) / 1000)}s`
          : undefined,
        duration: job.completedAt && job.startedAt
          ? `${Math.round((job.completedAt - job.startedAt) / 1000)}s`
          : undefined,
        progress: job.progress,
        error: job.error,
        result: job.result,
        todos: job.todos || [],
        logs: job.logs || [],
        metadata: job.metadata,
        source: 'redis'
      };
    }

    // Try database (historical jobs)
    const dbJob = await this.prisma.backgroundJob.findUnique({
      where: { id: jobId }
    });

    if (!dbJob) {
      return null;
    }

    // Check authorization
    if (dbJob.user_id && dbJob.user_id !== userId) {
      return null;
    }

    const startedAt = dbJob.started_at?.getTime();
    const completedAt = dbJob.completed_at?.getTime();

    return {
      jobId: dbJob.id,
      status: dbJob.status,
      type: dbJob.type,
      priority: dbJob.priority,
      prompt: dbJob.prompt,
      model: dbJob.model,
      createdAt: dbJob.created_at.toISOString(),
      startedAt: dbJob.started_at?.toISOString(),
      completedAt: dbJob.completed_at?.toISOString(),
      runningFor: startedAt && dbJob.status === 'running'
        ? `${Math.round((Date.now() - startedAt) / 1000)}s`
        : undefined,
      duration: completedAt && startedAt
        ? `${Math.round((completedAt - startedAt) / 1000)}s`
        : undefined,
      progress: dbJob.progress,
      error: dbJob.error,
      result: dbJob.result,
      todos: Array.isArray(dbJob.todos) ? dbJob.todos : [],
      logs: Array.isArray(dbJob.logs) ? dbJob.logs : [],
      metadata: (dbJob.metadata as any) || {},
      source: 'database'
    };
  }

  /**
   * Clean up old database records
   */
  async cleanupOldJobs(): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.DB_RETENTION_DAYS);

      const result = await this.prisma.backgroundJob.deleteMany({
        where: {
          created_at: {
            lt: cutoffDate
          }
        }
      });

      if (result.count > 0) {
        logger.info(`Cleaned up ${result.count} old background jobs from database`);
      }

      return result.count;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to cleanup old jobs');
      return 0;
    }
  }
}
