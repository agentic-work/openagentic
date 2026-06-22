/**
 * User Memory API Routes
 *
 * GET    /api/user-memory/entries?limit=20&source=chat  — list user's entries
 * GET    /api/user-memory/context?tokenBudget=1000      — assembled context block
 * POST   /api/user-memory/ingest                         — manual ingest
 * GET    /api/user-memory/profile                        — user's profile
 * DELETE /api/user-memory/entries/:id                     — delete entry
 * DELETE /api/user-memory/purge                           — GDPR full purge
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { getUserMemoryService } from '../services/UserMemoryService.js';

/**
 * Resolve the effective userId: internal service calls (via X-Internal-Secret)
 * may specify userId in body or query; authenticated users use their own id.
 */
function resolveUserId(request: any): string | null {
  const internalSecret = request.headers['x-internal-secret'];
  const expectedSecret = process.env.INTERNAL_SECRET || 'openagentic-internal';
  if (internalSecret && internalSecret === expectedSecret) {
    const bodyUserId = request.body?.userId;
    const queryUserId = (request.query as any)?.userId;
    if (bodyUserId || queryUserId) return bodyUserId || queryUserId;
  }
  return request.user?.id || null;
}

export const userMemoryRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes.child({ module: 'user-memory' });
  const prisma = (fastify as any).prisma;

  /**
   * GET /api/user-memory/entries
   */
  fastify.get<{
    Querystring: { limit?: string; offset?: string; source?: string; userId?: string };
  }>('/entries', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });

    const limit = Math.min(Number.parseInt(request.query.limit || '20', 10), 100);
    const offset = Number.parseInt(request.query.offset || '0', 10);
    const source = request.query.source;

    try {
      const where: any = { user_id: userId };
      if (source) where.source = source;

      const [entries, total] = await Promise.all([
        (prisma as any).userMemoryEntry.findMany({
          where,
          orderBy: { created_at: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            source: true,
            source_id: true,
            content: true,
            importance: true,
            topics: true,
            is_summary: true,
            created_at: true,
          },
        }),
        (prisma as any).userMemoryEntry.count({ where }),
      ]);

      return reply.send({ entries, total, limit, offset });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to list memory entries');
      return reply.code(500).send({ error: 'Failed to list memory entries' });
    }
  });

  /**
   * GET /api/user-memory/context
   */
  fastify.get<{
    Querystring: { tokenBudget?: string; query?: string; userId?: string };
  }>('/context', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });

    const tokenBudget = Number.parseInt(request.query.tokenBudget || '1000', 10);
    const query = request.query.query || '';

    try {
      const memoryService = getUserMemoryService();
      const context = await memoryService.getContext(userId, query, tokenBudget);
      return reply.send({ context, tokenEstimate: Math.ceil((context || '').length / 4) });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to get memory context');
      return reply.code(500).send({ error: 'Failed to get memory context' });
    }
  });

  /**
   * POST /api/user-memory/ingest
   */
  fastify.post<{
    Body: { content: string; source?: string; sourceId?: string; importance?: number; userId?: string };
  }>('/ingest', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });

    const { content, source = 'manual', sourceId, importance = 0.6 } = request.body || {};
    if (!content || content.length < 5) {
      return reply.code(400).send({ error: 'Content must be at least 5 characters' });
    }

    try {
      const memoryService = getUserMemoryService();
      await memoryService.ingest(userId, source, sourceId, content, importance);
      return reply.code(201).send({ success: true });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to ingest memory');
      return reply.code(500).send({ error: 'Failed to ingest memory' });
    }
  });

  /**
   * GET /api/user-memory/profile
   */
  fastify.get<{
    Querystring: { userId?: string };
  }>('/profile', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });

    try {
      const memoryService = getUserMemoryService();
      const profile = await memoryService.getUserProfile(userId);
      return reply.send({ profile });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to get user profile');
      return reply.code(500).send({ error: 'Failed to get user profile' });
    }
  });

  /**
   * DELETE /api/user-memory/entries/:id
   */
  fastify.delete<{ Params: { id: string } }>('/entries/:id', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });

    try {
      const entry = await (prisma as any).userMemoryEntry.findFirst({
        where: { id: request.params.id, user_id: userId },
      });
      if (!entry) return reply.code(404).send({ error: 'Entry not found' });

      await (prisma as any).userMemoryEntry.delete({ where: { id: request.params.id } });
      return reply.send({ success: true });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to delete memory entry');
      return reply.code(500).send({ error: 'Failed to delete memory entry' });
    }
  });

  /**
   * DELETE /api/user-memory/purge — GDPR full purge
   */
  fastify.delete<{
    Querystring: { userId?: string };
  }>('/purge', async (request, reply) => {
    const userId = resolveUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });

    try {
      const memoryService = getUserMemoryService();
      await memoryService.purgeUser(userId);
      return reply.send({ success: true, message: 'All memory data purged' });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to purge user memory');
      return reply.code(500).send({ error: 'Failed to purge user memory' });
    }
  });
};
