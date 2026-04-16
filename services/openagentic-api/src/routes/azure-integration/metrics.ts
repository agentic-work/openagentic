/**
 * Azure User Metrics Routes
 * Handles user-level Azure cost and usage metrics
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { authMiddleware } from '../../middleware/unifiedAuth.js';

interface AzureCostData {
  period: string;
  totalCost: number;
  currency: string;
  breakdown: Array<{
    date: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
  projectedMonthlyCost: number;
  costByModel: Record<string, number>;
}

interface AzureUsageStats {
  period: string;
  totalTokens: number;
  totalRequests: number;
  averageTokensPerRequest: number;
  topModels: Array<{
    model: string;
    tokens: number;
    requests: number;
    percentage: number;
  }>;
  dailyUsage: Array<{
    date: string;
    tokens: number;
    requests: number;
    cost: number;
  }>;
}

export const azureMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get Azure costs for authenticated user
  fastify.get<{
    Querystring: { 
      period?: string; 
      granularity?: 'daily' | 'weekly' | 'monthly';
    };
  }>('/costs', {
    preHandler: [authMiddleware],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' },
          granularity: { type: 'string', enum: ['daily', 'weekly', 'monthly'], default: 'daily' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { period = '30d', granularity = 'daily' } = request.query;
      const user_id = request.user?.id;

      if (!user_id) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const startDate = new Date(Date.now() - (periodDays * 24 * 60 * 60 * 1000));

      // Get user's chat sessions and messages with token usage
      const sessions = await prisma.chatSession.findMany({
        where: {
          user_id: user_id,
          created_at: {
            gte: startDate
          }
        },
        include: {
          messages: {
            where: {
              token_usage: {
                not: null
              }
            },
            select: {
              created_at: true,
              model: true,
              token_usage: true
            }
          }
        }
      });

      // Process cost data
      let totalCost = 0;
      const costByModel: Record<string, number> = {};
      const dailyData: Record<string, { cost: number; tokens: number; requests: number }> = {};

      sessions.forEach(session => {
        session.messages.forEach(message => {
          const usage = message.token_usage as any;
          const cost = usage?.cost || 0;
          const tokens = usage?.totalTokens || 0;
          const model = message.model || 'unknown';
          const date = message.created_at.toISOString().split('T')[0];

          totalCost += cost;
          costByModel[model] = (costByModel[model] || 0) + cost;

          if (!dailyData[date]) {
            dailyData[date] = { cost: 0, tokens: 0, requests: 0 };
          }
          dailyData[date].cost += cost;
          dailyData[date].tokens += tokens;
          dailyData[date].requests += 1;
        });
      });

      const breakdown = Object.entries(dailyData)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, data]) => ({
          date,
          cost: data.cost,
          tokens: data.tokens,
          requests: data.requests
        }));

      // Project monthly cost
      const dailyAverage = totalCost / periodDays;
      const projectedMonthlyCost = dailyAverage * 30;

      const costData: AzureCostData = {
        period,
        totalCost,
        currency: 'USD',
        breakdown,
        projectedMonthlyCost,
        costByModel
      };

      return reply.send(costData);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to fetch Azure cost data');
      return reply.status(500).send({ 
        error: 'Failed to fetch Azure cost data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get Azure usage statistics for authenticated user
  fastify.get<{
    Querystring: { period?: string };
  }>('/usage', {
    preHandler: [authMiddleware],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { period = '30d' } = request.query;
      const user_id = request.user?.id;

      if (!user_id) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const startDate = new Date(Date.now() - (periodDays * 24 * 60 * 60 * 1000));

      // Get usage data
      const messages = await prisma.chatMessage.findMany({
        where: {
          session: {
            user_id: user_id
          },
          created_at: {
            gte: startDate
          },
          token_usage: {
            not: null
          }
        },
        select: {
          created_at: true,
          model: true,
          token_usage: true
        },
        orderBy: {
          created_at: 'asc'
        }
      });

      let totalTokens = 0;
      let totalRequests = messages.length;
      const modelStats: Record<string, { tokens: number; requests: number }> = {};
      const dailyUsage: Record<string, { tokens: number; requests: number; cost: number }> = {};

      messages.forEach(message => {
        const usage = message.token_usage as any;
        const tokens = usage?.totalTokens || 0;
        const cost = usage?.cost || 0;
        const model = message.model || 'unknown';
        const date = message.created_at.toISOString().split('T')[0];

        totalTokens += tokens;

        if (!modelStats[model]) {
          modelStats[model] = { tokens: 0, requests: 0 };
        }
        modelStats[model].tokens += tokens;
        modelStats[model].requests += 1;

        if (!dailyUsage[date]) {
          dailyUsage[date] = { tokens: 0, requests: 0, cost: 0 };
        }
        dailyUsage[date].tokens += tokens;
        dailyUsage[date].requests += 1;
        dailyUsage[date].cost += cost;
      });

      // Calculate top models
      const topModels = Object.entries(modelStats)
        .map(([model, stats]) => ({
          model,
          tokens: stats.tokens,
          requests: stats.requests,
          percentage: (stats.tokens / totalTokens) * 100
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5);

      const dailyUsageArray = Object.entries(dailyUsage)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, data]) => ({
          date,
          tokens: data.tokens,
          requests: data.requests,
          cost: data.cost
        }));

      const usageStats: AzureUsageStats = {
        period,
        totalTokens,
        totalRequests,
        averageTokensPerRequest: totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0,
        topModels,
        dailyUsage: dailyUsageArray
      };

      return reply.send(usageStats);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to fetch Azure usage stats');
      return reply.status(500).send({ 
        error: 'Failed to fetch Azure usage statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  fastify.log.info('Azure metrics routes registered');
};