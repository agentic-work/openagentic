/**
 * §11.5 optimistic-concurrency contract for the canonical LLMProvider edit
 * endpoint (PUT /api/admin/llm-providers/:id).
 *
 *   • Body must include `version` (the value the client just GET'd).
 *   • Server does UPDATE … WHERE id = $id AND version = $clientVersion.
 *   • 0 rows affected → 409 with currentRow + conflictingFields, no write.
 *   • Successful update bumps version by 1; response includes the new version.
 *   • Missing/invalid `version` → 400.
 *
 * Pairs with the UI's useOptimisticVersion hook + ConflictModal so two
 * admins editing the same provider can't silently clobber each other.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

let storedRow: any = {
  id: 'p1',
  name: 'aif',
  display_name: 'AIF',
  provider_type: 'azure-ai-foundry',
  enabled: true,
  priority: 1,
  auth_config: {},
  provider_config: {},
  model_config: {},
  capabilities: { chat: true, tools: true, vision: true },
  description: 'AIF dev',
  tags: [],
  version: BigInt(3),
  updated_by: null,
  updated_at: new Date(),
  deleted_at: null,
};

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    lLMProvider: {
      findUnique: async ({ where }: any) => (where.id === storedRow.id ? { ...storedRow } : null),
      update: async ({ where, data }: any) => {
        if (where.id !== storedRow.id) throw new Error('not found');
        storedRow = { ...storedRow, ...data, version: storedRow.version + BigInt(1), updated_at: new Date() };
        return { ...storedRow };
      },
      updateMany: async ({ where, data }: any) => {
        if (where.id !== storedRow.id) return { count: 0 };
        const reqVersion = BigInt(where.version);
        if (reqVersion !== storedRow.version) return { count: 0 };
        // Strip Prisma operator forms (e.g. { increment: 1 }) into concrete values.
        const next: any = { ...storedRow };
        for (const [k, v] of Object.entries(data)) {
          if (k === 'version' && v && typeof v === 'object' && 'increment' in (v as any)) {
            next.version = storedRow.version + BigInt((v as any).increment);
          } else {
            next[k] = v;
          }
        }
        next.updated_at = new Date();
        storedRow = next;
        return { count: 1 };
      },
    },
  },
}));

vi.mock('../../../services/llm-providers/CredentialEncryptionService.js', () => ({
  encryptAuthConfig: (c: any) => c,
  decryptAuthConfig: (c: any) => c,
}));

vi.mock('../../../utils/auditTrail.js', () => ({
  AuditTrail: class { log() { return Promise.resolve(); } },
  AuditEventType: { CREDENTIAL_UPDATE: 'CREDENTIAL_UPDATE' },
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
  await app.register((fastify) => llmProviderRoutes(fastify, {} as any), { prefix: '/api/admin' });
  await app.ready();
  return app;
}

describe('PUT /api/admin/llm-providers/:id — §11.5 version gating', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('400s when body has no version', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/admin/llm-providers/p1',
      payload: { displayName: 'AIF v2' },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.error).toMatch(/version/i);
  });

  it('409s when version is stale', async () => {
    storedRow = { ...storedRow, version: BigInt(7), display_name: 'AIF' };
    const r = await app.inject({
      method: 'PUT',
      url: '/api/admin/llm-providers/p1',
      payload: { displayName: 'Stale Edit', version: 3 },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json();
    expect(body.error).toMatch(/conflict/i);
    expect(body.currentRow).toBeDefined();
    expect(body.currentRow.version).toBe(7);
    expect(Array.isArray(body.conflictingFields)).toBe(true);
  });

  it('200s and bumps version on a clean update', async () => {
    storedRow = { ...storedRow, version: BigInt(7), display_name: 'AIF' };
    const r = await app.inject({
      method: 'PUT',
      url: '/api/admin/llm-providers/p1',
      payload: { displayName: 'AIF (renamed)', version: 7 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.provider?.version ?? body.version).toBe(8);
  });
});
