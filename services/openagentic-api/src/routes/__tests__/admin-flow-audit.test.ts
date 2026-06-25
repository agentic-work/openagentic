/**
 * Admin Flow Audit Log Route — TDD spec.
 *
 * A9.  GET /api/admin/flows/audit-logs?action=...&actor=...&from=...&to=...&limit=100
 *       → paginated list ordered by ts desc
 * A10. GET /api/admin/flows/audit-logs.csv → CSV export
 * A11. Admin auth required
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Logger stub
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const noop: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------------------------------------------------------------------------
// Prisma stub
// ---------------------------------------------------------------------------
const { findManyMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    flowAuditLog: {
      findMany: findManyMock,
      count: countMock,
    },
  },
}));

// ---------------------------------------------------------------------------
// Admin middleware stub — pass-through for tests
// ---------------------------------------------------------------------------
vi.mock('../../middleware/unifiedAuth.js', () => ({
  adminMiddleware: vi.fn().mockImplementation(async (_req: any, _rep: any) => {
    // no-op — allow all test requests through
  }),
  unifiedAuthHook: vi.fn(),
}));

import adminFlowAuditRoutes from '../admin-flow-audit.js';

// ---------------------------------------------------------------------------
// Sample rows
// ---------------------------------------------------------------------------
const ROWS = [
  {
    id: 'r1', ts: new Date('2026-04-25T09:00:00Z'),
    action: 'integration.create', target_type: 'integration', target_id: 'int-1',
    outcome: 'success', actor_user_id: 'u1', actor_user_email: 'alice@example.com',
    actor_ip: '10.0.0.1', metadata: {},
  },
  {
    id: 'r2', ts: new Date('2026-04-25T08:00:00Z'),
    action: 'secret.acl_denied', target_type: 'secret', target_id: 'sec-1',
    outcome: 'denied', actor_user_id: 'u2', actor_user_email: 'bob@example.com',
    actor_ip: '10.0.0.2', metadata: { reason: 'node_type_mismatch' },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin Flow Audit Log routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue(ROWS);
    countMock.mockResolvedValue(2);

    app = Fastify();
    await app.register(adminFlowAuditRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // A9 — list ----------------------------------------------------------------

  it('A9: GET /api/admin/flows/audit-logs returns 200 with rows array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBe(2);
  });

  it('A9: accepts ?action= filter and passes it to prisma', async () => {
    findManyMock.mockResolvedValue([ROWS[0]]);
    countMock.mockResolvedValue(1);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs?action=integration.create',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);

    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.where.action).toBe('integration.create');
  });

  it('A9: accepts ?actor= filter for actor_user_email/id search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs?actor=alice%40example.com',
    });
    expect(res.statusCode).toBe(200);
    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.where).toMatchObject(
      expect.objectContaining({ actor_user_email: { contains: 'alice@example.com', mode: 'insensitive' } }),
    );
  });

  it('A9: accepts ?from= and ?to= date filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs?from=2026-04-25T00:00:00Z&to=2026-04-25T23:59:59Z',
    });
    expect(res.statusCode).toBe(200);
    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.where.ts).toBeDefined();
    expect(callArg.where.ts.gte).toBeDefined();
    expect(callArg.where.ts.lte).toBeDefined();
  });

  it('A9: respects ?limit= parameter (capped at 1000)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs?limit=50',
    });
    expect(res.statusCode).toBe(200);
    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.take).toBe(50);
  });

  it('A9: rows are ordered by ts desc', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs',
    });
    expect(res.statusCode).toBe(200);
    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.orderBy).toMatchObject({ ts: 'desc' });
  });

  // A10 — CSV ----------------------------------------------------------------

  it('A10: GET /api/admin/flows/audit-logs.csv returns text/csv', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs.csv',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const csv = res.body;
    expect(csv).toContain('ts,action,target_type');
    expect(csv).toContain('integration.create');
  });

  it('A10: CSV filename is set via Content-Disposition header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/flows/audit-logs.csv',
    });
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');
  });

  // A11 — auth ---------------------------------------------------------------

  it('A11: admin middleware is called for audit-logs endpoint', async () => {
    const { adminMiddleware } = await import('../../middleware/unifiedAuth.js');
    await app.inject({ method: 'GET', url: '/api/admin/flows/audit-logs' });
    expect(vi.mocked(adminMiddleware)).toHaveBeenCalled();
  });

  it('A11: admin middleware is called for csv endpoint', async () => {
    const { adminMiddleware } = await import('../../middleware/unifiedAuth.js');
    await app.inject({ method: 'GET', url: '/api/admin/flows/audit-logs.csv' });
    expect(vi.mocked(adminMiddleware)).toHaveBeenCalled();
  });
});
