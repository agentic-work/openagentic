/**
 * F2.6 — Registry Tombstone admin endpoints
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F2.6)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * Tests:
 *  1. POST bad confirmation → 400 INVALID_CONFIRMATION
 *  2. POST short reason     → 400 REASON_TOO_SHORT
 *  3. POST correct input    → 200, deleteMany called, TOMBSTONE_RESET audit event created
 *  4. POST no auth user     → still 200 (auth is enforced by adminMiddleware preHandler
 *                             registered in admin.plugin.ts; this unit test stubs
 *                             request.user = undefined to confirm the handler tolerates
 *                             a null actor_id rather than crashing)
 *  5. GET returns count + tombstone list
 *  6. POST audit event hash chains from prior event
 *
 * Style: prismaMock unit-test matching sibling llm-providers.registry-delete.test.ts —
 * runs without a live database or port-forward.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Prisma mock — must be declared BEFORE vi.mock (hoisting)
// ---------------------------------------------------------------------------
const now = new Date('2026-05-01T12:00:00.000Z');

const prismaMock: any = {
  modelRoleAssignmentTombstone: {
    findMany: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  modelRegistryEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  // $transaction(callback) form — invoke callback with the same mock surface
  // so tx-scoped calls land on the same vi.fn() spies.
  $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
};

vi.mock('../../../utils/prisma.js', () => ({ prisma: prismaMock }));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CLUSTER_NAME = 'test-cluster';
const VALID_CONFIRMATION = `RESET-TOMBSTONES-${CLUSTER_NAME}`;
const VALID_REASON = 'Resetting for fresh bootstrap run after dev wipe';

const TOMBSTONE_ROWS = [
  {
    provider_name: 'ollama-hal',
    model: 'gpt-oss:20b',
    role: 'chat',
    deleted_at: now,
    deleted_by: 'admin-uuid-1',
  },
  {
    provider_name: 'bedrock',
    model: 'claude-3-sonnet',
    role: 'code',
    deleted_at: now,
    deleted_by: null,
  },
];

// ---------------------------------------------------------------------------
// Helpers: build app instances
// ---------------------------------------------------------------------------

async function buildApp(withAuth = true): Promise<FastifyInstance> {
  const routes = (await import('../registry-tombstones.js')).default;
  const app = Fastify({ logger: false });
  if (withAuth) {
    app.addHook('preHandler', async (request: any) => {
      request.user = { id: 'test-admin-uuid', email: 'admin@openagentic.io' };
    });
  }
  await app.register(routes as any, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/registry/tombstones', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.CLUSTER_NAME = CLUSTER_NAME;
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.modelRoleAssignmentTombstone.findMany.mockReset();
  });

  it('returns count and tombstone list', async () => {
    prismaMock.modelRoleAssignmentTombstone.findMany.mockResolvedValueOnce(TOMBSTONE_ROWS);

    const res = await app.inject({ method: 'GET', url: '/api/admin/registry/tombstones' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.tombstones).toHaveLength(2);
    expect(body.tombstones[0]).toMatchObject({
      provider_name: 'ollama-hal',
      model: 'gpt-oss:20b',
      role: 'chat',
      deleted_by: 'admin-uuid-1',
    });
    expect(body.tombstones[0].deleted_at).toBe(now.toISOString());
    expect(body.tombstones[1].deleted_by).toBeNull();
  });

  it('returns count=0 and empty array when no tombstones exist', async () => {
    prismaMock.modelRoleAssignmentTombstone.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/registry/tombstones' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.tombstones).toEqual([]);
  });
});

describe('POST /api/admin/registry/tombstones/reset', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.CLUSTER_NAME = CLUSTER_NAME;
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.modelRoleAssignmentTombstone.count.mockReset();
    prismaMock.modelRoleAssignmentTombstone.deleteMany.mockReset();
    prismaMock.modelRegistryEvent.findFirst.mockReset();
    prismaMock.modelRegistryEvent.create.mockReset();
    prismaMock.$transaction.mockClear();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });

  // ── 1. Bad confirmation ──────────────────────────────────────────────────
  it('returns 400 INVALID_CONFIRMATION when confirmation does not match', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { confirmation: 'WRONG', reason: VALID_REASON },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('INVALID_CONFIRMATION');
    // Masked — should NOT reveal actual cluster name in expected field
    expect(body.expected).toMatch(/RESET-TOMBSTONES-<cluster_name>/);
    expect(prismaMock.modelRoleAssignmentTombstone.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_CONFIRMATION when confirmation is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { reason: VALID_REASON },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_CONFIRMATION');
  });

  // ── 2. Short reason ──────────────────────────────────────────────────────
  it('returns 400 REASON_TOO_SHORT when reason is fewer than 10 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { confirmation: VALID_CONFIRMATION, reason: 'too short' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('REASON_TOO_SHORT');
    expect(prismaMock.modelRoleAssignmentTombstone.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 400 REASON_TOO_SHORT when reason is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { confirmation: VALID_CONFIRMATION },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('REASON_TOO_SHORT');
  });

  // ── 3. Happy path ────────────────────────────────────────────────────────
  it('returns 200, calls deleteMany, and creates TOMBSTONE_RESET audit event', async () => {
    prismaMock.modelRoleAssignmentTombstone.count.mockResolvedValueOnce(3);
    prismaMock.modelRoleAssignmentTombstone.deleteMany.mockResolvedValueOnce({ count: 3 });
    prismaMock.modelRegistryEvent.findFirst.mockResolvedValueOnce(null); // no prior events
    prismaMock.modelRegistryEvent.create.mockResolvedValueOnce({ id: BigInt(42) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { confirmation: VALID_CONFIRMATION, reason: VALID_REASON },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBe(3);
    expect(body.audit_event_id).toBe('42');

    // deleteMany must be called with empty filter
    expect(prismaMock.modelRoleAssignmentTombstone.deleteMany).toHaveBeenCalledWith({});

    // Audit event must have action='TOMBSTONE_RESET'
    expect(prismaMock.modelRegistryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TOMBSTONE_RESET',
          after_state: expect.objectContaining({
            count: 3,
            reason: VALID_REASON,
            admin_user_id: 'test-admin-uuid',
          }),
        }),
      }),
    );
  });

  // ── 4. Auth stub — null actor_id ─────────────────────────────────────────
  it('succeeds with null actor_id when request.user is absent (auth enforced by middleware)', async () => {
    // Build a separate app without the user preHandler hook to simulate
    // a missing user object. In production the adminMiddleware preHandler
    // rejects the request before it reaches the route handler. This test
    // verifies the handler itself does not crash on a missing user.
    const noAuthApp = await buildApp(false);

    prismaMock.modelRoleAssignmentTombstone.count.mockResolvedValueOnce(0);
    prismaMock.modelRoleAssignmentTombstone.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.modelRegistryEvent.findFirst.mockResolvedValueOnce(null);
    prismaMock.modelRegistryEvent.create.mockResolvedValueOnce({ id: BigInt(1) });

    const res = await noAuthApp.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { confirmation: VALID_CONFIRMATION, reason: VALID_REASON },
    });

    // Handler completes; actor_id stored as null
    expect(res.statusCode).toBe(200);
    expect(prismaMock.modelRegistryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actor_id: null }),
      }),
    );

    await noAuthApp.close();
  });

  // ── 6. Hash chaining ─────────────────────────────────────────────────────
  it('chains prev_hash from last audit event into the new event', async () => {
    const prevHash = 'abc123prevhash';

    prismaMock.modelRoleAssignmentTombstone.count.mockResolvedValueOnce(1);
    prismaMock.modelRoleAssignmentTombstone.deleteMany.mockResolvedValueOnce({ count: 1 });
    // findFirst returns a prior event with a known hash
    prismaMock.modelRegistryEvent.findFirst.mockResolvedValueOnce({ hash: prevHash });
    prismaMock.modelRegistryEvent.create.mockResolvedValueOnce({ id: BigInt(99) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { confirmation: VALID_CONFIRMATION, reason: VALID_REASON },
    });

    expect(res.statusCode).toBe(200);

    const createCall = prismaMock.modelRegistryEvent.create.mock.calls[0][0];
    expect(createCall.data.prev_hash).toBe(prevHash);
    // New hash must be a non-empty string derived from prev_hash
    expect(typeof createCall.data.hash).toBe('string');
    expect(createCall.data.hash.length).toBeGreaterThan(0);
    expect(createCall.data.hash).not.toBe(prevHash);
  });

  it('sets prev_hash to null when no prior events exist', async () => {
    prismaMock.modelRoleAssignmentTombstone.count.mockResolvedValueOnce(0);
    prismaMock.modelRoleAssignmentTombstone.deleteMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.modelRegistryEvent.findFirst.mockResolvedValueOnce(null);
    prismaMock.modelRegistryEvent.create.mockResolvedValueOnce({ id: BigInt(1) });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/registry/tombstones/reset',
      payload: { confirmation: VALID_CONFIRMATION, reason: VALID_REASON },
    });

    expect(res.statusCode).toBe(200);
    const createCall = prismaMock.modelRegistryEvent.create.mock.calls[0][0];
    expect(createCall.data.prev_hash).toBeNull();
  });
});
