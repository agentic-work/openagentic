/**
 * Registry GET surfaces the first-class function_calling_accuracy column
 * (column-first, MCR fallback) + local-provider cost→0, and PATCH persists /
 * validates functionCallingAccuracy.
 *
 * Why: the RouterTuningLab's rowToLabModel filters out any row where
 * fca===null || cost===null. Before this, FCA came only from the MCR and
 * local-provider cost resolved null, so the lab showed "no enabled models
 * with FCA + cost". The column is now the SoT (router reads the same), and
 * local Ollama models report cost 0 so they're scoreable.
 *
 * Style: prismaMock unit-test (no live DB).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const prismaMock: any = {
  modelRoleAssignment: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  lLMProvider: {
    findMany: vi.fn(),
  },
};

vi.mock('../../../utils/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// MCR returns a benchmark FCA (0.87) but NULL cost — exercises the column-first
// FCA path and the local-provider cost fallback independently.
vi.mock('../../../services/ModelCapabilityRegistry.js', () => ({
  getModelCapabilityRegistry: () => ({
    getCapabilities: () => ({
      functionCallingAccuracy: 0.87,
      inputCostPer1k: null,
      outputCostPer1k: null,
      avgLatencyMs: 500,
      tokensPerSecond: 100,
      maxContextTokens: 8192,
      family: 'gpt-oss',
      providerType: 'ollama',
      thinking: false,
    }),
  }),
}));

import Fastify, { type FastifyInstance } from 'fastify';

describe('Registry FCA column surfacing + PATCH', () => {
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
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    prismaMock.modelRoleAssignment.findMany.mockReset();
    prismaMock.modelRoleAssignment.findUnique.mockReset();
    prismaMock.modelRoleAssignment.update.mockReset();
    prismaMock.lLMProvider.findMany.mockReset();
  });

  it('GET: function_calling_accuracy column wins over MCR; local provider cost is 0', async () => {
    prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([
      // column set to 0.91 (≠ MCR 0.87) → column must win; ollama → cost 0
      { id: 'r-1', role: 'chat', model: 'gpt-oss:20b', provider: 'node-ollama', priority: 1, enabled: true, capabilities: {}, options: {}, description: 'x', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null, function_calling_accuracy: 0.91 },
      // column NULL → MCR fallback (0.87)
      { id: 'r-2', role: 'chat', model: 'gpt-oss:20b', provider: 'node-ollama', priority: 2, enabled: true, capabilities: {}, options: {}, description: 'y', temperature: 0.7, max_tokens: null, cost_per_input_token_usd: null, cost_per_output_token_usd: null, function_calling_accuracy: null },
    ]);
    prismaMock.lLMProvider.findMany.mockResolvedValueOnce([
      { name: 'node-ollama', display_name: 'GPU Node', enabled: true, deleted_at: null },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/registry' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<any>;
    expect(body[0].functionCallingAccuracy).toBe(0.91); // column-first
    expect(body[1].functionCallingAccuracy).toBe(0.87); // MCR fallback
    expect(body[0].inputCostPer1k).toBe(0); // local-provider free
    expect(body[0].costSource).toBe('local-free');
  });

  it('PATCH: persists functionCallingAccuracy to the column', async () => {
    prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce({ id: 'r-1', options: {} });
    prismaMock.modelRoleAssignment.update.mockResolvedValueOnce({ id: 'r-1', function_calling_accuracy: 0.88 });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/llm-providers/registry/r-1',
      payload: { functionCallingAccuracy: 0.88 },
    });
    expect(res.statusCode).toBe(200);
    const updateArgs = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
    expect(updateArgs.data.function_calling_accuracy).toBe(0.88);
  });

  it('PATCH: rejects out-of-range functionCallingAccuracy with 400', async () => {
    prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce({ id: 'r-1', options: {} });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/llm-providers/registry/r-1',
      payload: { functionCallingAccuracy: 1.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(prismaMock.modelRoleAssignment.update).not.toHaveBeenCalled();
  });
});
