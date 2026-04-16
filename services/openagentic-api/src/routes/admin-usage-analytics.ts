/**
 * Admin Usage Analytics Routes
 * Provides comprehensive usage analytics including sessions, messages, tokens, and costs
 * Data aggregated from chat_sessions, chat_messages, llm_request_logs, and mcp_usage tables
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes.child({ component: 'AdminUsageAnalytics' });

interface UserUsageData {
  userId: string;
  userName: string;
  userEmail: string;
  totalSessions: number;
  totalMessages: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  estimatedCost: number;
  apiCalls: number;
  mcpToolCalls: number;
  imagesGenerated: number;
  filesCreated: number;
  avgResponseTime: number;
  visionModelUsage: number;
  errorRate: number;
  cacheHitRate: number;
  apiKeyUsage: {
    keyName: string;
    callCount: number;
    lastUsed: string;
  }[];
  endpointBreakdown: {
    endpoint: string;
    count: number;
  }[];
  models: {
    modelName: string;
    count: number;
    tokens: number;
    cost: number;
  }[];
  lastActive: string;
}

interface AggregateStats {
  totalUsers: number;
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  tokensInput: number;
  tokensOutput: number;
  totalApiCalls: number;
  totalMcpToolCalls: number;
  totalImagesGenerated: number;
  totalFilesCreated: number;
  avgResponseTime: number;
  totalVisionUsage: number;
  totalErrorRate: number;
  totalSuccessRate: number;
  cacheHitRate: number;
  avgTokensPerSecond: number;
  p95Latency: number;
  p99Latency: number;
  totalToolCalls: number;
  uniqueMcpTools: number;
}

interface TimeSeriesData {
  date: string;
  requests: number;
  tokens: number;
  cost: number;
  errors: number;
  avgLatency: number;
}

const adminUsageAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get comprehensive usage analytics
   * Supports time range filtering: 7d, 30d, 90d, all
   */
  fastify.get('/api/admin/analytics/usage', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { timeRange = '7d' } = request.query as any;

    try {
      // Calculate date filter
      let dateFilter: Date | undefined;
      if (timeRange !== 'all') {
        const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[timeRange] || 7;
        dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      }

      // Fetch all sessions with messages in time range
      const sessions = await prisma.chatSession.findMany({
        where: {
          ...(dateFilter && { created_at: { gte: dateFilter } })
        },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          },
          messages: {
            where: {
              ...(dateFilter && { created_at: { gte: dateFilter } })
            },
            select: {
              id: true,
              role: true,
              model: true,
              tokens_input: true,
              tokens_output: true,
              cost: true,
              mcp_calls: true,
              tool_calls: true,
              created_at: true
            }
          },
          metrics: {
            select: {
              response_time: true
            }
          }
        }
      });

      // Fetch LLM request logs for detailed API call metrics with comprehensive data
      const llmRequests = await prisma.lLMRequestLog.findMany({
        where: {
          ...(dateFilter && { created_at: { gte: dateFilter } })
        },
        select: {
          user_id: true,
          provider_type: true,
          model: true,
          total_tokens: true,
          prompt_tokens: true,
          completion_tokens: true,
          total_cost: true,
          latency_ms: true,
          tokens_per_second: true,
          status: true,
          cache_hit: true,
          tool_calls_count: true,
          tool_names: true,
          created_at: true,
          request_type: true
        }
      });

      // Fetch MCP usage for detailed tool call metrics
      const mcpUsage = await prisma.mCPUsage.findMany({
        where: {
          ...(dateFilter && { timestamp: { gte: dateFilter } })
        },
        select: {
          user_id: true,
          server_name: true,
          tool_name: true,
          success: true,
          execution_time_ms: true,
          timestamp: true
        }
      });

      // Fetch file attachments for files created
      const fileAttachments = await prisma.fileAttachment.findMany({
        where: {
          ...(dateFilter && { created_at: { gte: dateFilter } })
        },
        select: {
          user_id: true,
          created_at: true
        }
      });

      // Fetch API keys usage
      const apiKeys = await prisma.apiKey.findMany({
        where: {
          ...(dateFilter && { last_used_at: { gte: dateFilter } })
        },
        select: {
          user_id: true,
          name: true,
          last_used_at: true
        }
      });

      // Build comprehensive metrics by user
      const apiCallsByUser = new Map<string, {
        count: number;
        latencySum: number;
        successCount: number;
        errorCount: number;
        cacheHits: number;
        totalToolCalls: number;
        tokensPerSecondSum: number;
        latencies: number[];
        endpointCounts: Map<string, number>;
      }>();

      for (const req of llmRequests) {
        if (!req.user_id) continue;
        if (!apiCallsByUser.has(req.user_id)) {
          apiCallsByUser.set(req.user_id, {
            count: 0,
            latencySum: 0,
            successCount: 0,
            errorCount: 0,
            cacheHits: 0,
            totalToolCalls: 0,
            tokensPerSecondSum: 0,
            latencies: [],
            endpointCounts: new Map()
          });
        }
        const data = apiCallsByUser.get(req.user_id)!;
        data.count++;
        data.latencySum += req.latency_ms || 0;
        if (req.latency_ms) data.latencies.push(req.latency_ms);
        if (req.status === 'success') data.successCount++;
        else data.errorCount++;
        if (req.cache_hit) data.cacheHits++;
        data.totalToolCalls += req.tool_calls_count || 0;
        data.tokensPerSecondSum += req.tokens_per_second || 0;

        const endpoint = req.request_type || 'chat';
        data.endpointCounts.set(endpoint, (data.endpointCounts.get(endpoint) || 0) + 1);
      }

      // Build MCP tool usage by user
      const mcpByUser = new Map<string, {
        count: number;
        uniqueTools: Set<string>;
        executionTimeSum: number;
        successCount: number;
      }>();

      for (const mcp of mcpUsage) {
        if (!mcpByUser.has(mcp.user_id)) {
          mcpByUser.set(mcp.user_id, {
            count: 0,
            uniqueTools: new Set(),
            executionTimeSum: 0,
            successCount: 0
          });
        }
        const data = mcpByUser.get(mcp.user_id)!;
        data.count++;
        data.uniqueTools.add(mcp.tool_name);
        data.executionTimeSum += mcp.execution_time_ms || 0;
        if (mcp.success) data.successCount++;
      }

      // Build file count by user
      const filesByUser = new Map<string, number>();
      for (const file of fileAttachments) {
        if (!file.user_id) continue;
        filesByUser.set(file.user_id, (filesByUser.get(file.user_id) || 0) + 1);
      }

      // Build API key usage by user
      const apiKeysByUser = new Map<string, { keyName: string; callCount: number; lastUsed: Date }[]>();
      for (const key of apiKeys) {
        if (!apiKeysByUser.has(key.user_id)) {
          apiKeysByUser.set(key.user_id, []);
        }
        apiKeysByUser.get(key.user_id)!.push({
          keyName: key.name,
          callCount: 1, // We don't track individual call counts, so this is approximate
          lastUsed: key.last_used_at || new Date()
        });
      }

      // Aggregate data by user
      const userDataMap = new Map<string, {
        user: { id: string; name: string | null; email: string | null };
        sessions: Set<string>;
        messages: number;
        tokensInput: number;
        tokensOutput: number;
        cost: number;
        mcpToolCalls: number;
        imagesGenerated: number;
        visionModelUsage: number;
        responseTimes: number[];
        models: Map<string, { count: number; tokens: number; cost: number }>;
        lastActive: Date;
      }>();

      for (const session of sessions) {
        if (!session.user) continue;

        const userId = session.user.id;
        if (!userDataMap.has(userId)) {
          userDataMap.set(userId, {
            user: session.user,
            sessions: new Set(),
            messages: 0,
            tokensInput: 0,
            tokensOutput: 0,
            cost: 0,
            mcpToolCalls: 0,
            imagesGenerated: 0,
            visionModelUsage: 0,
            responseTimes: [],
            models: new Map(),
            lastActive: session.created_at
          });
        }

        const userData = userDataMap.get(userId)!;
        userData.sessions.add(session.id);

        // Collect response times from metrics
        for (const metric of session.metrics || []) {
          userData.responseTimes.push(metric.response_time);
        }

        // Process messages
        for (const message of session.messages) {
          userData.messages++;
          userData.tokensInput += message.tokens_input || 0;
          userData.tokensOutput += message.tokens_output || 0;
          userData.cost += Number(message.cost || 0);

          // Count MCP tool calls
          if (message.mcp_calls && Array.isArray(message.mcp_calls)) {
            userData.mcpToolCalls += message.mcp_calls.length;
          }

          // Count tool calls that might be image generation
          if (message.tool_calls && Array.isArray(message.tool_calls)) {
            for (const toolCall of message.tool_calls as any[]) {
              if (toolCall.function?.name?.toLowerCase().includes('image') ||
                  toolCall.function?.name?.toLowerCase().includes('generate')) {
                userData.imagesGenerated++;
              }
            }
          }

          // Track model usage and detect vision models
          const modelName = message.model || 'unknown';
          const isVisionModel = modelName.includes('vision') ||
                               modelName.includes('llava') ||
                               modelName.includes('gpt-4o') ||
                               modelName.includes('gemini-pro-vision');
          if (isVisionModel) {
            userData.visionModelUsage++;
          }

          if (!userData.models.has(modelName)) {
            userData.models.set(modelName, { count: 0, tokens: 0, cost: 0 });
          }
          const modelData = userData.models.get(modelName)!;
          modelData.count++;
          modelData.tokens += (message.tokens_input || 0) + (message.tokens_output || 0);
          modelData.cost += Number(message.cost || 0);

          // Update last active
          if (message.created_at > userData.lastActive) {
            userData.lastActive = message.created_at;
          }
        }
      }

      // Helper function to calculate percentile
      const percentile = (arr: number[], p: number): number => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
      };

      // Convert to response format
      const users: UserUsageData[] = [];
      let aggregateStats: AggregateStats = {
        totalUsers: 0,
        totalSessions: 0,
        totalMessages: 0,
        totalTokens: 0,
        totalCost: 0,
        tokensInput: 0,
        tokensOutput: 0,
        totalApiCalls: 0,
        totalMcpToolCalls: 0,
        totalImagesGenerated: 0,
        totalFilesCreated: 0,
        avgResponseTime: 0,
        totalVisionUsage: 0,
        totalErrorRate: 0,
        totalSuccessRate: 0,
        cacheHitRate: 0,
        avgTokensPerSecond: 0,
        p95Latency: 0,
        p99Latency: 0,
        totalToolCalls: 0,
        uniqueMcpTools: 0
      };

      let allResponseTimes: number[] = [];
      let allLatencies: number[] = [];
      let totalSuccesses = 0;
      let totalErrors = 0;
      let totalCacheHits = 0;
      let totalApiCallsGlobal = 0;
      let totalTokensPerSecond = 0;
      let tokenPerSecondCount = 0;
      const uniqueMcpToolsGlobal = new Set<string>();

      for (const [userId, data] of userDataMap) {
        const totalTokens = data.tokensInput + data.tokensOutput;
        const apiData = apiCallsByUser.get(userId) || {
          count: 0,
          latencySum: 0,
          successCount: 0,
          errorCount: 0,
          cacheHits: 0,
          totalToolCalls: 0,
          tokensPerSecondSum: 0,
          latencies: [],
          endpointCounts: new Map()
        };
        const mcpData = mcpByUser.get(userId) || {
          count: 0,
          uniqueTools: new Set(),
          executionTimeSum: 0,
          successCount: 0
        };
        const filesCreated = filesByUser.get(userId) || 0;
        const avgResponseTime = data.responseTimes.length > 0
          ? data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length
          : (apiData.count > 0 ? apiData.latencySum / apiData.count : 0);

        const errorRate = apiData.count > 0
          ? (apiData.errorCount / apiData.count) * 100
          : 0;

        const cacheHitRate = apiData.count > 0
          ? (apiData.cacheHits / apiData.count) * 100
          : 0;

        const apiKeys = apiKeysByUser.get(userId) || [];

        users.push({
          userId,
          userName: data.user.name || 'Unknown',
          userEmail: data.user.email || '',
          totalSessions: data.sessions.size,
          totalMessages: data.messages,
          tokensInput: data.tokensInput,
          tokensOutput: data.tokensOutput,
          totalTokens,
          estimatedCost: data.cost,
          apiCalls: apiData.count,
          mcpToolCalls: mcpData.count,
          imagesGenerated: data.imagesGenerated,
          filesCreated,
          avgResponseTime,
          visionModelUsage: data.visionModelUsage,
          errorRate,
          cacheHitRate,
          apiKeyUsage: apiKeys.map(key => ({
            keyName: key.keyName,
            callCount: key.callCount,
            lastUsed: key.lastUsed.toISOString()
          })),
          endpointBreakdown: Array.from(apiData.endpointCounts.entries()).map(([endpoint, count]) => ({
            endpoint,
            count
          })),
          models: Array.from(data.models.entries()).map(([name, stats]) => ({
            modelName: name,
            count: stats.count,
            tokens: stats.tokens,
            cost: stats.cost
          })),
          lastActive: data.lastActive.toISOString()
        });

        // Aggregate stats
        aggregateStats.totalSessions += data.sessions.size;
        aggregateStats.totalMessages += data.messages;
        aggregateStats.tokensInput += data.tokensInput;
        aggregateStats.tokensOutput += data.tokensOutput;
        aggregateStats.totalTokens += totalTokens;
        aggregateStats.totalCost += data.cost;
        aggregateStats.totalApiCalls += apiData.count;
        aggregateStats.totalMcpToolCalls += mcpData.count;
        aggregateStats.totalImagesGenerated += data.imagesGenerated;
        aggregateStats.totalFilesCreated += filesCreated;
        aggregateStats.totalVisionUsage += data.visionModelUsage;
        aggregateStats.totalToolCalls += apiData.totalToolCalls;

        allResponseTimes = allResponseTimes.concat(data.responseTimes);
        allLatencies = allLatencies.concat(apiData.latencies);
        totalSuccesses += apiData.successCount;
        totalErrors += apiData.errorCount;
        totalCacheHits += apiData.cacheHits;
        totalApiCallsGlobal += apiData.count;
        totalTokensPerSecond += apiData.tokensPerSecondSum;
        tokenPerSecondCount += apiData.count;

        mcpData.uniqueTools.forEach(tool => uniqueMcpToolsGlobal.add(tool));
      }

      aggregateStats.totalUsers = users.length;
      aggregateStats.avgResponseTime = allResponseTimes.length > 0
        ? allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length
        : 0;

      aggregateStats.totalErrorRate = totalApiCallsGlobal > 0
        ? (totalErrors / totalApiCallsGlobal) * 100
        : 0;

      aggregateStats.totalSuccessRate = totalApiCallsGlobal > 0
        ? (totalSuccesses / totalApiCallsGlobal) * 100
        : 0;

      aggregateStats.cacheHitRate = totalApiCallsGlobal > 0
        ? (totalCacheHits / totalApiCallsGlobal) * 100
        : 0;

      aggregateStats.avgTokensPerSecond = tokenPerSecondCount > 0
        ? totalTokensPerSecond / tokenPerSecondCount
        : 0;

      aggregateStats.p95Latency = percentile(allLatencies, 95);
      aggregateStats.p99Latency = percentile(allLatencies, 99);
      aggregateStats.uniqueMcpTools = uniqueMcpToolsGlobal.size;

      // Generate time series data for the last 7/30/90 days
      const timeSeriesData: TimeSeriesData[] = [];
      const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
      const days = timeRange === 'all' ? 30 : (daysMap[timeRange as keyof typeof daysMap] || 7);

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        const dayRequests = llmRequests.filter(r =>
          r.created_at.toISOString().split('T')[0] === dateStr
        );

        timeSeriesData.push({
          date: dateStr,
          requests: dayRequests.length,
          tokens: dayRequests.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
          cost: dayRequests.reduce((sum, r) => sum + Number(r.total_cost || 0), 0),
          errors: dayRequests.filter(r => r.status !== 'success').length,
          avgLatency: dayRequests.length > 0
            ? dayRequests.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / dayRequests.length
            : 0
        });
      }

      return reply.send({
        success: true,
        users,
        aggregate: aggregateStats,
        timeSeries: timeSeriesData,
        timeRange
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch usage analytics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch usage analytics'
      });
    }
  });

  /**
   * Get detailed usage for a specific user
   */
  fastify.get('/api/admin/analytics/usage/:userId', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as any;
    const { timeRange = '30d' } = request.query as any;

    try {
      // Calculate date filter
      let dateFilter: Date | undefined;
      if (timeRange !== 'all') {
        const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[timeRange] || 30;
        dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true }
      });

      if (!user) {
        return reply.code(404).send({ success: false, error: 'User not found' });
      }

      const sessions = await prisma.chatSession.findMany({
        where: {
          user_id: userId,
          ...(dateFilter && { created_at: { gte: dateFilter } })
        },
        include: {
          messages: {
            where: {
              ...(dateFilter && { created_at: { gte: dateFilter } })
            },
            select: {
              id: true,
              role: true,
              model: true,
              tokens_input: true,
              tokens_output: true,
              cost: true,
              created_at: true
            }
          }
        },
        orderBy: { created_at: 'desc' }
      });

      // Calculate daily usage
      const dailyUsage = new Map<string, {
        messages: number;
        tokens: number;
        cost: number;
      }>();

      let totalMessages = 0;
      let totalTokens = 0;
      let totalCost = 0;

      for (const session of sessions) {
        for (const message of session.messages) {
          const date = message.created_at.toISOString().split('T')[0];
          if (!dailyUsage.has(date)) {
            dailyUsage.set(date, { messages: 0, tokens: 0, cost: 0 });
          }
          const dayData = dailyUsage.get(date)!;
          dayData.messages++;
          dayData.tokens += (message.tokens_input || 0) + (message.tokens_output || 0);
          dayData.cost += Number(message.cost || 0);

          totalMessages++;
          totalTokens += (message.tokens_input || 0) + (message.tokens_output || 0);
          totalCost += Number(message.cost || 0);
        }
      }

      return reply.send({
        success: true,
        user,
        summary: {
          totalSessions: sessions.length,
          totalMessages,
          totalTokens,
          totalCost
        },
        dailyUsage: Array.from(dailyUsage.entries()).map(([date, data]) => ({
          date,
          ...data
        })).sort((a, b) => a.date.localeCompare(b.date)),
        recentSessions: sessions.slice(0, 10).map(s => ({
          sessionId: s.id,
          title: s.title,
          messageCount: s.messages.length,
          createdAt: s.created_at
        }))
      });
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to fetch user usage details');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch user usage details'
      });
    }
  });
  // ─── Workflow Cost Analytics ──────────────────────────────────────────
  // GET /api/admin/workflows/cost
  // Aggregates per-node cost data from workflow executions.
  // Supports groupBy: workflow, user, group
  // Supports period: 7d, 30d, 90d, all
  // ─────────────────────────────────────────────────────────────────────

  fastify.get('/api/admin/workflows/cost', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { groupBy = 'workflow', period = '30d' } = request.query as any;

    try {
      let dateFilter: Date | undefined;
      if (period !== 'all') {
        const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[period] || 30;
        dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      }

      const executions = await prisma.workflowExecution.findMany({
        where: {
          ...(dateFilter && { started_at: { gte: dateFilter } }),
          status: { in: ['completed', 'failed'] },
        },
        select: {
          id: true,
          workflow_id: true,
          started_by: true,
          cost: true,
          node_outputs: true,
          execution_time_ms: true,
          started_at: true,
          status: true,
          workflow: {
            select: { id: true, name: true },
          },
        },
        orderBy: { started_at: 'desc' },
      });

      // Resolve user IDs to names/emails for user-grouped views
      const userIds = [...new Set(executions.map(e => e.started_by).filter(Boolean))] as string[];
      const userMap = new Map<string, string>();
      if (userIds.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });
        for (const u of users) {
          userMap.set(u.id, u.name || u.email || u.id);
        }
      }

      // Aggregate by group
      const groups = new Map<string, {
        key: string;
        label: string;
        totalCost: number;
        totalExecutions: number;
        totalTokens: number;
        avgCostPerExecution: number;
        topModels: Map<string, { tokens: number; cost: number; count: number }>;
      }>();

      for (const exec of executions) {
        const cost = exec.cost ? Number(exec.cost) : 0;
        let groupKey: string;
        let groupLabel: string;

        if (groupBy === 'user') {
          groupKey = exec.started_by || 'unknown';
          groupLabel = userMap.get(groupKey) || groupKey;
        } else {
          groupKey = exec.workflow_id;
          groupLabel = exec.workflow?.name || exec.workflow_id;
        }

        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            key: groupKey,
            label: groupLabel,
            totalCost: 0,
            totalExecutions: 0,
            totalTokens: 0,
            avgCostPerExecution: 0,
            topModels: new Map(),
          });
        }

        const group = groups.get(groupKey)!;
        group.totalCost += cost;
        group.totalExecutions += 1;

        // Extract per-node token/cost data from node_outputs
        const nodeOutputs = (exec.node_outputs as Record<string, any>) || {};
        for (const [, nodeData] of Object.entries(nodeOutputs)) {
          if (nodeData?.tokens) group.totalTokens += nodeData.tokens;
          if (nodeData?.model && nodeData?.cost) {
            const modelKey = nodeData.model;
            if (!group.topModels.has(modelKey)) {
              group.topModels.set(modelKey, { tokens: 0, cost: 0, count: 0 });
            }
            const m = group.topModels.get(modelKey)!;
            m.tokens += nodeData.tokens || 0;
            m.cost += nodeData.cost || 0;
            m.count += 1;
          }
        }
      }

      // Format response
      const results = Array.from(groups.values()).map(g => ({
        key: g.key,
        label: g.label,
        totalCost: Math.round(g.totalCost * 10000) / 10000,
        totalExecutions: g.totalExecutions,
        totalTokens: g.totalTokens,
        avgCostPerExecution: g.totalExecutions > 0
          ? Math.round((g.totalCost / g.totalExecutions) * 10000) / 10000
          : 0,
        models: Array.from(g.topModels.entries()).map(([model, data]) => ({
          model,
          tokens: data.tokens,
          cost: Math.round(data.cost * 10000) / 10000,
          calls: data.count,
        })).sort((a, b) => b.cost - a.cost),
      })).sort((a, b) => b.totalCost - a.totalCost);

      const totalCost = results.reduce((sum, r) => sum + r.totalCost, 0);
      const totalExecutions = results.reduce((sum, r) => sum + r.totalExecutions, 0);
      const totalTokens = results.reduce((sum, r) => sum + r.totalTokens, 0);

      return reply.send({
        success: true,
        period,
        groupBy,
        summary: {
          totalCost: Math.round(totalCost * 10000) / 10000,
          totalExecutions,
          totalTokens,
          avgCostPerExecution: totalExecutions > 0
            ? Math.round((totalCost / totalExecutions) * 10000) / 10000
            : 0,
        },
        results,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch workflow cost analytics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch workflow cost analytics',
      });
    }
  });
};

export default adminUsageAnalyticsRoutes;
