/**
 * Admin Audit Logs Routes
 * Provides comprehensive audit logging for admin actions and user queries
 * Data sourced from AdminAuditLog and UserQueryAudit tables
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes.child({ component: 'AdminAuditLogs' });

interface AuditLogQuery {
  page?: number;
  limit?: number;
  logType?: 'admin' | 'user' | 'all';
  userId?: string;
  userEmail?: string;
  action?: string;
  actionType?: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  success?: string;
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
}

const adminAuditLogsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get audit logs with filtering and pagination
   * Combines AdminAuditLog and UserQueryAudit tables
   */
  fastify.get('/api/admin/audit-logs', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as AuditLogQuery;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const {
      logType = 'all',
      userId,
      userEmail,
      action,
      actionType,
      resourceType,
      resourceId,
      ipAddress,
      success,
      startDate,
      endDate,
      searchTerm
    } = query;

    try {
      // Build date filter
      const dateFilter: any = {};
      if (startDate) {
        dateFilter.gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.lte = new Date(endDate);
      }

      const logs: any[] = [];

      // Fetch admin audit logs if requested
      if (logType === 'admin' || logType === 'all') {
        const adminWhere: any = {
          ...(userId && { admin_user_id: userId }),
          ...(action && { action: { contains: action, mode: 'insensitive' } }),
          ...(resourceType && { resource_type: { contains: resourceType, mode: 'insensitive' } }),
          ...(resourceId && { resource_id: { contains: resourceId, mode: 'insensitive' } }),
          ...(ipAddress && { ip_address: { contains: ipAddress, mode: 'insensitive' } }),
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter })
        };

        // Add email search if provided
        if (userEmail) {
          adminWhere.OR = [
            { admin_email: { contains: userEmail, mode: 'insensitive' } },
            { user: { email: { contains: userEmail, mode: 'insensitive' } } }
          ];
        }

        const adminLogs = await prisma.adminAuditLog.findMany({
          where: adminWhere,
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit
        });

        logs.push(...adminLogs.map(log => ({
          id: log.id,
          type: 'admin' as const,
          userId: log.admin_user_id,
          userName: log.user?.name || 'Unknown',
          userEmail: log.admin_email || log.user?.email || '',
          action: log.action,
          resourceType: log.resource_type,
          resourceId: log.resource_id,
          details: log.details,
          ipAddress: log.ip_address,
          success: true,
          timestamp: log.created_at.toISOString()
        })));
      }

      // Fetch user query audit logs if requested
      if (logType === 'user' || logType === 'all') {
        const userWhere: any = {
          ...(userId && { user_id: userId }),
          ...(actionType && { query_type: { contains: actionType, mode: 'insensitive' } }),
          ...(ipAddress && { ip_address: { contains: ipAddress, mode: 'insensitive' } }),
          ...(success !== undefined && { success: success === 'true' }),
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter })
        };

        // Add email search if provided
        if (userEmail) {
          userWhere.user = { email: { contains: userEmail, mode: 'insensitive' } };
        }

        const userLogs = await prisma.userQueryAudit.findMany({
          where: userWhere,
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit
        });

        logs.push(...userLogs.map(log => ({
          id: log.id,
          type: 'user' as const,
          userId: log.user_id,
          userName: log.user?.name || 'Unknown',
          userEmail: log.user?.email || '',
          action: log.query_type,
          query: log.raw_query,
          intent: log.intent,
          sessionId: log.session_id,
          messageId: log.message_id,
          mcpServer: log.mcp_server,
          toolsCalled: log.tools_called,
          success: log.success,
          error: log.error_message,
          ipAddress: log.ip_address,
          userAgent: log.user_agent,
          timestamp: log.created_at.toISOString()
        })));
      }

      // Sort combined logs by timestamp
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply search term filter if provided
      let filteredLogs = logs;
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        filteredLogs = logs.filter(log =>
          log.userName?.toLowerCase().includes(searchLower) ||
          log.userEmail?.toLowerCase().includes(searchLower) ||
          log.action?.toLowerCase().includes(searchLower) ||
          log.query?.toLowerCase().includes(searchLower) ||
          log.resourceType?.toLowerCase().includes(searchLower) ||
          log.resourceId?.toLowerCase().includes(searchLower) ||
          log.ipAddress?.toLowerCase().includes(searchLower)
        );
      }

      // Apply limit to combined results
      const paginatedLogs = filteredLogs.slice(0, limit);

      // Get total counts with filters
      const adminWhere: any = {
        ...(userId && { admin_user_id: userId }),
        ...(action && { action: { contains: action, mode: 'insensitive' } }),
        ...(resourceType && { resource_type: { contains: resourceType, mode: 'insensitive' } }),
        ...(resourceId && { resource_id: { contains: resourceId, mode: 'insensitive' } }),
        ...(ipAddress && { ip_address: { contains: ipAddress, mode: 'insensitive' } }),
        ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter })
      };
      if (userEmail) {
        adminWhere.OR = [
          { admin_email: { contains: userEmail, mode: 'insensitive' } },
          { user: { email: { contains: userEmail, mode: 'insensitive' } } }
        ];
      }

      const userWhere: any = {
        ...(userId && { user_id: userId }),
        ...(actionType && { query_type: { contains: actionType, mode: 'insensitive' } }),
        ...(ipAddress && { ip_address: { contains: ipAddress, mode: 'insensitive' } }),
        ...(success !== undefined && { success: success === 'true' }),
        ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter })
      };
      if (userEmail) {
        userWhere.user = { email: { contains: userEmail, mode: 'insensitive' } };
      }

      const totalAdmin = logType === 'admin' || logType === 'all'
        ? await prisma.adminAuditLog.count({ where: adminWhere })
        : 0;

      const totalUser = logType === 'user' || logType === 'all'
        ? await prisma.userQueryAudit.count({ where: userWhere })
        : 0;

      const totalItems = searchTerm ? filteredLogs.length : totalAdmin + totalUser;

      return reply.send({
        success: true,
        logs: paginatedLogs,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(totalItems / limit),
          totalItems,
          totalAdmin,
          totalUser
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch audit logs');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch audit logs'
      });
    }
  });

  /**
   * Get audit log statistics
   */
  fastify.get('/api/admin/audit-logs/stats', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Admin audit stats
      const [
        totalAdminActions,
        recentAdminActions24h,
        recentAdminActions7d
      ] = await Promise.all([
        prisma.adminAuditLog.count(),
        prisma.adminAuditLog.count({ where: { created_at: { gte: last24h } } }),
        prisma.adminAuditLog.count({ where: { created_at: { gte: last7d } } })
      ]);

      // User query stats
      const [
        totalUserQueries,
        recentUserQueries24h,
        recentUserQueries7d,
        failedQueries24h
      ] = await Promise.all([
        prisma.userQueryAudit.count(),
        prisma.userQueryAudit.count({ where: { created_at: { gte: last24h } } }),
        prisma.userQueryAudit.count({ where: { created_at: { gte: last7d } } }),
        prisma.userQueryAudit.count({
          where: {
            created_at: { gte: last24h },
            success: false
          }
        })
      ]);

      // Top admin actions
      const adminLogs = await prisma.adminAuditLog.findMany({
        where: { created_at: { gte: last7d } },
        select: { action: true, resource_type: true }
      });

      const actionCounts: Record<string, number> = {};
      for (const log of adminLogs) {
        const key = `${log.action} - ${log.resource_type}`;
        actionCounts[key] = (actionCounts[key] || 0) + 1;
      }

      const topActions = Object.entries(actionCounts)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Most active users
      const userQueries = await prisma.userQueryAudit.findMany({
        where: { created_at: { gte: last7d } },
        include: {
          user: { select: { id: true, name: true, email: true } }
        }
      });

      const userActivityMap: Record<string, any> = {};
      for (const query of userQueries) {
        if (!userActivityMap[query.user_id]) {
          userActivityMap[query.user_id] = {
            userId: query.user_id,
            userName: query.user?.name || 'Unknown',
            userEmail: query.user?.email || '',
            count: 0
          };
        }
        userActivityMap[query.user_id].count++;
      }

      const topUsers = Object.values(userActivityMap)
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 10);

      return reply.send({
        success: true,
        admin: {
          totalActions: totalAdminActions,
          recent24h: recentAdminActions24h,
          recent7d: recentAdminActions7d,
          topActions
        },
        user: {
          totalQueries: totalUserQueries,
          recent24h: recentUserQueries24h,
          recent7d: recentUserQueries7d,
          failedQueries24h,
          topUsers
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch audit log stats');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch audit log statistics'
      });
    }
  });

  /**
   * Get recent errors from user queries
   */
  fastify.get('/api/admin/audit-logs/errors', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as any;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;

    try {
      const errors = await prisma.userQueryAudit.findMany({
        where: {
          success: false,
          error_message: { not: null }
        },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      });

      const totalErrors = await prisma.userQueryAudit.count({
        where: {
          success: false,
          error_message: { not: null }
        }
      });

      return reply.send({
        success: true,
        errors: errors.map(error => ({
          id: error.id,
          userId: error.user_id,
          userName: error.user?.name || 'Unknown',
          userEmail: error.user?.email || '',
          query: error.raw_query,
          queryType: error.query_type,
          errorMessage: error.error_message,
          errorCode: error.error_code,
          sessionId: error.session_id,
          messageId: error.message_id,
          ipAddress: error.ip_address,
          timestamp: error.created_at.toISOString()
        })),
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(totalErrors / limit),
          totalItems: totalErrors
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch error logs');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch error logs'
      });
    }
  });

  /**
   * Get session-level audit logs
   * Shows complete conversations with user queries and AI responses
   */
  fastify.get('/api/admin/audit-logs/sessions', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as any;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const {
      userId,
      startDate,
      endDate
    } = query;

    try {
      // Build date filter
      const dateFilter: any = {};
      if (startDate) {
        dateFilter.gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.lte = new Date(endDate);
      }

      // Fetch chat sessions with their messages
      // Note: Using select instead of include for better performance and to avoid nested relation issues
      const sessions = await prisma.chatSession.findMany({
        where: {
          ...(userId && { user_id: userId }),
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter }),
          deleted_at: null
          // Removed message_count filter to avoid issues when count is 0 or null
        },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          },
          messages: {
            where: { deleted_at: null },
            orderBy: { created_at: 'asc' },
            select: {
              id: true,
              role: true,
              content: true,
              model: true,
              mcp_calls: true,
              tool_calls: true,
              tool_results: true,
              tokens: true,
              cost: true,
              created_at: true
            }
          }
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      });

      // Filter out sessions with no messages after fetch
      const filteredSessions = sessions.filter(s => s.messages && s.messages.length > 0);

      const totalSessions = await prisma.chatSession.count({
        where: {
          ...(userId && { user_id: userId }),
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter }),
          deleted_at: null
        }
      });

      // Format session data
      const formattedSessions = filteredSessions.map(session => {
        // Separate user and assistant messages
        const userMessages = session.messages.filter(m => m.role === 'user');
        const assistantMessages = session.messages.filter(m => m.role === 'assistant');

        // Get first user query
        const firstQuery = userMessages[0]?.content || 'No query';

        // Get all MCP tool calls from the session
        const mcpCalls = session.messages
          .filter(m => m.mcp_calls)
          .flatMap(m => {
            const calls = m.mcp_calls as any;
            return Array.isArray(calls) ? calls : [];
          });

        // Count tool executions
        const toolExecutions = session.messages
          .filter(m => m.tool_calls)
          .reduce((count, m) => {
            const calls = m.tool_calls as any;
            return count + (Array.isArray(calls) ? calls.length : 0);
          }, 0);

        return {
          id: session.id,
          userId: session.user_id,
          userName: session.user?.name || 'Unknown',
          userEmail: session.user?.email || '',
          title: session.title || firstQuery.substring(0, 100),
          summary: session.summary,
          messageCount: session.message_count,
          userQueries: userMessages.length,
          aiResponses: assistantMessages.length,
          firstQuery,
          model: session.model,
          totalTokens: session.total_tokens,
          totalCost: session.total_cost,
          mcpCallsCount: mcpCalls.length,
          toolExecutionsCount: toolExecutions,
          conversation: session.messages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            model: msg.model,
            tokens: msg.tokens,
            cost: msg.cost,
            hasMcpCalls: !!msg.mcp_calls,
            hasToolCalls: !!msg.tool_calls,
            timestamp: msg.created_at.toISOString()
          })),
          createdAt: session.created_at.toISOString(),
          updatedAt: session.updated_at.toISOString()
        };
      });

      return reply.send({
        success: true,
        sessions: formattedSessions,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(totalSessions / limit),
          totalItems: totalSessions
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch session logs');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch session logs'
      });
    }
  });

  /**
   * Export audit logs to CSV or JSON
   * SOC2 Compliance: Full exportability of audit trail
   */
  fastify.get('/api/admin/audit-logs/export', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as AuditLogQuery & { format?: 'csv' | 'json' };
    const {
      format = 'csv',
      logType = 'all',
      userId,
      userEmail,
      action,
      actionType,
      resourceType,
      resourceId,
      ipAddress,
      success,
      startDate,
      endDate,
      searchTerm
    } = query;

    try {
      // Build date filter
      const dateFilter: any = {};
      if (startDate) {
        dateFilter.gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.lte = new Date(endDate);
      }

      const logs: any[] = [];

      // Fetch admin audit logs
      if (logType === 'admin' || logType === 'all') {
        const adminWhere: any = {
          ...(userId && { admin_user_id: userId }),
          ...(action && { action: { contains: action, mode: 'insensitive' } }),
          ...(resourceType && { resource_type: { contains: resourceType, mode: 'insensitive' } }),
          ...(resourceId && { resource_id: { contains: resourceId, mode: 'insensitive' } }),
          ...(ipAddress && { ip_address: { contains: ipAddress, mode: 'insensitive' } }),
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter })
        };

        if (userEmail) {
          adminWhere.OR = [
            { admin_email: { contains: userEmail, mode: 'insensitive' } },
            { user: { email: { contains: userEmail, mode: 'insensitive' } } }
          ];
        }

        const adminLogs = await prisma.adminAuditLog.findMany({
          where: adminWhere,
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 10000 // Max export limit
        });

        logs.push(...adminLogs.map(log => ({
          id: log.id,
          type: 'admin',
          timestamp: log.created_at.toISOString(),
          userId: log.admin_user_id || '',
          userName: log.user?.name || 'Unknown',
          userEmail: log.admin_email || log.user?.email || '',
          action: log.action,
          resourceType: log.resource_type,
          resourceId: log.resource_id,
          details: typeof log.details === 'string' ? log.details : JSON.stringify(log.details),
          ipAddress: log.ip_address || '',
          success: 'true',
          errorMessage: ''
        })));
      }

      // Fetch user query audit logs
      if (logType === 'user' || logType === 'all') {
        const userWhere: any = {
          ...(userId && { user_id: userId }),
          ...(actionType && { query_type: { contains: actionType, mode: 'insensitive' } }),
          ...(ipAddress && { ip_address: { contains: ipAddress, mode: 'insensitive' } }),
          ...(success !== undefined && { success: success === 'true' }),
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter })
        };

        if (userEmail) {
          userWhere.user = { email: { contains: userEmail, mode: 'insensitive' } };
        }

        const userLogs = await prisma.userQueryAudit.findMany({
          where: userWhere,
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 10000 // Max export limit
        });

        logs.push(...userLogs.map(log => ({
          id: log.id,
          type: 'user',
          timestamp: log.created_at.toISOString(),
          userId: log.user_id,
          userName: log.user?.name || 'Unknown',
          userEmail: log.user?.email || '',
          action: log.query_type,
          resourceType: 'query',
          resourceId: log.session_id || '',
          details: log.raw_query || '',
          ipAddress: log.ip_address || '',
          success: String(log.success),
          errorMessage: log.error_message || ''
        })));
      }

      // Sort combined logs by timestamp
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply search term filter if provided
      let filteredLogs = logs;
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        filteredLogs = logs.filter(log =>
          log.userName?.toLowerCase().includes(searchLower) ||
          log.userEmail?.toLowerCase().includes(searchLower) ||
          log.action?.toLowerCase().includes(searchLower) ||
          log.details?.toLowerCase().includes(searchLower) ||
          log.resourceType?.toLowerCase().includes(searchLower) ||
          log.resourceId?.toLowerCase().includes(searchLower) ||
          log.ipAddress?.toLowerCase().includes(searchLower)
        );
      }

      if (format === 'json') {
        return reply
          .header('Content-Type', 'application/json')
          .header('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.json"`)
          .send({
            success: true,
            exportDate: new Date().toISOString(),
            totalRecords: filteredLogs.length,
            filters: {
              logType,
              userId,
              userEmail,
              action,
              actionType,
              resourceType,
              resourceId,
              ipAddress,
              success,
              startDate,
              endDate,
              searchTerm
            },
            data: filteredLogs
          });
      } else {
        // CSV format
        const csvHeader = [
          'Timestamp',
          'Type',
          'User ID',
          'User Name',
          'User Email',
          'Action',
          'Resource Type',
          'Resource ID',
          'IP Address',
          'Success',
          'Error Message',
          'Details'
        ].join(',');

        const csvRows = filteredLogs.map(log => [
          log.timestamp,
          log.type,
          log.userId,
          log.userName,
          log.userEmail,
          log.action,
          log.resourceType,
          log.resourceId,
          log.ipAddress,
          log.success,
          `"${(log.errorMessage || '').replace(/"/g, '""')}"`,
          `"${(log.details || '').replace(/"/g, '""').substring(0, 500)}"`
        ].join(','));

        const csv = [csvHeader, ...csvRows].join('\n');

        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`)
          .send(csv);
      }

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to export audit logs');
      return reply.code(500).send({
        success: false,
        error: 'Failed to export audit logs'
      });
    }
  });

  /**
   * Get a specific session's complete conversation
   */
  fastify.get('/api/admin/audit-logs/sessions/:sessionId', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          },
          messages: {
            where: { deleted_at: null },
            orderBy: { created_at: 'asc' },
            include: {
              query_audit: {
                select: {
                  id: true,
                  query_type: true,
                  intent: true,
                  mcp_server: true,
                  tools_called: true,
                  success: true,
                  error_message: true,
                  ip_address: true,
                  user_agent: true,
                  created_at: true
                }
              }
            }
          }
        }
      });

      if (!session) {
        return reply.code(404).send({
          success: false,
          error: 'Session not found'
        });
      }

      return reply.send({
        success: true,
        session: {
          id: session.id,
          userId: session.user_id,
          userName: session.user?.name || 'Unknown',
          userEmail: session.user?.email || '',
          title: session.title,
          summary: session.summary,
          model: session.model,
          messageCount: session.message_count,
          totalTokens: session.total_tokens,
          totalCost: session.total_cost,
          metadata: session.metadata,
          conversation: session.messages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            model: msg.model,
            tokens: msg.tokens,
            tokensInput: msg.tokens_input,
            tokensOutput: msg.tokens_output,
            cost: msg.cost,
            mcpCalls: msg.mcp_calls,
            toolCalls: msg.tool_calls,
            toolResults: msg.tool_results,
            visualizations: msg.visualizations,
            auditLogs: msg.query_audit,
            timestamp: msg.created_at.toISOString()
          })),
          createdAt: session.created_at.toISOString(),
          updatedAt: session.updated_at.toISOString()
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message, sessionId }, 'Failed to fetch session details');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch session details'
      });
    }
  });
};

export default adminAuditLogsRoutes;
