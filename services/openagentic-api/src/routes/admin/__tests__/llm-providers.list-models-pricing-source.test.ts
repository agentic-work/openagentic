/**
 * #650 follow-up — GET /api/admin/llm-providers/:providerId/models must
 * surface pricing_source + pricing_fetched_at + family + temperature +
 * topP/topK + thinking_budget + per-token cost rates so the UI can
 * display "where does this number come from?" provenance and the
 * Smart Router has live cost data to bias on.
 *
 * Pre-fix the mapper at line ~2311 only emitted {id, name, capabilities,
 * config: {maxOutputTokens, enabled, role}}. Discovery-time data sat in
 * the DB but never reached the UI.
 *
 * Contract pinned here:
 *   - Each model in `models[]` carries `pricing_source` (e.g.
 *     "vertex-publisher-list") when the DB row has it set.
 *   - Each model carries `pricing_fetched_at` ISO timestamp.
 *   - Each model carries cost-per-token rates as numbers (cost_per_input_token_usd,
 *     cost_per_output_token_usd) when the DB row has them set.
 *   - Each model carries `temperature` + `top_p` + `top_k` + `thinking_budget`.
 *   - Optional fields are absent (not null) when DB row has them null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../../utils/prisma.js', () => {
  const mock: any = {
    modelRoleAssignment: { findMany: vi.fn() },
    lLMProvider: { findFirst: vi.fn(), findUnique: vi.fn() },
  };
  (globalThis as any).__prismaMock = mock;
  return { prisma: mock };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import '../../../utils/prisma.js';
import llmProviderRoutes from '../llm-providers.js';

function prismaMock(): any {
  return (globalThis as any).__prismaMock;
}

describe('#650 follow-up — GET /llm-providers/:providerId/models surfaces discovery fields', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    // Skip auth middleware: test route logic in isolation.
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req: any) => {
      req.user = { id: 'admin-1', email: 'admin@test', isAdmin: true };
    });
    await app.register(llmProviderRoutes as any, { prefix: '/api/admin' });
    await app.ready();
  });

  it('includes pricing_source, pricing_fetched_at, and cost rates in each model entry', async () => {
    prismaMock().lLMProvider.findFirst.mockResolvedValue({
      id: 'p-1',
      name: 'aws-bedrock',
      type: 'aws-bedrock',
      enabled: true,
      provider_config: {},
    });
    prismaMock().modelRoleAssignment.findMany.mockResolvedValue([
      {
        id: 'r-1',
        role: 'chat',
        model: 'us.anthropic.claude-sonnet-4-6',
        provider: 'aws-bedrock',
        priority: 1,
        enabled: true,
        max_tokens: 64000,
        temperature: 1,
        thinking_budget: 10000,
        capabilities: { chat: true, tools: true, streaming: true, thinking: true },
        cost_per_input_token_usd: '3.0',
        cost_per_output_token_usd: '15.0',
        pricing_source: 'bedrock-pricing-sdk',
        pricing_fetched_at: new Date('2026-05-06T16:38:22.673Z'),
        description: 'Claude Sonnet 4.6',
        options: { top_p: 0.95, top_k: 40, family: 'claude-sonnet-4' },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/llm-providers/p-1/models',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.models).toHaveLength(1);
    const m = body.models[0];

    // Discovery provenance fields — the actual point of #650
    expect(m.pricing_source).toBe('bedrock-pricing-sdk');
    expect(m.pricing_fetched_at).toBe('2026-05-06T16:38:22.673Z');

    // Cost rates as numbers (not Prisma Decimal objects)
    expect(typeof m.cost_per_input_token_usd).toBe('number');
    expect(m.cost_per_input_token_usd).toBe(3);
    expect(typeof m.cost_per_output_token_usd).toBe('number');
    expect(m.cost_per_output_token_usd).toBe(15);

    // Per-row generation params
    expect(m.temperature).toBe(1);
    expect(m.thinking_budget).toBe(10000);
  });

  it('omits null pricing fields cleanly (DB row never refreshed)', async () => {
    prismaMock().lLMProvider.findFirst.mockResolvedValue({
      id: 'p-2',
      name: 'ollama-hal',
      type: 'ollama',
      enabled: true,
      provider_config: {},
    });
    prismaMock().modelRoleAssignment.findMany.mockResolvedValue([
      {
        id: 'r-2',
        role: 'chat',
        model: 'gpt-oss:20b',
        provider: 'ollama-hal',
        priority: 10,
        enabled: true,
        max_tokens: 4096,
        temperature: 0.7,
        thinking_budget: null,
        capabilities: { chat: true, tools: true },
        cost_per_input_token_usd: null,
        cost_per_output_token_usd: null,
        pricing_source: null,
        pricing_fetched_at: null,
        description: 'gpt-oss:20b',
        options: {},
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/llm-providers/p-2/models',
    });

    expect(res.statusCode).toBe(200);
    const m = res.json().models[0];
    expect(m.pricing_source).toBeUndefined();
    expect(m.pricing_fetched_at).toBeUndefined();
    expect(m.cost_per_input_token_usd).toBeUndefined();
    // thinking_budget is null on the row → not surfaced
    expect(m.thinking_budget).toBeUndefined();
  });
});
