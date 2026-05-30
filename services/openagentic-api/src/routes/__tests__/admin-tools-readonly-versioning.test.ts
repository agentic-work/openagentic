/**
 * Admin Tools — optimistic concurrency RED tests (Phase 1.4 admin overhaul §11.5)
 *
 * Spec:
 *   GET  /api/admin/tools/readonly  → returns { enabled, source, version, updated_at, updated_by }
 *   POST /api/admin/tools/readonly  → body { enabled, version }
 *     - if version matches current row: UPDATE … RETURNING bumped row, return 200
 *     - if version stale: return 409 with body { error, currentRow, conflictingFields }
 *     - if version omitted: return 400 (clients MUST send version once a row exists)
 *
 * The kill switch is the §6 SoT gold standard — if the contract works here it
 * sets the bar for every other admin-write endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------- Logger stub ----------
vi.mock('../../utils/logger.js', () => {
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const noop: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------- Prisma stub ----------
const { findUniqueMock, executeRawMock, queryRawMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  executeRawMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: { findUnique: findUniqueMock },
    $executeRaw: executeRawMock,
    $queryRaw: queryRawMock,
  },
}));

// Now import the route under test (after mocks).
import adminToolsRoutes from '../admin-tools.js';

let app: FastifyInstance;

beforeEach(async () => {
  findUniqueMock.mockReset();
  executeRawMock.mockReset();
  queryRawMock.mockReset();
  app = Fastify();
  // Inject a stub user on every request (matches what unifiedAuth would set).
  app.addHook('onRequest', async (req: any) => {
    req.user = { userId: '00000000-0000-0000-0000-000000000001' };
  });
  await app.register(adminToolsRoutes, { prefix: '/api/admin' });
});
afterEach(async () => { await app.close(); });

describe('GET /api/admin/tools/readonly', () => {
  it('returns version + updated_at + updated_by alongside the boolean state', async () => {
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly',
      value: { enabled: true, changedBy: 'u1', changedAt: '2026-05-05T01:00:00.000Z' },
      description: null,
      is_active: true,
      created_at: new Date('2026-05-04T00:00:00.000Z'),
      updated_at: new Date('2026-05-05T01:00:00.000Z'),
      version: 7n,
      updated_by: '00000000-0000-0000-0000-000000000001',
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/tools/readonly' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      enabled: true,
      source: 'database',
      version: 7,
      updated_by: '00000000-0000-0000-0000-000000000001',
    });
    expect(typeof body.updated_at).toBe('string');
  });

  it('returns version: 0 when the row does not exist (env / default fallback)', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'GET', url: '/api/admin/tools/readonly' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.source).toBe('default');
    expect(body.version).toBe(0); // sentinel — first POST must use version=0 to seed
  });
});

describe('POST /api/admin/tools/readonly — happy path', () => {
  it('rejects body without version when row already exists', async () => {
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly',
      value: { enabled: false }, version: 3n, updated_at: new Date(), updated_by: null,
      description: null, is_active: true, created_at: new Date(),
    });
    const res = await app.inject({
      method: 'POST', url: '/api/admin/tools/readonly',
      payload: { enabled: true }, // version missing
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/version/i);
  });

  it('accepts the change and bumps version when client version matches', async () => {
    // Initial read returns version 3
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly',
      value: { enabled: false }, version: 3n, updated_at: new Date('2026-05-04T00:00:00.000Z'), updated_by: null,
      description: null, is_active: true, created_at: new Date(),
    });
    // UPDATE returns 1 row affected (version matched).
    executeRawMock.mockResolvedValueOnce(1);
    // After the write, the read returns the bumped row.
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly',
      value: { enabled: true, changedBy: '00000000-0000-0000-0000-000000000001' },
      version: 4n, updated_at: new Date('2026-05-05T01:00:00.000Z'),
      updated_by: '00000000-0000-0000-0000-000000000001',
      description: null, is_active: true, created_at: new Date(),
    });

    const res = await app.inject({
      method: 'POST', url: '/api/admin/tools/readonly',
      payload: { enabled: true, version: 3 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.version).toBe(4);
    expect(body.source).toBe('database');
  });

  it('seeds the row on first write when no row exists (version=0 sentinel)', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    executeRawMock.mockResolvedValueOnce(1);
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly',
      value: { enabled: true }, version: 1n, updated_at: new Date(), updated_by: '00000000-0000-0000-0000-000000000001',
      description: null, is_active: true, created_at: new Date(),
    });
    const res = await app.inject({
      method: 'POST', url: '/api/admin/tools/readonly',
      payload: { enabled: true, version: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(1);
  });
});

describe('POST /api/admin/tools/readonly — 409 conflict', () => {
  it('returns 409 with currentRow + conflictingFields when client version is stale', async () => {
    // Client thinks it's at version 3, but the DB is at version 7.
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly',
      value: { enabled: false, changedBy: 'someone-else' },
      version: 7n, updated_at: new Date('2026-05-05T00:30:00.000Z'),
      updated_by: '00000000-0000-0000-0000-000000000099',
      description: null, is_active: true, created_at: new Date(),
    });
    // UPDATE returns 0 because WHERE version = 3 didn't match.
    executeRawMock.mockResolvedValueOnce(0);
    // Re-read to attach the current row to the 409 body.
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly',
      value: { enabled: false, changedBy: 'someone-else' },
      version: 7n, updated_at: new Date('2026-05-05T00:30:00.000Z'),
      updated_by: '00000000-0000-0000-0000-000000000099',
      description: null, is_active: true, created_at: new Date(),
    });

    const res = await app.inject({
      method: 'POST', url: '/api/admin/tools/readonly',
      payload: { enabled: true, version: 3 },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toMatch(/conflict/i);
    expect(body.currentRow).toMatchObject({
      enabled: false,
      version: 7,
      updated_by: '00000000-0000-0000-0000-000000000099',
    });
    expect(body.conflictingFields).toEqual(expect.arrayContaining(['enabled']));
  });

  it('does NOT bump version on 409', async () => {
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly', value: { enabled: false }, version: 7n,
      updated_at: new Date(), updated_by: null,
      description: null, is_active: true, created_at: new Date(),
    });
    executeRawMock.mockResolvedValueOnce(0);
    findUniqueMock.mockResolvedValueOnce({
      key: 'mcp_tools_readonly', value: { enabled: false }, version: 7n,
      updated_at: new Date(), updated_by: null,
      description: null, is_active: true, created_at: new Date(),
    });
    const res = await app.inject({
      method: 'POST', url: '/api/admin/tools/readonly',
      payload: { enabled: true, version: 3 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().currentRow.version).toBe(7); // not 8
  });
});
