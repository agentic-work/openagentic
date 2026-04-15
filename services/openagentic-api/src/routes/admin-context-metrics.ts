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
 * Admin Context Window Metrics API
 *
 * Provides endpoints for viewing context window usage metrics per chat session
 * Helps administrators monitor context window management effectiveness
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { contextManagementService } from '../services/ContextManagementService.js';
import { getCachedMetrics, setCachedMetrics } from '../services/AdminMetricsCache.js';

interface ContextMetricsQuery {
  limit?: string;
  offset?: string;
  sortBy?: 'utilization' | 'total_tokens' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  userId?: string;
  minUtilization?: string;
}

interface SessionMetricsParams {
  sessionId: string;
}

export const adminContextMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/context-metrics/compaction
   * Get compaction metrics and statistics for context window management
   */
  fastify.get<{
    Querystring: { startDate?: string; endDate?: string; sessionType?: string };
  }>(
    '/context-metrics/compaction',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Get context compaction metrics',
        description: 'Retrieve metrics about context window compaction including frequency, tokens freed, and active session health',
        querystring: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'Start date for metrics (ISO format)' },
            endDate: { type: 'string', description: 'End date for metrics (ISO format)' },
            sessionType: { type: 'string', enum: ['chat', 'code', 'all'], default: 'all' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              summary: {
                type: 'object',
                properties: {
                  totalCompactions: { type: 'number' },
                  totalTokensFreed: { type: 'number' },
                  totalMessagesRemoved: { type: 'number' },
                  totalMessagesSummarized: { type: 'number' },
                  avgTokensFreedPerCompaction: { type: 'number' }
                }
              },
              byLevel: {
                type: 'object',
                properties: {
                  light: { type: 'number' },
                  medium: { type: 'number' },
                  aggressive: { type: 'number' }
                }
              },
              byDay: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    compactions: { type: 'number' },
                    tokensFreed: { type: 'number' }
                  }
                }
              },
              recentCompactions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    level: { type: 'string' },
                    tokensFreed: { type: 'number' },
                    messagesRemoved: { type: 'number' },
                    timestamp: { type: 'string' }
                  }
                }
              },
              activeSessions: {
                type: 'object',
                properties: {
                  total: { type: 'number' },
                  approachingLimit: { type: 'number' },
                  needsCompaction: { type: 'number' },
                  healthy: { type: 'number' }
                }
              },
              contextUsageDistribution: {
                type: 'object',
                properties: {
                  under50: { type: 'number' },
                  from50to70: { type: 'number' },
                  from70to85: { type: 'number' },
                  from85to95: { type: 'number' },
                  over95: { type: 'number' }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    async (request, reply) => {
      try {
        const { startDate, endDate, sessionType } = request.query;

        const metrics = await contextManagementService.getCompactionMetrics({
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          sessionType: (sessionType as 'chat' | 'code' | 'all') || 'all',
        });

        return reply.send(metrics);
      } catch (error) {
        request.log.error({ error }, 'Failed to fetch compaction metrics');
        return reply.code(500).send({
          error: 'Failed to fetch compaction metrics',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/context-metrics
   * Get context window metrics across all sessions
   */
  fastify.get<{ Querystring: ContextMetricsQuery }>(
    '/context-metrics',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Get context window metrics',
        description: 'Retrieve context window usage metrics across all chat sessions',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string', default: '50' },
            offset: { type: 'string', default: '0' },
            sortBy: {
              type: 'string',
              enum: ['utilization', 'total_tokens', 'created_at'],
              default: 'utilization'
            },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            userId: { type: 'string' },
            minUtilization: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              sessions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    userId: { type: 'string' },
                    userName: { type: 'string' },
                    userEmail: { type: 'string' },
                    title: { type: 'string' },
                    model: { type: 'string' },
                    messageCount: { type: 'number' },
                    contextTokensInput: { type: 'number' },
                    contextTokensOutput: { type: 'number' },
                    contextTokensTotal: { type: 'number' },
                    contextWindowSize: { type: 'number' },
                    contextUtilizationPct: { type: 'number' },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' }
                  }
                }
              },
              total: { type: 'number' },
              statistics: {
                type: 'object',
                properties: {
                  averageUtilization: { type: 'number' },
                  maxUtilization: { type: 'number' },
                  totalSessions: { type: 'number' },
                  highUtilizationSessions: { type: 'number' }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    async (request: FastifyRequest<{ Querystring: ContextMetricsQuery }>, reply: FastifyReply) => {
      try {
        const {
          limit = '50',
          offset = '0',
          sortBy = 'utilization',
          sortOrder = 'desc',
          userId,
          minUtilization
        } = request.query;

        const limitNum = Math.min(parseInt(limit, 10), 1000);
        const offsetNum = parseInt(offset, 10);
        const minUtil = minUtilization ? parseFloat(minUtilization) : undefined;

        // Check cache
        const cacheKey = `context:${limitNum}:${offsetNum}:${sortBy}:${sortOrder}:${userId || ''}:${minUtilization || ''}`;
        const cached = await getCachedMetrics<any>(cacheKey);
        if (cached) {
          return reply.send(cached);
        }

        // Build where clause
        const where: any = {
          deleted_at: null,
          context_tokens_total: { gt: 0 } // Only sessions with token data
        };

        if (userId) {
          where.user_id = userId;
        }

        if (minUtil !== undefined) {
          where.context_utilization_pct = { gte: minUtil };
        }

        // Build orderBy clause
        let orderBy: any;
        switch (sortBy) {
          case 'utilization':
            orderBy = { context_utilization_pct: sortOrder };
            break;
          case 'total_tokens':
            orderBy = { context_tokens_total: sortOrder };
            break;
          case 'created_at':
          default:
            orderBy = { created_at: sortOrder };
            break;
        }

        // Fetch sessions with context metrics
        const [sessions, total] = await Promise.all([
          prisma.chatSession.findMany({
            where,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            },
            orderBy,
            take: limitNum,
            skip: offsetNum
          }),
          prisma.chatSession.count({ where })
        ]);

        // Calculate statistics
        const stats = await prisma.chatSession.aggregate({
          where,
          _avg: {
            context_utilization_pct: true
          },
          _max: {
            context_utilization_pct: true
          },
          _count: true
        });

        const highUtilizationCount = await prisma.chatSession.count({
          where: {
            ...where,
            context_utilization_pct: { gte: 80 }
          }
        });

        // Format response — clamp utilization to 0-100% range
        const formattedSessions = sessions.map(session => ({
          id: session.id,
          userId: session.user_id,
          userName: session.user?.name || 'Unknown',
          userEmail: session.user?.email || 'Unknown',
          title: session.title || 'Untitled',
          model: session.model || 'Unknown',
          messageCount: session.message_count,
          contextTokensInput: session.context_tokens_input || 0,
          contextTokensOutput: session.context_tokens_output || 0,
          contextTokensTotal: session.context_tokens_total || 0,
          contextWindowSize: session.context_window_size || null,
          contextUtilizationPct: session.context_utilization_pct
            ? Math.min(100, Math.max(0, parseFloat(session.context_utilization_pct.toString())))
            : null,
          createdAt: session.created_at.toISOString(),
          updatedAt: session.updated_at.toISOString()
        }));

        const responseData = {
          sessions: formattedSessions,
          total,
          statistics: {
            averageUtilization: stats._avg.context_utilization_pct
              ? Math.min(100, Math.max(0, parseFloat(stats._avg.context_utilization_pct.toString())))
              : 0,
            maxUtilization: stats._max.context_utilization_pct
              ? Math.min(100, Math.max(0, parseFloat(stats._max.context_utilization_pct.toString())))
              : 0,
            totalSessions: stats._count,
            highUtilizationSessions: highUtilizationCount
          }
        };

        await setCachedMetrics(cacheKey, responseData, 60);
        return reply.send(responseData);

      } catch (error) {
        request.log.error({ error }, 'Failed to fetch context window metrics');
        return reply.code(500).send({
          error: 'Failed to fetch context window metrics',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/context-metrics/:sessionId
   * Get detailed context window metrics for a specific session
   */
  fastify.get<{ Params: SessionMetricsParams }>(
    '/context-metrics/:sessionId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Get session context metrics',
        description: 'Get detailed context window metrics for a specific chat session',
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              session: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  model: { type: 'string' },
                  messageCount: { type: 'number' },
                  contextTokensInput: { type: 'number' },
                  contextTokensOutput: { type: 'number' },
                  contextTokensTotal: { type: 'number' },
                  contextWindowSize: { type: 'number' },
                  contextUtilizationPct: { type: 'number' }
                }
              },
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    role: { type: 'string' },
                    tokensInput: { type: 'number' },
                    tokensOutput: { type: 'number' },
                    tokensTotal: { type: 'number' },
                    createdAt: { type: 'string' }
                  }
                }
              }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    async (request: FastifyRequest<{ Params: SessionMetricsParams }>, reply: FastifyReply) => {
      try {
        const { sessionId } = request.params;

        const session = await prisma.chatSession.findUnique({
          where: { id: sessionId },
          include: {
            messages: {
              where: { deleted_at: null },
              select: {
                id: true,
                role: true,
                tokens_input: true,
                tokens_output: true,
                tokens: true,
                created_at: true
              },
              orderBy: { created_at: 'asc' }
            }
          }
        });

        if (!session) {
          return reply.code(404).send({
            error: 'Session not found'
          });
        }

        // Format response — clamp utilization to 0-100% range
        const formattedSession = {
          id: session.id,
          title: session.title || 'Untitled',
          model: session.model || 'Unknown',
          messageCount: session.message_count,
          contextTokensInput: session.context_tokens_input || 0,
          contextTokensOutput: session.context_tokens_output || 0,
          contextTokensTotal: session.context_tokens_total || 0,
          contextWindowSize: session.context_window_size || null,
          contextUtilizationPct: session.context_utilization_pct
            ? Math.min(100, Math.max(0, parseFloat(session.context_utilization_pct.toString())))
            : null
        };

        const formattedMessages = session.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          tokensInput: msg.tokens_input || 0,
          tokensOutput: msg.tokens_output || 0,
          tokensTotal: msg.tokens || 0,
          createdAt: msg.created_at.toISOString()
        }));

        return reply.send({
          session: formattedSession,
          messages: formattedMessages
        });

      } catch (error) {
        request.log.error({ error, sessionId: request.params.sessionId },
          'Failed to fetch session context metrics');
        return reply.code(500).send({
          error: 'Failed to fetch session context metrics',
          message: error.message
        });
      }
    }
  );
  // GET /admin/context/compaction-log
  fastify.get('/context/compaction-log', async (request, reply) => {
    const { limit = 50, sessionId, mode } = request.query as any;
    const where: any = {};
    if (sessionId) where.session_id = sessionId;
    if (mode) where.mode = mode;

    const logs = await prisma.compactionLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: Math.min(Number(limit), 200),
    });

    return reply.send({ logs });
  });

  // GET /admin/context/model-switches
  fastify.get('/context/model-switches', async (request, reply) => {
    const switches = await prisma.compactionLog.findMany({
      where: { model_switched: true },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: {
        session_id: true,
        model: true,
        previous_model: true,
        tokens_freed: true,
        created_at: true,
      },
    });
    return reply.send({ switches });
  });

  // GET /admin/context/config
  fastify.get('/context/config', async (request, reply) => {
    try {
      const { ContextManagerService } = await import('../services/context/ContextManagerService.js');
      const service = ContextManagerService.getInstance();
      return reply.send({ config: service.getConfig() });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /admin/context/metrics
  fastify.get('/context/metrics', async (request, reply) => {
    try {
      const { start, end } = request.query as any;
      const { ContextManagerService } = await import('../services/context/ContextManagerService.js');
      const metrics = await ContextManagerService.getInstance().getCompactionMetrics(
        start && end ? { start: new Date(start), end: new Date(end) } : undefined
      );
      return reply.send(metrics);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
};

export default adminContextMetricsRoutes;
