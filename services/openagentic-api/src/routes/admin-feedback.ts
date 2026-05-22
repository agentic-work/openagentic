/**
 * Admin Feedback Analytics Routes
 *
 * Dashboard for viewing user feedback on LLM responses
 * - GET /api/admin/feedback/stats - Overall feedback statistics
 * - GET /api/admin/feedback/by-model - Feedback breakdown by model
 * - GET /api/admin/feedback/by-user - Feedback breakdown by user
 * - GET /api/admin/feedback/recent - Recent feedback entries
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

interface FeedbackQueryParams {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  model?: string;
  feedbackType?: string;
}

export const adminFeedbackRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes.child({ module: 'admin-feedback' });

  /**
   * GET /stats - Overall feedback statistics
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      const { startDate, endDate } = request.query as FeedbackQueryParams;

      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      // Get total counts by feedback type
      const feedbackCounts = await prisma.responseFeedback.groupBy({
        by: ['feedback_type'],
        where: startDate || endDate ? { created_at: dateFilter } : undefined,
        _count: { feedback_type: true },
      });

      // Get total unique messages with feedback
      const uniqueMessages = await prisma.responseFeedback.groupBy({
        by: ['message_id'],
        where: startDate || endDate ? { created_at: dateFilter } : undefined,
      });

      // Get total unique users giving feedback
      const uniqueUsers = await prisma.responseFeedback.groupBy({
        by: ['user_id'],
        where: startDate || endDate ? { created_at: dateFilter } : undefined,
      });

      // Calculate satisfaction rate (thumbs up / (thumbs up + thumbs down))
      const thumbsUp = feedbackCounts.find(f => f.feedback_type === 'thumbs_up')?._count.feedback_type || 0;
      const thumbsDown = feedbackCounts.find(f => f.feedback_type === 'thumbs_down')?._count.feedback_type || 0;
      const satisfactionRate = thumbsUp + thumbsDown > 0
        ? Math.round((thumbsUp / (thumbsUp + thumbsDown)) * 100)
        : null;

      return reply.send({
        totalFeedback: feedbackCounts.reduce((sum, f) => sum + f._count.feedback_type, 0),
        uniqueMessages: uniqueMessages.length,
        uniqueUsers: uniqueUsers.length,
        satisfactionRate,
        byType: feedbackCounts.reduce((acc, f) => {
          acc[f.feedback_type] = f._count.feedback_type;
          return acc;
        }, {} as Record<string, number>),
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to get feedback stats');
      return reply.code(500).send({ error: 'Failed to get feedback statistics' });
    }
  });

  /**
   * GET /by-model - Feedback breakdown by model
   */
  fastify.get('/by-model', async (request, reply) => {
    try {
      const { startDate, endDate, limit = 20 } = request.query as FeedbackQueryParams;
      const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : (limit || 20);

      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      // Group feedback by model
      const feedbackByModel = await prisma.responseFeedback.groupBy({
        by: ['model', 'feedback_type'],
        where: {
          model: { not: null },
          ...(startDate || endDate ? { created_at: dateFilter } : {}),
        },
        _count: { feedback_type: true },
      });

      // Transform into model-centric view
      const modelStats: Record<string, {
        model: string;
        thumbs_up: number;
        thumbs_down: number;
        copy: number;
        total: number;
        satisfactionRate: number | null;
      }> = {};

      feedbackByModel.forEach(entry => {
        const model = entry.model || 'unknown';
        if (!modelStats[model]) {
          modelStats[model] = {
            model,
            thumbs_up: 0,
            thumbs_down: 0,
            copy: 0,
            total: 0,
            satisfactionRate: null,
          };
        }
        if (entry.feedback_type === 'thumbs_up') {
          modelStats[model].thumbs_up = entry._count.feedback_type;
        } else if (entry.feedback_type === 'thumbs_down') {
          modelStats[model].thumbs_down = entry._count.feedback_type;
        } else if (entry.feedback_type === 'copy') {
          modelStats[model].copy = entry._count.feedback_type;
        }
        modelStats[model].total += entry._count.feedback_type;
      });

      // Calculate satisfaction rates
      Object.values(modelStats).forEach(stat => {
        const totalVotes = stat.thumbs_up + stat.thumbs_down;
        stat.satisfactionRate = totalVotes > 0
          ? Math.round((stat.thumbs_up / totalVotes) * 100)
          : null;
      });

      // Sort by total feedback and limit
      const sorted = Object.values(modelStats)
        .sort((a, b) => b.total - a.total)
        .slice(0, limitNum);

      return reply.send({ models: sorted });
    } catch (error: any) {
      logger.error({ error }, 'Failed to get feedback by model');
      return reply.code(500).send({ error: 'Failed to get feedback by model' });
    }
  });

  /**
   * GET /by-user - Feedback breakdown by user
   */
  fastify.get('/by-user', async (request, reply) => {
    try {
      const { startDate, endDate, limit = 20 } = request.query as FeedbackQueryParams;
      const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : (limit || 20);

      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      // Get feedback counts by user
      const feedbackByUser = await prisma.responseFeedback.groupBy({
        by: ['user_id', 'feedback_type'],
        where: startDate || endDate ? { created_at: dateFilter } : undefined,
        _count: { feedback_type: true },
      });

      // Get user details
      const userIds = [...new Set(feedbackByUser.map(f => f.user_id))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });
      const userMap = new Map(users.map(u => [u.id, u]));

      // Transform into user-centric view
      const userStats: Record<string, {
        userId: string;
        name: string | null;
        email: string | null;
        thumbs_up: number;
        thumbs_down: number;
        copy: number;
        total: number;
      }> = {};

      feedbackByUser.forEach(entry => {
        const userId = entry.user_id;
        const user = userMap.get(userId);
        if (!userStats[userId]) {
          userStats[userId] = {
            userId,
            name: user?.name || null,
            email: user?.email || null,
            thumbs_up: 0,
            thumbs_down: 0,
            copy: 0,
            total: 0,
          };
        }
        if (entry.feedback_type === 'thumbs_up') {
          userStats[userId].thumbs_up = entry._count.feedback_type;
        } else if (entry.feedback_type === 'thumbs_down') {
          userStats[userId].thumbs_down = entry._count.feedback_type;
        } else if (entry.feedback_type === 'copy') {
          userStats[userId].copy = entry._count.feedback_type;
        }
        userStats[userId].total += entry._count.feedback_type;
      });

      // Sort by total feedback and limit
      const sorted = Object.values(userStats)
        .sort((a, b) => b.total - a.total)
        .slice(0, limitNum);

      return reply.send({ users: sorted });
    } catch (error: any) {
      logger.error({ error }, 'Failed to get feedback by user');
      return reply.code(500).send({ error: 'Failed to get feedback by user' });
    }
  });

  /**
   * GET /recent - Recent feedback entries
   */
  fastify.get('/recent', async (request, reply) => {
    try {
      const { limit = 50, offset = 0, feedbackType, model } = request.query as FeedbackQueryParams;

      // Parse limit and offset as integers (query params come as strings)
      const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : (limit || 50);
      const offsetNum = typeof offset === 'string' ? parseInt(offset, 10) : (offset || 0);

      const where: any = {};
      if (feedbackType) where.feedback_type = feedbackType;
      if (model) where.model = model;

      const [feedback, total] = await Promise.all([
        prisma.responseFeedback.findMany({
          where,
          orderBy: { created_at: 'desc' },
          take: limitNum,
          skip: offsetNum,
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
            message: {
              select: { id: true, content: true, role: true },
            },
          },
        }),
        prisma.responseFeedback.count({ where }),
      ]);

      return reply.send({
        feedback: feedback.map(f => ({
          id: f.id,
          feedbackType: f.feedback_type,
          rating: f.rating,
          comment: f.comment,
          tags: f.tags,
          model: f.model,
          provider: f.provider,
          createdAt: f.created_at,
          user: {
            id: f.user.id,
            name: f.user.name,
            email: f.user.email,
          },
          message: f.message ? {
            id: f.message.id,
            content: f.message.content?.substring(0, 200) + (f.message.content?.length > 200 ? '...' : ''),
            role: f.message.role,
          } : null,
        })),
        total,
        limit: limitNum,
        offset: offsetNum,
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to get recent feedback');
      return reply.code(500).send({ error: 'Failed to get recent feedback' });
    }
  });

  /**
   * GET /trends - Feedback trends over time
   */
  fastify.get('/trends', async (request, reply) => {
    try {
      const { startDate, endDate } = request.query as FeedbackQueryParams;

      // Default to last 30 days if not specified
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      const feedback = await prisma.responseFeedback.findMany({
        where: {
          created_at: {
            gte: start,
            lte: end,
          },
        },
        select: {
          feedback_type: true,
          created_at: true,
        },
        orderBy: { created_at: 'asc' },
      });

      // Group by day
      const dailyStats: Record<string, { date: string; thumbs_up: number; thumbs_down: number; copy: number }> = {};

      feedback.forEach(f => {
        const date = f.created_at.toISOString().split('T')[0];
        if (!dailyStats[date]) {
          dailyStats[date] = { date, thumbs_up: 0, thumbs_down: 0, copy: 0 };
        }
        if (f.feedback_type === 'thumbs_up') dailyStats[date].thumbs_up++;
        else if (f.feedback_type === 'thumbs_down') dailyStats[date].thumbs_down++;
        else if (f.feedback_type === 'copy') dailyStats[date].copy++;
      });

      return reply.send({
        trends: Object.values(dailyStats),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to get feedback trends');
      return reply.code(500).send({ error: 'Failed to get feedback trends' });
    }
  });

  /**
   * GET /model-accuracy - Comprehensive model accuracy analysis
   * Combines feedback, cost, and performance data for each model
   * This is the key endpoint for determining which models are most cost-effective
   */
  fastify.get('/model-accuracy', async (request, reply) => {
    try {
      const { startDate, endDate } = request.query as FeedbackQueryParams;

      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      const whereDate = startDate || endDate ? { created_at: dateFilter } : {};

      // Get feedback data by model
      const feedbackByModel = await prisma.responseFeedback.groupBy({
        by: ['model', 'feedback_type'],
        where: {
          model: { not: null },
          ...whereDate,
        },
        _count: { feedback_type: true },
      });

      // Get LLM request metrics by model
      const llmMetricsByModel = await prisma.lLMRequestLog.groupBy({
        by: ['model'],
        where: whereDate,
        _count: { model: true },
        _sum: {
          total_cost: true,
          total_tokens: true,
          prompt_tokens: true,
          completion_tokens: true,
        },
        _avg: {
          latency_ms: true,
          tokens_per_second: true,
          time_to_first_token_ms: true,
        },
      });

      // Get error counts by model
      const errorsByModel = await prisma.lLMRequestLog.groupBy({
        by: ['model'],
        where: {
          status: { not: 'success' },
          ...whereDate,
        },
        _count: { model: true },
      });
      const errorMap = new Map(errorsByModel.map(e => [e.model, e._count.model]));

      // Build model stats map from feedback
      const modelStats: Record<string, {
        model: string;
        // Feedback metrics
        thumbsUp: number;
        thumbsDown: number;
        copyCount: number;
        totalFeedback: number;
        satisfactionRate: number | null;
        // Request metrics
        totalRequests: number;
        successfulRequests: number;
        errorRate: number | null;
        // Cost metrics
        totalCost: number;
        avgCostPerRequest: number | null;
        totalTokens: number;
        avgTokensPerRequest: number | null;
        // Performance metrics
        avgLatencyMs: number | null;
        avgTokensPerSecond: number | null;
        avgTimeToFirstToken: number | null;
        // Derived metrics
        costPerSuccessfulResponse: number | null;
        accuracyScore: number | null;  // Composite score
        valueScore: number | null;     // Accuracy per dollar
      }> = {};

      // Process feedback data
      feedbackByModel.forEach(entry => {
        const model = entry.model || 'unknown';
        if (!modelStats[model]) {
          modelStats[model] = {
            model,
            thumbsUp: 0,
            thumbsDown: 0,
            copyCount: 0,
            totalFeedback: 0,
            satisfactionRate: null,
            totalRequests: 0,
            successfulRequests: 0,
            errorRate: null,
            totalCost: 0,
            avgCostPerRequest: null,
            totalTokens: 0,
            avgTokensPerRequest: null,
            avgLatencyMs: null,
            avgTokensPerSecond: null,
            avgTimeToFirstToken: null,
            costPerSuccessfulResponse: null,
            accuracyScore: null,
            valueScore: null,
          };
        }
        if (entry.feedback_type === 'thumbs_up') {
          modelStats[model].thumbsUp = entry._count.feedback_type;
        } else if (entry.feedback_type === 'thumbs_down') {
          modelStats[model].thumbsDown = entry._count.feedback_type;
        } else if (entry.feedback_type === 'copy') {
          modelStats[model].copyCount = entry._count.feedback_type;
        }
        modelStats[model].totalFeedback += entry._count.feedback_type;
      });

      // Process LLM metrics
      llmMetricsByModel.forEach(metric => {
        const model = metric.model;
        if (!modelStats[model]) {
          modelStats[model] = {
            model,
            thumbsUp: 0,
            thumbsDown: 0,
            copyCount: 0,
            totalFeedback: 0,
            satisfactionRate: null,
            totalRequests: 0,
            successfulRequests: 0,
            errorRate: null,
            totalCost: 0,
            avgCostPerRequest: null,
            totalTokens: 0,
            avgTokensPerRequest: null,
            avgLatencyMs: null,
            avgTokensPerSecond: null,
            avgTimeToFirstToken: null,
            costPerSuccessfulResponse: null,
            accuracyScore: null,
            valueScore: null,
          };
        }

        const errors = errorMap.get(model) || 0;
        const stats = modelStats[model];

        stats.totalRequests = metric._count.model;
        stats.successfulRequests = metric._count.model - errors;
        stats.errorRate = metric._count.model > 0
          ? Math.round((errors / metric._count.model) * 10000) / 100
          : null;

        stats.totalCost = Number(metric._sum.total_cost || 0);
        stats.avgCostPerRequest = metric._count.model > 0
          ? Number((Number(metric._sum.total_cost || 0) / metric._count.model).toFixed(6))
          : null;

        stats.totalTokens = metric._sum.total_tokens || 0;
        stats.avgTokensPerRequest = metric._count.model > 0
          ? Math.round((metric._sum.total_tokens || 0) / metric._count.model)
          : null;

        stats.avgLatencyMs = metric._avg.latency_ms
          ? Math.round(metric._avg.latency_ms)
          : null;
        stats.avgTokensPerSecond = metric._avg.tokens_per_second
          ? Math.round(metric._avg.tokens_per_second * 100) / 100
          : null;
        stats.avgTimeToFirstToken = metric._avg.time_to_first_token_ms
          ? Math.round(metric._avg.time_to_first_token_ms)
          : null;
      });

      // Calculate derived metrics
      Object.values(modelStats).forEach(stat => {
        // Satisfaction rate from feedback
        const totalVotes = stat.thumbsUp + stat.thumbsDown;
        stat.satisfactionRate = totalVotes > 0
          ? Math.round((stat.thumbsUp / totalVotes) * 100)
          : null;

        // Cost per successful response
        stat.costPerSuccessfulResponse = stat.successfulRequests > 0 && stat.totalCost > 0
          ? Number((stat.totalCost / stat.successfulRequests).toFixed(6))
          : null;

        // Composite accuracy score (weighted):
        // - 60% satisfaction rate (user feedback)
        // - 20% success rate (1 - error rate)
        // - 20% copy rate (users found response useful enough to copy)
        if (stat.satisfactionRate !== null || stat.errorRate !== null) {
          const satisfactionWeight = stat.satisfactionRate !== null ? stat.satisfactionRate * 0.6 : 0;
          const successWeight = stat.errorRate !== null ? (100 - stat.errorRate) * 0.2 : 0;
          const copyWeight = stat.totalFeedback > 0
            ? (stat.copyCount / stat.totalFeedback) * 100 * 0.2
            : 0;

          stat.accuracyScore = Math.round(satisfactionWeight + successWeight + copyWeight);
        }

        // Value score: Accuracy per dollar spent (higher = better value)
        // Formula: (accuracyScore * totalRequests) / totalCost
        if (stat.accuracyScore !== null && stat.totalCost > 0) {
          stat.valueScore = Math.round((stat.accuracyScore * Math.log10(stat.totalRequests + 1)) / (stat.totalCost * 1000));
        }
      });

      // Sort by accuracy score, then by total requests
      const sorted = Object.values(modelStats)
        .filter(s => s.totalRequests > 0 || s.totalFeedback > 0)
        .sort((a, b) => {
          if (a.accuracyScore !== null && b.accuracyScore !== null) {
            return b.accuracyScore - a.accuracyScore;
          }
          return b.totalRequests - a.totalRequests;
        });

      // Summary statistics
      const summary = {
        totalModels: sorted.length,
        totalRequests: sorted.reduce((sum, s) => sum + s.totalRequests, 0),
        totalCost: Number(sorted.reduce((sum, s) => sum + s.totalCost, 0).toFixed(4)),
        totalFeedback: sorted.reduce((sum, s) => sum + s.totalFeedback, 0),
        avgSatisfactionRate: sorted.filter(s => s.satisfactionRate !== null).length > 0
          ? Math.round(sorted.filter(s => s.satisfactionRate !== null).reduce((sum, s) => sum + (s.satisfactionRate || 0), 0) / sorted.filter(s => s.satisfactionRate !== null).length)
          : null,
        topPerformer: sorted.length > 0 && sorted[0].accuracyScore !== null ? sorted[0].model : null,
        bestValue: sorted.filter(s => s.valueScore !== null).sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0))[0]?.model || null,
      };

      logger.info({
        modelCount: sorted.length,
        totalFeedback: summary.totalFeedback,
        avgSatisfaction: summary.avgSatisfactionRate,
      }, 'Model accuracy analytics generated');

      return reply.send({
        models: sorted,
        summary,
        dateRange: {
          start: startDate || 'all time',
          end: endDate || 'now',
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to get model accuracy analytics');
      return reply.code(500).send({ error: 'Failed to get model accuracy analytics' });
    }
  });
};

export default adminFeedbackRoutes;
