/**
 * #650 U8 — Daily re-sync job. Walks every Active Registry row, calls
 * provider.discoverModelDetails, updates the row in place, logs price
 * deltas. Per-row failures are isolated — one provider being down must
 * not abort the entire sweep.
 */
import { describe, it, expect, vi } from 'vitest';
import { RefreshModelDetailsJob } from '../RefreshModelDetailsJob.js';

const goldenDiscovery = {
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
    inputTokenUsd: 1.30,    // PRICE BUMP from 1.25
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

const aifDiscovery = {
  ...goldenDiscovery,
  modelId: 'gpt-5.4',
  family: 'gpt-5',
  providerType: 'azure-ai-foundry',
  pricing: { ...goldenDiscovery.pricing, source: 'azure-retail-prices', region: 'eastus2' },
};

describe('RefreshModelDetailsJob (#650 U8)', () => {
  it('walks every enabled+active row and re-runs discoverModelDetails', async () => {
    const prisma: any = {
      modelRoleAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', model: 'gemini-2.5-pro', provider: 'vertex', enabled: true,
            cost_per_input_token_usd: { toString: () => '1.25' },
            cost_per_output_token_usd: { toString: () => '10' } },
          { id: 'r2', model: 'gpt-5.4', provider: 'aif', enabled: true,
            cost_per_input_token_usd: { toString: () => '5' },
            cost_per_output_token_usd: { toString: () => '15' } },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      lLMProvider: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'vertex', provider_type: 'google-vertex',
            provider_config: { region: 'us-central1' }, enabled: true },
          { id: 'p2', name: 'aif', provider_type: 'azure-ai-foundry',
            provider_config: { region: 'eastus2' }, enabled: true },
        ]),
      },
    };
    const providerInstances: Record<string, any> = {
      vertex: { discoverModelDetails: vi.fn().mockResolvedValue(goldenDiscovery) },
      aif: { discoverModelDetails: vi.fn().mockResolvedValue(aifDiscovery) },
    };
    const providerManager: any = {
      getProvider: vi.fn().mockImplementation((name: string) => providerInstances[name]),
    };
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const job = new RefreshModelDetailsJob(prisma, providerManager, logger);
    const result = await job.run();

    expect(result.refreshed).toBe(2);
    expect(result.failed).toBe(0);
    expect(prisma.modelRoleAssignment.update).toHaveBeenCalledTimes(2);
    expect(providerInstances.vertex.discoverModelDetails).toHaveBeenCalledWith(
      'gemini-2.5-pro',
      'us-central1',
    );
    expect(providerInstances.aif.discoverModelDetails).toHaveBeenCalledWith(
      'gpt-5.4',
      'eastus2',
    );
  });

  it('logs a price-delta line when input/output USD changes', async () => {
    const prisma: any = {
      modelRoleAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', model: 'gemini-2.5-pro', provider: 'vertex', enabled: true,
            cost_per_input_token_usd: { toString: () => '1.25' },
            cost_per_output_token_usd: { toString: () => '10' } },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      lLMProvider: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'vertex', provider_type: 'google-vertex',
            provider_config: { region: 'us-central1' }, enabled: true },
        ]),
      },
    };
    const providerManager: any = {
      getProvider: () => ({ discoverModelDetails: vi.fn().mockResolvedValue(goldenDiscovery) }),
    };
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await new RefreshModelDetailsJob(prisma, providerManager, logger).run();

    // Find a logger.info call carrying a delta with both input + output USD diffs.
    const deltaCall = logger.info.mock.calls.find(([payload]: any[]) =>
      payload?.delta?.inputTokenUsd?.from === 1.25 && payload?.delta?.inputTokenUsd?.to === 1.30,
    );
    expect(deltaCall, 'expected a price-delta log with from=1.25 to=1.30').toBeDefined();
  });

  it('continues when one row fails (isolation: per-row try/catch)', async () => {
    const prisma: any = {
      modelRoleAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', model: 'gemini-2.5-pro', provider: 'vertex', enabled: true },
          { id: 'r2', model: 'gpt-5.4', provider: 'aif', enabled: true },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      lLMProvider: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'vertex', provider_type: 'google-vertex',
            provider_config: { region: 'us-central1' }, enabled: true },
          { id: 'p2', name: 'aif', provider_type: 'azure-ai-foundry',
            provider_config: { region: 'eastus2' }, enabled: true },
        ]),
      },
    };
    const providerInstances: Record<string, any> = {
      vertex: { discoverModelDetails: vi.fn().mockRejectedValue(new Error('vertex 403')) },
      aif: { discoverModelDetails: vi.fn().mockResolvedValue(aifDiscovery) },
    };
    const providerManager: any = {
      getProvider: (name: string) => providerInstances[name],
    };
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await new RefreshModelDetailsJob(prisma, providerManager, logger).run();

    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(1);
    // r2 (aif) succeeded; r1 (vertex) failed and was warn-logged.
    expect(prisma.modelRoleAssignment.update).toHaveBeenCalledTimes(1);
    const failedCall = (logger.warn as any).mock.calls.find(([payload]: any[]) =>
      payload?.modelId === 'gemini-2.5-pro',
    );
    expect(failedCall, 'expected warn log for failed row').toBeDefined();
  });

  it('skips rows whose provider has no discoverModelDetails (no-op, no fail)', async () => {
    const prisma: any = {
      modelRoleAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', model: 'old-model', provider: 'legacy', enabled: true },
        ]),
        update: vi.fn(),
      },
      lLMProvider: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'legacy', provider_type: 'legacy', provider_config: {}, enabled: true },
        ]),
      },
    };
    const providerManager: any = {
      getProvider: () => ({ /* no discoverModelDetails */ }),
    };
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await new RefreshModelDetailsJob(prisma, providerManager, logger).run();

    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(0);
    expect(prisma.modelRoleAssignment.update).not.toHaveBeenCalled();
  });

  it('skips rows whose provider row is missing (orphaned)', async () => {
    const prisma: any = {
      modelRoleAssignment: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', model: 'foo', provider: 'gone', enabled: true },
        ]),
        update: vi.fn(),
      },
      lLMProvider: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const providerManager: any = {
      getProvider: vi.fn().mockReturnValue(null),
    };
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await new RefreshModelDetailsJob(prisma, providerManager, logger).run();

    expect(result.refreshed).toBe(0);
    expect(prisma.modelRoleAssignment.update).not.toHaveBeenCalled();
    // We didn't even call providerManager.getProvider for the orphan because
    // there was no provider row to look up; callers asserting on the count
    // shouldn't see 0 for an orphan row.
  });
});
