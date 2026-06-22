/**
 * Admin Unified Audit Logs Route — /api/admin/audit-logs (plural).
 *
 * The DEAD AuditLogsPage (sidebar "Audit Logs") calls five endpoints that did
 * not exist. This route implements all of them on top of the activityAggregator
 * (one UNION ALL across every audit source table), plus a chat-session feed:
 *
 *   GET /api/admin/audit-logs               main unified feed  → { success, logs, pagination }
 *   GET /api/admin/audit-logs/stats         counts over range  → { success, admin, user, byType, byOutcome, total }
 *   GET /api/admin/audit-logs/errors        failures only      → { success, errors, pagination }
 *   GET /api/admin/audit-logs/sessions      chat sessions      → { success, sessions, pagination }
 *   GET /api/admin/audit-logs/export        CSV of the filter  → text/csv stream
 *
 * Admin-guarded per-route via onRequest: adminMiddleware (same pattern as the
 * singular admin-audit-log.ts). Registered under prefix /api/admin so the final
 * URLs are /api/admin/audit-logs[...]. See server.ts mount.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import {
  queryActivity,
  activityStats,
  type ActivityType,
  type AuditLogEntry,
  type QueryActivityParams,
} from '../services/audit/activityAggregator.js';

const log = loggers.admin;

// The UI's logType maps to scope: all | admin | user. `admin` and `user` are
// the two scopes the page's chips expose; everything else surfaces under `all`.
const SCOPE_TYPES: Record<string, ActivityType[] | undefined> = {
  all: undefined,
  admin: ['admin'],
  user: ['user', 'tool-call'],
};

interface FeedQuery {
  page?: string;
  limit?: string;
  logType?: string; // all | admin | user
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  success?: string; // 'true' | 'false'
  actor?: string;
  searchTerm?: string;
  format?: string; // export
}

function parsePaging(q: FeedQuery, defLimit = 50, maxLimit = 200) {
  const page = Math.max(Number.parseInt(q.page ?? '1', 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(q.limit ?? String(defLimit), 10) || defLimit, 1), maxLimit);
  return { page, limit };
}

function paramsFromQuery(q: FeedQuery, page: number, limit: number): QueryActivityParams {
  const types = SCOPE_TYPES[q.logType ?? 'all'];
  const params: QueryActivityParams = { page, limit, types };
  if (q.resourceType) params.resourceType = q.resourceType;
  if (q.startDate) params.startDate = q.startDate;
  if (q.endDate) params.endDate = q.endDate;
  if (q.success === 'true') params.success = true;
  else if (q.success === 'false') params.success = false;
  if (q.actor || q.searchTerm) params.actor = q.actor ?? q.searchTerm;
  return params;
}

const CSV_COLUMNS: (keyof AuditLogEntry)[] = [
  'timestamp',
  'type',
  'userId',
  'userName',
  'userEmail',
  'action',
  'resourceType',
  'resourceId',
  'mcpServer',
  'sessionId',
  'success',
  'error',
  'ipAddress',
  'query',
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  const escaped = s.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function streamCsv(reply: FastifyReply, rows: AuditLogEntry[]) {
  const header = CSV_COLUMNS.join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  const csv = [header, ...body].join('\n');
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`)
    .send(csv);
}

export default async function adminAuditLogsRoutes(fastify: FastifyInstance) {
  // ── Main unified feed ──────────────────────────────────────────────────────
  fastify.get<{ Querystring: FeedQuery }>(
    '/audit-logs',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      const { page, limit } = parsePaging(request.query);
      try {
        const result = await queryActivity(paramsFromQuery(request.query, page, limit));
        // The UI reads `logs`; also include `data` for parity with the singular route.
        return reply.send({
          success: true,
          logs: result.data,
          data: result.data,
          pagination: result.pagination,
        });
      } catch (error) {
        log.error({ err: error }, '[AUDIT-LOGS] feed query failed');
        return reply.code(500).send({ success: false, error: 'audit feed query failed', logs: [] });
      }
    },
  );

  // ── Stats (counts by type + outcome over the range) ────────────────────────
  fastify.get<{ Querystring: FeedQuery }>(
    '/audit-logs/stats',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      const q = request.query;
      try {
        const stats = await activityStats({ startDate: q.startDate, endDate: q.endDate });
        // 24h + 7d windows for the KPI cards the page renders.
        const now = Date.now();
        const since24h = new Date(now - 86_400_000).toISOString();
        const since7d = new Date(now - 7 * 86_400_000).toISOString();
        const [s24, s7] = await Promise.all([
          activityStats({ startDate: since24h }),
          activityStats({ startDate: since7d }),
        ]);
        const adminRecent24h = s24.byType.admin ?? 0;
        const userRecent24h = (s24.byType.user ?? 0) + (s24.byType['tool-call'] ?? 0);
        return reply.send({
          success: true,
          total: stats.total,
          byType: stats.byType,
          byOutcome: stats.byOutcome,
          // Shape the page's AuditStats interface consumes:
          admin: {
            totalActions: stats.byType.admin ?? 0,
            recent24h: adminRecent24h,
            recent7d: s7.byType.admin ?? 0,
          },
          user: {
            totalQueries: (stats.byType.user ?? 0) + (stats.byType['tool-call'] ?? 0),
            recent24h: userRecent24h,
            failedQueries24h: await failedUserQueries24h(since24h),
          },
        });
      } catch (error) {
        log.error({ err: error }, '[AUDIT-LOGS] stats query failed');
        return reply.code(500).send({ success: false, error: 'audit stats query failed' });
      }
    },
  );

  // ── Errors-only feed (success=false across all sources) ─────────────────────
  fastify.get<{ Querystring: FeedQuery }>(
    '/audit-logs/errors',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      const { page, limit } = parsePaging(request.query);
      try {
        const result = await queryActivity({
          ...paramsFromQuery(request.query, page, limit),
          success: false,
        });
        // The page's ErrorRow shape — map the unified entry onto it.
        const errors = result.data.map((e) => ({
          id: e.id,
          userId: e.userId ?? undefined,
          userName: e.userName ?? undefined,
          userEmail: e.userEmail ?? undefined,
          query: e.query ?? undefined,
          queryType: e.action ?? undefined,
          errorMessage: e.error ?? undefined,
          errorCode: e.type,
          sessionId: e.sessionId ?? undefined,
          messageId: e.messageId ?? undefined,
          ipAddress: e.ipAddress ?? undefined,
          timestamp: e.timestamp,
        }));
        return reply.send({ success: true, errors, pagination: result.pagination });
      } catch (error) {
        log.error({ err: error }, '[AUDIT-LOGS] errors query failed');
        return reply.code(500).send({ success: false, error: 'audit errors query failed', errors: [] });
      }
    },
  );

  // ── Chat sessions feed ──────────────────────────────────────────────────────
  fastify.get<{ Querystring: FeedQuery }>(
    '/audit-logs/sessions',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      const { page, limit } = parsePaging(request.query);
      const q = request.query;
      try {
        const where: Record<string, unknown> = {};
        if (q.startDate || q.endDate) {
          const created: Record<string, Date> = {};
          if (q.startDate) created.gte = new Date(q.startDate);
          if (q.endDate) created.lte = new Date(q.endDate);
          where.created_at = created;
        }
        const [rows, total] = await Promise.all([
          prisma.chatSession.findMany({
            where,
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: { user: { select: { name: true, email: true } } },
          }),
          prisma.chatSession.count({ where }),
        ]);
        const sessions = rows.map((s) => ({
          id: s.id,
          userId: s.user_id,
          userName: s.user?.name ?? undefined,
          userEmail: s.user?.email ?? undefined,
          title: s.title ?? undefined,
          messageCount: s.message_count,
          model: s.model ?? undefined,
          totalTokens: s.total_tokens,
          totalCost: s.total_cost?.toString?.() ?? null,
          createdAt: s.created_at.toISOString(),
          updatedAt: s.updated_at?.toISOString(),
        }));
        return reply.send({
          success: true,
          sessions,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(Math.ceil(total / limit), 1),
            hasMore: page * limit < total,
          },
        });
      } catch (error) {
        log.error({ err: error }, '[AUDIT-LOGS] sessions query failed');
        return reply.code(500).send({ success: false, error: 'audit sessions query failed', sessions: [] });
      }
    },
  );

  // ── CSV export of the current filter ────────────────────────────────────────
  fastify.get<{ Querystring: FeedQuery }>(
    '/audit-logs/export',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      const q = request.query;
      try {
        // Export is a single large page (capped) of the filtered feed.
        const result = await queryActivity(paramsFromQuery(q, 1, 200));
        if ((q.format ?? 'csv').toLowerCase() === 'json') {
          return reply
            .header('Content-Type', 'application/json')
            .header('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.json"`)
            .send(JSON.stringify(result.data, null, 2));
        }
        return streamCsv(reply, result.data);
      } catch (error) {
        log.error({ err: error }, '[AUDIT-LOGS] export failed');
        return reply.code(500).send({ success: false, error: 'audit export failed' });
      }
    },
  );
}

/** Count failed user_query_audit rows in the last 24h (the page's KPI). */
async function failedUserQueries24h(since: string): Promise<number> {
  try {
    return await prisma.userQueryAudit.count({
      where: { success: false, created_at: { gte: new Date(since) } },
    });
  } catch {
    return 0;
  }
}
