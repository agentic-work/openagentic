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

  /**
   * GET /api/admin/analytics/system/timeseries
   *
   * Primary-metrics-over-time feed for the admin Analytics Dashboard
   * "01 — Primary Metrics" section (Sev-1 #929).
   *
   * Query:
   *   metric  ∈ { tokens, ttft, tools }   — required
   *   window  ∈ { 7d, 30d, 90d }          — default 30d
   *   bucket  ∈ { 1h, 1d }                — default 1d
   *
   * Response (stable shape — UI charts depend on it):
   *   {
   *     metric, window, bucket,
   *     buckets:  [{ t: <iso>, byModel: { [model]: number } }],   // tokens, ttft
   *     topTools?: [{ tool: string, count: number }]              // tools only
   *   }
   *
   * Data sources:
   *   tokens → LLMRequestLog.total_tokens summed per (model, time-bucket)
   *   ttft   → LLMRequestLog.time_to_first_token_ms p50 per (model, time-bucket)
   *   tools  → MCPUsage.tool_name count desc over window
   *
   * Notes:
   *  - No hardcoded model literals (CLAUDE.md Rule 7) — top-5 models surface
   *    from the data itself, not from a static allow-list.
   *  - p50 (not mean) for TTFT — robust to single-outlier cold starts.
   */
  fastify.get<{
    Querystring: { metric?: string; window?: string; bucket?: string };
  }>('/system/timeseries', async (request, reply) => {
    try {
      const metric = String(request.query.metric ?? '');
      const window = String(request.query.window ?? '30d');
      // For sub-day windows (1h/6h/12h/24h) default the bucket to '1h' so the
      // admin Dashboard's "01 · primary metrics over time" panel renders
      // meaningfully (a single 1d bucket for a 24h window collapses to a
      // single bar). Day-and-up windows still default to '1d'.
      const HOUR_WINDOWS = ['1h', '6h', '12h', '24h'];
      const bucketDefault = HOUR_WINDOWS.includes(window) ? '1h' : '1d';
      const bucket = String(request.query.bucket ?? bucketDefault);

      if (!['tokens', 'ttft', 'tools'].includes(metric)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid metric '${metric}'. Must be one of: tokens, ttft, tools.`,
        });
      }
      const VALID_WINDOWS = ['1h', '6h', '12h', '24h', '7d', '30d', '90d'];
      if (!VALID_WINDOWS.includes(window)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid window '${window}'. Must be one of: ${VALID_WINDOWS.join(', ')}.`,
        });
      }
      if (!['1h', '1d'].includes(bucket)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid bucket '${bucket}'. Must be one of: 1h, 1d.`,
        });
      }

      const HOUR_MS = 60 * 60 * 1000;
      const DAY_MS = 24 * HOUR_MS;
      const millisMap: Record<string, number> = {
        '1h':   1 * HOUR_MS,
        '6h':   6 * HOUR_MS,
        '12h': 12 * HOUR_MS,
        '24h': 24 * HOUR_MS,
        '7d':   7 * DAY_MS,
        '30d': 30 * DAY_MS,
        '90d': 90 * DAY_MS,
      };
      const since = new Date(Date.now() - millisMap[window]);
      const bucketMs = bucket === '1h' ? HOUR_MS : DAY_MS;

      // Round a timestamp down to the bucket boundary. For 1d buckets we
      // normalize to UTC midnight; for 1h we floor to the hour.
      const floorToBucket = (d: Date): Date => {
        const t = d.getTime();
        return new Date(t - (t % bucketMs));
      };

      // ── tools: MCPUsage count, descending ──────────────────────────────
      if (metric === 'tools') {
        const grouped = await prisma.mCPUsage.groupBy({
          by: ['tool_name'],
          where: { timestamp: { gte: since } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 12,
        });
        const topTools = grouped.map((g) => ({
          tool: g.tool_name,
          count: g._count.id,
        }));
        return reply.send({
          success: true,
          metric,
          window,
          bucket,
          buckets: [],
          topTools,
        });
      }

      // ── tokens / ttft: read LLMRequestLog rows in window ──────────────
      const rows = await prisma.lLMRequestLog.findMany({
        where: { created_at: { gte: since } },
        select: {
          model: true,
          total_tokens: true,
          time_to_first_token_ms: true,
          latency_ms: true,
          created_at: true,
        },
      });

      // Pick top-5 models by total volume across the entire window so the
      // chart isn't crowded with one-shot models. Volume = token sum (for
      // tokens metric) or request count (for ttft metric).
      const modelVolume: Record<string, number> = {};
      for (const r of rows) {
        const m = r.model || 'unknown';
        if (metric === 'tokens') {
          modelVolume[m] = (modelVolume[m] ?? 0) + (r.total_tokens ?? 0);
        } else {
          modelVolume[m] = (modelVolume[m] ?? 0) + 1;
        }
      }
      const topModels = new Set(
        Object.entries(modelVolume)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([m]) => m),
      );

      // Group rows by (bucket, model). For tokens we sum; for ttft we
      // collect samples and compute p50 below.
      type Cell = { tokens: number; ttftSamples: number[] };
      const grid: Map<number, Map<string, Cell>> = new Map();
      for (const r of rows) {
        const m = r.model || 'unknown';
        if (!topModels.has(m)) continue;
        const bucketT = floorToBucket(r.created_at).getTime();
        let modelMap = grid.get(bucketT);
        if (!modelMap) {
          modelMap = new Map();
          grid.set(bucketT, modelMap);
        }
        let cell = modelMap.get(m);
        if (!cell) {
          cell = { tokens: 0, ttftSamples: [] };
          modelMap.set(m, cell);
        }
        cell.tokens += r.total_tokens ?? 0;
        // Fall back to latency_ms when TTFT wasn't recorded (older rows
        // pre-streaming-instrumentation). Doesn't poison the median —
        // these are rare.
        const ttft = r.time_to_first_token_ms ?? r.latency_ms ?? null;
        if (ttft != null && ttft > 0) {
          cell.ttftSamples.push(ttft);
        }
      }

      const p50 = (arr: number[]): number => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };

      const buckets = Array.from(grid.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([t, modelMap]) => {
          const byModel: Record<string, number> = {};
          for (const [model, cell] of modelMap.entries()) {
            byModel[model] = metric === 'tokens' ? cell.tokens : p50(cell.ttftSamples);
          }
          return { t: new Date(t).toISOString(), byModel };
        });

      return reply.send({
        success: true,
        metric,
        window,
        bucket,
        buckets,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get system timeseries');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch system timeseries',
      });
    }
  });

  /**
   * GET /api/admin/analytics/extended-thinking
   *
   * Extended thinking usage analytics (Task B.3, 2026-05-19).
   *
   * Query:
   *   window  ∈ { 7d, 30d, 90d }  — default 7d
   *   groupBy ∈ { model, user, day } — informational; response always includes
   *             both byModel and byDay sections regardless of groupBy.
   *
   * Response:
   *   {
   *     windowStart: ISO, windowEnd: ISO,
   *     totals: { requested, delivered, requestedNotDelivered,
   *               avgThinkingTokens, avgThinkingDurationMs },
   *     byModel: [{ model, requested, delivered, avgTokens }],
   *     byDay:   [{ date: 'YYYY-MM-DD', requested, delivered }]
   *   }
   *
   * Data source: admin.extended_thinking_metrics (written by stream.handler.ts
   * post-turn fire-and-forget).
   */
  fastify.get<{
    Querystring: { window?: string; groupBy?: string };
  }>('/extended-thinking', async (request, reply) => {
    try {
      const window = String(request.query.window ?? '7d');
      if (!['7d', '30d', '90d'].includes(window)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid window '${window}'. Must be one of: 7d, 30d, 90d.`,
        });
      }

      const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - daysMap[window] * 24 * 60 * 60 * 1000);

      // Read all rows in window from admin.extended_thinking_metrics.
      const rows = await (prisma as any).extendedThinkingMetric.findMany({
        where: { created_at: { gte: windowStart } },
        select: {
          created_at: true,
          model: true,
          requested: true,
          delivered: true,
          thinking_tokens: true,
          thinking_duration_ms: true,
        },
      }) as Array<{
        created_at: Date;
        model: string;
        requested: boolean;
        delivered: boolean;
        thinking_tokens: number | null;
        thinking_duration_ms: number | null;
      }>;

      // ── totals ──────────────────────────────────────────────────────────
      let totalRequested = 0;
      let totalDelivered = 0;
      let totalRequestedNotDelivered = 0;
      let tokenSum = 0;
      let tokenCount = 0;
      let durationSum = 0;
      let durationCount = 0;

      for (const r of rows) {
        if (r.requested) totalRequested++;
        if (r.delivered) totalDelivered++;
        if (r.requested && !r.delivered) totalRequestedNotDelivered++;
        if (typeof r.thinking_tokens === 'number' && r.thinking_tokens > 0) {
          tokenSum += r.thinking_tokens;
          tokenCount++;
        }
        if (typeof r.thinking_duration_ms === 'number' && r.thinking_duration_ms > 0) {
          durationSum += r.thinking_duration_ms;
          durationCount++;
        }
      }

      const totals = {
        requested: totalRequested,
        delivered: totalDelivered,
        requestedNotDelivered: totalRequestedNotDelivered,
        avgThinkingTokens: tokenCount > 0 ? Math.round(tokenSum / tokenCount) : 0,
        avgThinkingDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
      };

      // ── byModel ─────────────────────────────────────────────────────────
      const modelMap: Map<string, { requested: number; delivered: number; tokenSum: number; tokenCount: number }> = new Map();
      for (const r of rows) {
        const key = r.model || 'unknown';
        let entry = modelMap.get(key);
        if (!entry) {
          entry = { requested: 0, delivered: 0, tokenSum: 0, tokenCount: 0 };
          modelMap.set(key, entry);
        }
        if (r.requested) entry.requested++;
        if (r.delivered) entry.delivered++;
        if (typeof r.thinking_tokens === 'number' && r.thinking_tokens > 0) {
          entry.tokenSum += r.thinking_tokens;
          entry.tokenCount++;
        }
      }
      const byModel = Array.from(modelMap.entries())
        .map(([model, e]) => ({
          model,
          requested: e.requested,
          delivered: e.delivered,
          avgTokens: e.tokenCount > 0 ? Math.round(e.tokenSum / e.tokenCount) : 0,
        }))
        .sort((a, b) => b.requested - a.requested);

      // ── byDay ────────────────────────────────────────────────────────────
      const dayMap: Map<string, { requested: number; delivered: number }> = new Map();
      for (const r of rows) {
        const d = r.created_at;
        const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        let entry = dayMap.get(dateKey);
        if (!entry) {
          entry = { requested: 0, delivered: 0 };
          dayMap.set(dateKey, entry);
        }
        if (r.requested) entry.requested++;
        if (r.delivered) entry.delivered++;
      }
      const byDay = Array.from(dayMap.entries())
        .map(([date, e]) => ({ date, ...e }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return reply.send({
        success: true,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        totals,
        byModel,
        byDay,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get extended thinking metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch extended thinking metrics',
      });
    }
  });

  logger.info('Admin analytics routes registered (database-backed)');
};

export default adminAnalyticsRoutes;
