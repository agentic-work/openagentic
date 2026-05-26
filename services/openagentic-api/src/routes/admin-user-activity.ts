/**
 * Admin User Activity Routes
 *
 * Provides real-time and historical user activity monitoring endpoints:
 * - GET /live          - Active users with current activity status
 * - GET /stream        - SSE endpoint for real-time presence updates
 * - GET /:userId/usage - Per-user detailed usage statistics
 * - GET /summary       - Dashboard summary with online count, costs, top users
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { getCachedMetrics, setCachedMetrics } from '../services/AdminMetricsCache.js';
import { ndjsonHeaders, writeNDJSON } from '../infra/ndjson.js';

// ==========================================
// TYPE DEFINITIONS
// ==========================================

interface UserIdParams {
  userId: string;
}

interface UsageQuery {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

interface SummaryQuery {
  date?: string;
}

/**
 * Active SSE connections for presence streaming
 * Map: connectionId -> { reply, userId }
 */
const presenceSSEClients = new Map<string, { reply: FastifyReply; userId: string }>();

// ==========================================
// ROUTE PLUGIN
// ==========================================

export const adminUserActivityRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * GET /live
   *
   * Returns currently active users based on UserSession records
   * where is_active=true and last_accessed_at is within the last 15 minutes.
   * Joins with User, ChatSession, and (chat sessions) for context.
   */
  fastify.get('/live', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      // Find active sessions within the last 15 minutes
      const activeSessions = await prisma.userSession.findMany({
        where: {
          is_active: true,
          last_accessed_at: {
            gte: fifteenMinutesAgo,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              is_admin: true,
              avatar_url: true,
              last_login_at: true,
              code_enabled: true,
            },
          },
        },
        orderBy: {
          last_accessed_at: 'desc',
        },
      });

      // Deduplicate by user_id (a user may have multiple active sessions)
      const userMap = new Map<string, {
        userId: string;
        email: string;
        name: string | null;
        isAdmin: boolean;
        avatarUrl: string | null;
        lastAccessed: Date;
        sessionCount: number;
        ipAddress: string | null;
        userAgent: string | null;
      }>();

      for (const session of activeSessions) {
        const existing = userMap.get(session.user_id);
        if (existing) {
          existing.sessionCount++;
          // Keep the most recent access time
          if (session.last_accessed_at > existing.lastAccessed) {
            existing.lastAccessed = session.last_accessed_at;
            existing.ipAddress = session.ip_address;
            existing.userAgent = session.user_agent;
          }
        } else {
          userMap.set(session.user_id, {
            userId: session.user_id,
            email: session.user.email,
            name: session.user.name,
            isAdmin: session.user.is_admin,
            avatarUrl: session.user.avatar_url,
            lastAccessed: session.last_accessed_at,
            sessionCount: 1,
            ipAddress: session.ip_address,
            userAgent: session.user_agent,
          });
        }
      }

      const userIds = Array.from(userMap.keys());

      // Fetch recent chat sessions for these users (last 15 min activity)
      const recentChatSessions = userIds.length > 0
        ? await prisma.chatSession.findMany({
            where: {
              user_id: { in: userIds },
              updated_at: { gte: fifteenMinutesAgo },
              is_active: true,
            },
            select: {
              id: true,
              user_id: true,
              title: true,
              model: true,
              updated_at: true,
            },
            orderBy: { updated_at: 'desc' },
          })
        : [];

      // Group chat sessions by user
      const chatSessionsByUser = new Map<string, typeof recentChatSessions>();
      for (const cs of recentChatSessions) {
        const list = chatSessionsByUser.get(cs.user_id) || [];
        list.push(cs);
        chatSessionsByUser.set(cs.user_id, list);
      }

      // Code Mode is removed in the OSS edition — no provisioning rows to load.
      const codeProvisioningByUser = new Map<string, { user_id: string; status: string; pod_name: string | null; last_accessed_at: Date | null }>();

      // Build result array
      const activeUsers = Array.from(userMap.values()).map(user => {
        const chatSessions = chatSessionsByUser.get(user.userId) || [];
        const codeSession = codeProvisioningByUser.get(user.userId);

        // Determine activity type
        let activityType = 'idle';
        if (codeSession && codeSession.status === 'ready' && codeSession.last_accessed_at &&
            codeSession.last_accessed_at >= fifteenMinutesAgo) {
          activityType = 'code_mode';
        } else if (chatSessions.length > 0) {
          activityType = 'chatting';
        } else {
          activityType = 'browsing';
        }

        return {
          userId: user.userId,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin,
          avatarUrl: user.avatarUrl,
          lastAccessed: user.lastAccessed.toISOString(),
          sessionCount: user.sessionCount,
          ipAddress: user.ipAddress,
          activityType,
          activeChatSessions: chatSessions.map(cs => ({
            id: cs.id,
            title: cs.title,
            model: cs.model,
            updatedAt: cs.updated_at.toISOString(),
          })),
          codeMode: codeSession ? {
            status: codeSession.status,
            podName: codeSession.pod_name,
            lastAccessed: codeSession.last_accessed_at?.toISOString() || null,
          } : null,
        };
      });

      return reply.send({
        users: activeUsers,
        total: activeUsers.length,
        asOf: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error({ error }, '[UserActivity] Failed to get live users');
      return reply.code(500).send({
        error: 'Failed to get live users',
        message: error.message,
      });
    }
  });

  /**
   * GET /stream
   *
   * SSE endpoint for real-time presence updates.
   * Polls every 5 seconds, emits presence_update events.
   * Heartbeat every 15 seconds to keep the connection alive.
   */
  fastify.get('/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const connectionId = `${user?.id || 'anon'}-${Date.now()}`;

    // NDJSON stream (v0.6.7 — Phase D.5).
    reply.raw.writeHead(200, ndjsonHeaders());

    writeNDJSON(reply, 'connected', {
      connectionId,
      connectedAt: new Date().toISOString(),
    });

    // Register this connection
    presenceSSEClients.set(connectionId, { reply, userId: user?.id || 'anonymous' });

    logger.info({ connectionId, userId: user?.id }, '[UserActivity] Admin connected to presence SSE stream');

    // Polling function to fetch and emit presence data
    const emitPresenceUpdate = async () => {
      try {
        if (reply.raw.writableEnded) return;

        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        const activeSessions = await prisma.userSession.findMany({
          where: {
            is_active: true,
            last_accessed_at: { gte: fifteenMinutesAgo },
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                is_admin: true,
              },
            },
          },
          orderBy: { last_accessed_at: 'desc' },
        });

        // Deduplicate by user
        const uniqueUsers = new Map<string, {
          userId: string;
          email: string;
          name: string | null;
          isAdmin: boolean;
          lastAccessed: string;
        }>();

        for (const session of activeSessions) {
          if (!uniqueUsers.has(session.user_id)) {
            uniqueUsers.set(session.user_id, {
              userId: session.user_id,
              email: session.user.email,
              name: session.user.name,
              isAdmin: session.user.is_admin,
              lastAccessed: session.last_accessed_at.toISOString(),
            });
          }
        }

        const presenceData = {
          onlineCount: uniqueUsers.size,
          users: Array.from(uniqueUsers.values()),
          timestamp: new Date().toISOString(),
        };

        writeNDJSON(reply, 'presence_update', presenceData);
      } catch (error) {
        logger.warn({ error, connectionId }, '[UserActivity] Error emitting presence update');
      }
    };

    // Emit initial presence data immediately
    await emitPresenceUpdate();

    // Poll every 5 seconds
    const pollInterval = setInterval(emitPresenceUpdate, 5000);

    // Heartbeat every 15 seconds
    const heartbeatInterval = setInterval(() => {
      if (reply.raw.writableEnded || !writeNDJSON(reply, 'heartbeat', { ts: new Date().toISOString() })) {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    // Clean up on disconnect
    request.raw.on('close', () => {
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
      presenceSSEClients.delete(connectionId);
      logger.info({ connectionId }, '[UserActivity] Admin disconnected from presence SSE stream');
    });
  });

  /**
   * GET /:userId/usage
   *
   * Per-user detailed usage statistics including:
   * - Token usage aggregation (total tokens, cost, breakdown by provider/model)
   * - Chat session stats (total sessions, total messages)
   * - Recent UserQueryAudit entries
   * - MCP tool usage breakdown
   * - Code mode session history
   */
  fastify.get<{ Params: UserIdParams; Querystring: UsageQuery }>(
    '/:userId/usage',
    async (request, reply) => {
      try {
        const { userId } = request.params;
        const { startDate, endDate, limit = 50 } = request.query;

        // Verify user exists
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            is_admin: true,
            created_at: true,
            last_login_at: true,
            code_enabled: true,
          },
        });

        if (!user) {
          return reply.code(404).send({ error: 'User not found' });
        }

        // Build date filter for queries
        const dateFilter: { gte?: Date; lte?: Date } = {};
        if (startDate) dateFilter.gte = new Date(startDate);
        if (endDate) dateFilter.lte = new Date(endDate);
        const hasDateFilter = Object.keys(dateFilter).length > 0;

        // 1. Token usage aggregation
        const tokenUsageWhere: any = { user_id: userId };
        if (hasDateFilter) tokenUsageWhere.timestamp = dateFilter;

        const tokenAggregation = await prisma.tokenUsage.aggregate({
          where: tokenUsageWhere,
          _sum: {
            total_tokens: true,
            prompt_tokens: true,
            completion_tokens: true,
            total_cost: true,
            cached_tokens: true,
            thinking_tokens: true,
            input_cost: true,
            output_cost: true,
            cached_cost: true,
            thinking_cost: true,
          },
          _count: {
            id: true,
          },
        });

        // Token usage breakdown by provider
        const tokenByProvider = await prisma.tokenUsage.groupBy({
          by: ['provider'],
          where: tokenUsageWhere,
          _sum: {
            total_tokens: true,
            total_cost: true,
          },
          _count: {
            id: true,
          },
          orderBy: {
            _sum: {
              total_tokens: 'desc',
            },
          },
        });

        // Token usage breakdown by model
        const tokenByModel = await prisma.tokenUsage.groupBy({
          by: ['model'],
          where: tokenUsageWhere,
          _sum: {
            total_tokens: true,
            total_cost: true,
          },
          _count: {
            id: true,
          },
          orderBy: {
            _sum: {
              total_tokens: 'desc',
            },
          },
          take: 10,
        });

        // 2. Chat session stats
        const chatSessionWhere: any = { user_id: userId };
        if (hasDateFilter) chatSessionWhere.created_at = dateFilter;

        const chatSessionStats = await prisma.chatSession.aggregate({
          where: chatSessionWhere,
          _count: {
            id: true,
          },
          _sum: {
            message_count: true,
            total_tokens: true,
            total_cost: true,
          },
        });

        // Recent chat sessions
        const recentSessions = await prisma.chatSession.findMany({
          where: { user_id: userId },
          select: {
            id: true,
            title: true,
            model: true,
            message_count: true,
            total_tokens: true,
            total_cost: true,
            is_active: true,
            created_at: true,
            updated_at: true,
          },
          orderBy: { updated_at: 'desc' },
          take: Number(limit),
        });

        // 3. Recent UserQueryAudit entries
        const auditWhere: any = { user_id: userId };
        if (hasDateFilter) auditWhere.created_at = dateFilter;

        const recentAudits = await prisma.userQueryAudit.findMany({
          where: auditWhere,
          select: {
            id: true,
            query_type: true,
            intent: true,
            mcp_server: true,
            tools_called: true,
            model_used: true,
            tokens_consumed: true,
            cost_estimate: true,
            success: true,
            response_time_ms: true,
            error_message: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
          take: Number(limit),
        });

        // 4. MCP tool usage breakdown (from UserQueryAudit)
        const mcpToolUsage = await prisma.userQueryAudit.groupBy({
          by: ['mcp_server'],
          where: {
            user_id: userId,
            mcp_server: { not: null },
            ...(hasDateFilter ? { created_at: dateFilter } : {}),
          },
          _count: {
            id: true,
          },
          _avg: {
            response_time_ms: true,
          },
          orderBy: {
            _count: {
              id: 'desc',
            },
          },
        });

        // Query type breakdown
        const queryTypeBreakdown = await prisma.userQueryAudit.groupBy({
          by: ['query_type'],
          where: auditWhere,
          _count: {
            id: true,
          },
          orderBy: {
            _count: {
              id: 'desc',
            },
          },
        });

        // 5. Code mode is removed in the OSS edition — no provisioning row.
        const codeProvisioning: any = null;

        return reply.send({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            isAdmin: user.is_admin,
            codeEnabled: user.code_enabled,
            createdAt: user.created_at.toISOString(),
            lastLoginAt: user.last_login_at?.toISOString() || null,
          },
          tokenUsage: {
            totalTokens: tokenAggregation._sum.total_tokens || 0,
            promptTokens: tokenAggregation._sum.prompt_tokens || 0,
            completionTokens: tokenAggregation._sum.completion_tokens || 0,
            cachedTokens: tokenAggregation._sum.cached_tokens || 0,
            thinkingTokens: tokenAggregation._sum.thinking_tokens || 0,
            totalCost: tokenAggregation._sum.total_cost ? Number(tokenAggregation._sum.total_cost) : 0,
            inputCost: tokenAggregation._sum.input_cost ? Number(tokenAggregation._sum.input_cost) : 0,
            outputCost: tokenAggregation._sum.output_cost ? Number(tokenAggregation._sum.output_cost) : 0,
            cachedCost: tokenAggregation._sum.cached_cost ? Number(tokenAggregation._sum.cached_cost) : 0,
            thinkingCost: tokenAggregation._sum.thinking_cost ? Number(tokenAggregation._sum.thinking_cost) : 0,
            requestCount: tokenAggregation._count.id || 0,
            byProvider: tokenByProvider.map(p => ({
              provider: p.provider || 'unknown',
              totalTokens: p._sum.total_tokens || 0,
              totalCost: p._sum.total_cost ? Number(p._sum.total_cost) : 0,
              requestCount: p._count.id || 0,
            })),
            byModel: tokenByModel.map(m => ({
              model: m.model,
              totalTokens: m._sum.total_tokens || 0,
              totalCost: m._sum.total_cost ? Number(m._sum.total_cost) : 0,
              requestCount: m._count.id || 0,
            })),
          },
          chatSessions: {
            totalSessions: chatSessionStats._count.id || 0,
            totalMessages: chatSessionStats._sum.message_count || 0,
            totalTokens: chatSessionStats._sum.total_tokens || 0,
            totalCost: chatSessionStats._sum.total_cost ? Number(chatSessionStats._sum.total_cost) : 0,
            recent: recentSessions.map(s => ({
              id: s.id,
              title: s.title,
              model: s.model,
              messageCount: s.message_count,
              totalTokens: s.total_tokens,
              totalCost: s.total_cost ? Number(s.total_cost) : 0,
              isActive: s.is_active,
              createdAt: s.created_at.toISOString(),
              updatedAt: s.updated_at.toISOString(),
            })),
          },
          queryAudit: {
            recent: recentAudits.map(a => ({
              id: a.id,
              queryType: a.query_type,
              intent: a.intent,
              mcpServer: a.mcp_server,
              toolsCalled: a.tools_called,
              modelUsed: a.model_used,
              tokensConsumed: a.tokens_consumed,
              costEstimate: a.cost_estimate ? Number(a.cost_estimate) : null,
              success: a.success,
              responseTimeMs: a.response_time_ms,
              errorMessage: a.error_message,
              createdAt: a.created_at.toISOString(),
            })),
            byQueryType: queryTypeBreakdown.map(q => ({
              queryType: q.query_type,
              count: q._count.id,
            })),
          },
          mcpToolUsage: mcpToolUsage.map(m => ({
            mcpServer: m.mcp_server || 'unknown',
            callCount: m._count.id,
            avgResponseTimeMs: m._avg.response_time_ms ? Math.round(m._avg.response_time_ms) : null,
          })),
          codeMode: codeProvisioning ? {
            status: codeProvisioning.status,
            statusMessage: codeProvisioning.status_message,
            environmentType: codeProvisioning.environment_type,
            nodeName: codeProvisioning.node_name,
            podName: codeProvisioning.pod_name,
            storageQuotaMb: codeProvisioning.storage_quota_mb,
            storageUsedMb: codeProvisioning.storage_used_mb,
            openagenticModel: codeProvisioning.openagentic_model,
            provisionedAt: codeProvisioning.provisioned_at?.toISOString() || null,
            lastAccessedAt: codeProvisioning.last_accessed_at?.toISOString() || null,
            suspendedAt: codeProvisioning.suspended_at?.toISOString() || null,
            suspendedReason: codeProvisioning.suspended_reason,
            lastError: codeProvisioning.last_error,
            errorCount: codeProvisioning.error_count,
            createdAt: codeProvisioning.created_at.toISOString(),
          } : null,
          query: {
            startDate: startDate || null,
            endDate: endDate || null,
            limit: Number(limit),
          },
        });
      } catch (error: any) {
        logger.error({ error }, '[UserActivity] Failed to get user usage stats');
        return reply.code(500).send({
          error: 'Failed to get user usage stats',
          message: error.message,
        });
      }
    }
  );

  /**
   * GET /summary
   *
   * Dashboard summary including:
   * - Online user count (active sessions within 15 minutes)
   * - Active chat sessions count
   * - Token and cost totals for today
   * - Top 10 users by token usage today
   */
  fastify.get<{ Querystring: SummaryQuery }>(
    '/summary',
    async (request, reply) => {
      try {
        const { date } = request.query;

        // Check cache
        const cacheKey = `activity:summary:${date || 'today'}`;
        const cached = await getCachedMetrics<any>(cacheKey);
        if (cached) {
          return reply.send(cached);
        }

        // Calculate date boundaries
        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        // 1. Online user count (distinct users with active sessions in last 15 min)
        const onlineSessions = await prisma.userSession.findMany({
          where: {
            is_active: true,
            last_accessed_at: { gte: fifteenMinutesAgo },
          },
          select: {
            user_id: true,
          },
          distinct: ['user_id'],
        });
        const onlineCount = onlineSessions.length;

        // 2. Active chat sessions count (sessions updated today that are still active)
        const activeChatSessionsCount = await prisma.chatSession.count({
          where: {
            is_active: true,
            updated_at: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        });

        // 3. Total tokens and cost for today
        // Try token_usage table first, fall back to llm_request_logs (SOT) if empty
        let todayTokenAggregation: any = await prisma.tokenUsage.aggregate({
          where: {
            timestamp: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          _sum: {
            total_tokens: true,
            prompt_tokens: true,
            completion_tokens: true,
            total_cost: true,
          },
          _count: {
            id: true,
          },
        });

        // Fallback to llm_request_logs if token_usage has no data for today
        let usedLlmRequestLogFallback = false;
        if (!todayTokenAggregation._sum.total_tokens || todayTokenAggregation._sum.total_tokens === 0) {
          const llmLogAggregation = await prisma.lLMRequestLog.aggregate({
            where: {
              created_at: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
            _sum: {
              total_tokens: true,
              prompt_tokens: true,
              completion_tokens: true,
              total_cost: true,
            },
            _count: {
              id: true,
            },
          });

          if (llmLogAggregation._sum.total_tokens && llmLogAggregation._sum.total_tokens > 0) {
            todayTokenAggregation = llmLogAggregation;
            usedLlmRequestLogFallback = true;
          }
        }

        // Cost by provider for today
        let todayCostByProvider: any[];
        if (usedLlmRequestLogFallback) {
          // Use llm_request_logs grouped by provider_type (mapped as 'provider' in output)
          const llmByProvider = await prisma.lLMRequestLog.groupBy({
            by: ['provider_type'],
            where: {
              created_at: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
            _sum: {
              total_tokens: true,
              total_cost: true,
            },
            _count: {
              id: true,
            },
          });
          todayCostByProvider = llmByProvider.sort((a, b) =>
            (Number(b._sum.total_cost) || 0) - (Number(a._sum.total_cost) || 0)
          );
        } else {
          const tuByProvider = await prisma.tokenUsage.groupBy({
            by: ['provider'],
            where: {
              timestamp: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
            _sum: {
              total_tokens: true,
              total_cost: true,
            },
            _count: {
              id: true,
            },
          });
          todayCostByProvider = tuByProvider.sort((a, b) =>
            (Number(b._sum.total_cost) || 0) - (Number(a._sum.total_cost) || 0)
          );
        }

        // 4. Top 10 users by token usage today
        let topUsersToday: any[];
        if (usedLlmRequestLogFallback) {
          const llmByUser = await prisma.lLMRequestLog.groupBy({
            by: ['user_id'],
            where: {
              created_at: {
                gte: startOfDay,
                lte: endOfDay,
              },
              user_id: { not: null },
            },
            _sum: {
              total_tokens: true,
              total_cost: true,
            },
            _count: {
              id: true,
            },
          });
          topUsersToday = llmByUser
            .sort((a, b) => (b._sum.total_tokens || 0) - (a._sum.total_tokens || 0))
            .slice(0, 10);
        } else {
          const tuByUser = await prisma.tokenUsage.groupBy({
            by: ['user_id'],
            where: {
              timestamp: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
            _sum: {
              total_tokens: true,
              total_cost: true,
            },
            _count: {
              id: true,
            },
          });
          topUsersToday = tuByUser
            .sort((a, b) => (b._sum.total_tokens || 0) - (a._sum.total_tokens || 0))
            .slice(0, 10);
        }

        // Fetch user details for top users
        const topUserIds = topUsersToday.map(u => u.user_id);
        const topUserDetails = topUserIds.length > 0
          ? await prisma.user.findMany({
              where: { id: { in: topUserIds } },
              select: {
                id: true,
                email: true,
                name: true,
                is_admin: true,
              },
            })
          : [];

        const userDetailsMap = new Map(topUserDetails.map(u => [u.id, u]));

        const topUsers = topUsersToday.map(u => {
          const details = userDetailsMap.get(u.user_id);
          return {
            userId: u.user_id,
            email: details?.email || 'unknown',
            name: details?.name || null,
            isAdmin: details?.is_admin || false,
            totalTokens: u._sum.total_tokens || 0,
            totalCost: u._sum.total_cost ? Number(u._sum.total_cost) : 0,
            requestCount: u._count.id || 0,
          };
        });

        // 5. Total registered users
        const totalUsers = await prisma.user.count();

        // 6. New users today
        const newUsersToday = await prisma.user.count({
          where: {
            created_at: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        });

        // 7. Code Mode is removed in the OSS edition — always 0 active sessions.
        const activeCodeSessions = 0;

        const responseData = {
          onlineCount,
          activeChatSessions: activeChatSessionsCount,
          activeCodeSessions,
          totalUsers,
          newUsersToday,
          todayTokens: {
            totalTokens: todayTokenAggregation._sum.total_tokens || 0,
            promptTokens: todayTokenAggregation._sum.prompt_tokens || 0,
            completionTokens: todayTokenAggregation._sum.completion_tokens || 0,
            totalCost: todayTokenAggregation._sum.total_cost ? Number(todayTokenAggregation._sum.total_cost) : 0,
            requestCount: todayTokenAggregation._count.id || 0,
            byProvider: todayCostByProvider.map((p: any) => ({
              provider: p.provider || p.provider_type || 'unknown',
              totalTokens: p._sum.total_tokens || 0,
              totalCost: p._sum.total_cost ? Number(p._sum.total_cost) : 0,
              requestCount: p._count.id || 0,
            })),
          },
          topUsers,
          date: startOfDay.toISOString().split('T')[0],
          asOf: new Date().toISOString(),
        };

        await setCachedMetrics(cacheKey, responseData, 15);
        return reply.send(responseData);
      } catch (error: any) {
        logger.error({ error }, '[UserActivity] Failed to get summary');
        return reply.code(500).send({
          error: 'Failed to get activity summary',
          message: error.message,
        });
      }
    }
  );

  logger.info('Admin User Activity routes registered');
};

export default adminUserActivityRoutes;
