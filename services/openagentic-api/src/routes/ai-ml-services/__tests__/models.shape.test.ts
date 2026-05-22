/**
 * RED test for #915 — TWO-SoT Task 1.0.
 *
 * GET /api/models MUST source rows from `model_role_assignments` (the model SoT),
 * NOT from `llm_providers`. The bug today:
 *
 *   const modelId = providerConfig.modelId
 *                ?? providerConfig.model
 *                ?? providerConfig.deployment
 *                ?? dbProvider.name;     // <-- falls back to PROVIDER NAME
 *
 * So a single Bedrock provider with N registered models surfaces ONE model row
 * with `id === <provider name>`. The bulletproof harness L3d assertion fails
 * because the router picks a real model id (e.g. `us.anthropic.claude-sonnet-4-6`)
 * that isn't in the `/api/models` active set.
 *
 * Fix: enumerate `model_role_assignments` (where `enabled = true`), group by
 * (model, provider), surface `{ id: <model>, providerId, roles[], capabilities }`.
 *
 * This test mocks Prisma at the dynamic-import target path and registers
 * `modelsRoutes` directly. No DB, no server bootstrap.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Stub prisma client — module is loaded via dynamic import inside the handler,
// so vi.mock must hoist before any import that pulls models.ts.
// ---------------------------------------------------------------------------

const stubPrisma = {
  modelRoleAssignment: {
    findMany: vi.fn(),
  },
  lLMProvider: {
    findMany: vi.fn(),
  },
} as any;

vi.mock('../../../utils/prisma.js', () => ({
  prisma: stubPrisma,
  default: stubPrisma,
  prismaBase: stubPrisma,
  prismaTenant: stubPrisma,
}));

describe('GET /api/models — TWO-SoT contract (#915)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // Fixture: one Bedrock provider with TWO models registered via
    // model_role_assignments. Each model has multiple roles (chat + code,
    // or just embedding). This is the realistic shape post-#913 helm seed.
    stubPrisma.modelRoleAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        role: 'chat',
        model: 'us.anthropic.claude-sonnet-4-6',
        provider: 'bedrock-test',
        enabled: true,
        capabilities: { tools: true, streaming: true, vision: true },
      },
      {
        id: 'a2',
        role: 'code',
        model: 'us.anthropic.claude-sonnet-4-6',
        provider: 'bedrock-test',
        enabled: true,
        capabilities: { tools: true, streaming: true, vision: true },
      },
      {
        id: 'a3',
        role: 'embedding',
        model: 'amazon.titan-embed-text-v2:0',
        provider: 'bedrock-test',
        enabled: true,
        capabilities: { embeddings: true },
      },
    ]);

    stubPrisma.lLMProvider.findMany.mockResolvedValue([
      {
        id: 'p-bedrock',
        name: 'bedrock-test',
        display_name: 'Bedrock Test',
        provider_type: 'aws-bedrock',
        enabled: true,
        deleted_at: null,
        priority: 1,
        provider_config: {},
        capabilities: { chat: true },
        model_config: {},
        description: 'test',
      },
    ]);

    server = Fastify({ logger: false });
    const { modelsRoutes } = await import('../models.js');
    await server.register(modelsRoutes);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('surfaces MODEL ids from model_role_assignments — NOT provider names', async () => {
    const resp = await server.inject({ method: 'GET', url: '/' });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body) as { models: Array<{ id: string }> };
    const ids = body.models.map((m) => m.id).sort();

    // Today's BUG behaviour: ids === ['bedrock-test'] (the provider name).
    // The contract: ids must be the registered MODEL identifiers.
    expect(ids).toContain('us.anthropic.claude-sonnet-4-6');
    expect(ids).not.toContain('bedrock-test');
  });

  it('groups multiple role assignments for one model into a single row with roles[]', async () => {
    const resp = await server.inject({ method: 'GET', url: '/' });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body) as {
      models: Array<{ id: string; roles?: string[] }>;
    };

    const sonnet = body.models.find((m) => m.id === 'us.anthropic.claude-sonnet-4-6');
    expect(sonnet, 'expected sonnet model row').toBeTruthy();
    expect(sonnet?.roles, 'roles[] must be populated').toBeTruthy();
    expect(new Set(sonnet?.roles)).toEqual(new Set(['chat', 'code']));
  });

  it('includes providerId resolving to the llm_providers row', async () => {
    const resp = await server.inject({ method: 'GET', url: '/' });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body) as {
      models: Array<{ id: string; providerId?: string; provider?: string }>;
    };

    const sonnet = body.models.find((m) => m.id === 'us.anthropic.claude-sonnet-4-6');
    // Either providerId (preferred new shape) or legacy provider must point at
    // the real provider row, not a derived heuristic value.
    const provRef = sonnet?.providerId || sonnet?.provider;
    expect(provRef).toBeTruthy();
    // providerId resolves to either the llm_providers.id (`p-bedrock`) or its
    // name (`bedrock-test`); both are valid joins. The legacy `provider`
    // field maps to provider_type (`aws-bedrock`).
    const acceptable = ['p-bedrock', 'bedrock-test', 'aws-bedrock'];
    expect(acceptable).toContain(provRef);
  });

  it('does NOT collapse multi-model providers into a single row', async () => {
    const resp = await server.inject({ method: 'GET', url: '/' });
    const body = JSON.parse(resp.body) as { models: Array<{ id: string }> };
    // Two distinct models registered: sonnet + titan-embed. Today's bug
    // returns ONE row (just the provider). We assert two distinct rows.
    const distinctIds = new Set(body.models.map((m) => m.id));
    expect(distinctIds.size).toBeGreaterThanOrEqual(2);
  });
});
