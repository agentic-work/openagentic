/**
 * Phase I — SmartModelRouter availability gate
 *
 * Spec: docs/superpowers/specs/2026-04-30-ollama-split-topology.md §Phase I
 *
 * Bug: candidate filter sites (routeRequest, simulateRouting,
 * getCheapestChatModel) trust `m.metadata.isAvailable`. Nothing in the
 * resolution path sets `isAvailable=false` when the resolved provider
 * has `enabled=false` or `deleted_at != null`. So even after Phases G+H
 * close the registry-side leak, the router can still pick a model whose
 * provider is gone.
 *
 * Fix: at filter time, also check whether the model's provider is
 * present in `providerManager.getProviders()`. If the provider isn't
 * live (soft-deleted or disabled), drop the candidate AND flip the
 * cached profile's `metadata.isAvailable=false` so the next routing
 * decision is faster (and so getCheapestChatModel, which doesn't
 * consult providerManager, also excludes it).
 *
 * Style: pure unit-test using fake ProviderManager. No real DB / Prisma.
 */
import { describe, it, expect } from 'vitest';
import pino from 'pino';

const SILENT_LOGGER = pino({ level: 'silent' });

// Generic test profile factory — no hardcoded real model IDs.
function buildProfile(overrides: Partial<any> & { modelId: string; provider?: string }): any {
  return {
    modelId: overrides.modelId,
    provider: overrides.provider ?? 'live-provider',
    providerType: overrides.providerType ?? 'azure-openai',
    capabilities: {
      chat: true,
      functionCalling: true,
      functionCallingAccuracy: 0.92,
      vision: false,
      imageGeneration: false,
      embeddings: false,
      streaming: true,
      jsonMode: true,
      structuredOutput: true,
      supportsToolInputDelta: false,
      supportsThinking: false,
      supportsCitations: false,
      supportsSyntheticThinking: false,
      ...(overrides.capabilities ?? {}),
    },
    performance: {
      maxContextTokens: 200_000,
      maxOutputTokens: 8_000,
      avgLatencyMs: 500,
      tokensPerSecond: 50,
      ...(overrides.performance ?? {}),
    },
    cost: {
      inputPer1kTokens: 0.001,
      outputPer1kTokens: 0.003,
      currency: 'USD',
      ...(overrides.cost ?? {}),
    },
    metadata: {
      family: 'test',
      version: '1.0',
      specializations: [],
      lastTested: new Date(),
      isAvailable: true,
      ...(overrides.metadata ?? {}),
    },
  };
}

/**
 * Build a fake ProviderManager:
 *   - `getProviders()` returns a Map containing ONLY the names listed in
 *     `liveProviderNames` — soft-deleted/disabled providers are absent.
 *   - `isModelEnabled(modelId)` returns true iff `modelId`'s provider is live.
 */
function buildProviderManager(opts: {
  liveProviderNames: string[];
  modelToProvider: Record<string, string>;
}) {
  const providers = new Map<string, any>();
  for (const name of opts.liveProviderNames) {
    providers.set(name, {} as any);
  }
  return {
    getProviders: () => providers,
    isModelEnabled: (modelId: string) => {
      const provider = opts.modelToProvider[modelId];
      if (!provider) return false;
      return providers.has(provider);
    },
  };
}

