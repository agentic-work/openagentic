/**
 * Test G — GET /api/admin/audit-log (paged, filterable, admin-guarded).
 *
 * Mirrors admin-flow-audit.test.ts inject pattern. Mocks prisma + adminMiddleware.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../utils/logger.js', () => {
  const noop: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  noop.child = () => noop;
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

const { findManyMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    toolCallAuditLog: { findMany: findManyMock, count: countMock },
  },
}));

const { adminAllowMock } = vi.hoisted(() => ({
  adminAllowMock: vi.fn(async (_req: any, _rep: any) => {}),
}));

vi.mock('../../middleware/unifiedAuth.js', () => ({
  adminMiddleware: adminAllowMock,
  unifiedAuthHook: vi.fn(),
}));

import adminAuditLogRoutes from '../admin-audit-log.js';

const ROWS = [
  { id: 'r1', tool_name: 'kubectl_delete_pod', classification: 'MUTATING', decision: 'pending', created_at: new Date('2026-05-30T09:00:00Z') },
  { id: 'r2', tool_name: 'list_pods', classification: 'READ', decision: 'auto', created_at: new Date('2026-05-30T08:00:00Z') },
];

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  adminAllowMock.mockImplementation(async () => {});
  findManyMock.mockResolvedValue(ROWS);
  countMock.mockResolvedValue(2);
  app = Fastify();
  await app.register(adminAuditLogRoutes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/admin/audit-log', () => {
  it('200 with data + pagination, ordered created_at desc, default page/limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-log?page=1&limit=50' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toMatchObject({ page: 1, limit: 50, total: 2 });
    expect(body.pagination.totalPages).toBe(1);
    expect(body.pagination).toHaveProperty('hasMore');
    const arg = findManyMock.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ created_at: 'desc' });
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(50);
  });

  it('applies decision / classification / tool_name / user_id filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-log?decision=pending&classification=MUTATING&tool_name=delete&user_id=u1',
    });
    expect(res.statusCode).toBe(200);
    const where = findManyMock.mock.calls[0][0].where;
    expect(where.decision).toBe('pending');
    expect(where.classification).toBe('MUTATING');
    expect(where.tool_name).toEqual({ contains: 'delete' });
    expect(where.user_id).toBe('u1');
  });

  it('clamps limit to 100', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-log?limit=500' });
    expect(res.statusCode).toBe(200);
    expect(findManyMock.mock.calls[0][0].take).toBe(100);
  });

  it('403 for non-admin', async () => {
    adminAllowMock.mockImplementation(async (_req: any, rep: any) => {
      rep.status(403).send({ error: 'forbidden' });
    });
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-log' });
    expect(res.statusCode).toBe(403);
  });
});
