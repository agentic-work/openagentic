/**
 * Regression test for the "Add Model does nothing for Bedrock/Vertex" bug.
 *
 * The admin UI's AddModelDialog lets a user pick a discovered model and click
 * "Add to Platform", which fires POST /api/admin/llm-providers/:providerId/models.
 * Pre-fix, that handler only wrote to LLMProvider.provider_config.models[] +
 * LLMProvider.model_config. The Registry table (Model Registry view, Smart
 * Router candidate pool) reads from ModelRoleAssignment — which was never
 * touched. Result: POST 200, toast success, but the Registry tab never
 * showed the model → user saw "nothing happened".
 *
 * This test hits the POST endpoint in-process and asserts that a matching
 * ModelRoleAssignment row exists after the call.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import llmProviderRoutes from '../llm-providers.js';
import type { ProviderManager } from '../../../services/llm-providers/ProviderManager.js';

describe('POST /api/admin/llm-providers/:providerId/models → Registry upsert', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let testUserId: string;
  let providerId: string;

  const providerName = `add-model-test-${Date.now()}`;

  const fakeLiveProvider = {
    discoverModels: async () => [] as any[],
    listModels: async () => [] as any[],
  };

  const fakeProviderManager: any = {
    providers: new Map([[providerName, fakeLiveProvider]]),
    initialize: async () => {},
    reinitialize: async () => {},
    getProvider: (name: string) => fakeProviderManager.providers.get(name) ?? null,
    hasProvider: (name: string) => fakeProviderManager.providers.has(name),
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
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.lLMProvider.deleteMany({ where: { name: providerName } });
    const p = await prisma.lLMProvider.create({
      data: {
        name: providerName,
        display_name: 'Add-Model Test',
        provider_type: 'ollama',
        enabled: true,
        auth_config: {},
        provider_config: { endpoint: 'http://localhost:11434', models: [] },
        model_config: {},
        created_by: testUserId,
        updated_by: testUserId,
      },
    });
    providerId = p.id;
  });

  afterEach(async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: providerName } });
    await prisma.lLMProvider.deleteMany({ where: { name: providerName } });
  });

  it('creates a ModelRoleAssignment row when a chat-capable model is added', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/llm-providers/${providerId}/models`,
      payload: {
        modelId: 'add-model-chat',
        displayName: 'Add-Model Chat Test',
        capabilities: { chat: true, tools: true, streaming: true },
        config: { maxOutputTokens: 4096, temperature: 0.7 },
      },
    });
    expect(res.statusCode).toBeLessThan(300);

    const rows = await prisma.modelRoleAssignment.findMany({
      where: { provider: providerName, model: 'add-model-chat' },
    });
    expect(rows.length).toBeGreaterThan(0);
    const chatRow = rows.find(r => r.role === 'chat');
    expect(chatRow).toBeDefined();
    expect(chatRow?.enabled).toBe(true);
    expect((chatRow?.capabilities as any)?.chat).toBe(true);
  });

  it('creates EXACTLY ONE row for a chat+vision model — vision is a capability flag, not a separate role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/llm-providers/${providerId}/models`,
      payload: {
        modelId: 'add-model-chat-vision',
        displayName: 'Sonnet-style chat+vision',
        capabilities: { chat: true, tools: true, streaming: true, vision: true },
        config: { maxOutputTokens: 4096 },
      },
    });
    expect(res.statusCode).toBeLessThan(300);

    const rows = await prisma.modelRoleAssignment.findMany({
      where: { provider: providerName, model: 'add-model-chat-vision' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('chat');
    // Vision is preserved as a capability on the chat row:
    expect((rows[0].capabilities as any)?.vision).toBe(true);
  });

  it('creates an image-generation ModelRoleAssignment when imageGeneration capability is set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/llm-providers/${providerId}/models`,
      payload: {
        modelId: 'add-model-imagen',
        displayName: 'Imagen Test',
        capabilities: { imageGeneration: true, chat: false, embeddings: false },
        config: { maxOutputTokens: 66000 },
      },
    });
    expect(res.statusCode).toBeLessThan(300);

    const rows = await prisma.modelRoleAssignment.findMany({
      where: { provider: providerName, model: 'add-model-imagen' },
    });
    expect(rows.length).toBeGreaterThan(0);
    const imgRow = rows.find(r => r.role === 'image-generation');
    expect(imgRow).toBeDefined();
    expect(imgRow?.enabled).toBe(true);
  });

  it('creates an embedding ModelRoleAssignment when embeddings:true + chat:false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/llm-providers/${providerId}/models`,
      payload: {
        modelId: 'add-model-embed',
        displayName: 'Embed Test',
        capabilities: { embeddings: true, chat: false },
        config: {},
      },
    });
    expect(res.statusCode).toBeLessThan(300);

    const rows = await prisma.modelRoleAssignment.findMany({
      where: { provider: providerName, model: 'add-model-embed' },
    });
    const embedRow = rows.find(r => r.role === 'embeddings');
    expect(embedRow).toBeDefined();
    expect(embedRow?.enabled).toBe(true);
  });

  it('re-adding the same model is idempotent — no duplicate Registry rows', async () => {
    const body = {
      modelId: 'add-model-idem',
      displayName: 'Idempotent',
      capabilities: { chat: true, tools: true },
      config: {},
    };
    await app.inject({ method: 'POST', url: `/api/admin/llm-providers/${providerId}/models`, payload: body });
    await app.inject({ method: 'POST', url: `/api/admin/llm-providers/${providerId}/models`, payload: body });

    const rows = await prisma.modelRoleAssignment.findMany({
      where: { provider: providerName, model: 'add-model-idem', role: 'chat' },
    });
    expect(rows).toHaveLength(1);
  });

  it('Registry GET /registry returns the newly added row (end-to-end path)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/llm-providers/${providerId}/models`,
      payload: {
        modelId: 'add-model-e2e',
        displayName: 'E2E',
        capabilities: { chat: true, tools: true, streaming: true },
        config: {},
      },
    });

    const getRes = await app.inject({ method: 'GET', url: `/api/admin/llm-providers/registry?enabledOnly=true` });
    expect(getRes.statusCode).toBe(200);
    const rows: any[] = JSON.parse(getRes.body);
    const match = rows.find(r => r.model === 'add-model-e2e' && r.provider === providerName);
    expect(match).toBeDefined();
    expect(match.role).toBe('chat');
    expect(match.enabled).toBe(true);
  });
});
