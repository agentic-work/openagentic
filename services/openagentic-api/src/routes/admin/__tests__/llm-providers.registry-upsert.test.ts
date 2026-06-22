/**
 * Task 2 integration test — confirms the POST /api/admin/llm-providers
 * handler invokes upsertDiscoveredModels on success, producing rows in
 * admin.model_role_assignments for each discovered model.
 *
 * The provider's discoverModels() call is stubbed via a fake ProviderManager
 * (the handler pulls liveProvider from providerManager.providers.get(name)).
 * The rest of the stack (Prisma, DB writes) runs for real against the test
 * DATABASE_URL — no prisma mocking.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import llmProviderRoutes from '../llm-providers.js';
import type { ProviderManager } from '../../../services/llm-providers/ProviderManager.js';

describe('POST /api/admin/llm-providers → Registry upsert (task #2)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let testUserId: string;

  const providerName = `registry-upsert-test-${Date.now()}`;

  const discovered = [
    {
      id: 'test-chat-a',
      name: 'Test Chat A',
      provider: providerName,
      capabilities: { chat: true, tools: true, streaming: true, vision: false, thinking: false, embeddings: false, imageGeneration: false },
      maxOutputTokens: 4096,
      contextWindow: 32000,
    },
    {
      id: 'test-chat-b',
      name: 'Test Chat B',
      provider: providerName,
      capabilities: { chat: true, tools: true, streaming: true, vision: false, thinking: false, embeddings: false, imageGeneration: false },
    },
    {
      id: 'test-embed',
      name: 'Test Embed',
      provider: providerName,
      capabilities: { chat: false, tools: false, streaming: false, vision: false, thinking: false, embeddings: true, imageGeneration: false },
    },
  ];

  const fakeLiveProvider = {
    discoverModels: async () => discovered,
    getModelDefaults: async (_id: string) => ({ temperature: 0.7, topP: 1, maxTokens: 4096 }),
  };

  // Sufficient subset of ProviderManager that the handler consults
  const fakeProviderManager: any = {
    providers: new Map([[providerName, fakeLiveProvider]]),
    initialize: async () => {},
    reinitialize: async () => {},
    getProvider: (name: string) => fakeProviderManager.providers.get(name) ?? null,
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
      log: ['error'],
    });
    const anyUser = await prisma.user.findFirst({ select: { id: true } });
    if (!anyUser) throw new Error('No seed user — integration test requires user table populated');
    testUserId = anyUser.id;

    app = Fastify({ logger: false });
    // Decorate with user for the `(request as any).user?.id` reads.
    app.addHook('preHandler', async (request: any) => {
      request.user = { id: testUserId, email: 'test@openagentic.io' };
    });
    await app.register(llmProviderRoutes as any, { providerManager: fakeProviderManager as ProviderManager, prefix: '/api/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.lLMProvider.deleteMany({ where: { name: providerName } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean slate for each test.
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.lLMProvider.deleteMany({ where: { name: providerName } });
  });

  afterEach(async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.lLMProvider.deleteMany({ where: { name: providerName } });
  });

  it('populates Registry with 3 rows (2 chat + 1 embeddings) on provider create', async () => {
    const body = {
      name: providerName,
      displayName: 'Registry Upsert Test Provider',
      providerType: 'ollama',
      authConfig: { type: 'none' },
      providerConfig: { endpoint: 'http://localhost:11434' },
    };
    const res = await app.inject({ method: 'POST', url: '/api/admin/llm-providers', payload: body });
    expect(res.statusCode).toBe(201);

    const rows = await prisma.modelRoleAssignment.findMany({
      where: { provider: providerName },
      orderBy: { model: 'asc' },
    });
    expect(rows).toHaveLength(3);
    const chat = rows.filter(r => r.role === 'chat');
    const embed = rows.filter(r => r.role === 'embeddings');
    expect(chat).toHaveLength(2);
    expect(embed).toHaveLength(1);
    for (const r of rows) {
      expect((r.options as any)?.auto).toBe(true);
      expect(r.enabled).toBe(true);
    }
    expect((chat[0].capabilities as any)?.chat).toBe(true);
  });

  it('second POST with same discover set leaves 3 rows (idempotent)', async () => {
    const body = {
      name: providerName,
      displayName: 'Registry Upsert Test Provider',
      providerType: 'ollama',
      authConfig: { type: 'none' },
      providerConfig: { endpoint: 'http://localhost:11434' },
    };
    const first = await app.inject({ method: 'POST', url: '/api/admin/llm-providers', payload: body });
    expect(first.statusCode).toBe(201);

    // Purge the LLMProvider row to let us re-POST without unique-name collision
    await prisma.lLMProvider.deleteMany({ where: { name: providerName } });
    const second = await app.inject({ method: 'POST', url: '/api/admin/llm-providers', payload: body });
    expect(second.statusCode).toBe(201);

    const rows = await prisma.modelRoleAssignment.findMany({ where: { provider: providerName } });
    expect(rows).toHaveLength(3); // still 3, not 6
  });

  it('preserves admin priority when a row is flipped to options.auto=false', async () => {
    const body = {
      name: providerName,
      displayName: 'Registry Upsert Test Provider',
      providerType: 'ollama',
      authConfig: { type: 'none' },
      providerConfig: { endpoint: 'http://localhost:11434' },
    };
    const first = await app.inject({ method: 'POST', url: '/api/admin/llm-providers', payload: body });
    expect(first.statusCode).toBe(201);
    const original = await prisma.modelRoleAssignment.findFirst({ where: { provider: providerName, model: 'test-chat-a' } });
    expect(original).not.toBeNull();

    // Admin flips to manual mode + changes priority
    await prisma.modelRoleAssignment.update({
      where: { id: original!.id },
      data: { priority: 1, options: { auto: false, note: 'hand-tuned' } },
    });

    // Re-POST (after purging the llm-provider row)
    await prisma.lLMProvider.deleteMany({ where: { name: providerName } });
    const second = await app.inject({ method: 'POST', url: '/api/admin/llm-providers', payload: body });
    expect(second.statusCode).toBe(201);

    const after = await prisma.modelRoleAssignment.findUnique({ where: { id: original!.id } });
    expect(after?.priority).toBe(1); // preserved
    expect((after?.options as any)?.auto).toBe(false); // preserved
    expect((after?.options as any)?.note).toBe('hand-tuned'); // preserved
  });
});
