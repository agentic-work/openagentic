/**
 * #289 — soft-delete name collision
 *
 * Repro: User adds provider "vertex-x" → DELETEs it via UI (server soft-deletes,
 * sets `deleted_at`) → tries to re-add provider with the same name → 500
 * "Unique constraint failed on (`name`)" because the unique index is on the
 * raw `name` column, not `(name) WHERE deleted_at IS NULL`.
 *
 * Fix: in POST /admin/llm-providers, before INSERT, hard-delete any
 * soft-deleted row with the same name. UX: "delete then re-add" is a clean
 * restart, not a confusing collision.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const deleteManyCalls: any[] = [];
const createCalls: any[] = [];

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    lLMProvider: {
      deleteMany: vi.fn(async (args: any) => {
        deleteManyCalls.push(args);
        // Pretend a soft-deleted row matched.
        if (args?.where?.name === 'vertex-collide') return { count: 1 };
        return { count: 0 };
      }),
      create: vi.fn(async ({ data }: any) => {
        createCalls.push(data);
        return { id: 'new-uuid', ...data };
      }),
      findFirst: async () => null,
      findMany: async () => [],
    },
  },
}));

vi.mock('../../../services/llm-providers/CredentialEncryptionService.js', () => ({
  encryptAuthConfig: (c: any) => c,
  decryptAuthConfig: (c: any) => c,
}));

vi.mock('../../../services/llm-providers/ProviderManager.js', () => ({
  ProviderManager: class {},
  invalidateAllModelCaches: async () => {},
}));

vi.mock('../../../utils/auditTrail.js', () => ({
  AuditTrail: class { log() { return Promise.resolve(); } },
  AuditEventType: { CREDENTIAL_CREATE: 'CREDENTIAL_CREATE' },
  AuditSeverity: { INFO: 'INFO' },
}));

vi.mock('../../../services/CredentialAuditService.js', () => ({
  credentialAuditService: { log: async () => {} },
}));

import llmProviderRoutes from '../llm-providers.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request: any) => {
    request.user = { id: 'test-admin', email: 'test@test', isAdmin: true };
  });
  await app.register(llmProviderRoutes as any, { providerManager: undefined, prefix: '/api/admin' });
  await app.ready();
  return app;
}

describe('POST /api/admin/llm-providers — #289 soft-delete name collision', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('clears any soft-deleted row with the same name BEFORE inserting (hard-delete)', async () => {
    deleteManyCalls.length = 0;
    createCalls.length = 0;

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers',
      payload: {
        name: 'vertex-collide',
        displayName: 'Vertex Recreate',
        providerType: 'vertex-ai',
        enabled: true,
        priority: 1,
        authConfig: { type: 'service-account', credentials: 'fake' },
        providerConfig: { projectId: 'p', region: 'r' },
      },
    });

    expect(res.statusCode).toBe(201);
    // Cleanup MUST be called with the soft-deleted-only filter and the right name
    expect(deleteManyCalls.length).toBeGreaterThanOrEqual(1);
    expect(deleteManyCalls[0]).toMatchObject({
      where: { name: 'vertex-collide', deleted_at: { not: null } },
    });
    // Then create MUST follow with the same name
    expect(createCalls[0].name).toBe('vertex-collide');
  });

  it('still succeeds when no soft-deleted row exists (deleteMany returns count:0)', async () => {
    deleteManyCalls.length = 0;
    createCalls.length = 0;

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers',
      payload: {
        name: 'vertex-fresh',
        displayName: 'Vertex Fresh',
        providerType: 'vertex-ai',
        enabled: true,
        priority: 1,
        authConfig: { type: 'service-account', credentials: 'fake' },
        providerConfig: { projectId: 'p', region: 'r' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(deleteManyCalls[0]).toMatchObject({
      where: { name: 'vertex-fresh', deleted_at: { not: null } },
    });
    expect(createCalls[0].name).toBe('vertex-fresh');
  });
});
