/**
 * Admin User Context Routes
 * Serves the "User Context Memory" admin dashboard panel.
 * Reads from user_memory_entries + user_profiles tables.
 */

import { FastifyInstance } from 'fastify';
import { loggers } from '../utils/logger.js';

export default async function adminUserContextRoutes(fastify: FastifyInstance) {
  const prisma = (fastify as any).prisma;
  const logger = loggers.routes.child({ module: 'admin-user-context' });

  /**
   * GET /api/admin/user-context/overview
   * Aggregated overview for the admin dashboard card.
   */
  fastify.get('/overview', async (_request, reply) => {
    try {
      // Total entries + breakdown by source
      const entries = await prisma.userMemoryEntry.groupBy({
        by: ['source'],
        _count: { id: true },
      });

      const bySource: Record<string, number> = { chat: 0, code: 0, workflow: 0, memory: 0, tool: 0, feedback: 0, summary: 0 };
      let totalEntries = 0;
      for (const row of entries) {
        const src = row.source || 'memory';
        // map flow → workflow for display
        const key = src === 'flow' ? 'workflow' : src;
        bySource[key] = (bySource[key] || 0) + row._count.id;
        totalEntries += row._count.id;
      }

      // Unique users
      const userCounts = await prisma.userMemoryEntry.groupBy({
        by: ['user_id'],
        _count: { id: true },
      });
      const totalUsers = userCounts.length;

      // Rough storage estimate — count entries × avg content length
      // Use aggregate to get total count, then estimate from sample
      const allEntries = await prisma.userMemoryEntry.findMany({
        select: { content: true },
        take: 500,
      });
      const sampleBytes = allEntries.reduce((sum, e) => sum + (e.content?.length || 0), 0);
      const storageBytes = totalEntries <= 500 ? sampleBytes : Math.round((sampleBytes / Math.max(allEntries.length, 1)) * totalEntries);

      // Per-user summaries with full breakdown
      // Group by user_id AND source to get per-source counts
      const perUserSource = await prisma.userMemoryEntry.groupBy({
        by: ['user_id', 'source'],
        _count: { id: true },
      });

      // Get last activity per user using ORM aggregate
      const lastActivityAgg = await prisma.userMemoryEntry.groupBy({
        by: ['user_id'],
        _max: { created_at: true },
      });
      const lastActivityMap = new Map<string, string>();
      for (const row of lastActivityAgg) {
        if (row._max.created_at) {
          lastActivityMap.set(row.user_id, row._max.created_at.toISOString());
        }
      }

      // Build per-user source breakdown
      const userSourceMap = new Map<string, Record<string, number>>();
      for (const row of perUserSource) {
        if (!userSourceMap.has(row.user_id)) {
          userSourceMap.set(row.user_id, { chat: 0, code: 0, workflow: 0, memory: 0, tool: 0, feedback: 0, summary: 0 });
        }
        const src = row.source === 'flow' ? 'workflow' : (row.source || 'memory');
        const map = userSourceMap.get(row.user_id)!;
        map[src] = (map[src] || 0) + row._count.id;
      }

      // Fetch user details (email, name) from User table
      const userIds = userCounts.map((u: any) => u.user_id);
      const userRecords = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      });
      const userInfoMap = new Map<string, { email: string; name: string | null }>();
      for (const u of userRecords) {
        userInfoMap.set(u.id, { email: u.email, name: u.name });
      }

      const users = userCounts.map((u: any) => {
        const info = userInfoMap.get(u.user_id);
        const sources = userSourceMap.get(u.user_id) || {};
        return {
          userId: u.user_id,
          email: info?.email || u.user_id,
          name: info?.name || info?.email || u.user_id,
          totalEntries: u._count.id,
          chatEntries: sources.chat || 0,
          codeEntries: sources.code || 0,
          workflowEntries: sources.workflow || 0,
          memoryEntries: sources.memory || 0,
          toolEntries: sources.tool || 0,
          feedbackEntries: sources.feedback || 0,
          summaryEntries: sources.summary || 0,
          lastActivity: lastActivityMap.get(u.user_id) || null,
        };
      });

      return reply.send({
        overview: { totalEntries, bySource, totalUsers, storageBytes },
        users,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to fetch user-context overview');
      return reply.send({
        overview: { totalEntries: 0, bySource: { chat: 0, code: 0, workflow: 0, memory: 0 }, totalUsers: 0, storageBytes: 0 },
        users: [],
      });
    }
  });

  /**
   * GET /api/admin/user-context/retention
   * Retention policy settings (currently static defaults).
   */
  fastify.get('/retention', async (_request, reply) => {
    return reply.send({
      chatRetentionDays: 90,
      codeRetentionDays: 30,
      workflowRetentionDays: 180,
      memoryRetentionDays: 365,
      autoCleanupEnabled: false,
    });
  });

  /**
   * GET /api/admin/user-context/entries?userId=...&q=...
   * List entries for a specific user with optional search.
   */
  fastify.get<{
    Querystring: { userId?: string; q?: string; limit?: string; offset?: string };
  }>('/entries', async (request, reply) => {
    const { userId, q, limit: limitStr, offset: offsetStr } = request.query;
    if (!userId) return reply.code(400).send({ error: 'userId required' });

    const limit = Math.min(parseInt(limitStr || '50', 10), 200);
    const offset = parseInt(offsetStr || '0', 10);

    try {
      const where: any = { user_id: userId };
      if (q) {
        where.content = { contains: q, mode: 'insensitive' };
      }

      const entries = await prisma.userMemoryEntry.findMany({
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
      });

      return reply.send({ entries });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to fetch user-context entries');
      return reply.send({ entries: [] });
    }
  });

  /**
   * DELETE /api/admin/user-context/:userId
   * Purge all memory data for a user (GDPR).
   */
  fastify.delete<{ Params: { userId: string } }>('/:userId', async (request, reply) => {
    const { userId } = request.params;
    try {
      const deleted = await prisma.userMemoryEntry.deleteMany({ where: { user_id: userId } });
      await prisma.userProfile.deleteMany({ where: { user_id: userId } });
      logger.info({ userId, deletedEntries: deleted.count }, 'Purged user context');
      return reply.send({ success: true, deletedEntries: deleted.count });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to purge user context');
      return reply.code(500).send({ error: 'Failed to purge user context' });
    }
  });
}
