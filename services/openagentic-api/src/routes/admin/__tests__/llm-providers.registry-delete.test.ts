/**
 * #507 — DELETE /api/admin/llm-providers/registry/:id removes a Registry row.
 *
 * Today the admin only has PATCH (toggle enabled). When a provider is
 * soft-deleted, its registry rows survive forever as orphans (provider_enabled
 * is false but the row still exists, polluting the Models page and confusing
 * the audit). The painfully scrutinous CRUD UAT (#505) surfaced this as a
 * permanent debt — admins need a hard-delete option to clean up.
 *
 * Contract:
 *   - DELETE /api/admin/llm-providers/registry/:id → 204 No Content on success
 *   - Calls prisma.modelRoleAssignment.delete({ where: { id } }) exactly once
 *   - DELETE on nonexistent id → 404 with { error: 'Registry row not found' }
 *
 * Unit-style test using prisma-mock — runs without a live database. The
 * sister llm-providers.registry-patch.test.ts uses the integration pattern
 * (real PrismaClient + DATABASE_URL); this file matches the lighter
 * ModelConfigurationService.self-heal.test.ts pattern so it runs in any
 * vitest invocation without port-forward gymnastics.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const prismaMock: any = {
  modelRoleAssignment: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  modelRoleAssignmentTombstone: {
    upsert: vi.fn(),
  },
  // Callback-form $transaction so the route's tx-scoped operations land on
  // the same prismaMock surface — easy to assert that BOTH writes happened.
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

describe('DELETE /api/admin/llm-providers/registry/:id (#507)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const llmProviderRoutes = (await import('../llm-providers.js')).default;
    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
      request.user = { id: 'test-admin-uuid' };
    });
    await app.register(llmProviderRoutes as any, { prefix: '/api/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.modelRoleAssignment.findUnique.mockReset();
    prismaMock.modelRoleAssignment.delete.mockReset();
    prismaMock.modelRoleAssignmentTombstone.upsert.mockReset();
    prismaMock.$transaction.mockClear();
    // Re-install callback impl after mockClear (mockClear wipes implementations).
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });

  it('DELETE returns 204 and removes the row', async () => {
    prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce({
      id: 'row-1',
      role: 'chat',
      model: 'gpt-oss:20b',
      provider: 'ollama-hal',
      enabled: true,
    });
    prismaMock.modelRoleAssignmentTombstone.upsert.mockResolvedValueOnce({});
    prismaMock.modelRoleAssignment.delete.mockResolvedValueOnce({ id: 'row-1' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/registry/row-1',
    });
    expect(res.statusCode).toBe(204);
    expect(prismaMock.modelRoleAssignment.delete).toHaveBeenCalledWith({
      where: { id: 'row-1' },
    });
  });

  it('DELETE on nonexistent id returns 404', async () => {
    prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/registry/missing-id',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/not found/i);
    expect(prismaMock.modelRoleAssignment.delete).not.toHaveBeenCalled();
    // No tombstone written for a 404
    expect(prismaMock.modelRoleAssignmentTombstone.upsert).not.toHaveBeenCalled();
  });

  // Registry SoT v1 (F2 C-4) — tombstone-on-DELETE protocol.
  it('writes a tombstone with the correct (provider_name, model, role) PK on success', async () => {
    prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce({
      id: 'row-2',
      role: 'embedding',
      model: 'nomic-embed-text',
      provider: 'ollama-bootstrap',
      enabled: true,
    });
    prismaMock.modelRoleAssignmentTombstone.upsert.mockResolvedValueOnce({});
    prismaMock.modelRoleAssignment.delete.mockResolvedValueOnce({ id: 'row-2' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/registry/row-2',
    });
    expect(res.statusCode).toBe(204);

    expect(prismaMock.modelRoleAssignmentTombstone.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = prismaMock.modelRoleAssignmentTombstone.upsert.mock.calls[0][0];
    expect(upsertCall.where.provider_name_model_role).toEqual({
      provider_name: 'ollama-bootstrap',
      model: 'nomic-embed-text',
      role: 'embedding',
    });
    expect(upsertCall.create).toMatchObject({
      provider_name: 'ollama-bootstrap',
      model: 'nomic-embed-text',
      role: 'embedding',
      deleted_by: 'test-admin-uuid',
    });
    // Update path must also exist (idempotent re-delete must not crash on PK
    // collision when admin re-added then re-deleted).
    expect(upsertCall.update).toBeDefined();
    expect(upsertCall.update.deleted_by).toBe('test-admin-uuid');
  });

  it('runs the tombstone write + row delete inside a single $transaction', async () => {
    prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce({
      id: 'row-3',
      role: 'code',
      model: 'gpt-oss:20b',
      provider: 'ollama-bootstrap',
      enabled: true,
    });
    prismaMock.modelRoleAssignmentTombstone.upsert.mockResolvedValueOnce({});
    prismaMock.modelRoleAssignment.delete.mockResolvedValueOnce({ id: 'row-3' });

    await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/registry/row-3',
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Both writes must have happened against the tx-scoped surface
    expect(prismaMock.modelRoleAssignmentTombstone.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.modelRoleAssignment.delete).toHaveBeenCalledTimes(1);
  });

  it('rolls back the row delete when the tombstone write fails', async () => {
    prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce({
      id: 'row-4',
      role: 'chat',
      model: 'gpt-oss:20b',
      provider: 'ollama-bootstrap',
      enabled: true,
    });
    // Tombstone write rejects → the route's catch handler must surface 500
    prismaMock.modelRoleAssignmentTombstone.upsert.mockRejectedValueOnce(new Error('boom'));

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/registry/row-4',
    });
    // 500 → the route surfaced the error rather than silently dropping the row
    expect(res.statusCode).toBe(500);
    // The row delete must NOT have been called (transaction never reached it)
    expect(prismaMock.modelRoleAssignment.delete).not.toHaveBeenCalled();
  });
});
