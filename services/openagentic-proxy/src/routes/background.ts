import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { BackgroundAgentManager } from '../services/BackgroundAgentManager';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

export async function backgroundRoutes(app: FastifyInstance, bgManager: BackgroundAgentManager): Promise<void> {
  // Run a background agent
  app.post('/api/agents/background/run', {
    preHandler: authMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const { agentType, input, sessionId, userId, triggerMessageId, authMethod, userGroups, isAdmin } = body;

    if (!agentType || !input || !sessionId || !userId) {
      return reply.status(400).send({ error: 'agentType, input, sessionId, and userId are required' });
    }

    const result = await bgManager.runBackground(
      agentType,
      input,
      sessionId,
      userId,
      {
        userId,
        sessionId,
        authMethod: authMethod || 'local',
        userGroups: userGroups || [],
        isAdmin: isAdmin || false,
        executionId: `bg_${Date.now()}`,
      },
      triggerMessageId
    );

    if (!result) {
      return reply.status(429).send({ error: 'Background agent already running or unknown type' });
    }

    return reply.send(result);
  });

  // List active background agents
  app.get('/api/agents/background/status', {
    preHandler: authMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ activeAgents: bgManager.getActiveAgents() });
  });
}
