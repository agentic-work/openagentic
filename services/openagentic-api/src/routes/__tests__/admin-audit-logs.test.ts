/**
 * Admin Unified Audit Logs Route — TDD spec for /api/admin/audit-logs.
 *
 *   GET /audit-logs           → { success, logs, pagination }   (unified feed)
 *   GET /audit-logs/stats     → { success, admin, user, byType, byOutcome }
 *   GET /audit-logs/errors    → { success, errors }             (success=false)
 *   GET /audit-logs/sessions  → { success, sessions }           (chat_sessions)
 *   GET /audit-logs/export    → text/csv                        (filtered feed)
 *
 * The aggregator (queryActivity/activityStats) is mocked — its UNION SQL is
 * covered by its own unit test. Here we lock the route wiring: filter→param
 * mapping, response shapes the UI consumes, and the CSV export.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Logger stub ─────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => {
  const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  cat.child = () => cat;
  const loggers: Record<string, any> = {};
  for (const c of ['server', 'admin', 'routes', 'database', 'services']) loggers[c] = cat;
  return { default: cat, logger: cat, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ── Aggregator stub ─────────────────────────────────────────────────────────
const { queryActivityMock, activityStatsMock } = vi.hoisted(() => ({
  queryActivityMock: vi.fn(),
  activityStatsMock: vi.fn(),
}));
vi.mock('../../services/audit/activityAggregator.js', () => ({
  queryActivity: queryActivityMock,
  activityStats: activityStatsMock,
}));

// ── Prisma stub (chat_sessions + userQueryAudit.count) ──────────────────────
const { sessionFindMany, sessionCount, uqaCount } = vi.hoisted(() => ({
  sessionFindMany: vi.fn(),
  sessionCount: vi.fn(),
  uqaCount: vi.fn(),
}));
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    chatSession: { findMany: sessionFindMany, count: sessionCount },
    userQueryAudit: { count: uqaCount },
  },
}));

// ── Admin middleware — pass-through ─────────────────────────────────────────
vi.mock('../../middleware/unifiedAuth.js', () => ({
  adminMiddleware: vi.fn(async () => {}),
  unifiedAuthHook: vi.fn(),
}));

import adminAuditLogsRoutes from '../admin-audit-logs.js';

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    type: 'user',
    userId: 'u1',
    userName: 'Ada',
    userEmail: 'ada@x.io',
    action: 'chat',
    resourceType: null,
    resourceId: null,
    query: 'hi',
    intent: null,
    sessionId: 's1',
    messageId: null,
    mcpServer: null,
    toolsCalled: [],
    success: true,
    error: null,
    ipAddress: '127.0.0.1',
    timestamp: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

const PAGINATION = { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false };

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(adminAuditLogsRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

beforeEach(() => {
  queryActivityMock.mockReset();
  activityStatsMock.mockReset();
  sessionFindMany.mockReset();
  sessionCount.mockReset();
  uqaCount.mockReset();
  queryActivityMock.mockResolvedValue({ data: [entry()], pagination: PAGINATION });
  activityStatsMock.mockResolvedValue({
    total: 3,
    byType: { user: 2, admin: 1 },
    byOutcome: { success: 2, error: 1 },
  });
  uqaCount.mockResolvedValue(0);
});

describe('GET /api/admin/audit-logs', () => {
  it('returns the unified feed as { success, logs, pagination }', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs?page=1&limit=50&logType=all' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs[0].id).toBe('e1');
    expect(body.pagination.total).toBe(1);
    await app.close();
  });

  it('maps logType=admin → types:[admin] and resourceType/date filters through', async () => {
    const app = await build();
    await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?logType=admin&resourceType=LLMProvider&startDate=2026-05-01T00:00:00Z',
    });
    const arg = queryActivityMock.mock.calls[0][0];
    expect(arg.types).toEqual(['admin']);
    expect(arg.resourceType).toBe('LLMProvider');
    expect(arg.startDate).toBe('2026-05-01T00:00:00Z');
    await app.close();
  });

  it('maps logType=user → types include user + tool-call', async () => {
    const app = await build();
    await app.inject({ method: 'GET', url: '/api/admin/audit-logs?logType=user' });
    expect(queryActivityMock.mock.calls[0][0].types).toEqual(['user', 'tool-call']);
    await app.close();
  });

  it('returns 500 with empty logs when the aggregator throws', async () => {
    queryActivityMock.mockRejectedValueOnce(new Error('boom'));
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs' });
    expect(res.statusCode).toBe(500);
    expect(res.json().logs).toEqual([]);
    await app.close();
  });
});

describe('GET /api/admin/audit-logs/stats', () => {
  it('returns admin/user KPI shape + byType/byOutcome', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.admin).toBeDefined();
    expect(body.user).toBeDefined();
    expect(body.byOutcome.error).toBe(1);
    expect(typeof body.user.failedQueries24h).toBe('number');
    await app.close();
  });
});

describe('GET /api/admin/audit-logs/errors', () => {
  it('forces success:false and maps to the ErrorRow shape', async () => {
    queryActivityMock.mockResolvedValueOnce({
      data: [entry({ success: false, error: 'denied', type: 'tool-call', action: 'aws_delete' })],
      pagination: PAGINATION,
    });
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs/errors?page=1&limit=50' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(queryActivityMock.mock.calls[0][0].success).toBe(false);
    expect(body.errors[0].errorMessage).toBe('denied');
    expect(body.errors[0].queryType).toBe('aws_delete');
    await app.close();
  });
});

describe('GET /api/admin/audit-logs/sessions', () => {
  it('returns chat sessions joined to user', async () => {
    sessionFindMany.mockResolvedValueOnce([
      {
        id: 'sess-1',
        user_id: 'u1',
        title: 'debugging pods',
        model: 'auto',
        message_count: 4,
        total_tokens: 1200,
        total_cost: { toString: () => '0.0123' },
        created_at: new Date('2026-06-01T00:00:00Z'),
        updated_at: new Date('2026-06-01T01:00:00Z'),
        user: { name: 'Ada', email: 'ada@x.io' },
      },
    ]);
    sessionCount.mockResolvedValueOnce(1);
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions[0].id).toBe('sess-1');
    expect(body.sessions[0].userEmail).toBe('ada@x.io');
    expect(body.sessions[0].messageCount).toBe(4);
    await app.close();
  });
});

describe('GET /api/admin/audit-logs/export', () => {
  it('streams CSV with a header row and the filtered entries', async () => {
    queryActivityMock.mockResolvedValueOnce({
      data: [entry({ action: 'a,b', error: 'oops "quoted"' })],
      pagination: PAGINATION,
    });
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs/export?format=csv&logType=all' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.body;
    expect(text.split('\n')[0]).toContain('timestamp');
    // CSV-escaped comma + quote
    expect(text).toContain('"a,b"');
    expect(text).toContain('"oops ""quoted"""');
    await app.close();
  });
});
