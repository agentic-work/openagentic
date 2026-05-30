/**
 * Admin Messages Routes
 *
 * Provides admin access to view recent messages across all users and sessions.
 * Used for monitoring, support, and audit purposes.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

const adminMessagesRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log.child({ plugin: 'admin-messages' }) as Logger;

  // Middleware to ensure admin access
  fastify.addHook('preHandler', async (request: any, reply) => {
    if (!request.user || !request.user.isAdmin) {
      reply.code(403).send({
        error: 'Admin access required'
      });
      return;
    }
    return;
  });

  /**
   * GET /api/admin/messages/recent
   * Get recent messages across all users and sessions
   */
  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      userId?: string;
      sessionId?: string;
      role?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };
  }>('/recent', async (request, reply) => {
    try {
      const {
        limit = '50',
        offset = '0',
        userId,
        sessionId,
        role,
        search,
        startDate,
        endDate
      } = request.query;

      const limitNum = Math.min(parseInt(limit), 200);
      const offsetNum = parseInt(offset);

      // Build WHERE clause
      const conditions: any = {};

      if (userId) {
        conditions.user_id = userId;
      }
      if (sessionId) {
        conditions.session_id = sessionId;
      }
      if (role) {
        conditions.role = role;
      }
      if (search) {
        conditions.content = {
          contains: search,
          mode: 'insensitive'
        };
      }
      if (startDate || endDate) {
        conditions.created_at = {};
        if (startDate) conditions.created_at.gte = new Date(startDate);
        if (endDate) conditions.created_at.lte = new Date(endDate);
      }

      // Get messages with user and session info
      const messages = await prisma.chatMessage.findMany({
        where: conditions,
        take: limitNum,
        skip: offsetNum,
        orderBy: {
          created_at: 'desc'
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          session: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });

      // Get total count for pagination
      const totalCount = await prisma.chatMessage.count({
        where: conditions
      });

      // Format response
      const formattedMessages = messages.map(msg => ({
        id: msg.id,
        content: msg.content?.substring(0, 500) + (msg.content && msg.content.length > 500 ? '...' : ''),
        contentLength: msg.content?.length || 0,
        role: msg.role,
        model: msg.model,
        user: msg.user,
        session: msg.session,
        metadata: msg.metadata,
        createdAt: msg.created_at
      }));

      return reply.send({
        success: true,
        messages: formattedMessages,
        pagination: {
          total: totalCount,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < totalCount
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get recent messages');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch recent messages'
      });
    }
  });

  /**
   * GET /api/admin/messages/:messageId
   * Get full details of a specific message
   */
  fastify.get<{ Params: { messageId: string } }>('/:messageId', async (request, reply) => {
    try {
      const { messageId } = request.params;

      const message = await prisma.chatMessage.findUnique({
        where: { id: messageId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          session: {
            select: {
              id: true,
              title: true,
              created_at: true
            }
          }
        }
      });

      if (!message) {
        return reply.code(404).send({
          success: false,
          error: 'Message not found'
        });
      }

      return reply.send({
        success: true,
        message: {
          id: message.id,
          content: message.content,
          role: message.role,
          model: message.model,
          user: message.user,
          session: message.session,
          metadata: message.metadata,
          createdAt: message.created_at
        }
      });
    } catch (error) {
      logger.error({ error, messageId: request.params.messageId }, 'Failed to get message');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch message'
      });
    }
  });

  /**
   * GET /api/admin/messages/stats
   * Get message statistics
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        total,
        last24hCount,
        last7dCount,
        last30dCount,
        byRole
      ] = await Promise.all([
        prisma.chatMessage.count(),
        prisma.chatMessage.count({ where: { created_at: { gte: last24h } } }),
        prisma.chatMessage.count({ where: { created_at: { gte: last7d } } }),
        prisma.chatMessage.count({ where: { created_at: { gte: last30d } } }),
        prisma.chatMessage.groupBy({
          by: ['role'],
          _count: { role: true }
        })
      ]);

      const roleStats = byRole.reduce((acc, r) => {
        acc[r.role] = r._count.role;
        return acc;
      }, {} as Record<string, number>);

      return reply.send({
        success: true,
        stats: {
          total,
          last24h: last24hCount,
          last7d: last7dCount,
          last30d: last30dCount,
          byRole: roleStats,
          avgPerDay: Math.round(last30dCount / 30)
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get message stats');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch message stats'
      });
    }
  });

  logger.info('Admin messages routes registered');
};

export default adminMessagesRoutes;
