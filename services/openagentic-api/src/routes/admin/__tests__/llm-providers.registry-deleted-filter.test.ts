/**
 * Phase H — Registry GET filter excludes rows whose provider has deleted_at != null.
 *
 * Spec: docs/superpowers/specs/2026-04-30-ollama-split-topology.md §Phase H
 *
 * Bug: GET /api/admin/llm-providers/registry joins ModelRoleAssignment rows
 * to LLMProvider by name string. The handler does NOT filter rows whose
 * joined provider has deleted_at != null. Soft-deleted providers' registry
 * rows still surface in the response with provider_enabled=false, polluting
 * the Models page and any caller that lists "what's routable today".
 *
 * Fix: select deleted_at on the LLMProvider query, then drop result rows
 * whose provider has deleted_at != null. An admin escape hatch
 * `?includeDeleted=true` keeps soft-deleted rows visible for forensic /
 * cleanup workflows.
 *
 * Style: prismaMock unit-test (no live DB required).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const prismaMock: any = {
  modelRoleAssignment: {
    findMany: vi.fn(),
  },
  lLMProvider: {
    findMany: vi.fn(),
  },
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

// ModelCapabilityRegistry is consulted for enrichment — stub it to a no-op.
vi.mock('../../../services/ModelCapabilityRegistry.js', () => ({
  getModelCapabilityRegistry: () => ({
    getCapabilities: () => ({
      functionCallingAccuracy: null,
      inputCostPer1k: null,
      outputCostPer1k: null,
      avgLatencyMs: null,
      tokensPerSecond: null,
      maxContextTokens: null,
      family: null,
      providerType: null,
      thinking: false,
    }),
  }),
}));

import Fastify, { type FastifyInstance } from 'fastify';

describe('GET /api/admin/llm-providers/registry — Phase H deleted-provider filter', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const llmProviderRoutes = (await import('../llm-providers.js')).default;
    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
      request.user = { id: 'test-admin-uuid', email: 'admin@test', isAdmin: true };
    });
    await app.register(llmProviderRoutes as any, { prefix: '/api/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.modelRoleAssignment.findMany.mockReset();
    prismaMock.lLMProvider.findMany.mockReset();
  });

  it('default GET excludes rows whose provider has deleted_at != null', async () => {
    // 4 registry rows: 2 from active provider, 2 from soft-deleted provider.
    prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([
      { id: 'r-1', role: 'chat', model: 'test-model-A', provider: 'active-provider', priority: 1, enabled: true, capabilities: { chat: true }, options: {}, description: 'A', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null },
      { id: 'r-2', role: 'chat', model: 'test-model-B', provider: 'active-provider', priority: 2, enabled: true, capabilities: { chat: true }, options: {}, description: 'B', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null },
      { id: 'r-3', role: 'chat', model: 'test-model-C', provider: 'gone-provider', priority: 1, enabled: true, capabilities: { chat: true }, options: {}, description: 'C', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null },
      { id: 'r-4', role: 'chat', model: 'test-model-D', provider: 'gone-provider', priority: 2, enabled: true, capabilities: { chat: true }, options: {}, description: 'D', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null },
    ]);
    // The provider lookup MUST include deleted_at so the handler can drop rows.
    prismaMock.lLMProvider.findMany.mockResolvedValueOnce([
      { name: 'active-provider', display_name: 'Active', enabled: true, deleted_at: null },
      { name: 'gone-provider', display_name: 'Gone', enabled: false, deleted_at: new Date('2026-04-30T00:00:00Z') },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/llm-providers/registry',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<any>;
    // Only the active provider's 2 rows should remain.
    expect(body).toHaveLength(2);
    const providers = body.map(r => r.provider);
    expect(providers).toEqual(['active-provider', 'active-provider']);
    expect(providers).not.toContain('gone-provider');
  });

  it('?includeDeleted=true returns rows from soft-deleted providers too (admin debugging escape hatch)', async () => {
    prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([
      { id: 'r-1', role: 'chat', model: 'test-model-A', provider: 'active-provider', priority: 1, enabled: true, capabilities: { chat: true }, options: {}, description: 'A', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null },
      { id: 'r-2', role: 'chat', model: 'test-model-C', provider: 'gone-provider', priority: 1, enabled: true, capabilities: { chat: true }, options: {}, description: 'C', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null },
    ]);
    prismaMock.lLMProvider.findMany.mockResolvedValueOnce([
      { name: 'active-provider', display_name: 'Active', enabled: true, deleted_at: null },
      { name: 'gone-provider', display_name: 'Gone', enabled: false, deleted_at: new Date('2026-04-30T00:00:00Z') },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/llm-providers/registry?includeDeleted=true',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<any>;
    expect(body).toHaveLength(2);
    const providers = body.map(r => r.provider).sort();
    expect(providers).toEqual(['active-provider', 'gone-provider']);
  });

  it('LLMProvider query selects deleted_at so the handler can filter without a second roundtrip', async () => {
    prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([
      { id: 'r-1', role: 'chat', model: 'test-model-A', provider: 'active-provider', priority: 1, enabled: true, capabilities: { chat: true }, options: {}, description: 'A', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null },
    ]);
    prismaMock.lLMProvider.findMany.mockResolvedValueOnce([
      { name: 'active-provider', display_name: 'Active', enabled: true, deleted_at: null },
    ]);

    await app.inject({
      method: 'GET',
      url: '/api/admin/llm-providers/registry',
    });

    expect(prismaMock.lLMProvider.findMany).toHaveBeenCalledTimes(1);
    const findManyArg = prismaMock.lLMProvider.findMany.mock.calls[0][0];
    // The select must include deleted_at — without it, the post-filter can't run.
    expect(findManyArg.select).toMatchObject({
      name: true,
      display_name: true,
      enabled: true,
      deleted_at: true,
    });
  });
});
