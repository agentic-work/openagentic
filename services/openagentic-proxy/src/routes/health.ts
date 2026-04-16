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
