/**
 * Admin Tool-Call Audit Log Route — GET /api/admin/audit-log
 *
 * Paged, filterable, admin-guarded read of the append-only tool_call_audit_log.
 * Surfaces EVERY tool call (READ auto-audited + MUTATING approval decisions).
 * Mirrors admin-messages.ts (paged GET) + admin-mcp-logs.ts (per-route
 * onRequest: adminMiddleware). Registered with prefix /api/admin so the final
 * URL is /api/admin/audit-log.
 */
import type { FastifyInstance } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';

export default async function adminAuditLogRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      decision?: string;
      classification?: string;
      tool_name?: string;
      user_id?: string;
    };
  }>('/audit-log', { onRequest: adminMiddleware }, async (request, reply) => {
    const q = request.query;
    const page = Math.max(Number.parseInt(q.page ?? '1', 10) || 1, 1);
    const limit = Math.min(Number.parseInt(q.limit ?? '50', 10) || 50, 100);

    const where: Record<string, unknown> = {};
    if (q.decision) where.decision = q.decision;
    if (q.classification) where.classification = q.classification;
    if (q.tool_name) where.tool_name = { contains: q.tool_name };
    if (q.user_id) where.user_id = q.user_id;

    const [rows, total] = await Promise.all([
      prisma.toolCallAuditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.toolCallAuditLog.count({ where }),
    ]);

    return reply.send({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  });
}
