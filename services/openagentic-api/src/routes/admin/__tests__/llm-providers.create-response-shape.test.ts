/**
 * #459 — provider-create response must distinguish "discovered in catalog"
 * from "added to Registry".
 *
 * Pre-fix the response said:
 *   { autoDiscoveredCount: 32, message: "Auto-discovered 32 model(s) from the provider." }
 *
 * That implies 32 models got added. In reality #311 gates auto-sync to
 * AIF + Ollama only; for Vertex/Bedrock/OpenAI/Anthropic/AzureOpenAI the
 * gate skips the upsert and 0 rows hit admin.model_role_assignments. The
 * misleading message led to #459 (false alarm thinking the gate was
 * broken).
 *
 * Post-fix:
 *   { autoDiscoveredCount, registryUpserted, autoSyncSkipped, message }
 * with `message` saying "Discovered N catalog model(s) — use Models → Add
 * Model to register specific ones" when the gate skipped.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    lLMProvider: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => ({ id: 'fake-uuid', ...data }),
      findFirst: async () => null,
      findMany: async () => [],
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

async function buildAppWithProvider(providerName: string, providerType: string, discovered: any[]) {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request: any) => {
    request.user = { id: 'test-admin', email: 'test@test', isAdmin: true };
  });
  const providerInstance = {
    discoverModels: async () => discovered,
    getModelDefaults: async () => ({ temperature: 0.7, topP: 1, maxTokens: 4096 }),
  };
  const providers = new Map();
  providers.set(providerName, providerInstance);
  const fakePM = {
    providers,
    hasProvider: (n: string) => providers.has(n),
    getProvider: (n: string) => providers.get(n),
    getHealthStatus: async () => new Map(),
    getMetrics: () => new Map(),
  } as any;
  await app.register(llmProviderRoutes as any, { providerManager: fakePM, prefix: '/api/admin' });
  await app.ready();
  return app;
}

describe('POST /api/admin/llm-providers — response shape (#459)', () => {
  let app: FastifyInstance;
  afterAll(async () => { if (app) await app.close(); });

  it('vertex-ai (auto-sync skipped): returns autoSyncSkipped=true, registryUpserted=0, and a message that says "Discovered N catalog model(s)"', async () => {
    app = await buildAppWithProvider('vertex-skipgate', 'vertex-ai', [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { chat: true } },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', capabilities: { chat: true } },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers',
      payload: {
        name: 'vertex-skipgate',
        displayName: 'Vertex (gate-skipped)',
        providerType: 'vertex-ai',
        authConfig: { type: 'service-account', projectId: 'p', region: 'r' },
        providerConfig: { projectId: 'p', region: 'r' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.autoSyncSkipped).toBe(true);
    expect(body.registryUpserted).toBe(0);
    expect(body.autoDiscoveredCount).toBe(2);
    expect(body.message).toMatch(/Discovered 2 catalog model\(s\)/i);
    expect(body.message).toMatch(/Add Model/i);
    // Critical: message must NOT claim models were added when none were
    expect(body.message).not.toMatch(/added to the Registry/i);
  });

  it('"Provider created successfully" when nothing was discovered', async () => {
    app = await buildAppWithProvider('empty-provider', 'vertex-ai', []);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers',
      payload: {
        name: 'empty-provider',
        displayName: 'Empty',
        providerType: 'vertex-ai',
        authConfig: { type: 'service-account', projectId: 'p', region: 'r' },
        providerConfig: { projectId: 'p', region: 'r' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.autoDiscoveredCount).toBe(0);
    expect(body.registryUpserted).toBe(0);
    expect(body.message).toBe('Provider created successfully');
  });
});
