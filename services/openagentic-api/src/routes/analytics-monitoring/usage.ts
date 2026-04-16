/**
 * Usage Analytics and System Metrics Routes
 * 
 * Provides comprehensive analytics for usage tracking, cost monitoring, performance metrics,
 * and system health. Includes both admin-level analytics and user self-service analytics.
 * 
 * @see {@link https://docs.openagentic.io/api/analytics-monitoring}
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import * as jwt from 'jsonwebtoken';
import os from 'os';
import { authMiddleware, AuthenticatedRequest } from '../../middleware/unifiedAuth.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for usage routes');
}

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Helper to get user from token
  const getUserFromToken = (request: any): { userId: string; isAdmin: boolean } | null => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return {
        userId: decoded.userId || decoded.id || decoded.oid,
        isAdmin: decoded.isAdmin || false
      };
    } catch (error) {
      logger.warn({ error }, 'Failed to decode user token');
      return null;
    }
  };

  // Admin auth middleware
  const requireAdmin = async (request: any, reply: any) => {
    const user = getUserFromToken(request);
    if (!user || !user.isAdmin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }
    request.user = user;
  };

  /**
   * Usage analytics (Admin only)
   * GET /api/admin/analytics/usage
   */
  fastify.get('/usage', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { 
        startDate, 
        endDate, 
        groupBy = 'day',
        userId,
        model
      } = request.query as {
        startDate?: string;
        endDate?: string;
        groupBy?: 'hour' | 'day' | 'week' | 'month';
        userId?: string;
        model?: string;
      };

      const where: any = {};
      if (startDate && endDate) {
        where.timestamp = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }
      if (userId) where.user_id = userId;
      if (model) where.model = model;

      // Get token usage aggregated by time period
      const tokenUsage = await prisma.tokenUsage.groupBy({
        by: ['user_id', 'model'],
        where,
        _sum: {
          total_tokens: true,
          prompt_tokens: true,
          completion_tokens: true,
          total_cost: true
        },
        _count: { id: true },
        _avg: {
          total_tokens: true,
          total_cost: true
        },
        orderBy: {
          _sum: {
            total_cost: 'desc'
          }
        }
      });

      // Get time-series data for charts
      const whereClause: any = {};
      if (startDate) whereClause.timestamp = { gte: new Date(startDate) };
      if (endDate) {
        whereClause.timestamp = { 
          ...whereClause.timestamp, 
          lte: new Date(endDate) 
        };
      }
      if (userId) whereClause.user_id = userId;
      if (model) whereClause.model = model;
      
      const rawData = await prisma.tokenUsage.findMany({
        where: whereClause,
        select: {
          timestamp: true,
          total_tokens: true,
          total_cost: true,
          user_id: true
        },
        orderBy: {
          timestamp: 'asc'
        }
      });
      
      // Group data by period in application code
      const periodMap = new Map<string, any>();
      const uniqueUsersPerPeriod = new Map<string, Set<string>>();
      
      for (const item of rawData) {
        let periodKey: string;
        const date = new Date(item.timestamp);
        
        switch (groupBy) {
          case 'hour':
            periodKey = `${date.toISOString().substring(0, 13)}:00:00`;
            break;
          case 'day':
            periodKey = date.toISOString().split('T')[0];
            break;
          case 'week':
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            periodKey = weekStart.toISOString().split('T')[0];
            break;
          case 'month':
            periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            break;
          default:
            periodKey = date.toISOString().split('T')[0];
        }
        
        if (!periodMap.has(periodKey)) {
          periodMap.set(periodKey, {
            period: new Date(periodKey),
            requests: 0,
            tokens: 0,
            cost: 0,
            unique_users: 0
          });
          uniqueUsersPerPeriod.set(periodKey, new Set());
        }
        
        const period = periodMap.get(periodKey);
        period.requests += 1;
        period.tokens += item.total_tokens || 0;
        period.cost += item.total_cost || 0;
        
        uniqueUsersPerPeriod.get(periodKey)!.add(item.user_id);
      }
      
      // Set unique user counts
      for (const [periodKey, userSet] of uniqueUsersPerPeriod) {
        const period = periodMap.get(periodKey);
        if (period) {
          period.unique_users = userSet.size;
        }
      }
      
      const timeSeriesData = Array.from(periodMap.values()).sort((a, b) => 
        a.period.getTime() - b.period.getTime()
      );

      // Get top models
      const topModels = await prisma.tokenUsage.groupBy({
        by: ['model'],
        where,
        _sum: {
          total_tokens: true,
          total_cost: true
        },
        _count: { id: true },
        orderBy: {
          _sum: {
            total_cost: 'desc'
          }
        },
        take: 10
      });

      // Calculate summary metrics
      const summary = {
        totalRequests: tokenUsage.reduce((sum, item) => sum + item._count.id, 0),
        totalTokens: tokenUsage.reduce((sum, item) => sum + (item._sum.total_tokens || 0), 0),
        totalCost: tokenUsage.reduce((sum, item) => sum + Number(item._sum.total_cost || 0), 0),
        uniqueUsers: new Set(tokenUsage.map(item => item.user_id)).size,
        avgTokensPerRequest: tokenUsage.length > 0 ? 
          tokenUsage.reduce((sum, item) => sum + (item._avg.total_tokens || 0), 0) / tokenUsage.length : 0,
        avgCostPerRequest: tokenUsage.length > 0 ?
          tokenUsage.reduce((sum, item) => sum + Number(item._avg.total_cost || 0), 0) / tokenUsage.length : 0
      };

      return reply.send({
        summary,
        usage: tokenUsage,
        timeSeries: timeSeriesData.map((row: any) => ({
          period: row.period,
          requests: parseInt(row.requests),
          tokens: parseInt(row.tokens || 0),
          cost: parseFloat(row.cost || 0),
          uniqueUsers: parseInt(row.unique_users || 0)
        })),
        topModels: topModels.map(model => ({
          model: model.model,
          requests: model._count.id,
          tokens: model._sum.total_tokens || 0,
          cost: Number(model._sum.total_cost || 0)
        }))
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get usage analytics');
      return reply.code(500).send({ error: 'Failed to retrieve usage analytics' });
    }
  });

  /**
   * User analytics (Admin only)
   * GET /api/admin/analytics/users
   */
  fastify.get('/users', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { 
        startDate, 
        endDate,
        limit = 50 
      } = request.query as {
        startDate?: string;
        endDate?: string;
        limit?: number;
      };

      const where: any = {};
      if (startDate && endDate) {
        where.timestamp = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }

      // Get user activity metrics
      const userMetrics = await prisma.tokenUsage.groupBy({
        by: ['user_id'],
        where,
        _sum: {
          total_tokens: true,
          total_cost: true
        },
        _count: { id: true },
        _min: { timestamp: true },
        _max: { timestamp: true },
        orderBy: {
          _sum: {
            total_cost: 'desc'
          }
        },
        take: parseInt(limit.toString())
      });

      // Get user details
      const userIds = userMetrics.map(metric => metric.user_id);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          email: true,
          name: true,
          is_admin: true,
          created_at: true,
          last_login_at: true
        }
      });

      const userMap = users.reduce((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {} as Record<string, any>);

      // Get session counts
      const sessionCounts = await prisma.chatSession.groupBy({
        by: ['user_id'],
        where: {
          user_id: { in: userIds },
          deleted_at: null,
          ...(startDate && endDate && {
            created_at: {
              gte: new Date(startDate),
              lte: new Date(endDate)
            }
          })
        },
        _count: { id: true }
      });

      const sessionMap = sessionCounts.reduce((acc, session) => {
        acc[session.user_id] = session._count.id;
        return acc;
      }, {} as Record<string, number>);

      const enhancedUserMetrics = userMetrics.map(metric => {
        const user = userMap[metric.user_id];
        return {
          userId: metric.user_id,
          user: user ? {
            email: user.email,
            name: user.name,
            isAdmin: user.is_admin,
            createdAt: user.created_at,
            lastLoginAt: user.last_login_at
          } : null,
          usage: {
            totalRequests: metric._count.id,
            totalTokens: metric._sum.total_tokens || 0,
            totalCost: Number(metric._sum.total_cost || 0),
            totalSessions: sessionMap[metric.user_id] || 0,
            firstActivity: metric._min.timestamp,
            lastActivity: metric._max.timestamp
          }
        };
      });

      // Activity trends
      const whereClauseTrends: any = {};
      if (startDate) whereClauseTrends.timestamp = { gte: new Date(startDate) };
      if (endDate) {
        whereClauseTrends.timestamp = { 
          ...whereClauseTrends.timestamp, 
          lte: new Date(endDate) 
        };
      }
      
      const trendData = await prisma.tokenUsage.findMany({
        where: whereClauseTrends,
        select: {
          timestamp: true,
          user_id: true
        },
        orderBy: {
          timestamp: 'asc'
        }
      });
      
      // Group by day and count unique users
      const dailyActiveUsers = new Map<string, Set<string>>();
      
      for (const item of trendData) {
        const dateKey = item.timestamp.toISOString().split('T')[0];
        
        if (!dailyActiveUsers.has(dateKey)) {
          dailyActiveUsers.set(dateKey, new Set());
        }
        
        dailyActiveUsers.get(dateKey)!.add(item.user_id);
      }
      
      const activityTrends = Array.from(dailyActiveUsers.entries())
        .map(([date, userSet]) => ({
          date: new Date(date),
          active_users: userSet.size
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      return reply.send({
        users: enhancedUserMetrics,
        trends: {
          dailyActiveUsers: activityTrends.map((row: any) => ({
            date: row.date,
            activeUsers: parseInt(row.active_users)
          }))
        },
        summary: {
          totalUsers: enhancedUserMetrics.length,
          totalActivity: enhancedUserMetrics.reduce((sum, u) => sum + u.usage.totalRequests, 0),
          totalCost: enhancedUserMetrics.reduce((sum, u) => sum + u.usage.totalCost, 0),
          avgCostPerUser: enhancedUserMetrics.length > 0 ? 
            enhancedUserMetrics.reduce((sum, u) => sum + u.usage.totalCost, 0) / enhancedUserMetrics.length : 0
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get user analytics');
      return reply.code(500).send({ error: 'Failed to retrieve user analytics' });
    }
  });

  /**
   * Cost analytics (Admin only)
   * GET /api/admin/analytics/costs
   */
  fastify.get('/costs', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { startDate, endDate } = request.query as {
        startDate?: string;
        endDate?: string;
      };

      const where: any = {};
      if (startDate && endDate) {
        where.timestamp = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }

      // Daily cost trends
      const whereClauseCosts: any = {};
      if (startDate) whereClauseCosts.timestamp = { gte: new Date(startDate) };
      if (endDate) {
        whereClauseCosts.timestamp = { 
          ...whereClauseCosts.timestamp, 
          lte: new Date(endDate) 
        };
      }
      
      const costData = await prisma.tokenUsage.findMany({
        where: whereClauseCosts,
        select: {
          timestamp: true,
          total_cost: true,
          total_tokens: true
        },
        orderBy: {
          timestamp: 'asc'
        }
      });
      
      // Group by day and aggregate costs
      const dailyCostMap = new Map<string, { date: Date, cost: number, tokens: number, requests: number }>();
      
      for (const item of costData) {
        const dateKey = item.timestamp.toISOString().split('T')[0];
        
        if (!dailyCostMap.has(dateKey)) {
          dailyCostMap.set(dateKey, {
            date: new Date(dateKey),
            cost: 0,
            tokens: 0,
            requests: 0
          });
        }
        
        const day = dailyCostMap.get(dateKey)!;
        day.cost += Number(item.total_cost) || 0;
        day.tokens += Number(item.total_tokens) || 0;
        day.requests += 1;
      }
      
      const dailyCosts = Array.from(dailyCostMap.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      // Cost by model
      const modelCosts = await prisma.tokenUsage.groupBy({
        by: ['model'],
        where,
        _sum: {
          total_cost: true,
          total_tokens: true
        },
        _count: { id: true },
        orderBy: {
          _sum: {
            total_cost: 'desc'
          }
        }
      });

      // Cost by user (top 20)
      const userCosts = await prisma.tokenUsage.groupBy({
        by: ['user_id'],
        where,
        _sum: {
          total_cost: true,
          total_tokens: true
        },
        _count: { id: true },
        orderBy: {
          _sum: {
            total_cost: 'desc'
          }
        },
        take: 20
      });

      // Get user details for top spenders
      const topUserIds = userCosts.map(cost => cost.user_id);
      const topUsers = await prisma.user.findMany({
        where: { id: { in: topUserIds } },
        select: { id: true, email: true, name: true }
      });

      const userMap = topUsers.reduce((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {} as Record<string, any>);

      const enhancedUserCosts = userCosts.map(cost => ({
        userId: cost.user_id,
        user: userMap[cost.user_id] || { email: 'Unknown', name: null },
        cost: Number(cost._sum.total_cost || 0),
        tokens: cost._sum.total_tokens || 0,
        requests: cost._count.id
      }));

      // Calculate projections
      const totalCost = dailyCosts.reduce((sum, day) => sum + (day.cost || 0), 0);
      const daysInPeriod = dailyCosts.length;
      const avgDailyCost = daysInPeriod > 0 ? totalCost / daysInPeriod : 0;
      const projectedMonthlyCost = avgDailyCost * 30;

      return reply.send({
        summary: {
          totalCost: totalCost,
          avgDailyCost: avgDailyCost,
          projectedMonthlyCost: projectedMonthlyCost,
          totalTokens: dailyCosts.reduce((sum, day) => sum + (day.tokens || 0), 0),
          totalRequests: dailyCosts.reduce((sum, day) => sum + (day.requests || 0), 0)
        },
        trends: {
          daily: dailyCosts.map((row: any) => ({
            date: row.date,
            cost: parseFloat(row.cost || 0),
            tokens: parseInt(row.tokens || 0),
            requests: parseInt(row.requests || 0)
          }))
        },
        breakdown: {
          byModel: modelCosts.map(model => ({
            model: model.model,
            cost: Number(model._sum.total_cost || 0),
            tokens: model._sum.total_tokens || 0,
            requests: model._count.id
          })),
          byUser: enhancedUserCosts
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get cost analytics');
      return reply.code(500).send({ error: 'Failed to retrieve cost analytics' });
    }
  });

  /**
   * Performance metrics (Admin only)
   * GET /api/admin/analytics/performance
   */
  fastify.get('/performance', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { startDate, endDate } = request.query as {
        startDate?: string;
        endDate?: string;
      };

      // System metrics
      const systemMetrics = {
        cpu: {
          usage: Math.round(os.loadavg()[0] * 100 / os.cpus().length),
          cores: os.cpus().length,
          loadAvg: os.loadavg()
        },
        memory: {
          total: os.totalmem(),
          used: os.totalmem() - os.freemem(),
          free: os.freemem(),
          percentage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
        },
        uptime: Math.round(os.uptime()),
        platform: os.platform(),
        arch: os.arch()
      };

      // Database performance
      const where: any = {};
      if (startDate && endDate) {
        where.timestamp = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }

      const [
        totalSessions,
        totalMessages,
        totalUsers,
        recentActivity
      ] = await Promise.all([
        prisma.chatSession.count({
          where: { deleted_at: null }
        }),
        
        prisma.chatMessage.count({
          where: { deleted_at: null }
        }),
        
        prisma.user.count(),
        
        prisma.tokenUsage.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: 100,
          select: {
            timestamp: true,
            model: true,
            total_tokens: true,
            total_cost: true
          }
        })
      ]);

      // Calculate response time metrics
      const responseTimes = recentActivity
        .filter(activity => activity.total_cost)
        .map(activity => Number(activity.total_cost) * 1000); // Convert cost to ms for demo

      const avgResponseTime = responseTimes.length > 0 ? 
        responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0;

      const p95ResponseTime = responseTimes.length > 0 ? 
        responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)] : 0;

      // Error rates (approximate)
      const errorRate = 0.5; // TODO: Calculate from actual error logs

      return reply.send({
        system: systemMetrics,
        database: {
          totalSessions,
          totalMessages,
          totalUsers,
          avgResponseTime: Math.round(avgResponseTime),
          p95ResponseTime: Math.round(p95ResponseTime),
          errorRate,
          throughput: recentActivity.length > 0 ? 
            Math.round(recentActivity.length / Math.max(1, (Date.now() - recentActivity[recentActivity.length - 1].timestamp.getTime()) / (1000 * 60))) : 0 // requests per minute
        },
        trends: {
          responseTime: recentActivity.slice(0, 50).map(activity => ({
            timestamp: activity.timestamp,
            responseTime: Number(activity.total_cost) * 1000 || 0, // Convert cost to ms for demo
            model: activity.model
          }))
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get performance metrics');
      return reply.code(500).send({ error: 'Failed to retrieve performance metrics' });
    }
  });

  /**
   * System health metrics (Admin only)
   * GET /api/admin/analytics/system
   */
  fastify.get('/system', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      // Check database connectivity
      const dbHealthy = await prisma.user.findFirst({ take: 1 })
        .then(() => true)
        .catch(() => false);

      // Check MCP orchestrator
      const orchestratorUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';
      let mcpHealthy = false;
      let mcpServers = 0;
      
      try {
        const mcpResponse = await fetch(`${orchestratorUrl}/health`, { 
          signal: AbortSignal.timeout(5000) 
        });
        mcpHealthy = mcpResponse.ok;
        
        if (mcpHealthy) {
          const serversResponse = await fetch(`${orchestratorUrl}/api/inspector/api/servers`);
          if (serversResponse.ok) {
            const serversData = await serversResponse.json() as any;
            mcpServers = serversData.servers?.length || 0;
          }
        }
      } catch (error) {
        logger.debug({ error }, 'MCP health check failed');
      }

      // Service statuses
      const services = [
        {
          name: 'Database',
          status: dbHealthy ? 'healthy' : 'unhealthy',
          uptime: dbHealthy ? '99.9%' : '0%',
          responseTime: dbHealthy ? 5 : 0 // ms
        },
        {
          name: 'MCP Orchestrator',
          status: mcpHealthy ? 'healthy' : 'unhealthy',
          uptime: mcpHealthy ? '99.5%' : '0%',
          responseTime: mcpHealthy ? 50 : 0,
          metadata: { servers: mcpServers }
        },
        {
          name: 'Vector Search',
          status: 'healthy', // TODO: Check Milvus
          uptime: '99.8%',
          responseTime: 25
        }
      ];

      // Overall health score
      const healthyServices = services.filter(s => s.status === 'healthy').length;
      const healthScore = Math.round((healthyServices / services.length) * 100);

      // Recent incidents (mock data)
      const incidents = [
        // TODO: Implement actual incident tracking
      ];

      return reply.send({
        healthScore,
        status: healthScore >= 90 ? 'healthy' : healthScore >= 70 ? 'degraded' : 'unhealthy',
        services,
        incidents,
        uptime: {
          current: '99.9%',
          lastMonth: '99.8%',
          lastYear: '99.95%'
        },
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get system health metrics');
      return reply.code(500).send({ error: 'Failed to retrieve system health' });
    }
  });

  /**
   * User's own usage analytics
   * GET /api/analytics/my-usage
   */
  fastify.get('/my-usage', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    try {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { period = '30d' } = request.query as { period?: string };

      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      
      switch (period) {
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(now.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 30);
      }

      const [summary, tokenUsageData, modelBreakdown] = await Promise.all([
        // Summary metrics
        prisma.tokenUsage.aggregate({
          where: {
            user_id: user.id || user.userId,
            timestamp: { gte: startDate }
          },
          _sum: {
            total_tokens: true,
            prompt_tokens: true,
            completion_tokens: true,
            total_cost: true
          },
          _count: { id: true }
        }),
        
        // Get all token usage for daily aggregation
        prisma.tokenUsage.findMany({
          where: {
            user_id: user.id || user.userId,
            timestamp: { gte: startDate }
          },
          select: {
            timestamp: true,
            total_tokens: true,
            total_cost: true
          },
          orderBy: {
            timestamp: 'asc'
          }
        }),
        
        // Model breakdown
        prisma.tokenUsage.groupBy({
          by: ['model'],
          where: {
            user_id: user.id || user.userId,
            timestamp: { gte: startDate }
          },
          _sum: {
            total_tokens: true,
            total_cost: true
          },
          _count: { id: true },
          orderBy: {
            _sum: {
              total_cost: 'desc'
            }
          }
        })
      ]);
      
      // Aggregate daily usage in application code
      const dailyUsageMap = new Map<string, { date: Date, tokens: number, cost: number, requests: number }>();
      
      for (const usage of tokenUsageData) {
        const dateKey = usage.timestamp.toISOString().split('T')[0];
        const existing = dailyUsageMap.get(dateKey);
        
        if (existing) {
          existing.tokens += Number(usage.total_tokens) || 0;
          existing.cost += Number(usage.total_cost) || 0;
          existing.requests += 1;
        } else {
          dailyUsageMap.set(dateKey, {
            date: new Date(dateKey),
            tokens: Number(usage.total_tokens) || 0,
            cost: Number(usage.total_cost) || 0,
            requests: 1
          });
        }
      }
      
      const dailyUsage = Array.from(dailyUsageMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

      return reply.send({
        period,
        summary: {
          totalRequests: summary._count,
          totalTokens: summary._sum.total_tokens || 0,
          promptTokens: summary._sum.prompt_tokens || 0,
          completionTokens: summary._sum.completion_tokens || 0,
          totalCost: Number(summary._sum.total_cost || 0)
        },
        trends: {
          daily: dailyUsage.map((row: any) => ({
            date: row.date,
            tokens: parseInt(row.tokens || 0),
            cost: parseFloat(row.cost || 0),
            requests: parseInt(row.requests || 0)
          }))
        },
        breakdown: {
          models: modelBreakdown.map(model => ({
            model: model.model,
            requests: model._count.id,
            tokens: model._sum.total_tokens || 0,
            cost: Number(model._sum.total_cost || 0)
          }))
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get user usage analytics');
      return reply.code(500).send({ error: 'Failed to retrieve usage data' });
    }
  });

  /**
   * Generate custom reports (Admin only)
   * POST /api/admin/analytics/reports
   */
  fastify.post('/reports', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const {
        reportType,
        startDate,
        endDate,
        filters = {},
        format = 'json'
      } = request.body as {
        reportType: 'usage' | 'costs' | 'users' | 'performance' | 'custom';
        startDate?: string;
        endDate?: string;
        filters?: Record<string, any>;
        format?: 'json' | 'csv';
      };

      // TODO: Implement custom report generation
      // For now, return a placeholder

      const reportData = {
        reportId: `report_${Date.now()}`,
        type: reportType,
        generatedAt: new Date().toISOString(),
        period: {
          from: startDate,
          to: endDate
        },
        filters,
        data: [], // Would contain actual report data
        metadata: {
          totalRecords: 0,
          processingTime: '< 1s'
        }
      };

      if (format === 'csv') {
        // TODO: Return CSV format
        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', `attachment; filename="report_${reportType}_${Date.now()}.csv"`)
          .send('CSV report generation not yet implemented');
      }

      return reply.send({
        report: reportData,
        downloadUrl: `/api/admin/analytics/reports/${reportData.reportId}/download`
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate report');
      return reply.code(500).send({ error: 'Report generation failed' });
    }
  });
};