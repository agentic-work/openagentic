/**
 * M11 contract test — DELETE /api/admin/multi-model/roles/:id MUST write a
 * tombstone before removing the live row, mirroring the canonical pattern
 * in routes/admin/llm-providers.ts:440-461.
 *
 * Without the tombstone, lifecycle controllers (#508 Phase 1) resurrect the
 * deleted assignment on the next discovery sync. The bug was that this
 * route did a bare `prisma.modelRoleAssignment.delete()` with no tombstone
 * write — a registry-bypass even though it WROTE to the registry table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const tombstoneUpsertCalls: any[] = [];
const roleDeleteCalls: any[] = [];
let storedRow: any = {
  id: 'role-1',
  role: 'chat',
  model: 'test-model',
  provider: 'test-provider',
  enabled: true,
};

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    modelRoleAssignment: {
      findFirst: async ({ where }: any) => (storedRow && where.id === storedRow.id ? { ...storedRow } : null),
    },
    $transaction: async (fn: any) => fn({
      modelRoleAssignmentTombstone: {
        upsert: async (args: any) => {
          tombstoneUpsertCalls.push(args);
          return {};
        },
      },
      modelRoleAssignment: {
        delete: async (args: any) => {
          roleDeleteCalls.push(args);
          storedRow = null;
          return {};
        },
      },
    }),
  },
}));

import multiModelRoutes from '../multi-model.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request: any) => {
    request.user = { id: 'test-admin', email: 'test@test', isAdmin: true };
  });
  await app.register((fastify) => multiModelRoutes(fastify, {} as any), { prefix: '/api/admin' });
  await app.ready();
  return app;
}

describe('DELETE /api/admin/multi-model/roles/:id — M11 tombstone contract', () => {
  beforeEach(() => {
    tombstoneUpsertCalls.length = 0;
    roleDeleteCalls.length = 0;
    storedRow = {
      id: 'role-1',
      role: 'chat',
      model: 'test-model',
      provider: 'test-provider',
      enabled: true,
    };
  });

  it('writes a tombstone BEFORE deleting the live row', async () => {
    const app = await buildApp();
    try {
      const r = await app.inject({
        method: 'DELETE',
        url: '/api/admin/multi-model/roles/role-1',
      });
      expect(r.statusCode).toBe(200);
      expect(tombstoneUpsertCalls.length).toBe(1);
      expect(roleDeleteCalls.length).toBe(1);
      const upsertArgs = tombstoneUpsertCalls[0];
      expect(upsertArgs.create.provider_name).toBe('test-provider');
      expect(upsertArgs.create.model).toBe('test-model');
      expect(upsertArgs.create.role).toBe('chat');
      expect(upsertArgs.create.deleted_by).toBe('test-admin');
    } finally {
      await app.close();
    }
  });

  it('returns 404 when the row is not found, no tombstone written', async () => {
    const app = await buildApp();
    try {
      const r = await app.inject({
        method: 'DELETE',
        url: '/api/admin/multi-model/roles/missing-id',
      });
      expect(r.statusCode).toBe(404);
      expect(tombstoneUpsertCalls.length).toBe(0);
      expect(roleDeleteCalls.length).toBe(0);
    } finally {
      await app.close();
    }
  });
});
