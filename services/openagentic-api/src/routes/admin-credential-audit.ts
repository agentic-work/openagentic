/**
 * Admin Credential Audit Routes
 *
 * Provides paginated, filterable access to the credential_audit_log table.
 * Tracks all admin CRUD operations on LLM providers, MCP servers, and API keys.
 *
 * Endpoint: GET /api/admin/audit/credentials
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { credentialAuditService, type CredentialAuditQuery } from '../services/CredentialAuditService.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes.child({ component: 'AdminCredentialAudit' });

const adminCredentialAuditRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/audit/credentials
   *
   * Query credential change audit logs with filtering and pagination.
   *
   * Query parameters:
   *   page        - Page number (default 1)
   *   limit       - Items per page (default 50, max 200)
   *   userId      - Filter by admin user ID
   *   action      - Filter by action ("create", "update", "delete", "view", "enable", "disable")
   *   entityType  - Filter by entity type ("llm_provider", "mcp_server", "api_key")
   *   entityId    - Filter by entity ID
   *   startDate   - Filter logs after this ISO date
   *   endDate     - Filter logs before this ISO date
   *   search      - Free text search across entity name, user email, action
   */
  fastify.get('/api/admin/audit/credentials', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Admin - Credential Audit'],
      summary: 'Query credential change audit logs',
      description: 'Returns paginated audit logs of admin CRUD operations on LLM providers, MCP servers, and API keys.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 50, maximum: 200 },
          userId: { type: 'string' },
          action: { type: 'string', enum: ['create', 'update', 'delete', 'view', 'enable', 'disable'] },
          entityType: { type: 'string', enum: ['llm_provider', 'mcp_server', 'api_key'] },
          entityId: { type: 'string' },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          search: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            logs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  user_id: { type: 'string' },
                  user_email: { type: 'string' },
                  action: { type: 'string' },
                  entity_type: { type: 'string' },
                  entity_id: { type: 'string' },
                  entity_name: { type: 'string' },
                  changes: { type: 'object' },
                  ip_address: { type: 'string' },
                  user_agent: { type: 'string' },
                  created_at: { type: 'string' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                limit: { type: 'number' },
                total: { type: 'number' },
                totalPages: { type: 'number' },
                hasMore: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as CredentialAuditQuery;

    try {
      const page = Number(query.page) || 1;
      const limit = Math.min(Number(query.limit) || 50, 200);

      const { logs, total } = await credentialAuditService.query({
        ...query,
        page,
        limit,
      });

      const totalPages = Math.ceil(total / limit);

      return reply.send({
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to query credential audit logs');
      return reply.code(500).send({
        error: 'Failed to query credential audit logs',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/audit/credentials/stats
   *
   * Returns summary statistics for credential changes.
   */
  fastify.get('/api/admin/audit/credentials/stats', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['Admin - Credential Audit'],
      summary: 'Get credential audit statistics',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'number', default: 30 },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { days = 30 } = request.query as { days?: number };
      const since = new Date();
      since.setDate(since.getDate() - days);

      // Use the service query with date range to calculate stats
      const { logs, total } = await credentialAuditService.query({
        startDate: since.toISOString(),
        limit: 200,
        page: 1,
      });

      // Aggregate by action
      const byAction: Record<string, number> = {};
      const byEntityType: Record<string, number> = {};
      const byUser: Record<string, { count: number; email: string }> = {};

      for (const log of logs) {
        byAction[log.action] = (byAction[log.action] || 0) + 1;
        byEntityType[log.entity_type] = (byEntityType[log.entity_type] || 0) + 1;
        if (log.user_id) {
          if (!byUser[log.user_id]) {
            byUser[log.user_id] = { count: 0, email: log.user_email || 'unknown' };
          }
          byUser[log.user_id].count += 1;
        }
      }

      return reply.send({
        totalChanges: total,
        period: `${days} days`,
        byAction,
        byEntityType,
        topUsers: Object.entries(byUser)
          .map(([userId, data]) => ({ userId, email: data.email, changes: data.count }))
          .sort((a, b) => b.changes - a.changes)
          .slice(0, 10),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get credential audit stats');
      return reply.code(500).send({
        error: 'Failed to get credential audit statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};

export default adminCredentialAuditRoutes;
