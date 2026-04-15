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
 * User Context API Routes
 *
 * Provides cross-mode memory/context access for the unified memory layer.
 * All endpoints enforce per-user data isolation (FedRAMP AC-3).
 */
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { userContextService } from '../services/UserContextService.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.api;

const userContextRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Get user context (cross-mode)
  fastify.get('/api/user-context', { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = (request as any).user;
    const query = request.query as any;

    const sources = query.sources ? (query.sources as string).split(',') : undefined;
    const maxTokens = query.maxTokens ? parseInt(query.maxTokens as string) : 4000;
    const relevancyQuery = query.query as string | undefined;

    const context = await userContextService.getUserContext(user.id, {
      sources,
      maxTokens,
      relevancyQuery,
      includeChatHistory: !sources || sources.includes('chat'),
      includeCodeResults: !sources || sources.includes('code'),
      includeWorkflowResults: !sources || sources.includes('workflow'),
      includeMemories: !sources || sources.includes('memory'),
    });

    return reply.send(context);
  });

  // Index user data into unified context
  fastify.post('/api/user-context/index', { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = (request as any).user;
    const body = request.body as any;

    if (!body.source || !body.sourceId || !body.content) {
      return reply.code(400).send({ error: 'source, sourceId, and content are required' });
    }

    await userContextService.indexUserData(user.id, {
      source: body.source,
      sourceId: body.sourceId,
      content: body.content,
      metadata: body.metadata,
    });

    return reply.send({ success: true });
  });

  // Search user context
  fastify.get('/api/user-context/search', { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = (request as any).user;
    const query = request.query as any;

    if (!query.q) {
      return reply.code(400).send({ error: 'q (search query) is required' });
    }

    const results = await userContextService.searchUserContext(user.id, query.q, {
      sources: query.sources ? (query.sources as string).split(',') as any : undefined,
      limit: query.limit ? parseInt(query.limit) : 20,
    });

    return reply.send({ results });
  });

  // Purge user context (admin or self)
  fastify.delete('/api/user-context/:userId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = (request as any).user;
    const { userId } = request.params as { userId: string };

    // Only admin can purge other users' context
    if (userId !== user.id && !user.is_admin) {
      return reply.code(403).send({ error: 'Cannot purge other users context' });
    }

    const result = await userContextService.purgeUserContext(userId);
    logger.info({ userId, deletedBy: user.id, deleted: result.deleted }, '[UserContext] Context purged');

    return reply.send(result);
  });

  // Admin: get user context stats
  fastify.get('/api/admin/user-context/stats/:userId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user.is_admin) return reply.code(403).send({ error: 'Admin access required' });

    const { userId } = request.params as { userId: string };
    const stats = await userContextService.getUserContextStats(userId);

    return reply.send(stats);
  });
};

export default userContextRoutes;
