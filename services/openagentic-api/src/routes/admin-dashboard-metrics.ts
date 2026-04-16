/**
 * Admin Dashboard Metrics API
 *
 * Provides comprehensive time-series metrics for the admin dashboard
 * Supports Grafana-style time ranges: 1h, 6h, 12h, 24h, 7d, 30d, 90d
 *
 * IMPORTANT: Cost and token data comes from llm_request_logs (SOT)
 * via LLMMetricsService, NOT from chat_messages.cost which is often incomplete
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { Prisma } from '@prisma/client';
import { loggers } from '../utils/logger.js';
import { LLMMetricsService } from '../services/LLMMetricsService.js';
import { getCachedMetrics, setCachedMetrics } from '../services/AdminMetricsCache.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes.child({ component: 'AdminDashboardMetrics' });
const llmMetricsService = new LLMMetricsService();

interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

interface MetricSeries {
  name: string;
  data: TimeSeriesPoint[];
  total: number;
  change?: number; // Percentage change from previous period
}

// Cost data is stored in the database (msg.cost field) - no hardcoded pricing needed
// Costs are calculated by LLMMetricsService at request time and stored in llm_request_logs

const adminDashboardMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/dashboard/metrics
   * Returns comprehensive time-series metrics for the admin dashboard
   */
  fastify.get('/api/admin/dashboard/metrics', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { timeRange = '24h' } = request.query as { timeRange?: string };

    // CACHE CHECK - Prevents dashboard glitching during active LLM streaming
    const cacheKey = `dashboard:${timeRange}`;
    const cachedData = await getCachedMetrics(cacheKey);
    if (cachedData) {
      return reply.send(cachedData);
    }

    try {
      // Parse time range
      const rangeMs = parseTimeRange(timeRange);
      const startDate = new Date(Date.now() - rangeMs);
      const previousStartDate = new Date(Date.now() - (rangeMs * 2));

      // Determine bucket size for time-series grouping
      const bucketMs = getBucketSize(rangeMs);
      const bucketCount = Math.ceil(rangeMs / bucketMs);

      // Fetch all relevant data including embedding usage and code mode
      const [
        sessionsData,
        messagesData,
        usersData,
        imagesData,
        embeddingUsage,
        contextWindowData,
        perUserSessionData,
        // NEW: Code Mode data from AWCodeMessage
        codeMessagesData
      ] = await Promise.all([
        // Sessions with timestamps
        prisma.chatSession.findMany({
          where: { created_at: { gte: startDate } },
          select: { id: true, created_at: true, user_id: true },
          take: 10000
        }),

        // Messages with token data and session info
        prisma.chatMessage.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            role: true,
            model: true,
            tokens_input: true,
            tokens_output: true,
            cost: true,
            mcp_calls: true,
            created_at: true,
            session_id: true
          }
        }),

        // Active users
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            name: true,
            created_at: true,
            last_login_at: true
          },
          take: 10000
        }),

        // Generated images (from chat messages with image content)
        prisma.chatMessage.findMany({
          where: {
            created_at: { gte: startDate },
            role: 'assistant',
            content: { contains: '![Generated Image]' }
          },
          select: { id: true, created_at: true, model: true }
        }),

        // Embedding usage - get user memories with timestamps for time series
        prisma.userMemory.findMany({
          where: { created_at: { gte: startDate } },
          select: { id: true, created_at: true }
        }),

        // Context window metrics from sessions
        prisma.chatSession.findMany({
          where: {
            created_at: { gte: startDate },
            context_tokens_total: { gt: 0 }
          },
          select: {
            id: true,
            user_id: true,
            model: true,
            context_tokens_input: true,
            context_tokens_output: true,
            context_tokens_total: true,
            context_window_size: true,
            context_utilization_pct: true,
            created_at: true
          }
        }),

        // Per-user session and message data for usage breakdown
        prisma.chatSession.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            user_id: true,
            created_at: true,
            message_count: true,
            user: {
              select: {
                email: true,
                name: true
              }
            }
          },
          take: 10000
        }),

        // NEW: Code Mode messages with token data
        prisma.aWCodeMessage.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            tokens_input: true,
            tokens_output: true,
            tokens: true,
            cost: true,
            created_at: true,
            session_id: true
          }
        })
      ]);

      // Fetch workflow and agent execution data (parallel, non-blocking)
      const [
        workflowExecutions,
        agentExecutions,
        workflows,
        apiKeyUsage,
        codeSessions
      ] = await Promise.all([
        prisma.workflowExecution.findMany({
          where: { started_at: { gte: startDate } },
          select: {
            id: true,
            status: true,
            execution_time_ms: true,
            started_at: true,
            workflow_id: true,
            started_by: true,
            error: true,
          }
        }).catch(() => []),

        prisma.agentExecution.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            status: true,
            orchestration: true,
            agent_specs: true,
            total_tokens: true,
            total_cost_cents: true,
            total_duration_ms: true,
            created_at: true,
            user_id: true
          }
        }).catch(() => []),

        prisma.workflow.findMany({
          select: { id: true, name: true, is_active: true }
        }).catch(() => []),

        // API request counts from LLMRequestLog
        prisma.lLMRequestLog.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            api_key_id: true,
            source: true,
            created_at: true,
            total_tokens: true,
            total_cost: true,
            total_duration_ms: true,
          }
        }).catch(() => []),

        // Code mode sessions
        prisma.aWCodeSession.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            status: true,
            created_at: true,
            user_id: true
          }
        }).catch(() => [])
      ]);

      // Also get previous period data for change calculation
      const [prevSessions, prevMessages] = await Promise.all([
        prisma.chatSession.count({
          where: {
            created_at: { gte: previousStartDate, lt: startDate }
          }
        }),
        prisma.chatMessage.count({
          where: {
            created_at: { gte: previousStartDate, lt: startDate }
          }
        })
      ]);

      // NEW: Fetch openagentic-specific metrics from LLMRequestLog where source = 'code'
      const openagenticRequestLogs = await prisma.lLMRequestLog.findMany({
        where: {
          source: 'code',
          created_at: { gte: startDate }
        },
        select: {
          id: true,
          api_key_id: true,
          model: true,
          prompt_tokens: true,
          completion_tokens: true,
          total_tokens: true,
          reasoning_tokens: true,
          total_cost: true,
          created_at: true
        }
      });

      // Fetch API key names for the openagentic requests
      const openagenticApiKeyIds = [...new Set(openagenticRequestLogs.map(r => r.api_key_id).filter(Boolean))] as string[];
      const apiKeysData = openagenticApiKeyIds.length > 0 ? await prisma.apiKey.findMany({
        where: { id: { in: openagenticApiKeyIds } },
        select: { id: true, name: true, user: { select: { email: true, name: true } } }
      }) : [];
      const apiKeyMap = new Map(apiKeysData.map(k => [k.id, k]));

      // Build time series data
      const buckets = createTimeBuckets(startDate, bucketMs, bucketCount);

      // Process sessions time series
      const sessionsTimeSeries = createTimeSeries(
        sessionsData,
        buckets,
        (item) => item.created_at
      );

      // Process messages time series
      const messagesTimeSeries = createTimeSeries(
        messagesData,
        buckets,
        (item) => item.created_at
      );

      // Process token usage time series (Chat Mode)
      const tokenUsageTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: messagesData
          .filter(m => m.created_at >= bucket.start && m.created_at < bucket.end)
          .reduce((sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0), 0)
      }));

      // NEW: Process Code Mode token usage time series
      const codeTokenUsageTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: codeMessagesData
          .filter(m => m.created_at >= bucket.start && m.created_at < bucket.end)
          .reduce((sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0) + (m.tokens || 0), 0)
      }));

      // NEW: Calculate Code Mode totals
      const totalCodeTokens = codeMessagesData.reduce(
        (sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0) + (m.tokens || 0), 0
      );
      const totalCodeCost = codeMessagesData.reduce(
        (sum, m) => sum + (Number(m.cost) || 0), 0
      );

      // Process images generated time series
      const imagesTimeSeries = createTimeSeries(
        imagesData,
        buckets,
        (item) => item.created_at
      );

      // Process embeddings time series
      const embeddingsTimeSeries = createTimeSeries(
        embeddingUsage,
        buckets,
        (item) => item.created_at
      );

      // Calculate model usage breakdown
      const modelUsage = new Map<string, { count: number; tokens: number; cost: number }>();
      for (const msg of messagesData) {
        if (msg.role === 'assistant') {
          const model = msg.model || 'unknown';
          const existing = modelUsage.get(model) || { count: 0, tokens: 0, cost: 0 };
          const inputTokens = msg.tokens_input || 0;
          const outputTokens = msg.tokens_output || 0;
          const cost = msg.cost ? Number(msg.cost) : 0;

          modelUsage.set(model, {
            count: existing.count + 1,
            tokens: existing.tokens + inputTokens + outputTokens,
            cost: existing.cost + cost
          });
        }
      }

      // Calculate MCP tool usage
      const mcpToolUsage = new Map<string, number>();
      for (const msg of messagesData) {
        if (msg.mcp_calls && Array.isArray(msg.mcp_calls)) {
          for (const call of msg.mcp_calls as any[]) {
            const toolName = call?.name || call?.toolName || 'unknown';
            mcpToolUsage.set(toolName, (mcpToolUsage.get(toolName) || 0) + 1);
          }
        }
      }

      // Calculate cost by model time series
      const costByModelTimeSeries: { model: string; data: TimeSeriesPoint[] }[] = [];
      const topModels = Array.from(modelUsage.entries())
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 5)
        .map(([model]) => model);

      for (const model of topModels) {
        const series = buckets.map(bucket => {
          const modelMessages = messagesData.filter(
            m => m.model === model &&
                 m.created_at >= bucket.start &&
                 m.created_at < bucket.end
          );
          const cost = modelMessages.reduce((sum, m) => {
            return sum + (m.cost ? Number(m.cost) : 0);
          }, 0);
          return { timestamp: bucket.timestamp, value: cost };
        });
        costByModelTimeSeries.push({ model, data: series });
      }

      // Calculate totals
      const totalSessions = sessionsData.length;
      const totalMessages = messagesData.length;

      // IMPORTANT: Get accurate token and cost data from llm_request_logs (SOT)
      // This is the same source as LLM Performance Metrics for consistency
      const [llmMetrics, pricingSourceBreakdown] = await Promise.all([
        llmMetricsService.getAggregatedMetrics({
          startDate,
          endDate: new Date()
        }),
        llmMetricsService.getPricingSourceBreakdown({
          startDate,
          endDate: new Date()
        }),
      ]);

      // Use LLM metrics as primary source (accurate)
      // Fall back to chat_messages if llm_request_logs is empty (legacy data)
      const chatMessageTokens = messagesData.reduce(
        (sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0), 0
      );
      const chatMessageCost = messagesData.reduce((sum, m) => {
        return sum + (m.cost ? Number(m.cost) : 0);
      }, 0);

      // Use llm_request_logs data if available, otherwise fall back to chat_messages
      const totalTokens = llmMetrics.totalTokens > 0 ? llmMetrics.totalTokens : chatMessageTokens;
      const totalCost = llmMetrics.totalCost > 0 ? llmMetrics.totalCost : chatMessageCost;

      const totalImages = imagesData.length;
      const totalMcpCalls = messagesData.reduce((sum, m) => {
        return sum + (Array.isArray(m.mcp_calls) ? m.mcp_calls.length : 0);
      }, 0);
      const totalEmbeddings = embeddingUsage.length;

      // Active users (users with activity in time range)
      const activeUserIds = new Set(sessionsData.map(s => s.user_id));
      const totalUsers = usersData.length;
      const activeUsers = activeUserIds.size;

      // Calculate change percentages
      const sessionChange = prevSessions > 0
        ? ((totalSessions - prevSessions) / prevSessions) * 100
        : 0;
      const messageChange = prevMessages > 0
        ? ((totalMessages - prevMessages) / prevMessages) * 100
        : 0;

      // Calculate per-user usage metrics
      const perUserUsage = new Map<string, {
        userId: string;
        email: string;
        name: string;
        sessions: number;
        messages: number;
        tokens: number;
        cost: number;
        lastActive: Date;
      }>();

      // Aggregate user data from sessions and messages
      for (const session of perUserSessionData) {
        const userId = session.user_id;
        const existing = perUserUsage.get(userId) || {
          userId,
          email: session.user?.email || 'Unknown',
          name: session.user?.name || 'Unknown',
          sessions: 0,
          messages: 0,
          tokens: 0,
          cost: 0,
          lastActive: session.created_at
        };
        existing.sessions++;
        existing.messages += session.message_count || 0;
        if (session.created_at > existing.lastActive) {
          existing.lastActive = session.created_at;
        }
        perUserUsage.set(userId, existing);
      }

      // Add token and cost data from messages
      for (const msg of messagesData) {
        if (msg.role === 'assistant') {
          // Find the session's user
          const session = perUserSessionData.find(s => s.id === msg.session_id);
          if (session) {
            const userId = session.user_id;
            const existing = perUserUsage.get(userId);
            if (existing) {
              const inputTokens = msg.tokens_input || 0;
              const outputTokens = msg.tokens_output || 0;
              const cost = msg.cost ? Number(msg.cost) : 0;
              existing.tokens += inputTokens + outputTokens;
              existing.cost += cost;
              perUserUsage.set(userId, existing);
            }
          }
        }
      }

      // Per-user time series (top 10 users by usage)
      const topUsers = Array.from(perUserUsage.entries())
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 10);

      const perUserTimeSeries: { userId: string; name: string; data: TimeSeriesPoint[] }[] = [];
      for (const [userId, userData] of topUsers) {
        const userMessages = messagesData.filter(m => {
          const session = perUserSessionData.find(s => s.id === m.session_id);
          return session?.user_id === userId && m.role === 'assistant';
        });

        const series = buckets.map(bucket => {
          const cost = userMessages
            .filter(m => m.created_at >= bucket.start && m.created_at < bucket.end)
            .reduce((sum, m) => sum + (m.cost ? Number(m.cost) : 0), 0);
          return { timestamp: bucket.timestamp, value: Math.round(cost * 100) / 100 };
        });
        perUserTimeSeries.push({ userId, name: userData.name || userData.email, data: series });
      }

      // Calculate context window metrics summary — clamp utilization values to 0-100%
      const rawAvgUtil = contextWindowData.length > 0
        ? contextWindowData.reduce((sum, s) => sum + (Number(s.context_utilization_pct) || 0), 0) / contextWindowData.length
        : 0;
      const rawMaxUtil = contextWindowData.length > 0
        ? Math.max(...contextWindowData.map(s => Number(s.context_utilization_pct) || 0))
        : 0;
      const contextWindowMetrics = {
        sessionsWithData: contextWindowData.length,
        avgUtilization: Math.min(100, Math.max(0, rawAvgUtil)),
        maxUtilization: Math.min(100, Math.max(0, rawMaxUtil)),
        highUtilizationCount: contextWindowData.filter(s => Math.min(100, Number(s.context_utilization_pct) || 0) >= 80).length,
        totalContextTokens: contextWindowData.reduce((sum, s) => sum + (s.context_tokens_total || 0), 0),
        avgTokensPerSession: contextWindowData.length > 0
          ? contextWindowData.reduce((sum, s) => sum + (s.context_tokens_total || 0), 0) / contextWindowData.length
          : 0
      };

      // Context utilization time series — clamp to 0-100%
      const contextUtilizationTimeSeries = buckets.map(bucket => {
        const sessionsInBucket = contextWindowData.filter(
          s => s.created_at >= bucket.start && s.created_at < bucket.end
        );
        const avgUtil = sessionsInBucket.length > 0
          ? sessionsInBucket.reduce((sum, s) => sum + (Number(s.context_utilization_pct) || 0), 0) / sessionsInBucket.length
          : 0;
        return { timestamp: bucket.timestamp, value: Math.round(Math.min(100, Math.max(0, avgUtil)) * 100) / 100 };
      });

      // NEW: Calculate Openagentic CLI metrics
      const openagenticMetrics = {
        totalRequests: openagenticRequestLogs.length,
        totalTokens: openagenticRequestLogs.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
        totalPromptTokens: openagenticRequestLogs.reduce((sum, r) => sum + (r.prompt_tokens || 0), 0),
        totalCompletionTokens: openagenticRequestLogs.reduce((sum, r) => sum + (r.completion_tokens || 0), 0),
        totalThinkingTokens: openagenticRequestLogs.reduce((sum, r) => sum + (r.reasoning_tokens || 0), 0),
        totalCost: openagenticRequestLogs.reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0),
        uniqueApiKeys: openagenticApiKeyIds.length
      };

      // Openagentic time series
      const openagenticTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: openagenticRequestLogs.filter(
          r => r.created_at >= bucket.start && r.created_at < bucket.end
        ).length
      }));

      // Openagentic token usage time series
      const openagenticTokenTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: openagenticRequestLogs
          .filter(r => r.created_at >= bucket.start && r.created_at < bucket.end)
          .reduce((sum, r) => sum + (r.total_tokens || 0), 0)
      }));

      // Openagentic cost time series
      const openagenticCostTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: Math.round(openagenticRequestLogs
          .filter(r => r.created_at >= bucket.start && r.created_at < bucket.end)
          .reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0) * 100) / 100
      }));

      // Openagentic usage by API key
      const openagenticByApiKey = new Map<string, {
        apiKeyId: string;
        keyName: string;
        userName: string;
        userEmail: string;
        requests: number;
        tokens: number;
        thinkingTokens: number;
        cost: number;
      }>();

      for (const log of openagenticRequestLogs) {
        const keyId = log.api_key_id || 'unknown';
        const apiKeyInfo = apiKeyMap.get(keyId);
        const existing = openagenticByApiKey.get(keyId) || {
          apiKeyId: keyId,
          keyName: apiKeyInfo?.name || 'Unknown Key',
          userName: apiKeyInfo?.user?.name || 'Unknown',
          userEmail: apiKeyInfo?.user?.email || 'Unknown',
          requests: 0,
          tokens: 0,
          thinkingTokens: 0,
          cost: 0
        };
        existing.requests++;
        existing.tokens += log.total_tokens || 0;
        existing.thinkingTokens += log.reasoning_tokens || 0;
        existing.cost += Number(log.total_cost) || 0;
        openagenticByApiKey.set(keyId, existing);
      }

      // Openagentic model usage
      const openagenticModelUsage = new Map<string, { count: number; tokens: number; cost: number; thinkingTokens: number }>();
      for (const log of openagenticRequestLogs) {
        const model = log.model || 'unknown';
        const existing = openagenticModelUsage.get(model) || { count: 0, tokens: 0, cost: 0, thinkingTokens: 0 };
        existing.count++;
        existing.tokens += log.total_tokens || 0;
        existing.cost += Number(log.total_cost) || 0;
        existing.thinkingTokens += log.reasoning_tokens || 0;
        openagenticModelUsage.set(model, existing);
      }

      // === Workflow Execution Metrics ===
      const workflowExecTimeSeries = createTimeSeries(workflowExecutions, buckets, (item) => item.started_at);
      const workflowStatusCounts = {
        completed: workflowExecutions.filter(w => w.status === 'completed').length,
        failed: workflowExecutions.filter(w => w.status === 'failed').length,
        running: workflowExecutions.filter(w => w.status === 'running').length,
        pending: workflowExecutions.filter(w => w.status === 'pending' || w.status === 'queued').length,
      };
      const wfWithDuration = workflowExecutions.filter(w => w.execution_time_ms);
      const workflowAvgDuration = wfWithDuration.length > 0
        ? wfWithDuration.reduce((sum, w) => sum + (w.execution_time_ms || 0), 0) / wfWithDuration.length
        : 0;
      const workflowSuccessRate = workflowExecutions.length > 0
        ? (workflowStatusCounts.completed / workflowExecutions.length) * 100
        : 0;

      // === Agent Execution Metrics ===
      const agentExecTimeSeries = createTimeSeries(agentExecutions, buckets, (item) => item.created_at);
      const agentStatusCounts = {
        completed: agentExecutions.filter(a => a.status === 'completed').length,
        failed: agentExecutions.filter(a => a.status === 'failed').length,
        running: agentExecutions.filter(a => a.status === 'running').length,
      };
      const agentByName = new Map<string, { count: number; tokens: number; cost: number; avgTime: number; totalTime: number }>();
      for (const exec of agentExecutions) {
        // Extract agent name from agent_specs JSON (first agent's role or orchestration type)
        let name = exec.orchestration || 'unknown';
        try {
          const specs = exec.agent_specs as any;
          if (Array.isArray(specs) && specs.length > 0) {
            name = specs[0]?.role || specs[0]?.name || exec.orchestration;
          }
        } catch { /* use orchestration as fallback */ }
        const existing = agentByName.get(name) || { count: 0, tokens: 0, cost: 0, avgTime: 0, totalTime: 0 };
        existing.count++;
        existing.tokens += exec.total_tokens || 0;
        existing.cost += Number(exec.total_cost_cents) / 100 || 0; // cents to dollars
        existing.totalTime += exec.total_duration_ms || 0;
        existing.avgTime = existing.totalTime / existing.count;
        agentByName.set(name, existing);
      }

      // === API Request Metrics ===
      const apiRequestTimeSeries = createTimeSeries(apiKeyUsage, buckets, (item) => item.created_at);
      const apiBySource = new Map<string, number>();
      const apiErrorCount = 0; // No status_code field available
      const apiWithDuration = apiKeyUsage.filter(r => r.total_duration_ms);
      const apiAvgResponseTime = apiWithDuration.length > 0
        ? apiWithDuration.reduce((sum, r) => sum + (r.total_duration_ms || 0), 0) / apiWithDuration.length
        : 0;
      for (const req of apiKeyUsage) {
        const source = req.source || 'chat';
        apiBySource.set(source, (apiBySource.get(source) || 0) + 1);
      }

      // === Code Session Metrics ===
      const codeSessionTimeSeries = createTimeSeries(codeSessions, buckets, (item) => item.created_at);

      // === Token Usage by Source (combined time series) ===
      // Group LLMRequestLog by source for multi-line chart
      const sourceLabels = ['chat', 'code', 'api'] as const;
      const tokensBySource: { source: string; data: TimeSeriesPoint[] }[] = sourceLabels.map(source => ({
        source,
        data: buckets.map(bucket => ({
          timestamp: bucket.timestamp,
          value: apiKeyUsage
            .filter(r => (r.source || 'chat') === source && r.created_at >= bucket.start && r.created_at < bucket.end)
            .reduce((sum, r) => sum + (r.total_tokens || 0), 0)
        }))
      }));
      // Also add flows/agent tokens from agentExecutions
      const flowTokenTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: agentExecutions
          .filter(a => a.created_at >= bucket.start && a.created_at < bucket.end)
          .reduce((sum, a) => sum + (a.total_tokens || 0), 0)
      }));
      tokensBySource.push({ source: 'flows', data: flowTokenTimeSeries });

      // Source totals
      const tokenTotalsBySource: Record<string, number> = {};
      for (const s of tokensBySource) {
        tokenTotalsBySource[s.source] = s.data.reduce((sum, p) => sum + p.value, 0);
      }

      // === Per-User Token Usage by Source ===
      // Build map: userId -> { chat, code, flows, total }
      const perUserTokensBySource = new Map<string, {
        userId: string; email: string; name: string;
        chat: number; code: number; flows: number; total: number;
      }>();

      // Chat tokens from chat messages (joined with session for user)
      for (const msg of messagesData) {
        if (msg.role === 'assistant') {
          const session = perUserSessionData.find(s => s.id === msg.session_id);
          if (session) {
            const userId = session.user_id;
            const existing = perUserTokensBySource.get(userId) || {
              userId, email: session.user?.email || 'Unknown', name: session.user?.name || 'Unknown',
              chat: 0, code: 0, flows: 0, total: 0,
            };
            const tokens = (msg.tokens_input || 0) + (msg.tokens_output || 0);
            existing.chat += tokens;
            existing.total += tokens;
            perUserTokensBySource.set(userId, existing);
          }
        }
      }

      // Code tokens from LLMRequestLog where source='code'
      for (const log of apiKeyUsage) {
        if (log.source === 'code' && log.api_key_id) {
          const apiKeyInfo = apiKeyMap.get(log.api_key_id);
          if (apiKeyInfo) {
            // Use the api key's user info
            const userId = apiKeyInfo.user?.email || log.api_key_id;
            const existing = perUserTokensBySource.get(userId) || {
              userId, email: apiKeyInfo.user?.email || 'Unknown', name: apiKeyInfo.user?.name || 'Unknown',
              chat: 0, code: 0, flows: 0, total: 0,
            };
            existing.code += log.total_tokens || 0;
            existing.total += log.total_tokens || 0;
            perUserTokensBySource.set(userId, existing);
          }
        }
      }

      // Agent/flow tokens from agentExecutions
      for (const exec of agentExecutions) {
        const userId = exec.user_id;
        const existing = perUserTokensBySource.get(userId) || {
          userId, email: 'Unknown', name: 'Unknown',
          chat: 0, code: 0, flows: 0, total: 0,
        };
        existing.flows += exec.total_tokens || 0;
        existing.total += exec.total_tokens || 0;
        perUserTokensBySource.set(userId, existing);
      }

      // Pre-compute agent totals to avoid reduce type issues
      let agentTotalTokens = 0;
      let agentTotalCostCents = 0;
      for (const a of agentExecutions) {
        agentTotalTokens += a.total_tokens || 0;
        agentTotalCostCents += Number(a.total_cost_cents) || 0;
      }
      const agentTotalCost = Math.round((agentTotalCostCents / 100) * 100) / 100;

      // Build response object
      const response = {
        success: true,
        timeRange,
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          bucketSize: formatBucketSize(bucketMs)
        },
        summary: {
          totalUsers,
          activeUsers,
          totalSessions,
          sessionChange: Math.round(sessionChange * 10) / 10,
          totalMessages,
          messageChange: Math.round(messageChange * 10) / 10,
          totalTokens,
          totalCost: Math.round(totalCost * 100) / 100,
          totalImages,
          totalMcpCalls,
          totalEmbeddings,
          contextWindowAvgUtil: Math.round(contextWindowMetrics.avgUtilization * 100) / 100,
          // Code Mode metrics
          totalCodeTokens,
          totalCodeCost: Math.round(totalCodeCost * 100) / 100,
          totalCodeMessages: codeMessagesData.length,
          totalCodeSessions: codeSessions.length,
          // Workflow metrics
          totalWorkflowExecutions: workflowExecutions.length,
          totalWorkflows: workflows.length,
          activeWorkflows: workflows.filter(w => w.is_active).length,
          workflowSuccessRate: Math.round(workflowSuccessRate * 10) / 10,
          // Agent metrics
          totalAgentExecutions: agentExecutions.length,
          agentTotalTokens,
          agentTotalCost,
          // API metrics
          totalApiRequests: apiKeyUsage.length,
          apiErrorRate: apiKeyUsage.length > 0 ? Math.round((apiErrorCount / apiKeyUsage.length) * 1000) / 10 : 0,
          apiAvgResponseTime: Math.round(apiAvgResponseTime),
        },
        timeSeries: {
          sessions: sessionsTimeSeries,
          messages: messagesTimeSeries,
          tokenUsage: tokenUsageTimeSeries,
          images: imagesTimeSeries,
          embeddings: embeddingsTimeSeries,
          contextUtilization: contextUtilizationTimeSeries,
          // Code Mode token usage time series
          codeTokenUsage: codeTokenUsageTimeSeries,
          // Workflow execution time series
          workflowExecutions: workflowExecTimeSeries,
          // Agent execution time series
          agentExecutions: agentExecTimeSeries,
          // API request time series
          apiRequests: apiRequestTimeSeries,
          // Code session time series
          codeSessions: codeSessionTimeSeries
        },
        modelUsage: Array.from(modelUsage.entries()).map(([model, data]) => ({
          model,
          ...data,
          cost: Math.round(data.cost * 100) / 100
        })).sort((a, b) => b.count - a.count),
        costByModel: costByModelTimeSeries,
        mcpToolUsage: Array.from(mcpToolUsage.entries())
          .map(([tool, count]) => ({ tool, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20),
        // NEW: Per-user usage breakdown
        perUserUsage: Array.from(perUserUsage.values())
          .map(u => ({
            ...u,
            cost: Math.round(u.cost * 100) / 100,
            lastActive: u.lastActive.toISOString()
          }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 20),
        // NEW: Per-user time series (top 10 users)
        perUserTimeSeries,
        // NEW: Context window metrics
        contextWindowMetrics,
        // Cost pricing source breakdown (for transparency)
        pricingSourceBreakdown,
        // Openagentic CLI metrics
        openagenticMetrics: {
          ...openagenticMetrics,
          totalCost: Math.round(openagenticMetrics.totalCost * 100) / 100
        },
        openagenticTimeSeries: {
          requests: openagenticTimeSeries,
          tokens: openagenticTokenTimeSeries,
          cost: openagenticCostTimeSeries
        },
        openagenticByApiKey: Array.from(openagenticByApiKey.values())
          .map(k => ({
            ...k,
            cost: Math.round(k.cost * 100) / 100
          }))
          .sort((a, b) => b.cost - a.cost),
        openagenticModelUsage: Array.from(openagenticModelUsage.entries())
          .map(([model, data]) => ({
            model,
            ...data,
            cost: Math.round(data.cost * 100) / 100
          }))
          .sort((a, b) => b.cost - a.cost),

        // Workflow metrics
        workflowMetrics: {
          statusCounts: workflowStatusCounts,
          avgDurationMs: Math.round(workflowAvgDuration),
          successRate: Math.round(workflowSuccessRate * 10) / 10,
          totalWorkflows: workflows.length,
          activeWorkflows: workflows.filter(w => w.is_active).length,
        },

        // Agent metrics
        agentMetrics: {
          statusCounts: agentStatusCounts,
          byAgent: Array.from(agentByName.entries())
            .map(([name, data]) => ({
              name,
              ...data,
              cost: Math.round(data.cost * 100) / 100,
              avgTime: Math.round(data.avgTime),
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20),
        },

        // API request metrics
        apiMetrics: {
          totalRequests: apiKeyUsage.length,
          errorCount: apiErrorCount,
          errorRate: apiKeyUsage.length > 0 ? Math.round((apiErrorCount / apiKeyUsage.length) * 1000) / 10 : 0,
          avgResponseTime: Math.round(apiAvgResponseTime),
          bySource: Array.from(apiBySource.entries())
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count),
        },

        // Token usage by source (multi-line chart data) — always include all sources
        tokensBySource: tokensBySource
          .map(s => ({ model: s.source, data: s.data })),
        tokenTotalsBySource,

        // Per-user token usage by source (chat/code/flows)
        perUserTokensBySource: Array.from(perUserTokensBySource.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 20),
      };

      // CACHE: Store response to prevent glitching during active LLM streaming
      await setCachedMetrics(cacheKey, response, 30);

      return reply.send(response);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch dashboard metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch dashboard metrics'
      });
    }
  });

  logger.info('Admin dashboard metrics routes registered');
};

