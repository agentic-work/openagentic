/**
 * Admin Flow Audit Log Routes
 *
 * SOC 2 CC6/CC7 — paginated list + CSV export of FlowAuditLog rows.
 *
 * Endpoints:
 *   GET /api/admin/flows/audit-logs           — paginated list with filtering
 *   GET /api/admin/flows/audit-logs.csv       — CSV export
 *
 * All endpoints require admin authentication.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes.child({ component: 'AdminFlowAudit' });

const adminFlowAuditRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Shared query parser ──────────────────────────────────────────────────

  function buildWhere(query: Record<string, any>) {
    const where: Record<string, any> = {};

    if (query.action) {
      where.action = query.action;
    }
    if (query.actor) {
      where.actor_user_email = { contains: query.actor, mode: 'insensitive' };
    }
    if (query.outcome) {
      where.outcome = query.outcome;
    }
    if (query.target_type) {
      where.target_type = query.target_type;
    }
    if (query.from || query.to) {
      where.ts = {};
      if (query.from) where.ts.gte = new Date(query.from as string);
      if (query.to)   where.ts.lte = new Date(query.to as string);
    }

    return where;
  }

  // ── GET /api/admin/flows/audit-logs ─────────────────────────────────────

  fastify.get(
    '/api/admin/flows/audit-logs',
    { onRequest: adminMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, any>;
      const limit = Math.min(parseInt(query.limit ?? '100', 10), 1000);
      const offset = parseInt(query.offset ?? '0', 10);

      const where = buildWhere(query);

      try {
        const [rows, total] = await Promise.all([
          prisma.flowAuditLog.findMany({
            where,
            orderBy: { ts: 'desc' },
            take: limit,
            skip: offset,
          }),
          prisma.flowAuditLog.count({ where }),
        ]);

        reply.send({
          data: rows,
          pagination: {
            limit,
            offset,
            total,
          },
        });
      } catch (err: any) {
        logger.error({ err }, '[FlowAudit] Failed to list audit logs');
        reply.code(500).send({ error: 'Failed to list audit logs', message: err.message });
      }
    },
  );

  // ── GET /api/admin/flows/audit-logs.csv ─────────────────────────────────

  fastify.get(
    '/api/admin/flows/audit-logs.csv',
    { onRequest: adminMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, any>;
      const limit = Math.min(parseInt(query.limit ?? '10000', 10), 50000);
      const where = buildWhere(query);

      try {
        const rows = await prisma.flowAuditLog.findMany({
          where,
          orderBy: { ts: 'desc' },
          take: limit,
        });

        const csvHeader = 'ts,action,target_type,target_id,outcome,actor_user_id,actor_user_email,actor_ip,metadata';
        const csvRows = rows.map((r) => [
          r.ts.toISOString(),
          r.action,
          r.target_type,
          r.target_id ?? '',
          r.outcome,
          r.actor_user_id ?? '',
          r.actor_user_email ?? '',
          r.actor_ip ?? '',
          `"${JSON.stringify(r.metadata).replace(/"/g, '""')}"`,
        ].join(','));

        const csv = [csvHeader, ...csvRows].join('\n');
        const filename = `flow-audit-logs-${new Date().toISOString().split('T')[0]}.csv`;

        reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(csv);
      } catch (err: any) {
        logger.error({ err }, '[FlowAudit] Failed to export audit logs CSV');
        reply.code(500).send({ error: 'Failed to export audit logs', message: err.message });
      }
    },
  );
};

export default adminFlowAuditRoutes;
