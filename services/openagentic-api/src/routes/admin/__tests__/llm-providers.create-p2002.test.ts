/**
 * #100 contract test — POST /api/admin/llm-providers on a duplicate name
 * MUST return 409 with a clean message ("A provider with this name already
 * exists"), not bleed the raw Prisma P2002 stacktrace ("Invalid
 * `prisma.lLMProvider.create()` invocation…") into the UI toast.
 *
 * User-reported regression 2026-05-05 (/fyi).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Minimal Prisma stub — findUnique returns null (no soft-deleted ghost) and
// create throws a real P2002 error shape.
class FakeP2002Error extends Error {
  code = 'P2002';
  meta = { target: ['name'] };
  constructor() {
    super(
      'Invalid `prisma.lLMProvider.create()` invocation:\n\n\nUnique constraint failed on the fields: (`name`)'
    );
  }
}

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    lLMProvider: {
      findUnique: async () => null,
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      create: async () => { throw new FakeP2002Error(); },
    },
  },
}));

vi.mock('../../../services/llm-providers/CredentialEncryptionService.js', () => ({
  encryptAuthConfig: (c: any) => c,
  decryptAuthConfig: (c: any) => c,
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
  await app.register((fastify) => llmProviderRoutes(fastify, {} as any), { prefix: '/api/admin' });
  await app.ready();
  return app;
}

describe('POST /api/admin/llm-providers — #100 P2002 UX contract', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('returns 409 with a clean message on duplicate name (no Prisma stacktrace bleed)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers',
      payload: {
        name: 'hal',
        displayName: 'Duplicate hal',
        providerType: 'ollama',
        enabled: true,
        priority: 1,
        authConfig: {},
        providerConfig: { origin: { env: 'dev', hostname: 'hal' } },
        modelConfig: {},
        capabilities: {},
      },
    });

    expect(r.statusCode).toBe(409);
    const body = r.json();
    expect(body.error).toBe('A provider with this name already exists');
    expect(body.message).toMatch(/must be unique/i);
    expect(body.field).toBe('name');
    // Crucially: the raw Prisma error must NOT appear in the response body
    expect(JSON.stringify(body)).not.toMatch(/Invalid `prisma\.lLMProvider\.create/);
    expect(JSON.stringify(body)).not.toMatch(/Unique constraint failed/);
  });
});
