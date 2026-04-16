/**
 * Admin Analytics Routes
 *
 * Provides comprehensive analytics for the admin portal including per-user
 * cost tracking, model usage, and system-wide statistics.
 *
 * Uses direct database queries for analytics.
 * Token usage and costs are tracked in the chat_messages table.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

export interface AdminAnalyticsRequest {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
  };
}

const adminAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log.child({ plugin: 'admin-analytics' }) as Logger;

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
   * GET /api/admin/analytics/users/:userId/cost
   * Get comprehensive cost analytics for a specific user
   */
  fastify.get<{
    Params: { userId: string };
    Querystring: { startDate?: string; endDate?: string };
  }>('/users/:userId/cost', async (request, reply) => {
    try {
      const { userId } = request.params;
      const { startDate, endDate } = request.query;

      const whereClause: any = {
        user_id: userId,
        role: 'assistant'
      };

      if (startDate || endDate) {
        whereClause.created_at = {};
        if (startDate) whereClause.created_at.gte = new Date(startDate);
        if (endDate) whereClause.created_at.lte = new Date(endDate);
      }

      // Get messages with token usage from metadata
      const messages = await prisma.chatMessage.findMany({
        where: whereClause,
        select: {
          metadata: true,
          model: true,
          created_at: true
        }
      });

      // Calculate totals
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalCost = 0;

      const modelUsage: Record<string, any> = {};

      for (const msg of messages) {
        const metadata = msg.metadata as any;
        if (metadata?.usage) {
          const usage = metadata.usage;
          totalPromptTokens += usage.prompt_tokens || 0;
          totalCompletionTokens += usage.completion_tokens || 0;

          // Track by model
          if (msg.model) {
            if (!modelUsage[msg.model]) {
              modelUsage[msg.model] = {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
              };
            }
            modelUsage[msg.model].prompt_tokens += usage.prompt_tokens || 0;
            modelUsage[msg.model].completion_tokens += usage.completion_tokens || 0;
            modelUsage[msg.model].total_tokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
          }
        }
      }

      // Get user info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true }
      });

      return reply.send({
        success: true,
        user,
        analytics: {
          totalPromptTokens,
          totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
          totalCost,
          modelUsage,
          messageCount: messages.length
        }
      });
    } catch (error) {
      logger.error({ error, userId: request.params.userId }, 'Failed to get user cost analytics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch user cost analytics'
      });
    }
  });

  /**
   * GET /api/admin/analytics/system/overview
   * Get system-wide analytics overview
   */
  fastify.get('/system/overview', async (request, reply) => {
    try {
      // Get total users
      const totalUsers = await prisma.user.count();

      // Get total sessions
      const totalSessions = await prisma.chatSession.count();

      // Get total messages
      const totalMessages = await prisma.chatMessage.count();

      // Get messages from last 24 hours
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentMessages = await prisma.chatMessage.count({
        where: {
          created_at: {
            gte: last24h
          }
        }
      });

      // Get token usage from metadata
      const assistantMessages = await prisma.chatMessage.findMany({
        where: {
          role: 'assistant'
        },
        select: {
          metadata: true
        }
      });

      let totalTokens = 0;
      for (const msg of assistantMessages) {
        const metadata = msg.metadata as any;
        if (metadata?.usage) {
          const usage = metadata.usage;
          totalTokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
        }
      }

      return reply.send({
        success: true,
        overview: {
          totalUsers,
          totalSessions,
          totalMessages,
          recentMessages24h: recentMessages,
          totalTokens
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get system overview');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch system overview'
      });
    }
  });

  /**
   * GET /api/admin/analytics/users
   * Get list of all users with their usage statistics
   */
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/users', async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit || '50');
      const offset = parseInt(request.query.offset || '0');

      const users = await prisma.user.findMany({
        take: limit,
        skip: offset,
        select: {
          id: true,
          email: true,
          name: true,
          created_at: true,
          last_login_at: true
        },
        orderBy: {
          created_at: 'desc'
        }
      });

      // Get message counts for each user
      const usersWithStats = await Promise.all(
        users.map(async (user) => {
          const messageCount = await prisma.chatMessage.count({
            where: { user_id: user.id }
          });

          const sessionCount = await prisma.chatSession.count({
            where: { user_id: user.id }
          });

          return {
            ...user,
            messageCount,
            sessionCount
          };
        })
      );

      const totalUsers = await prisma.user.count();

      return reply.send({
        success: true,
        users: usersWithStats,
        pagination: {
          total: totalUsers,
          limit,
          offset,
          hasMore: offset + limit < totalUsers
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get users list');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch users list'
      });
    }
  });

  /**
   * GET /api/admin/analytics/stats
   * Get aggregate system statistics (for benchmarks and tests)
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      // Get all statistics in parallel
      const [
        totalUsers,
        totalSessions,
        totalMessages,
        activeUsers24h,
        activeSessions24h
      ] = await Promise.all([
        prisma.user.count(),
        prisma.chatSession.count(),
        prisma.chatMessage.count(),
        prisma.chatMessage.findMany({
          where: {
            created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          },
          distinct: ['user_id'],
          select: { user_id: true }
        }).then(r => r.length),
        prisma.chatSession.count({
          where: {
            updated_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        })
      ]);

      // Get LLM metrics using Prisma ORM
      let llmStats: { totalCost: number; totalTokens: number; modelBreakdown: Record<string, any> } = {
        totalCost: 0,
        totalTokens: 0,
        modelBreakdown: {}
      };
      try {
        // Get model counts using Prisma groupBy
        const modelCounts = await prisma.chatMessage.groupBy({
          by: ['model'],
          where: {
            role: 'assistant',
            model: { not: null }
          },
          _count: { id: true }
        });

        // Get messages with metadata for token calculation
        const messagesWithTokens = await prisma.chatMessage.findMany({
          where: {
            role: 'assistant',
            model: { not: null }
          },
          select: {
            model: true,
            metadata: true
          }
        });

        // Aggregate tokens by model
        const tokensByModel: Record<string, number> = {};
        for (const msg of messagesWithTokens) {
          const metadata = msg.metadata as any;
          const tokens = (metadata?.prompt_tokens || 0) + (metadata?.completion_tokens || 0);
          const model = msg.model || 'unknown';
          tokensByModel[model] = (tokensByModel[model] || 0) + tokens;
          llmStats.totalTokens += tokens;
        }

        // Build model breakdown
        for (const mc of modelCounts) {
          const model = mc.model || 'unknown';
          llmStats.modelBreakdown[model] = {
            tokens: tokensByModel[model] || 0,
            requests: mc._count.id
          };
        }
      } catch (e) {
        logger.warn('LLM metrics query failed, using estimates');
      }

      return reply.send({
        success: true,
        stats: {
          users: {
            total: totalUsers,
            active24h: activeUsers24h
          },
          sessions: {
            total: totalSessions,
            active24h: activeSessions24h
          },
          messages: {
            total: totalMessages
          },
          llm: llmStats,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get system stats');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch system stats'
      });
    }
  });

  /**
   * GET /api/admin/analytics/models
   * Get detailed model usage breakdown with costs and tokens
   */
  fastify.get<{
    Querystring: { startDate?: string; endDate?: string; limit?: string };
  }>('/models', async (request, reply) => {
    try {
      const { startDate, endDate, limit = '20' } = request.query;
      const limitNum = Math.min(parseInt(limit), 100);

      // Build date filter for Prisma
      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      const whereClause: any = {
        role: 'assistant'
      };
      if (startDate || endDate) {
        whereClause.created_at = dateFilter;
      }

      // Get model counts using Prisma groupBy
      const modelCounts = await prisma.chatMessage.groupBy({
        by: ['model'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limitNum
      });

      // Get messages with metadata for detailed token calculation
      const messagesWithDetails = await prisma.chatMessage.findMany({
        where: whereClause,
        select: {
          model: true,
          metadata: true,
          user_id: true,
          created_at: true,
          cost: true
        }
      });

      // Aggregate data by model
      const modelData: Record<string, {
        promptTokens: number;
        completionTokens: number;
        cost: number;
        uniqueUsers: Set<string>;
        firstUsed: Date | null;
        lastUsed: Date | null;
      }> = {};

      for (const msg of messagesWithDetails) {
        const model = msg.model || 'unknown';
        const metadata = msg.metadata as any;

        if (!modelData[model]) {
          modelData[model] = {
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            uniqueUsers: new Set(),
            firstUsed: null,
            lastUsed: null
          };
        }

        modelData[model].promptTokens += metadata?.prompt_tokens || 0;
        modelData[model].completionTokens += metadata?.completion_tokens || 0;
        modelData[model].cost += msg.cost ? Number(msg.cost) : 0;
        if (msg.user_id) modelData[model].uniqueUsers.add(msg.user_id);

        const msgDate = msg.created_at;
        if (!modelData[model].firstUsed || msgDate < modelData[model].firstUsed) {
          modelData[model].firstUsed = msgDate;
        }
        if (!modelData[model].lastUsed || msgDate > modelData[model].lastUsed) {
          modelData[model].lastUsed = msgDate;
        }
      }

      // Use actual costs from database (calculated by LLMMetricsService at request time)
      const models = modelCounts.map(mc => {
        const modelName = mc.model || 'unknown';
        const data = modelData[modelName] || {
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          uniqueUsers: new Set(),
          firstUsed: null,
          lastUsed: null
        };
        const totalTokens = data.promptTokens + data.completionTokens;

        return {
          model: modelName,
          requestCount: mc._count.id,
          promptTokens: data.promptTokens,
          completionTokens: data.completionTokens,
          totalTokens,
          estimatedCost: data.cost.toFixed(4),
          uniqueUsers: data.uniqueUsers.size,
          firstUsed: data.firstUsed,
          lastUsed: data.lastUsed
        };
      });

      return reply.send({
        success: true,
        models,
        summary: {
          totalModels: models.length,
          totalRequests: models.reduce((sum, m) => sum + m.requestCount, 0),
          totalTokens: models.reduce((sum, m) => sum + m.totalTokens, 0),
          totalEstimatedCost: models.reduce((sum, m) => sum + parseFloat(m.estimatedCost), 0).toFixed(4)
        },
        dateRange: { startDate, endDate }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get model analytics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch model analytics'
      });
    }
  });

  /**
   * GET /api/admin/analytics/embeddings
   * Get embedding usage statistics
   */
  fastify.get<{
    Querystring: { startDate?: string; endDate?: string };
  }>('/embeddings', async (request, reply) => {
    try {
      const { startDate, endDate } = request.query;

      const whereClause: any = {
        request_type: 'embedding'
      };

      if (startDate || endDate) {
        whereClause.created_at = {};
        if (startDate) whereClause.created_at.gte = new Date(startDate);
        if (endDate) whereClause.created_at.lte = new Date(endDate);
      }

      // Get embedding request counts and token usage from LLMRequestLog
      const embeddingLogs = await prisma.lLMRequestLog.findMany({
        where: whereClause,
        select: {
          provider_type: true,
          model: true,
          prompt_tokens: true,
          total_tokens: true,
          prompt_cost: true,
          total_cost: true,
          latency_ms: true,
          created_at: true
        }
      });

      // Aggregate by provider and model
      const byProvider: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
        avgLatency: number;
        latencies: number[];
      }> = {};

      const byModel: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
        avgLatency: number;
        latencies: number[];
      }> = {};

      let totalRequests = 0;
      let totalTokens = 0;
      let totalCost = 0;
      const allLatencies: number[] = [];

      for (const log of embeddingLogs) {
        totalRequests++;
        const tokens = log.total_tokens || log.prompt_tokens || 0;
        // Convert Prisma Decimal to number
        const costValue = log.total_cost || log.prompt_cost;
        const cost = costValue ? Number(costValue) : 0;
        const latency = log.latency_ms || 0;

        totalTokens += tokens;
        totalCost += cost;
        if (latency > 0) allLatencies.push(latency);

        // By provider
        const provider = log.provider_type || 'unknown';
        if (!byProvider[provider]) {
          byProvider[provider] = { requests: 0, tokens: 0, cost: 0, avgLatency: 0, latencies: [] };
        }
        byProvider[provider].requests++;
        byProvider[provider].tokens += tokens;
        byProvider[provider].cost += cost;
        if (latency > 0) byProvider[provider].latencies.push(latency);

        // By model
        const model = log.model || 'unknown';
        if (!byModel[model]) {
          byModel[model] = { requests: 0, tokens: 0, cost: 0, avgLatency: 0, latencies: [] };
        }
        byModel[model].requests++;
        byModel[model].tokens += tokens;
        byModel[model].cost += cost;
        if (latency > 0) byModel[model].latencies.push(latency);
      }

      // Calculate average latencies
      for (const provider in byProvider) {
        const p = byProvider[provider];
        p.avgLatency = p.latencies.length > 0
          ? Math.round(p.latencies.reduce((a, b) => a + b, 0) / p.latencies.length)
          : 0;
        delete (p as any).latencies; // Remove raw latencies from response
      }

      for (const model in byModel) {
        const m = byModel[model];
        m.avgLatency = m.latencies.length > 0
          ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length)
          : 0;
        delete (m as any).latencies;
      }

      const avgLatency = allLatencies.length > 0
        ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
        : 0;

      // Get daily trend (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const dailyTrend: Record<string, number> = {};

      for (const log of embeddingLogs) {
        if (log.created_at && log.created_at >= sevenDaysAgo) {
          const day = log.created_at.toISOString().split('T')[0];
          dailyTrend[day] = (dailyTrend[day] || 0) + 1;
        }
      }

      return reply.send({
        success: true,
        embeddings: {
          summary: {
            totalRequests,
            totalTokens,
            totalCost: parseFloat(totalCost.toFixed(4)),
            avgLatencyMs: avgLatency
          },
          byProvider: Object.entries(byProvider).map(([name, data]) => ({
            provider: name,
            requests: data.requests,
            tokens: data.tokens,
            cost: parseFloat(data.cost.toFixed(4)),
            avgLatencyMs: data.avgLatency
          })),
          byModel: Object.entries(byModel).map(([name, data]) => ({
            model: name,
            requests: data.requests,
            tokens: data.tokens,
            cost: parseFloat(data.cost.toFixed(4)),
            avgLatencyMs: data.avgLatency
          })),
          dailyTrend: Object.entries(dailyTrend)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, count]) => ({ date, count }))
        },
        dateRange: { startDate, endDate }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get embedding analytics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch embedding analytics'
      });
    }
  });

  logger.info('Admin analytics routes registered (database-backed)');
};

export default adminAnalyticsRoutes;
