/**
 * ProviderManager — prefix-heuristic rip (#912, 2026-05-20).
 *
 * RED-PHASE bug repro:
 *   Pre-rip: detectProviderForModel() at lines 1076-1093 fell back to
 *   inferProviderFromModelName() when the model wasn't in
 *   modelToProviderMap or discoveredCapabilities. This substring-sniff
 *   path mapped:
 *     - 'us.anthropic.*' / 'anthropic.*' / 'amazon.*' / 'global.*'
 *       → 'aws-bedrock'
 *     - 'gemini' / 'palm' / 'imagen' → 'vertex-ai'
 *     - 'gpt-4.1' / 'gpt-5.*' → 'azure-ai-foundry'
 *     - ':<tag>' / 'gpt-oss' / 'llama' / 'qwen' / 'deepseek' / 'phi-'
 *       → 'ollama'
 *
 *   Per the two-SoT contract, the registry IS the source of truth. The
 *   prefix-heuristic fallback bypassed admin intent: an admin could
 *   disable a model in the registry but the heuristic would still
 *   resolve it to the matching provider via name pattern.
 *
 * GREEN contract pinned here:
 *   1. getProviderForModel() for an UNKNOWN model id (no map hit, no
 *      discovery match) MUST throw an Error containing
 *      "MODEL_NOT_IN_REGISTRY" — it does NOT silently return a
 *      provider from name-prefix heuristic.
 *   2. getProviderForModel() still returns the mapped provider when
 *      the model IS in the registry's modelToProviderMap. (Regression
 *      guard for happy path.)
 *   3. getProviderForModel() still throws on empty/null/undefined input.
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

/**
 * Build a ProviderManager populated with a fixed model→provider map and a
 * provider list. Mirrors the pattern from ProviderManager.routing.test.ts
 * — bypasses initialize() to keep tests pure.
 */
function makePopulatedPM(opts: {
  modelToProvider: Record<string, string>;
  providerTypes: Record<string, string>;
}): ProviderManager {
  const fakeLogger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => fakeLogger };
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
  const providers = new Map<string, any>();
  const providerConfigs: Array<{ name: string; provider_type: string }> = [];
  for (const [name, type] of Object.entries(opts.providerTypes)) {
    providers.set(name, { type });
    providerConfigs.push({ name, provider_type: type });
  }
  (pm as any).providers = providers;
  (pm as any).providerConfigs = providerConfigs;
  return pm;
}

describe('ProviderManager — prefix-heuristic rip (#912, 2026-05-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path (registry SoT) — unchanged', () => {
    it('returns mapped provider for a directly-registered model', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'us.anthropic.claude-sonnet-4-6': 'bedrock-blitz' },
        providerTypes: { 'bedrock-blitz': 'aws-bedrock' },
      });
      expect(pm.getProviderForModel('us.anthropic.claude-sonnet-4-6')).toBe('bedrock-blitz');
    });

    it('still resolves via stripped-version-suffix on registered ids', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      expect(pm.getProviderForModel('gpt-oss:20b')).toBe('ollama-hal');
    });
  });

  describe('prefix-heuristic rip — unknown model ids fail-closed', () => {
    it('throws MODEL_NOT_IN_REGISTRY for unknown global.anthropic.* (no map hit)', () => {
      const pm = makePopulatedPM({
        // No 'global.anthropic.*' in map. A Bedrock provider IS enabled
        // with another Anthropic family entry — but that should NOT be
        // enough to resolve a model that's not explicitly in the
        // registry.
        modelToProvider: { 'anthropic.claude-sonnet-4-6': 'bedrock-blitz' },
        providerTypes: { 'bedrock-blitz': 'aws-bedrock' },
      });
      expect(() =>
        pm.getProviderForModel('global.anthropic.claude-sonnet-4-20250514-v1:0'),
      ).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });

    it('throws MODEL_NOT_IN_REGISTRY for an unknown amazon.* id (no name-heuristic)', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'amazon.nova-2-multimodal-embeddings-v1:0': 'bedrock-blitz' },
        providerTypes: { 'bedrock-blitz': 'aws-bedrock' },
      });
      expect(() => pm.getProviderForModel('amazon.titan-text-express-v1')).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });

    it('throws MODEL_NOT_IN_REGISTRY for an unknown gemini.* id', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gemini-1.5-pro': 'vertex-prod' },
        providerTypes: { 'vertex-prod': 'vertex-ai' },
      });
      expect(() => pm.getProviderForModel('gemini-3.5-ultra')).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });

    it('throws MODEL_NOT_IN_REGISTRY for a totally novel id with no prefix hint', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      expect(() =>
        pm.getProviderForModel('totally-novel-vendor.fake-model-v1'),
      ).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });
  });

  describe('empty / null / undefined input — fail-closed (regression)', () => {
    it('throws on empty string', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      expect(() => pm.getProviderForModel('')).toThrow(/empty|missing|model/i);
    });

    it('throws on null', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      // @ts-expect-error — runtime null
      expect(() => pm.getProviderForModel(null)).toThrow(/empty|missing|model/i);
    });

    it('throws on undefined', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      // @ts-expect-error — runtime undefined
      expect(() => pm.getProviderForModel(undefined)).toThrow(/empty|missing|model/i);
    });
  });
});
