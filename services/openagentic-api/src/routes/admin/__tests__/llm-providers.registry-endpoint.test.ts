/**
 * Task 3 test — GET /api/admin/llm-providers/registry returns the curated
 * registry with provider metadata joined in (display_name + enabled).
 *
 * Seeds N rows, queries with enabledOnly default + explicit, asserts
 * response shape includes provider_display_name + provider_enabled +
 * filters disabled rows correctly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import llmProviderRoutes from '../llm-providers.js';

describe('GET /api/admin/llm-providers/registry (task #3)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let testUserId: string;
  const providerName = `registry-ep-test-${Date.now()}`;
  const disabledProviderName = `registry-ep-disabled-${Date.now()}`;

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
    await app.register(llmProviderRoutes as any, { prefix: '/api/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: { in: [providerName, disabledProviderName] } } });
    await prisma.lLMProvider.deleteMany({ where: { name: { in: [providerName, disabledProviderName] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.modelRoleAssignment.deleteMany({ where: { provider: { in: [providerName, disabledProviderName] } } });
    await prisma.lLMProvider.deleteMany({ where: { name: { in: [providerName, disabledProviderName] } } });

    // Seed: 1 enabled provider with 3 enabled rows + 2 disabled rows,
    // plus 1 disabled provider with 1 enabled row.
    await prisma.lLMProvider.create({
      data: {
        name: providerName,
        display_name: 'Enabled Test Provider',
        provider_type: 'ollama',
        enabled: true,
        priority: 1,
        auth_config: { type: 'none' },
        provider_config: { endpoint: 'http://localhost:11434' },
      },
    });
    await prisma.lLMProvider.create({
      data: {
        name: disabledProviderName,
        display_name: 'Disabled Test Provider',
        provider_type: 'ollama',
        enabled: false,
        priority: 2,
        auth_config: { type: 'none' },
        provider_config: {},
      },
    });
    const common = { created_by: testUserId, priority: 100, temperature: 0.7 };
    await prisma.modelRoleAssignment.createMany({
      data: [
        { id: 'reg-ep-1', role: 'chat', model: 'm-en-1', provider: providerName, enabled: true, capabilities: { chat: true }, options: { auto: true }, description: 'm-en-1', ...common } as any,
        { id: 'reg-ep-2', role: 'chat', model: 'm-en-2', provider: providerName, enabled: true, capabilities: { chat: true }, options: { auto: true }, description: 'm-en-2', ...common } as any,
        { id: 'reg-ep-3', role: 'chat', model: 'm-en-3', provider: providerName, enabled: true, capabilities: { chat: true }, options: { auto: true }, description: 'm-en-3', ...common } as any,
        { id: 'reg-ep-4', role: 'chat', model: 'm-dis-1', provider: providerName, enabled: false, capabilities: { chat: true }, options: { auto: true }, description: 'm-dis-1', ...common } as any,
        { id: 'reg-ep-5', role: 'embeddings', model: 'emb-dis', provider: providerName, enabled: false, capabilities: { embeddings: true }, options: { auto: true }, description: 'emb-dis', ...common } as any,
        { id: 'reg-ep-6', role: 'chat', model: 'm-from-disabled-prov', provider: disabledProviderName, enabled: true, capabilities: { chat: true }, options: { auto: true }, description: 'x', ...common } as any,
      ],
    });
  });

  it('enabledOnly=true (default) returns only enabled rows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/registry?enabledOnly=true' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<any>;
    const scoped = body.filter(r => r.provider === providerName || r.provider === disabledProviderName);
    expect(scoped).toHaveLength(4); // 3 enabled from enabled provider + 1 enabled from disabled provider
  });

  it('enabledOnly=false returns all rows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/registry?enabledOnly=false' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<any>;
    const scoped = body.filter(r => r.provider === providerName || r.provider === disabledProviderName);
    expect(scoped).toHaveLength(6);
  });

  it('response rows include provider_display_name and provider_enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/registry?enabledOnly=false' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<any>;
    const enabled = body.find(r => r.provider === providerName && r.model === 'm-en-1');
    expect(enabled).toBeDefined();
    expect(enabled.provider_display_name).toBe('Enabled Test Provider');
    expect(enabled.provider_enabled).toBe(true);
    const fromDisabled = body.find(r => r.provider === disabledProviderName);
    expect(fromDisabled.provider_display_name).toBe('Disabled Test Provider');
    expect(fromDisabled.provider_enabled).toBe(false);
  });

  it('response rows include role, priority, enabled, temperature, max_tokens, capabilities', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/registry?enabledOnly=false' });
    const body = res.json() as Array<any>;
    const sample = body.find(r => r.provider === providerName && r.model === 'm-en-1');
    expect(sample).toMatchObject({
      model: 'm-en-1',
      provider: providerName,
      role: 'chat',
      priority: 100,
      enabled: true,
      temperature: 0.7,
    });
    expect(sample.capabilities).toMatchObject({ chat: true });
    expect(sample.id).toBe('reg-ep-1');
  });

  it('role=embeddings filter narrows result to embeddings rows only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/registry?role=embeddings&enabledOnly=false' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<any>;
    const scoped = body.filter(r => r.provider === providerName);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].role).toBe('embeddings');
  });
});
