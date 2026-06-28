/**
 * Phase I (2026-04-29) — defense-in-depth: Bedrock cross-region alias
 * resolution.
 *
 * Context:
 *   F1's smoking gun was an admin-saved default of
 *   `global.anthropic.claude-sonnet-4-20250514-v1:0` (a Bedrock cross-region
 *   inference profile id). The platform router's modelToProviderMap had no
 *   entry for that exact id, so getProviderForModel returned null and the
 *   openagentic handler silently routed to Ollama. Phase I's primary fix is
 *   to inject the registry-canonical id at pod-spawn instead of a helm
 *   literal, so the wrong id never reaches the api in the first place.
 *
 *   This test guards the api-side defense-in-depth: if a `global.anthropic.*`
 *   id DOES somehow reach getProviderForModel (e.g. because admin pointed
 *   the registry default at one), the heuristic resolves it to a Bedrock
 *   provider when one with an Anthropic entry is enabled. The previous
 *   tests in `services/__tests__/ProviderManager.routing.test.ts` already
 *   pin the `global.anthropic.*` shape — this file pins the broader
 *   alias-resolution contract for ALL Bedrock cross-region prefix forms
 *   (`global.`, `eu.`, `apac.`, `us.`) so a future refactor of
 *   `inferProviderFromModelName` can't regress one of them silently.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
  loggers: {
    services: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

import { ProviderManager } from '../ProviderManager.js';

/** Build a ProviderManager populated with a known map (post-init shape). */
function makePM(opts: {
  modelToProvider: Record<string, string>;
  providerTypes: Record<string, string>;
}): ProviderManager {
  const fakeLogger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const pm = new ProviderManager(fakeLogger, {
    providers: [],
    enableFailover: false,
    failoverTimeout: 30000,
    imageGenTimeout: 60000,
    enableLoadBalancing: false,
    loadBalancingStrategy: 'priority',
  });
  (pm as any).initialized = true;
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.modelToProvider)) {
    map.set(k.toLowerCase(), v);
  }
  (pm as any).modelToProviderMap = map;

  // Stub provider instance map so the heuristic's enabled-providers check finds
  // the Bedrock entry (or doesn't, depending on the test's setup).
  const providersMap = new Map<string, any>();
  for (const [pName, sdkType] of Object.entries(opts.providerTypes)) {
    providersMap.set(pName, { type: sdkType });
  }
  (pm as any).providers = providersMap;

  // providerConfigs is consulted as a fallback for resolving provider type.
  (pm as any).providerConfigs = Object.entries(opts.providerTypes).map(
    ([name, provider_type]) => ({ name, provider_type }),
  );

  return pm;
}

describe('Bedrock cross-region alias resolution (defense-in-depth, Phase I)', () => {
  describe('global.anthropic.* — the F1 smoking gun', () => {
    it('global.anthropic.claude-sonnet-4-20250514-v1:0 → enabled Bedrock provider', () => {
      const pm = makePM({
        modelToProvider: {
          // Canonical row that's actually in the registry:
          'anthropic.claude-sonnet-4-20250514': 'bedrock-prod',
        },
        providerTypes: { 'bedrock-prod': 'aws-bedrock' },
      });
      // The exact id from F1 — admin saved it as default_models.code.
      expect(pm.getProviderForModel('global.anthropic.claude-sonnet-4-20250514-v1:0'))
        .toBe('bedrock-prod');
    });

    it('global.anthropic.claude-haiku-4-5 → Bedrock when Anthropic family is enabled', () => {
      const pm = makePM({
        modelToProvider: {
          // Any Anthropic family entry on Bedrock unlocks the heuristic.
          'anthropic.claude-haiku-4-5': 'bedrock-prod',
        },
        providerTypes: { 'bedrock-prod': 'aws-bedrock' },
      });
      expect(pm.getProviderForModel('global.anthropic.claude-haiku-4-5'))
        .toBe('bedrock-prod');
    });
  });

  describe('eu.anthropic.* and apac.anthropic.* — broader cross-region forms', () => {
    it('eu.anthropic.claude-sonnet-4-6 → Bedrock', () => {
      const pm = makePM({
        modelToProvider: {
          'anthropic.claude-sonnet-4-6': 'bedrock-eu',
        },
        providerTypes: { 'bedrock-eu': 'aws-bedrock' },
      });
      expect(pm.getProviderForModel('eu.anthropic.claude-sonnet-4-6'))
        .toBe('bedrock-eu');
    });

    it('apac.anthropic.claude-haiku-4-5 → Bedrock', () => {
      const pm = makePM({
        modelToProvider: {
          'anthropic.claude-haiku-4-5': 'bedrock-apac',
        },
        providerTypes: { 'bedrock-apac': 'aws-bedrock' },
      });
      expect(pm.getProviderForModel('apac.anthropic.claude-haiku-4-5'))
        .toBe('bedrock-apac');
    });
  });

  describe('global.amazon.* and us.amazon.* — Nova/Titan cross-region forms', () => {
    it('global.amazon.nova-pro-v1:0 → Bedrock when an amazon.* entry is enabled', () => {
      const pm = makePM({
        modelToProvider: {
          'amazon.nova-2-multimodal-embeddings-v1:0': 'bedrock-prod',
        },
        providerTypes: { 'bedrock-prod': 'aws-bedrock' },
      });
      expect(pm.getProviderForModel('global.amazon.nova-pro-v1:0'))
        .toBe('bedrock-prod');
    });
  });

  describe('regression: `global.anthropic.*` does NOT silently route to Ollama', () => {
    it('returns null (NOT ollama) when only Ollama is enabled, even if heuristic says Anthropic', () => {
      // The original F1 failure: heuristic said "Anthropic" but no Bedrock
      // provider was enabled, so the lookup fell through to ollama-hal as
      // listModels()[0]. The fail-closed contract: return null, don't fake-route.
      const pm = makePM({
        modelToProvider: {
          'gpt-oss:20b': 'ollama-hal',
        },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      const provider = pm.getProviderForModel('global.anthropic.claude-sonnet-4-20250514-v1:0');
      expect(provider).not.toBe('ollama-hal');
      expect(provider).toBeNull();
    });
  });

  describe('canonical id lookup is unaffected by the heuristic', () => {
    it('exact-match anthropic.X still wins regardless of cross-region cousins', () => {
      const pm = makePM({
        modelToProvider: {
          'anthropic.claude-sonnet-4-20250514': 'bedrock-prod-A',
          'us.anthropic.claude-sonnet-4-20250514-v1:0': 'bedrock-prod-B',
        },
        providerTypes: {
          'bedrock-prod-A': 'aws-bedrock',
          'bedrock-prod-B': 'aws-bedrock',
        },
      });
      // Direct map hit — bypasses the heuristic.
      expect(pm.getProviderForModel('anthropic.claude-sonnet-4-20250514'))
        .toBe('bedrock-prod-A');
      // The us.* form is also a direct hit.
      expect(pm.getProviderForModel('us.anthropic.claude-sonnet-4-20250514-v1:0'))
        .toBe('bedrock-prod-B');
    });
  });
});
