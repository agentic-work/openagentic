/**
 * #650 U7 — POST /api/admin/llm-providers/:providerId/models/:modelId/refresh
 *
 * Re-runs live discovery against the upstream provider and updates the
 * existing Registry row in place. Critical for: (a) admins picking up a
 * provider-side price change without re-adding the model, (b) the daily
 * re-sync cron (U8) which calls the same code path per row.
 *
 * Offline mock-based pattern (mirrors llm-providers.registry-delete.test.ts).
 * Real provider + DB are not required.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const prismaMock: any = {
  lLMProvider: {
    findFirst: vi.fn(),
  },
  modelRoleAssignment: {
    findFirst: vi.fn(),
    update: vi.fn(),
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

import Fastify, { type FastifyInstance } from 'fastify';

const FRESH_DISCOVERY = {
  modelId: 'gemini-2.5-pro',
  providerType: 'google-vertex',
  displayName: 'Gemini 2.5 Pro',
  family: 'gemini-2.5',
  capabilities: {
    chat: true, vision: true, tools: true, thinking: true,
    embeddings: false, imageGeneration: false, streaming: true,
    nativeToolCalling: true,
  },
  contextWindow: 1048576,
  maxOutputTokens: 65536,
  thinkingBudget: 8000,
  temperature: 1.0,
  topP: 0.95,
  topK: 40,
  pricing: {
    inputTokenUsd: 1.30, // PRICE BUMP from a hypothetical 1.25 prior
    outputTokenUsd: 10.0,
    cacheReadUsd: null,
    cacheWriteUsd: null,
    thinkingTokenUsd: null,
    embeddingTokenUsd: null,
    perRequestUsd: null,
    source: 'vertex-publisher-list',
    fetchedAt: '2026-05-07T00:00:00.000Z',
    region: 'us-central1',
  },
};

describe('POST /:id/models/:modelId/refresh — re-runs live discovery (#650 U7)', () => {
  let app: FastifyInstance;
  let providerInstance: any;
  let providerManager: any;

  beforeAll(async () => {
    providerInstance = {
      discoverModelDetails: vi.fn().mockResolvedValue(FRESH_DISCOVERY),
    };
    providerManager = {
      providers: new Map([['vertex', providerInstance]]),
      getProvider: (name: string) => providerManager.providers.get(name) ?? null,
      hasProvider: (name: string) => providerManager.providers.has(name),
    };

    const llmProviderRoutes = (await import('../llm-providers.js')).default;
    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
      request.user = { id: 'test-admin-uuid', email: 'admin@test' };
    });
    await app.register(llmProviderRoutes as any, {
      providerManager,
      prefix: '/api/admin',
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.lLMProvider.findFirst.mockReset();
    prismaMock.modelRoleAssignment.findFirst.mockReset();
    prismaMock.modelRoleAssignment.update.mockReset();
    providerInstance.discoverModelDetails.mockClear();
    providerInstance.discoverModelDetails.mockResolvedValue(FRESH_DISCOVERY);
  });

  it('re-runs discoverModelDetails(modelId, region) and updates Registry row', async () => {
    prismaMock.lLMProvider.findFirst.mockResolvedValueOnce({
      id: 'p1', name: 'vertex', provider_type: 'google-vertex',
      provider_config: { region: 'us-central1' },
      model_config: {},
    });
    prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce({
      id: 'r1', role: 'chat', model: 'gemini-2.5-pro', provider: 'vertex',
    });
    prismaMock.modelRoleAssignment.update.mockResolvedValueOnce({ id: 'r1' });

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/p1/models/gemini-2.5-pro/refresh',
    });
    expect(resp.statusCode).toBe(200);
    expect(providerInstance.discoverModelDetails).toHaveBeenCalledWith(
      'gemini-2.5-pro',
      'us-central1',
    );
    expect(prismaMock.modelRoleAssignment.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'r1' });
    expect(updateArg.data.cost_per_input_token_usd).toBe(1.30);
    expect(updateArg.data.cost_per_output_token_usd).toBe(10.0);
    expect(updateArg.data.pricing_source).toBe('vertex-publisher-list');
    expect(updateArg.data.pricing_fetched_at).toBeInstanceOf(Date);
    expect(updateArg.data.max_tokens).toBe(65536);
    expect(updateArg.data.temperature).toBe(1.0);
    expect(updateArg.data.thinking_budget).toBe(8000);
    expect(updateArg.data.capabilities).toMatchObject({
      chat: true, tools: true, thinking: true, streaming: true,
    });
    expect(updateArg.data.options).toMatchObject({
      contextWindow: 1048576,
      family: 'gemini-2.5',
      topP: 0.95,
      topK: 40,
      nativeToolCalling: true,
    });
  });

  it('returns 404 if Registry row does not exist for this modelId/provider', async () => {
    prismaMock.lLMProvider.findFirst.mockResolvedValueOnce({
      id: 'p1', name: 'vertex', provider_type: 'google-vertex',
      provider_config: { region: 'us-central1' },
      model_config: {},
    });
    prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce(null);

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/p1/models/not-deployed/refresh',
    });
    expect(resp.statusCode).toBe(404);
    expect(prismaMock.modelRoleAssignment.update).not.toHaveBeenCalled();
    expect(providerInstance.discoverModelDetails).not.toHaveBeenCalled();
  });

  it('returns 404 if provider does not exist', async () => {
    prismaMock.lLMProvider.findFirst.mockResolvedValueOnce(null);

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/missing/models/gemini-2.5-pro/refresh',
    });
    expect(resp.statusCode).toBe(404);
    expect(prismaMock.modelRoleAssignment.update).not.toHaveBeenCalled();
  });

  it('returns 502 when discoverModelDetails throws (e.g. provider 403)', async () => {
    prismaMock.lLMProvider.findFirst.mockResolvedValueOnce({
      id: 'p1', name: 'vertex', provider_type: 'google-vertex',
      provider_config: { region: 'us-central1' },
      model_config: {},
    });
    prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce({
      id: 'r1', role: 'chat', model: 'gemini-2.5-pro', provider: 'vertex',
    });
    providerInstance.discoverModelDetails.mockRejectedValueOnce(new Error('Vertex 403'));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/p1/models/gemini-2.5-pro/refresh',
    });
    expect(resp.statusCode).toBe(502);
    expect(JSON.parse(resp.body)).toMatchObject({
      error: expect.stringMatching(/refresh/i),
    });
    expect(prismaMock.modelRoleAssignment.update).not.toHaveBeenCalled();
  });

  it('decodes URL-encoded modelId (handles colons, slashes in model names)', async () => {
    prismaMock.lLMProvider.findFirst.mockResolvedValueOnce({
      id: 'p1', name: 'vertex', provider_type: 'google-vertex',
      provider_config: { region: 'us-central1' },
      model_config: {},
    });
    prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce({
      id: 'r1', role: 'chat', model: 'gpt-oss:20b', provider: 'vertex',
    });
    providerInstance.discoverModelDetails.mockResolvedValueOnce({
      ...FRESH_DISCOVERY, modelId: 'gpt-oss:20b',
    });
    prismaMock.modelRoleAssignment.update.mockResolvedValueOnce({ id: 'r1' });

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/p1/models/gpt-oss%3A20b/refresh',
    });
    expect(resp.statusCode).toBe(200);
    expect(providerInstance.discoverModelDetails).toHaveBeenCalledWith(
      'gpt-oss:20b',
      'us-central1',
    );
  });
});
