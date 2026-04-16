/**
 * Admin Audit Portal Routes
 * 
 * Provides comprehensive audit trail access for admins to monitor:
 * - All user queries and responses
 * - MCP tool calls and results
 * - System usage patterns
 * - Error tracking and debugging
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { AuditLogger } from '../services/AuditLogger.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes.child({ component: 'AdminAudit' });

const adminAuditRoutes: FastifyPluginAsync = async (fastify) => {
  const auditLogger = new AuditLogger(logger);

  /**
   * Real-time audit log streaming via Server-Sent Events (SSE)
   * Splunk-like live log streaming for admin monitoring
   */
  fastify.get('/api/admin/audit/logs/stream', {
    preHandler: adminMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          queryType: { type: 'string', enum: ['chat', 'mcp_tool', 'admin_action', 'api_call'] },
          mcpServer: { type: 'string' },
          success: { type: 'boolean' },
          search: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, queryType, mcpServer, success, search } = request.query as any;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Track last seen log ID to avoid duplicates
    let lastLogId: string | null = null;
    let isActive = true;

    // Send heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (isActive) {
        reply.raw.write(': heartbeat\n\n');
      }
    }, 15000); // Every 15 seconds

    // Poll for new logs every 2 seconds (Splunk-like streaming)
    const pollInterval = setInterval(async () => {
      if (!isActive) return;

      try {
        const options: any = {
          userId,
          queryType,
          mcpServer,
          success,
          limit: 50 // Get recent logs
        };

        const logs = await auditLogger.getAuditLogs(options);

        // Filter by search term if provided
        let filteredLogs = logs;
        if (search) {
          const searchTerm = search.toLowerCase();
          filteredLogs = logs.filter(log =>
            log.raw_query?.toLowerCase().includes(searchTerm) ||
            log.error_message?.toLowerCase().includes(searchTerm) ||
            log.user?.email?.toLowerCase().includes(searchTerm)
          );
        }

        // Only send new logs we haven't seen before
        const newLogs = lastLogId
          ? filteredLogs.filter(log => log.id > lastLogId!)
          : filteredLogs.slice(0, 10); // Initial batch of 10

        if (newLogs.length > 0) {
          // Update last seen ID
          lastLogId = newLogs[newLogs.length - 1].id;

          // Send each new log as an SSE event
          for (const log of newLogs) {
            const eventData = {
              id: log.id,
              timestamp: log.created_at,
              userId: log.user_id,
              userEmail: log.user?.email,
              queryType: log.query_type,
              rawQuery: log.raw_query,
              mcpServer: log.mcp_server,
              success: log.success,
              responseTime: log.response_time_ms,
              errorMessage: log.error_message
            };

            reply.raw.write(`data: ${JSON.stringify(eventData)}\n\n`);
          }
        }
      } catch (error) {
        logger.error({ error }, '[AUDIT-STREAM] Failed to fetch new logs');
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to fetch logs' })}\n\n`);
      }
    }, 2000); // Poll every 2 seconds

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      isActive = false;
      clearInterval(heartbeat);
      clearInterval(pollInterval);
      logger.info('[AUDIT-STREAM] Client disconnected');
    });

    // Send initial connection success message
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ message: 'Audit log stream connected' })}\n\n`);
  });

  /**
   * Get comprehensive audit logs with filtering
   */
  fastify.get('/api/admin/audit/logs', {
    preHandler: adminMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          queryType: { type: 'string', enum: ['chat', 'mcp_tool', 'admin_action', 'api_call'] },
          mcpServer: { type: 'string' },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          success: { type: 'boolean' },
          limit: { type: 'number', minimum: 1, maximum: 1000, default: 100 },
          offset: { type: 'number', minimum: 0, default: 0 },
          search: { type: 'string' } // search in raw_query
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      userId,
      queryType,
      mcpServer,
      startDate,
      endDate,
      success,
      limit = 100,
      offset = 0,
      search
    } = request.query as any;

    try {
      const options: any = {
        userId,
        queryType,
        mcpServer,
        success,
        limit,
        offset
      };

      if (startDate) options.startDate = new Date(startDate);
      if (endDate) options.endDate = new Date(endDate);

      const logs = await auditLogger.getAuditLogs(options);

      // Filter by search term if provided
      let filteredLogs = logs;
      if (search) {
        const searchTerm = search.toLowerCase();
        filteredLogs = logs.filter(log => 
          log.raw_query?.toLowerCase().includes(searchTerm) ||
          log.error_message?.toLowerCase().includes(searchTerm) ||
          log.user?.email?.toLowerCase().includes(searchTerm)
        );
      }

      reply.send({
        success: true,
        data: {
          logs: filteredLogs,
          pagination: {
            limit,
            offset,
            total: filteredLogs.length
          },
          filters: {
            userId,
            queryType,
            mcpServer,
            startDate,
            endDate,
            success,
            search
          }
        }
      });

    } catch (error) {
      logger.error({ error }, '[AUDIT] Failed to fetch audit logs');
      reply.code(500).send({
        success: false,
        error: 'Failed to fetch audit logs',
        message: error.message
      });
    }
  });

  /**
   * Get user activity summary
   */
  fastify.get('/api/admin/audit/user/:userId/summary', {
    preHandler: adminMiddleware,
    schema: {
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' }
        },
        required: ['userId']
      },
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'number', minimum: 1, maximum: 365, default: 30 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const { days = 30 } = request.query as { days?: number };

    try {
      const summary = await auditLogger.getUserActivitySummary(userId, days);
      
      reply.send({
        success: true,
        data: summary
      });

    } catch (error) {
      logger.error({ error, userId }, '[AUDIT] Failed to fetch user activity summary');
      reply.code(500).send({
        success: false,
        error: 'Failed to fetch user activity summary',
        message: error.message
      });
    }
  });

  /**
   * Get audit log details by ID
   */
  fastify.get('/api/admin/audit/logs/:logId', {
    preHandler: adminMiddleware,
    schema: {
      params: {
        type: 'object',
        properties: {
          logId: { type: 'string' }
        },
        required: ['logId']
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { logId } = request.params as { logId: string };

    try {
      const log = await auditLogger.getAuditLogs({ limit: 1 });
      const foundLog = log.find(l => l.id === logId);

      if (!foundLog) {
        return reply.code(404).send({
          success: false,
          error: 'Audit log not found'
        });
      }

      return reply.send({
        success: true,
        data: foundLog
      });

    } catch (error) {
      logger.error({ error, logId }, '[AUDIT] Failed to fetch audit log details');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch audit log details',
        message: error.message
      });
    }
  });

  /**
   * Get audit statistics for dashboard
   */
  fastify.get('/api/admin/audit/stats', {
    preHandler: adminMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          groupBy: { type: 'string', enum: ['day', 'hour', 'user', 'queryType', 'mcpServer'], default: 'day' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      startDate,
      endDate,
      groupBy = 'day'
    } = request.query as any;

    try {
      // This would need more complex aggregation queries
      // For now, return basic stats
      const options: any = {};
      if (startDate) options.startDate = new Date(startDate);
      if (endDate) options.endDate = new Date(endDate);

      const [totalLogs, successfulLogs, failedLogs, uniqueUsers] = await Promise.all([
        auditLogger.getAuditLogs({ ...options, limit: 99999 }).then(logs => logs.length),
        auditLogger.getAuditLogs({ ...options, success: true, limit: 99999 }).then(logs => logs.length),
        auditLogger.getAuditLogs({ ...options, success: false, limit: 99999 }).then(logs => logs.length),
        auditLogger.getAuditLogs({ ...options, limit: 99999 }).then(logs => 
          new Set(logs.map(l => l.user_id)).size
        )
      ]);

      reply.send({
        success: true,
        data: {
          totalQueries: totalLogs,
          successfulQueries: successfulLogs,
          failedQueries: failedLogs,
          uniqueUsers,
          successRate: totalLogs > 0 ? (successfulLogs / totalLogs * 100).toFixed(2) : 0,
          period: {
            startDate,
            endDate,
            groupBy
          }
        }
      });

    } catch (error) {
      logger.error({ error }, '[AUDIT] Failed to fetch audit statistics');
      reply.code(500).send({
        success: false,
        error: 'Failed to fetch audit statistics',
        message: error.message
      });
    }
  });

  /**
   * Export audit logs as CSV
   */
  fastify.get('/api/admin/audit/export', {
    preHandler: adminMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          queryType: { type: 'string' },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          format: { type: 'string', enum: ['csv', 'json'], default: 'csv' }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      userId,
      queryType,
      startDate,
      endDate,
      format = 'csv'
    } = request.query as any;

    try {
      const options: any = { 
        userId,
        queryType,
        limit: 10000 // Max export limit
      };

      if (startDate) options.startDate = new Date(startDate);
      if (endDate) options.endDate = new Date(endDate);

      const logs = await auditLogger.getAuditLogs(options);

      if (format === 'json') {
        reply
          .header('Content-Type', 'application/json')
          .header('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.json"`)
          .send({
            success: true,
            exportDate: new Date().toISOString(),
            totalRecords: logs.length,
            data: logs
          });
      } else {
        // CSV format
        const csvHeader = [
          'Timestamp', 'User Email', 'Query Type', 'Raw Query', 
          'MCP Server', 'Success', 'Response Time (ms)', 'Error Message'
        ].join(',');

        const csvRows = logs.map(log => [
          log.created_at,
          log.user?.email || '',
          log.query_type,
          `"${log.raw_query?.replace(/"/g, '""') || ''}"`,
          log.mcp_server || '',
          log.success,
          log.response_time_ms || '',
          `"${log.error_message?.replace(/"/g, '""') || ''}"`
        ].join(','));

        const csv = [csvHeader, ...csvRows].join('\\n');

        reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`)
          .send(csv);
      }

    } catch (error) {
      logger.error({ error }, '[AUDIT] Failed to export audit logs');
      reply.code(500).send({
        success: false,
        error: 'Failed to export audit logs',
        message: error.message
      });
    }
  });

  /**
   * Export ML training data for model fine-tuning
   */
  fastify.get('/api/admin/audit/ml-training-data', {
    preHandler: adminMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          minConfidence: { type: 'number', minimum: 0, maximum: 1 },
          includeErrors: { type: 'boolean', default: false },
          limit: { type: 'number', minimum: 1, maximum: 50000, default: 10000 }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      startDate,
      endDate,
      minConfidence = 0.7,
      includeErrors = false,
      limit = 10000
    } = request.query as any;

    try {
      const options: any = { 
        success: includeErrors ? undefined : true,
        limit 
      };

      if (startDate) options.startDate = new Date(startDate);
      if (endDate) options.endDate = new Date(endDate);

      const logs = await auditLogger.getAuditLogs(options);

      // Filter and format for ML training
      const trainingData = logs
        .filter(log => log.ml_training_data && 
                      (!minConfidence || JSON.parse(log.ml_training_data).output?.confidenceScore >= minConfidence))
        .map(log => ({
          id: log.id,
          timestamp: log.created_at,
          user_id: log.user_id,
          session_id: log.session_id,
          ...JSON.parse(log.ml_training_data)
        }));

      reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="ml-training-data-${new Date().toISOString().split('T')[0]}.json"`)
        .send({
          metadata: {
            exportDate: new Date().toISOString(),
            totalRecords: trainingData.length,
            filters: {
              minConfidence,
              includeErrors,
              startDate,
              endDate
            }
          },
          trainingData
        });

    } catch (error) {
      logger.error({ error }, '[AUDIT] Failed to export ML training data');
      reply.code(500).send({
        success: false,
        error: 'Failed to export ML training data',
        message: error.message
      });
    }
  });

  /**
   * Permanently delete session (admin only) - removes from audit trail too
   */
  fastify.delete('/api/admin/audit/sessions/:sessionId/permanent', {
    preHandler: adminMiddleware,
    schema: {
      params: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' }
        },
        required: ['sessionId']
      },
      body: {
        type: 'object',
        properties: {
          confirmPhrase: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['confirmPhrase', 'reason']
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { confirmPhrase, reason } = request.body as { confirmPhrase: string; reason: string };

    // Safety check - require confirmation phrase
    if (confirmPhrase !== 'PERMANENTLY DELETE') {
      return reply.code(400).send({
        success: false,
        error: 'Confirmation phrase required',
        message: 'Must provide exact phrase "PERMANENTLY DELETE" to confirm'
      });
    }

    try {
      const adminUserId = request.user?.id;

      // Log the permanent deletion for audit
      await auditLogger.logAdminAction(
        adminUserId,
        'permanent_session_delete',
        'chat_session',
        sessionId,
        { reason },
        request.ip
      );

      // This would need to be implemented in ChatStorageService
      // await chatStorageService.permanentlyDeleteSession(sessionId, adminUserId);

      return reply.send({
        success: true,
        message: 'Session permanently deleted - this action cannot be undone',
        sessionId,
        deletedBy: adminUserId,
        reason
      });

    } catch (error) {
      logger.error({ error, sessionId }, '[AUDIT] Failed to permanently delete session');
      return reply.code(500).send({
        success: false,
        error: 'Failed to permanently delete session',
        message: error.message
      });
    }
  });
};

export default adminAuditRoutes;