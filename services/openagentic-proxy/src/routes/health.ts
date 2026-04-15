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

import type { FastifyInstance } from 'fastify';
import { getRedis } from '../utils/redis';
import type { AgentOrchestrator } from '../services/AgentOrchestrator';

export async function healthRoutes(app: FastifyInstance, orchestrator?: AgentOrchestrator): Promise<void> {
  app.get('/api/agents/health', async (_request, reply) => {
    let redisOk = false;
    try {
      const redis = getRedis();
      await redis.ping();
      redisOk = true;
    } catch {}

    let executionStats: { activeCount: number; totalToday: number; completedToday: number; failedToday: number } | null = null;
    if (orchestrator) {
      try {
        executionStats = await orchestrator.getStats();
      } catch {}
    }

    return reply.send({
      status: 'healthy',
      service: 'openagentic-proxy',
      version: '0.6.0',
      uptime: process.uptime(),
      redis: redisOk ? 'connected' : 'disconnected',
      ...(executionStats && { executions: executionStats }),
      timestamp: new Date().toISOString(),
    });
  });

}
