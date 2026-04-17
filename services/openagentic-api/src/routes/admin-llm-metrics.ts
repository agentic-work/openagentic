/**
 * Admin LLM Metrics Routes
 * Real-time LLM usage metrics: token usage, costs, MCP tool calls
 * Data sourced from user_query_audit and admin_audit_log tables
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { llmMetricsService } from '../services/LLMMetricsService.js';
import { getCachedMetrics, setCachedMetrics } from '../services/AdminMetricsCache.js';
import { enterpriseOnly } from '../middleware/enterpriseOnly.js';

const logger = loggers.routes.child({ component: 'AdminLLMMetrics' });

interface TimeRangeQuery {
  hours?: number;
  days?: number;
}

interface UserMetrics {
  userId: string;
  email: string;
  totalQueries: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  toolCalls: number;
  avgResponseTime: number;
}

interface MCPToolMetrics {
  toolName: string;
  serverName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionTime: number;
  estimatedCost: number;
}

// Cost data is stored in the database (llm_request_logs.total_cost field)
// For legacy userQueryAudit data without costs, return 0
// Costs are calculated by LLMMetricsService at request time and stored in llm_request_logs

const adminLLMMetricsRoutes: FastifyPluginAsync = async (fastify) => {

  // OSS gate — all routes in this plugin return 402 with upgrade_url.
  fastify.addHook('preHandler', enterpriseOnly);
  /**
   * Get comprehensive LLM metrics overview
   */
  fastify.get<{ Querystring: TimeRangeQuery }>('/api/admin/metrics/llm/overview', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest<{ Querystring: TimeRangeQuery }>, reply: FastifyReply) => {
    try {
      const { hours = 24 } = request.query;

      const cacheKey = `llm:overview:${hours}`;
      const cached = await getCachedMetrics(cacheKey);
      if (cached) return reply.send(cached);

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      logger.info({ hours, since }, '[LLM-METRICS] Fetching overview');

      // Get all query audits in timeframe
      const queries = await prisma.userQueryAudit.findMany({
        where: {
          created_at: { gte: since }
        },
        include: {
          user: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

      // Calculate aggregate metrics
      const totalQueries = queries.length;
      const totalTokens = queries.reduce((sum, q) => sum + (q.tokens_consumed || 0), 0);
      // Note: Schema doesn't track prompt/completion separately, only total tokens_consumed
      const totalPromptTokens = Math.floor(totalTokens * 0.6); // Rough estimate: 60% prompt
      const totalCompletionTokens = Math.floor(totalTokens * 0.4); // 40% completion

      // Note: userQueryAudit does not store cost data - use /aggregated or /requests for accurate costs
      // Those endpoints read from llm_request_logs which has actual cost data
      const totalCost = 0;

      // Calculate average response time
      const validResponseTimes = queries.filter(q => q.response_time_ms).map(q => q.response_time_ms!);
      const avgResponseTime = validResponseTimes.length > 0
        ? validResponseTimes.reduce((a, b) => a + b, 0) / validResponseTimes.length
        : 0;

      // Count unique users
      const uniqueUsers = new Set(queries.map(q => q.user_id)).size;

      // Count successful vs failed queries
      const successCount = queries.filter(q => q.success).length;
      const failureCount = totalQueries - successCount;

      // Count MCP tool calls from userQueryAudit
      let toolCalls = queries.reduce((sum, q) => {
        if (!q.tools_called || !Array.isArray(q.tools_called)) return sum;
        return sum + q.tools_called.length;
      }, 0);

      // Fallback: if userQueryAudit has no tool call data, count from chat_messages.mcp_calls
      if (toolCalls === 0) {
        try {
          const messagesWithMcpCalls = await prisma.chatMessage.findMany({
            where: {
              created_at: { gte: since },
              NOT: { mcp_calls: { equals: null } },
            },
            select: { mcp_calls: true },
          });
          toolCalls = messagesWithMcpCalls.reduce((sum, m) => {
            return sum + (Array.isArray(m.mcp_calls) ? (m.mcp_calls as any[]).length : 0);
          }, 0);
        } catch (e) {
          logger.warn({ error: e }, '[LLM-METRICS] Failed to fallback to chat_messages for tool calls');
        }
      }

      // Model breakdown (cost data not available in userQueryAudit - use /aggregated for costs)
      const modelStats = queries.reduce((acc, q) => {
        const model = q.model_used || 'unknown';
        if (!acc[model]) {
          acc[model] = { count: 0, tokens: 0, cost: 0 };
        }
        acc[model].count++;
        const tokens = q.tokens_consumed || 0;
        acc[model].tokens += tokens;
        // Cost is 0 - userQueryAudit doesn't store cost data
        return acc;
      }, {} as Record<string, { count: number; tokens: number; cost: number }>);

      const responseObj = {
        success: true,
        timeRange: { hours, since },
        overview: {
          totalQueries,
          totalTokens,
          totalPromptTokens,
          totalCompletionTokens,
          totalCost: parseFloat(totalCost.toFixed(4)),
          avgResponseTime: Math.round(avgResponseTime),
          uniqueUsers,
          successCount,
          failureCount,
          successRate: totalQueries > 0 ? (successCount / totalQueries * 100).toFixed(2) : '0',
          toolCalls
        },
        modelBreakdown: Object.entries(modelStats).map(([model, stats]) => ({
          model,
          queries: stats.count,
          tokens: stats.tokens,
          cost: parseFloat(stats.cost.toFixed(4)),
          avgTokensPerQuery: Math.round(stats.tokens / stats.count)
        }))
      };
      await setCachedMetrics(cacheKey, responseObj, 30);
      return reply.send(responseObj);
    } catch (error: any) {
      logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch overview');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch LLM metrics overview'
      });
    }
  });

  /**
   * Get per-user token usage and costs
   */
  fastify.get<{ Querystring: TimeRangeQuery }>('/api/admin/metrics/llm/users', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest<{ Querystring: TimeRangeQuery }>, reply: FastifyReply) => {
    try {
      const { hours = 24 } = request.query;

      const cacheKey = `llm:users:${hours}`;
      const cached = await getCachedMetrics(cacheKey);
      if (cached) return reply.send(cached);

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      logger.info({ hours, since }, '[LLM-METRICS] Fetching per-user metrics');

      // Get all queries with user info
      const queries = await prisma.userQueryAudit.findMany({
        where: {
          created_at: { gte: since }
        },
        include: {
          user: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

      // Group by user
      const userMetricsMap = queries.reduce((acc, q) => {
        const userId = q.user_id;
        if (!acc[userId]) {
          acc[userId] = {
            userId,
            email: q.user?.email || 'unknown',
            totalQueries: 0,
            totalTokens: 0,
            promptTokens: 0,
            completionTokens: 0,
            estimatedCost: 0,
            toolCalls: 0,
            responseTimes: [] as number[]
          };
        }

        const tokens = q.tokens_consumed || 0;
        const promptTokens = Math.floor(tokens * 0.6);
        const completionTokens = Math.floor(tokens * 0.4);

        acc[userId].totalQueries++;
        acc[userId].promptTokens += promptTokens;
        acc[userId].completionTokens += completionTokens;
        acc[userId].totalTokens += tokens;
        // Cost is 0 - userQueryAudit doesn't store cost data. Use /aggregated for accurate costs.

        if (q.tools_called && Array.isArray(q.tools_called)) {
          acc[userId].toolCalls += q.tools_called.length;
        }

        if (q.response_time_ms) {
          acc[userId].responseTimes.push(q.response_time_ms);
        }

        return acc;
      }, {} as Record<string, any>);

      // Convert to array and calculate averages
      const userMetrics: UserMetrics[] = Object.values(userMetricsMap).map((um: any) => ({
        userId: um.userId,
        email: um.email,
        totalQueries: um.totalQueries,
        totalTokens: um.totalTokens,
        promptTokens: um.promptTokens,
        completionTokens: um.completionTokens,
        estimatedCost: parseFloat(um.estimatedCost.toFixed(4)),
        toolCalls: um.toolCalls,
        avgResponseTime: um.responseTimes.length > 0
          ? Math.round(um.responseTimes.reduce((a: number, b: number) => a + b, 0) / um.responseTimes.length)
          : 0
      }));

      // Sort by total cost descending
      userMetrics.sort((a, b) => b.estimatedCost - a.estimatedCost);

      const responseObj = {
        success: true,
        timeRange: { hours, since },
        users: userMetrics,
        totalUsers: userMetrics.length
      };
      await setCachedMetrics(cacheKey, responseObj, 60);
      return reply.send(responseObj);
    } catch (error: any) {
      logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch user metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch per-user metrics'
      });
    }
  });

  /**
   * Get MCP tool call statistics
   */
  fastify.get<{ Querystring: TimeRangeQuery }>('/api/admin/metrics/llm/tools', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest<{ Querystring: TimeRangeQuery }>, reply: FastifyReply) => {
    try {
      const { hours = 24 } = request.query;

      const cacheKey = `llm:tools:${hours}`;
      const cached = await getCachedMetrics(cacheKey);
      if (cached) return reply.send(cached);

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      logger.info({ hours, since }, '[LLM-METRICS] Fetching MCP tool metrics');

      // Get all queries with tool usage
      const queries = await prisma.userQueryAudit.findMany({
        where: {
          created_at: { gte: since },
          tools_called: {
            not: null
          }
        }
      });

      // Extract and aggregate tool metrics
      const toolMetricsMap: Record<string, {
        toolName: string;
        serverName: string;
        calls: { success: boolean; executionTime?: number }[];
      }> = {};

      queries.forEach(q => {
        if (!q.tools_called || !Array.isArray(q.tools_called)) return;

        q.tools_called.forEach((tool: any) => {
          const toolName = tool.name || tool.tool_name || 'unknown';
          const serverName = tool.server || tool.mcp_server || 'unknown';
          const key = `${serverName}:${toolName}`;

          if (!toolMetricsMap[key]) {
            toolMetricsMap[key] = {
              toolName,
              serverName,
              calls: []
            };
          }

          toolMetricsMap[key].calls.push({
            success: tool.success !== false,
            executionTime: tool.execution_time_ms || tool.duration_ms
          });
        });
      });

      // Calculate statistics
      const toolMetrics: MCPToolMetrics[] = Object.values(toolMetricsMap).map(tm => {
        const totalCalls = tm.calls.length;
        const successCount = tm.calls.filter(c => c.success).length;
        const failureCount = totalCalls - successCount;
        const successRate = totalCalls > 0 ? (successCount / totalCalls * 100) : 0;

        const executionTimes = tm.calls.filter(c => c.executionTime).map(c => c.executionTime!);
        const avgExecutionTime = executionTimes.length > 0
          ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length
          : 0;

        // Estimate cost based on execution time (rough estimate: $0.0001 per second)
        const estimatedCost = (avgExecutionTime / 1000) * totalCalls * 0.0001;

        return {
          toolName: tm.toolName,
          serverName: tm.serverName,
          totalCalls,
          successCount,
          failureCount,
          successRate: parseFloat(successRate.toFixed(2)),
          avgExecutionTime: Math.round(avgExecutionTime),
          estimatedCost: parseFloat(estimatedCost.toFixed(6))
        };
      });

      // Sort by total calls descending
      toolMetrics.sort((a, b) => b.totalCalls - a.totalCalls);

      const responseObj = {
        success: true,
        timeRange: { hours, since },
        tools: toolMetrics,
        totalTools: toolMetrics.length,
        totalCalls: toolMetrics.reduce((sum, t) => sum + t.totalCalls, 0)
      };
      await setCachedMetrics(cacheKey, responseObj, 60);
      return reply.send(responseObj);
    } catch (error: any) {
      logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch tool metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch MCP tool metrics'
      });
    }
  });

  /**
   * Get hourly token usage trend
   */
  fastify.get<{ Querystring: { hours?: number } }>('/api/admin/metrics/llm/trends', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest<{ Querystring: { hours?: number } }>, reply: FastifyReply) => {
    try {
      const { hours = 24 } = request.query;

      const cacheKey = `llm:trends:${hours}`;
      const cached = await getCachedMetrics(cacheKey);
      if (cached) return reply.send(cached);

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      logger.info({ hours, since }, '[LLM-METRICS] Fetching trends');

      const queries = await prisma.userQueryAudit.findMany({
        where: {
          created_at: { gte: since }
        },
        orderBy: {
          created_at: 'asc'
        }
      });

      // Group by hour
      const hourlyData: Record<string, {
        queries: number;
        tokens: number;
        cost: number;
        toolCalls: number;
      }> = {};

      queries.forEach(q => {
        const hour = new Date(q.created_at).toISOString().slice(0, 13) + ':00:00';

        if (!hourlyData[hour]) {
          hourlyData[hour] = { queries: 0, tokens: 0, cost: 0, toolCalls: 0 };
        }

        const tokens = q.tokens_consumed || 0;

        hourlyData[hour].queries++;
        hourlyData[hour].tokens += tokens;
        // Cost is 0 - userQueryAudit doesn't store cost data. Use /aggregated for accurate costs.

        if (q.tools_called && Array.isArray(q.tools_called)) {
          hourlyData[hour].toolCalls += q.tools_called.length;
        }
      });

      // Convert to array and sort by timestamp
      const trends = Object.entries(hourlyData)
        .map(([timestamp, data]) => ({
          timestamp,
          ...data,
          cost: parseFloat(data.cost.toFixed(4))
        }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      const responseObj = {
        success: true,
        timeRange: { hours, since },
        trends
      };
      await setCachedMetrics(cacheKey, responseObj, 60);
      return reply.send(responseObj);
    } catch (error: any) {
      logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch trends');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch trends'
      });
    }
  });

  /**
   * Get detailed LLM request logs with actual provider data
   * Uses the new llm_request_logs table for precise cost tracking
   */
  fastify.get<{ Querystring: { page?: string; limit?: string; userId?: string; providerType?: string; model?: string; hours?: string } }>(
    '/api/admin/metrics/llm/requests',
    { preHandler: adminMiddleware },
    async (request, reply) => {
      try {
        const page = parseInt(request.query.page || '1', 10);
        const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);
        const hours = parseInt(request.query.hours || '24', 10);
        const { userId, providerType, model } = request.query;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        logger.info({ page, limit, userId, providerType, model, hours }, '[LLM-METRICS] Fetching detailed requests');

        const whereClause: any = {
          created_at: { gte: since }
        };
        if (userId) whereClause.user_id = userId;
        if (providerType) whereClause.provider_type = providerType;
        if (model) whereClause.model = { contains: model, mode: 'insensitive' };

        const [requests, totalCount] = await Promise.all([
          prisma.lLMRequestLog.findMany({
            where: whereClause,
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              user: {
                select: { id: true, name: true, email: true }
              }
            }
          }),
          prisma.lLMRequestLog.count({ where: whereClause })
        ]);

        const logs = requests.map(r => ({
          id: r.id,
          userId: r.user_id,
          userName: r.user?.name,
          userEmail: r.user?.email,
          providerType: r.provider_type,
          model: r.model,
          deployment: r.deployment,
          requestType: r.request_type,
          streaming: r.streaming,
          promptTokens: r.prompt_tokens,
          completionTokens: r.completion_tokens,
          totalTokens: r.total_tokens,
          cachedTokens: r.cached_tokens,
          reasoningTokens: r.reasoning_tokens,
          promptCost: r.prompt_cost ? Number(r.prompt_cost) : null,
          completionCost: r.completion_cost ? Number(r.completion_cost) : null,
          totalCost: r.total_cost ? Number(r.total_cost) : null,
          latencyMs: r.latency_ms,
          totalDurationMs: r.total_duration_ms,
          tokensPerSecond: r.tokens_per_second,
          toolCallsCount: r.tool_calls_count,
          toolNames: r.tool_names,
          status: r.status,
          errorCode: r.error_code,
          errorMessage: r.error_message,
          timestamp: r.created_at.toISOString()
        }));

        return reply.send({
          success: true,
          logs,
          pagination: {
            page,
            limit,
            totalPages: Math.ceil(totalCount / limit),
            totalItems: totalCount,
            hasMore: page < Math.ceil(totalCount / limit)
          }
        });
      } catch (error: any) {
        logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch detailed requests');
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch detailed LLM requests'
        });
      }
    }
  );

  /**
   * Get aggregated LLM metrics from the new llm_request_logs table
   * Provides accurate cost tracking per provider
   */
  fastify.get<{ Querystring: { userId?: string; providerType?: string; model?: string; hours?: string } }>(
    '/api/admin/metrics/llm/aggregated',
    { preHandler: adminMiddleware },
    async (request, reply) => {
      try {
        const { userId, providerType, model } = request.query;
        const hours = parseInt(request.query.hours || '24', 10);
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        logger.info({ userId, providerType, model, hours }, '[LLM-METRICS] Fetching aggregated metrics');

        const metrics = await llmMetricsService.getAggregatedMetrics({
          userId,
          providerType,
          model,
          startDate: since
        });

        return reply.send({
          success: true,
          timeRange: { hours, since },
          metrics
        });
      } catch (error: any) {
        logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch aggregated metrics');
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch aggregated LLM metrics'
        });
      }
    }
  );

  /**
   * Get comprehensive LLM Performance KPIs
   * Issue 4l: All required performance metrics
   */
  fastify.get<{ Querystring: { userId?: string; providerType?: string; model?: string; hours?: string } }>(
    '/api/admin/metrics/llm/performance',
    { preHandler: adminMiddleware },
    async (request, reply) => {
      try {
        const { userId, providerType, model } = request.query;
        const hours = parseInt(request.query.hours || '24', 10);
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        logger.info({ userId, providerType, model, hours }, '[LLM-METRICS] Fetching performance KPIs');

        const kpis = await llmMetricsService.getPerformanceKPIs({
          userId,
          providerType,
          model,
          startDate: since
        });

        return reply.send({
          success: true,
          timeRange: { hours, since },
          kpis
        });
      } catch (error: any) {
        logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch performance KPIs');
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch LLM performance KPIs'
        });
      }
    }
  );

  /**
   * Get performance KPI time-series trends
   * Returns bucketed TTFT, throughput, latency breakdown, and streaming metrics over time
   */
  fastify.get<{ Querystring: { hours?: string } }>(
    '/api/admin/metrics/llm/performance-trends',
    { preHandler: adminMiddleware },
    async (request, reply) => {
      try {
        const hours = parseInt(request.query.hours || '24', 10);

        const cacheKey = `llm:perf-trends:${hours}`;
        const cached = await getCachedMetrics(cacheKey);
        if (cached) return reply.send(cached);

        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        logger.info({ hours }, '[LLM-METRICS] Fetching performance trends');

        // Determine bucket size based on time range
        // 1h → 5min buckets, 6h → 15min, 24h → 1h, 7d → 6h, 30d → 1d
        let bucketMinutes: number;
        if (hours <= 1) bucketMinutes = 5;
        else if (hours <= 6) bucketMinutes = 15;
        else if (hours <= 24) bucketMinutes = 60;
        else if (hours <= 168) bucketMinutes = 360;
        else bucketMinutes = 1440;

        const requests = await prisma.lLMRequestLog.findMany({
          where: {
            created_at: { gte: since }
          },
          select: {
            created_at: true,
            time_to_first_token_ms: true,
            tokens_per_second: true,
            total_duration_ms: true,
            latency_ms: true,
            prompt_tokens: true,
            completion_tokens: true,
            total_tokens: true,
            streaming: true,
          },
          orderBy: { created_at: 'asc' }
        });

        // Bucket the data
        const buckets = new Map<string, {
          timestamp: string;
          ttftValues: number[];
          tpsValues: number[];
          totalDurationValues: number[];
          latencyValues: number[];
          promptTokensSum: number;
          completionTokensSum: number;
          totalTokensSum: number;
          streamingChunkLatencies: number[];
          requestCount: number;
        }>();

        requests.forEach(r => {
          const ts = r.created_at.getTime();
          const bucketTs = new Date(Math.floor(ts / (bucketMinutes * 60000)) * (bucketMinutes * 60000));
          const key = bucketTs.toISOString();

          if (!buckets.has(key)) {
            buckets.set(key, {
              timestamp: key,
              ttftValues: [],
              tpsValues: [],
              totalDurationValues: [],
              latencyValues: [],
              promptTokensSum: 0,
              completionTokensSum: 0,
              totalTokensSum: 0,
              streamingChunkLatencies: [],
              requestCount: 0,
            });
          }

          const b = buckets.get(key)!;
          b.requestCount++;

          if (r.time_to_first_token_ms !== null) b.ttftValues.push(r.time_to_first_token_ms);
          if (r.tokens_per_second !== null) b.tpsValues.push(r.tokens_per_second);
          if (r.total_duration_ms !== null) b.totalDurationValues.push(r.total_duration_ms);
          if (r.latency_ms !== null) b.latencyValues.push(r.latency_ms);
          b.promptTokensSum += r.prompt_tokens || 0;
          b.completionTokensSum += r.completion_tokens || 0;
          b.totalTokensSum += r.total_tokens || 0;

          // For streaming requests, estimate chunk delivery latency from TTFT and total duration
          if (r.streaming && r.time_to_first_token_ms !== null && r.total_duration_ms !== null && r.completion_tokens) {
            const streamingDuration = r.total_duration_ms - r.time_to_first_token_ms;
            if (streamingDuration > 0 && r.completion_tokens > 1) {
              // Average time between chunks (approximate as time per token)
              const avgChunkLatency = streamingDuration / r.completion_tokens;
              b.streamingChunkLatencies.push(avgChunkLatency);
            }
          }
        });

        // Helper
        const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        const p95 = (arr: number[]) => {
          if (arr.length === 0) return null;
          const sorted = [...arr].sort((a, b) => a - b);
          const idx = Math.ceil(0.95 * sorted.length) - 1;
          return sorted[Math.max(0, idx)];
        };
        const p99 = (arr: number[]) => {
          if (arr.length === 0) return null;
          const sorted = [...arr].sort((a, b) => a - b);
          const idx = Math.ceil(0.99 * sorted.length) - 1;
          return sorted[Math.max(0, idx)];
        };

        // Convert buckets to sorted array
        const trends = Array.from(buckets.values())
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map(b => ({
            timestamp: b.timestamp,
            requestCount: b.requestCount,
            // TTFT
            avgTTFT: avg(b.ttftValues) !== null ? Math.round(avg(b.ttftValues)!) : null,
            p95TTFT: p95(b.ttftValues) !== null ? Math.round(p95(b.ttftValues)!) : null,
            p99TTFT: p99(b.ttftValues) !== null ? Math.round(p99(b.ttftValues)!) : null,
            // Throughput
            avgTokensPerSecond: avg(b.tpsValues) !== null ? Math.round(avg(b.tpsValues)! * 100) / 100 : null,
            p95TokensPerSecond: p95(b.tpsValues) !== null ? Math.round(p95(b.tpsValues)! * 100) / 100 : null,
            // Latency breakdown
            avgTotalLatency: avg(b.totalDurationValues) !== null ? Math.round(avg(b.totalDurationValues)!) : null,
            p95TotalLatency: p95(b.totalDurationValues) !== null ? Math.round(p95(b.totalDurationValues)!) : null,
            avgInputLatency: avg(b.latencyValues) !== null ? Math.round(avg(b.latencyValues)!) : null,
            // Token volume per bucket
            promptTokens: b.promptTokensSum,
            completionTokens: b.completionTokensSum,
            totalTokens: b.totalTokensSum,
            // Streaming performance
            avgChunkLatency: avg(b.streamingChunkLatencies) !== null ? Math.round(avg(b.streamingChunkLatencies)! * 100) / 100 : null,
            p95ChunkLatency: p95(b.streamingChunkLatencies) !== null ? Math.round(p95(b.streamingChunkLatencies)! * 100) / 100 : null,
          }));

        const responseObj = {
          success: true,
          timeRange: { hours, since, bucketMinutes },
          trends,
        };
        await setCachedMetrics(cacheKey, responseObj, 60);
        return reply.send(responseObj);
      } catch (error: any) {
        logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch performance trends');
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch performance trends'
        });
      }
    }
  );

  /**
   * Get provider-specific cost breakdown
   */
  fastify.get<{ Querystring: { hours?: string } }>(
    '/api/admin/metrics/llm/providers',
    { preHandler: adminMiddleware },
    async (request, reply) => {
      try {
        const hours = parseInt(request.query.hours || '24', 10);

        const cacheKey = `llm:providers:${hours}`;
        const cached = await getCachedMetrics(cacheKey);
        if (cached) return reply.send(cached);

        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        logger.info({ hours }, '[LLM-METRICS] Fetching provider breakdown');

        // Get aggregates by provider type
        const providerStats = await prisma.lLMRequestLog.groupBy({
          by: ['provider_type'],
          where: {
            created_at: { gte: since }
          },
          _count: { id: true },
          _sum: {
            prompt_tokens: true,
            completion_tokens: true,
            total_tokens: true,
            total_cost: true
          },
          _avg: {
            latency_ms: true,
            tokens_per_second: true
          }
        });

        // Get success counts by provider
        const successStats = await prisma.lLMRequestLog.groupBy({
          by: ['provider_type'],
          where: {
            created_at: { gte: since },
            status: 'success'
          },
          _count: { id: true }
        });

        const successMap = new Map(successStats.map(s => [s.provider_type, s._count.id]));

        const providers = providerStats.map(p => ({
          provider: p.provider_type,
          totalRequests: p._count.id,
          successfulRequests: successMap.get(p.provider_type) || 0,
          failedRequests: p._count.id - (successMap.get(p.provider_type) || 0),
          successRate: p._count.id > 0
            ? ((successMap.get(p.provider_type) || 0) / p._count.id * 100).toFixed(2)
            : '0.00',
          promptTokens: p._sum.prompt_tokens || 0,
          completionTokens: p._sum.completion_tokens || 0,
          totalTokens: p._sum.total_tokens || 0,
          totalCost: p._sum.total_cost ? Number(p._sum.total_cost).toFixed(6) : '0.000000',
          avgLatencyMs: Math.round(p._avg.latency_ms || 0),
          avgTokensPerSecond: Math.round((p._avg.tokens_per_second || 0) * 100) / 100
        }));

        // Sort by total cost descending
        providers.sort((a, b) => parseFloat(b.totalCost) - parseFloat(a.totalCost));

        const responseObj = {
          success: true,
          timeRange: { hours, since },
          providers,
          totalCost: providers.reduce((sum, p) => sum + parseFloat(p.totalCost), 0).toFixed(6)
        };
        await setCachedMetrics(cacheKey, responseObj, 120);
        return reply.send(responseObj);
      } catch (error: any) {
        logger.error({ error: error.message }, '[LLM-METRICS] Failed to fetch provider breakdown');
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch provider breakdown'
        });
      }
    }
  );
};

export default adminLLMMetricsRoutes;