// Helper functions

function parseTimeRange(range: string): number {
  const units: Record<string, number> = {
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };

  const match = range.match(/^(\d+)([hd])$/);
  if (!match) return 24 * 60 * 60 * 1000; // Default to 24h

  return parseInt(match[1]) * (units[match[2]] || units['h']);
}

function getBucketSize(rangeMs: number): number {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  if (rangeMs <= 6 * hour) return 15 * 60 * 1000;     // 15 min buckets
  if (rangeMs <= 24 * hour) return hour;              // 1 hour buckets
  if (rangeMs <= 7 * day) return 4 * hour;            // 4 hour buckets
  if (rangeMs <= 30 * day) return day;                // 1 day buckets
  return 7 * day;                                      // 1 week buckets
}

function formatBucketSize(bucketMs: number): string {
  const minutes = bucketMs / (60 * 1000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours}h`;
  const days = hours / 24;
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

interface TimeBucket {
  start: Date;
  end: Date;
  timestamp: string;
}

function createTimeBuckets(startDate: Date, bucketMs: number, count: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const start = new Date(Math.floor(startDate.getTime() / bucketMs) * bucketMs);

  for (let i = 0; i < count; i++) {
    const bucketStart = new Date(start.getTime() + (i * bucketMs));
    const bucketEnd = new Date(bucketStart.getTime() + bucketMs);
    buckets.push({
      start: bucketStart,
      end: bucketEnd,
      timestamp: bucketStart.toISOString()
    });
  }

  return buckets;
}

function createTimeSeries<T>(
  items: T[],
  buckets: TimeBucket[],
  getTimestamp: (item: T) => Date
): TimeSeriesPoint[] {
  return buckets.map(bucket => ({
    timestamp: bucket.timestamp,
    value: items.filter(item => {
      const ts = getTimestamp(item);
      return ts >= bucket.start && ts < bucket.end;
    }).length
  }));
}

export default adminDashboardMetricsRoutes;
