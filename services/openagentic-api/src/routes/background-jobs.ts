/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Background Jobs API Routes
 *
 * Provides REST endpoints for managing and monitoring background jobs
 * submitted via the background_processor MCP.
 *
 * Features:
 * - List all jobs for a user (from Redis + Database)
 * - Get detailed job information with todos and logs
 * - Cancel running jobs
 * - SSE streaming for real-time job updates
 * - Automatic archival of completed jobs to database
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';
import { BackgroundJobService } from '../services/BackgroundJobService.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('error', (err: any) => {
  logger.error({ err }, 'Redis connection error in background-jobs route');
});

// Initialize BackgroundJobService
const backgroundJobService = new BackgroundJobService(prisma, redis);

// Start periodic archival
backgroundJobService.startPeriodicArchival();

interface BackgroundJobTodo {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

interface BackgroundJob {
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

const backgroundJobsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/background-jobs
   * List all background jobs for the authenticated user (from Redis + Database)
   */
  fastify.get('/api/background-jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const userId = user.email || user.id;

      // Get jobs from both Redis and database
      const jobs = await backgroundJobService.getUserJobs(userId);

      return reply.send({ jobs });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list background jobs');
      return reply.code(500).send({ error: 'Failed to list background jobs' });
    }
  });

  /**
   * GET /api/background-jobs/:jobId
   * Get detailed information about a specific job, including full result (from Redis or Database)
   */
  fastify.get('/api/background-jobs/:jobId', async (request: FastifyRequest<{
    Params: { jobId: string };
  }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { jobId } = request.params;
      const userId = user.email || user.id;

      const job = await backgroundJobService.getJob(jobId, userId);

      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      return reply.send(job);
    } catch (error: any) {
      logger.error({ error: error.message, jobId: request.params.jobId }, 'Failed to get background job');
      return reply.code(500).send({ error: 'Failed to get background job' });
    }
  });

  /**
   * POST /api/background-jobs/:jobId/cancel
   * Cancel a running or queued job
   */
  fastify.post('/api/background-jobs/:jobId/cancel', async (request: FastifyRequest<{
    Params: { jobId: string };
  }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { jobId } = request.params;
      const userId = user.email || user.id;

      const jobData = await redis.get(`background_job:${jobId}`);
      if (!jobData) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      const job: BackgroundJob = JSON.parse(jobData);

      // Check authorization
      if (job.metadata.userId && job.metadata.userId !== userId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      // Only cancel if queued or running
      if (job.status !== 'queued' && job.status !== 'running') {
        return reply.code(400).send({ error: 'Job is not in a cancellable state' });
      }

      // Update job status
      job.status = 'failed';
      job.error = 'Cancelled by user';
      job.completedAt = Date.now();
      if (!job.logs) {
        job.logs = [];
      }
      job.logs.push(`[${new Date().toISOString()}] Job cancelled by user`);

      await redis.set(`background_job:${jobId}`, JSON.stringify(job), 'EX', 86400);

      // Remove from queue if it's there
      await redis.zrem('background_job_queue', jobId);

      logger.info({ jobId, userId }, 'Background job cancelled');

      return reply.send({
        success: true,
        message: 'Job cancelled successfully',
        jobId
      });
    } catch (error: any) {
      logger.error({ error: error.message, jobId: request.params.jobId }, 'Failed to cancel background job');
      return reply.code(500).send({ error: 'Failed to cancel background job' });
    }
  });

  /**
   * GET /api/background-jobs/stream
   * SSE endpoint for real-time job updates
   * Supports token in query param (?token=) since EventSource doesn't support custom headers
   */
  fastify.get('/api/background-jobs/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // EventSource doesn't support custom headers, so check for token in query params
      const queryParams = request.query as { token?: string };
      const queryToken = queryParams.token;

      // If token provided in query, validate it and set request.user
      if (queryToken && !((request as any).user)) {
        try {
          const { validateAnyToken } = await import('../auth/tokenValidator.js');
          const result = await validateAnyToken(queryToken, {
            logger: logger
          });

          if (result.isValid && result.user) {
            const user = result.user;
            (request as any).user = {
              id: user.userId,
              userId: user.userId,
              email: user.email,
              name: user.name,
              groups: user.groups || [],
              isAdmin: user.isAdmin || false,
              localAccount: result.tokenType === 'local',
              accessToken: queryToken
            };
            logger.debug({ userId: user.userId }, '[SSE] Authenticated via query token');
          }
        } catch (error: any) {
          logger.warn({ error: error.message }, '[SSE] Failed to validate query token');
        }
      }

      const user = (request as any).user;
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const userId = user.email || user.id;

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // CRITICAL: Disable NGINX buffering for SSE streaming
      });

      // Send initial connection event
      reply.raw.write(`event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`);

      // Poll for job updates every 2 seconds
      const pollInterval = setInterval(async () => {
        try {
          // Get jobs from both Redis and database using the service
          const jobs = await backgroundJobService.getUserJobs(userId);

          // Send update event
          reply.raw.write(`event: update\ndata: ${JSON.stringify({ jobs })}\n\n`);
        } catch (error: any) {
          logger.error({ error: error.message, userId }, 'Error polling background jobs');
        }
      }, 2000);

      // Clean up on disconnect
      request.raw.on('close', () => {
        clearInterval(pollInterval);
        logger.info({ userId }, 'Background jobs SSE stream closed');
      });

      return reply;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to start background jobs stream');
      return reply.code(500).send({ error: 'Failed to start stream' });
    }
  });
};

export default backgroundJobsRoutes;