describe('SmartModelRouter — Phase I availability gate', () => {
  async function loadRouter() {
    const mod = await import('../SmartModelRouter.js');
    return mod;
  }

  it('routeRequest excludes a model whose provider is soft-deleted (absent from getProviders)', async () => {
    const { SmartModelRouter } = await loadRouter();

    // Two providers: provider-A is live, provider-B is soft-deleted (absent).
    const providerManager = buildProviderManager({
      liveProviderNames: ['provider-A'],
      modelToProvider: {
        'test-model-A': 'provider-A',
        'test-model-B': 'provider-B',
      },
    });

    const router = new SmartModelRouter(SILENT_LOGGER, {
      providerManager: providerManager as any,
    });

    // Pre-load both profiles directly (simulates a state where SmartModelRouter
    // discovered both before provider-B was soft-deleted, and its cache hasn't
    // been re-cleared since).
    router.addModelProfile(
      buildProfile({
        modelId: 'test-model-A',
        provider: 'provider-A',
        capabilities: { functionCallingAccuracy: 0.92 } as any,
      }),
    );
    router.addModelProfile(
      buildProfile({
        modelId: 'test-model-B',
        provider: 'provider-B',
        capabilities: { functionCallingAccuracy: 0.95 } as any,
      }),
    );

    const decision = await router.routeRequest({
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    // Must pick the LIVE provider's model — never the soft-deleted one,
    // even though test-model-B has higher FCA and would normally win.
    expect(decision.selectedModel.modelId).toBe('test-model-A');
    expect(decision.selectedModel.provider).toBe('provider-A');
    expect(decision.alternativeModels.map((m: any) => m.modelId)).not.toContain('test-model-B');
  });

  it('routeRequest excludes a model whose provider is disabled (enabled=false → absent from getProviders)', async () => {
    // Same exclusion path: a disabled provider is also absent from
    // ProviderManager.getProviders() (init/reinit skips disabled rows).
    const { SmartModelRouter } = await loadRouter();

    const providerManager = buildProviderManager({
      liveProviderNames: ['enabled-provider'],
      modelToProvider: {
        'test-model-A': 'enabled-provider',
        'test-model-B': 'disabled-provider',
      },
    });

    const router = new SmartModelRouter(SILENT_LOGGER, {
      providerManager: providerManager as any,
    });

    router.addModelProfile(
      buildProfile({
        modelId: 'test-model-A',
        provider: 'enabled-provider',
        capabilities: { functionCallingAccuracy: 0.92 } as any,
      }),
    );
    router.addModelProfile(
      buildProfile({
        modelId: 'test-model-B',
        provider: 'disabled-provider',
        capabilities: { functionCallingAccuracy: 0.95 } as any,
      }),
    );

    const decision = await router.routeRequest({
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    expect(decision.selectedModel.modelId).toBe('test-model-A');
    expect(decision.selectedModel.provider).toBe('enabled-provider');
  });

  it('candidate filter flips metadata.isAvailable=false on the cached profile when the provider is gone', async () => {
    // Phase I behavioural contract per spec: "set metadata.isAvailable=false
    // when the resolved provider has enabled=false || deleted_at != null."
    // After at least one routeRequest, the stale profile's flag has been
    // updated in place — so callers like getCheapestChatModel (which only
    // consult metadata.isAvailable, NOT providerManager.isModelEnabled)
    // also exclude the gone-provider's model.
    const { SmartModelRouter } = await loadRouter();

    const providerManager = buildProviderManager({
      liveProviderNames: ['live-provider'],
      modelToProvider: {
        'test-model-A': 'live-provider',
        'test-model-B': 'gone-provider',
      },
    });

    const router = new SmartModelRouter(SILENT_LOGGER, {
      providerManager: providerManager as any,
    });

    router.addModelProfile(
      buildProfile({
        modelId: 'test-model-A',
        provider: 'live-provider',
      }),
    );
    const goneProfile = buildProfile({
      modelId: 'test-model-B',
      provider: 'gone-provider',
    });
    router.addModelProfile(goneProfile);

    // Sanity: the gone profile starts marked available (stale cache).
    expect(goneProfile.metadata.isAvailable).toBe(true);

    await router.routeRequest({
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    // Phase I: after routing, the stale profile has been flipped to
    // unavailable in-place so the next read of metadata.isAvailable is
    // already correct (no second exclusion-path roundtrip needed).
    expect(goneProfile.metadata.isAvailable).toBe(false);

    // getCheapestChatModel only checks metadata.isAvailable — it must
    // also exclude the gone provider's model now.
    const cheapest = router.getCheapestChatModel();
    expect(cheapest?.modelId).toBe('test-model-A');
  });

  it('a provider that becomes available again is included on the next route', async () => {
    // Recovery scenario: provider-B was soft-deleted, an admin un-soft-deletes
    // (or re-enables) it via the Admin UI. ProviderManager.reloadProviders()
    // adds it back to the live map. SmartModelRouter does NOT need a full
    // profile cache rebuild — the next routeRequest sees the live provider
    // and re-marks the profile available.
    const { SmartModelRouter } = await loadRouter();

    // Phase 1: provider-B starts as gone.
    const liveSet = new Set<string>(['provider-A']);
    const providerManager = {
      getProviders: () => {
        const m = new Map<string, any>();
        for (const name of liveSet) m.set(name, {} as any);
        return m;
      },
      isModelEnabled: (modelId: string) => {
        const map: Record<string, string> = {
          'test-model-A': 'provider-A',
          'test-model-B': 'provider-B',
        };
        const provider = map[modelId];
        return Boolean(provider && liveSet.has(provider));
      },
    };

    const router = new SmartModelRouter(SILENT_LOGGER, {
      providerManager: providerManager as any,
    });

    // Differentiate the two profiles by cost so scoring can pick the
    // recovering model deterministically once it's eligible. test-model-A
    // is more expensive; test-model-B is cheaper, so cost-weighted scoring
    // prefers B as soon as B becomes routable again.
    router.addModelProfile(
      buildProfile({
        modelId: 'test-model-A',
        provider: 'provider-A',
        capabilities: { functionCallingAccuracy: 0.85 } as any,
        cost: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.03, currency: 'USD' },
      }),
    );
    const recoveringProfile = buildProfile({
      modelId: 'test-model-B',
      provider: 'provider-B',
      capabilities: { functionCallingAccuracy: 0.95 } as any,
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
    });
    router.addModelProfile(recoveringProfile);

    // First route: provider-B is gone → routed to provider-A (only candidate).
    const firstDecision = await router.routeRequest({
      messages: [{ role: 'user', content: 'hello' }],
    } as any);
    expect(firstDecision.selectedModel.modelId).toBe('test-model-A');
    expect(recoveringProfile.metadata.isAvailable).toBe(false);

    // Phase 2: admin un-soft-deletes provider-B → it's back in the live map.
    liveSet.add('provider-B');

    const secondDecision = await router.routeRequest({
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    // Now provider-B's cheaper (and higher-FCA) model is preferred again.
    expect(secondDecision.selectedModel.modelId).toBe('test-model-B');
    expect(recoveringProfile.metadata.isAvailable).toBe(true);
  });
});
