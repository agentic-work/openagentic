/**
 * TDD — fail-closed model→provider routing (2026-04-28).
 *
 * RED-PHASE bug repro:
 *   Live cluster: admin set `default_models.code` to a Bedrock cross-region
 *   inference profile id ("global.anthropic.claude-sonnet-4-20250514-v1:0").
 *   The ProviderManager's modelToProviderMap had only 4 entries (gpt-oss:20b,
 *   nomic-embed-text:latest, nvidia.nemotron-nano-12b-v2,
 *   amazon.nova-2-multimodal-embeddings-v1:0). The Sonnet profile id was
 *   not in any map AND was not handled by the existing alias loop (which
 *   only tries `anthropic.` / `us.anthropic.` prefixes — `global.anthropic.`
 *   was missed).
 *
 *   Result: getProviderForModel returned null, the openagentic handler then
 *   silently fell through to listModels()[0] (ollama-hal.gpt-oss:20b), and
 *   somewhere downstream the SONNET id leaked into OllamaProvider, which
 *   emitted "Model 'global.anthropic...' is not available on the Ollama
 *   host. Use 'ollama pull glo…'" — see boot probe model_ping fail.
 *
 * GREEN contract this test pins:
 *   1. getProviderForModel('global.anthropic.claude-*') resolves to a Bedrock
 *      provider when the registry has any Bedrock provider with an Anthropic
 *      family model.
 *   2. getProviderForModel('') / null / undefined THROWS (not silently null).
 *   3. getProviderForModel returns the matching provider for direct-mapped
 *      models (regression guard for the existing happy path).
 *   4. Bedrock-prefixed ids (`anthropic.`, `us.anthropic.`, `global.anthropic.`,
 *      `amazon.`, `us.amazon.`) all resolve to a Bedrock provider when one
 *      with the right family is enabled — even when the exact model id has
 *      not been added to the registry yet (heuristic fallback before fail).
 *   5. Truly-unknown ids (no heuristic match, no map hit) return null —
 *      the existing fail-closed contract holds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
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

import { ProviderManager } from '../llm-providers/ProviderManager.js';

/**
 * Build a ProviderManager populated with a fixed model→provider map and a
 * provider list, bypassing real .initialize() (which needs DB + live API
 * calls). Tests poke the private fields directly via `as any` to simulate
 * a post-init state.
 */
function makePopulatedPM(opts: {
  modelToProvider: Record<string, string>;
  /** Provider name → SDK type (mirrors what providerConfigs holds) */
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
  // Fake initialized state.
  (pm as any).initialized = true;
  // Populate model→provider map.
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.modelToProvider)) {
    map.set(k.toLowerCase(), v);
  }
  (pm as any).modelToProviderMap = map;
  // Populate providers map with a stub for each provider name (so
  // hasProvider checks pass). The stub mimics ILLMProvider but we never
  // actually call it for these routing-only tests.
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

describe('ProviderManager.getProviderForModel — fail-closed routing (2026-04-28)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('explicit registry mapping', () => {
    it('returns the mapped provider for a directly-registered model', () => {
      const pm = makePopulatedPM({
        modelToProvider: {
          'gpt-oss:20b': 'ollama-hal',
          'nvidia.nemotron-nano-12b-v2': 'bedrock-blitz',
        },
        providerTypes: {
          'ollama-hal': 'ollama',
          'bedrock-blitz': 'aws-bedrock',
        },
      });
      expect(pm.getProviderForModel('gpt-oss:20b')).toBe('ollama-hal');
      expect(pm.getProviderForModel('nvidia.nemotron-nano-12b-v2')).toBe('bedrock-blitz');
    });
  });

  // -------------------------------------------------------------------------
  // #912 (2026-05-20) — Bedrock prefix-heuristic RIPPED.
  //
  // Pre-rip: name-substring prefix matches (`global.anthropic.*`,
  // `amazon.*`, `us.anthropic.*`) routed to a Bedrock provider when one
  // was enabled, EVEN IF the specific model id wasn't in the registry.
  // Per the two-SoT contract, the registry IS the source of truth — an
  // admin who hasn't registered a specific id shouldn't have it
  // silently routed via family name. Throw MODEL_NOT_IN_REGISTRY
  // instead.
  // -------------------------------------------------------------------------
  describe('Bedrock prefix heuristic RIPPED — unknown ids fail-closed (#912)', () => {
    it('throws MODEL_NOT_IN_REGISTRY for global.anthropic.* id not explicitly in the registry', () => {
      const pm = makePopulatedPM({
        modelToProvider: {
          // 4-entry map — no `global.anthropic.*` entry, but a Bedrock
          // provider IS configured with another Anthropic id. Pre-rip
          // the heuristic would have resolved this anyway; post-rip it
          // throws.
          'gpt-oss:20b': 'ollama-hal',
          'nomic-embed-text:latest': 'ollama-hal',
          'nvidia.nemotron-nano-12b-v2': 'bedrock-blitz',
          'amazon.nova-2-multimodal-embeddings-v1:0': 'bedrock-blitz',
          'anthropic.claude-sonnet-4-6': 'bedrock-blitz',
        },
        providerTypes: {
          'ollama-hal': 'ollama',
          'bedrock-blitz': 'aws-bedrock',
        },
      });
      expect(() =>
        pm.getProviderForModel('global.anthropic.claude-sonnet-4-20250514-v1:0'),
      ).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });

    it('resolves explicit registry entries, throws on un-registered family prefixes', () => {
      const pm = makePopulatedPM({
        modelToProvider: {
          'anthropic.claude-sonnet-4-6': 'bedrock-blitz',
        },
        providerTypes: { 'bedrock-blitz': 'aws-bedrock' },
      });
      // Already-registered anthropic.* hits exact map (happy path unchanged).
      expect(pm.getProviderForModel('anthropic.claude-sonnet-4-6')).toBe('bedrock-blitz');
      // us.anthropic.* not in map — heuristic ripped, throw.
      expect(() =>
        pm.getProviderForModel('us.anthropic.claude-haiku-4-5-20251001-v1:0'),
      ).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });

    it('throws on un-registered amazon.* (Nova/Titan) prefixes', () => {
      const pm = makePopulatedPM({
        modelToProvider: {
          'amazon.nova-2-multimodal-embeddings-v1:0': 'bedrock-blitz',
        },
        providerTypes: { 'bedrock-blitz': 'aws-bedrock' },
      });
      // Pre-rip these resolved via amazon.* → Bedrock heuristic. Post-rip throw.
      expect(() => pm.getProviderForModel('amazon.titan-text-express-v1')).toThrow(/MODEL_NOT_IN_REGISTRY/);
      expect(() => pm.getProviderForModel('us.amazon.nova-pro-v1:0')).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });
  });

  describe('disambiguation: multiple Bedrock providers (#912 — heuristic ripped)', () => {
    it('still throws on un-registered ids even when multiple Bedrock providers are configured', () => {
      const pm = makePopulatedPM({
        modelToProvider: {
          'anthropic.claude-sonnet-4-6': 'bedrock-blitz',
          'anthropic.claude-opus-4-7': 'bedrock-east1',
        },
        providerTypes: {
          'bedrock-blitz': 'aws-bedrock',
          'bedrock-east1': 'aws-bedrock',
        },
      });
      // Pre-rip the heuristic resolved this to one of the Bedrock providers.
      // Post-rip: the admin hasn't explicitly registered this exact id —
      // throw instead of guessing.
      expect(() =>
        pm.getProviderForModel('global.anthropic.claude-sonnet-4-20250514-v1:0'),
      ).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });
  });

  describe('empty / null / undefined input — fail-closed', () => {
    it('throws when called with empty string', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      expect(() => pm.getProviderForModel('')).toThrow(/empty|missing|model/i);
    });

    it('throws when called with null', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      // @ts-expect-error — testing runtime null behavior
      expect(() => pm.getProviderForModel(null)).toThrow(/empty|missing|model/i);
    });

    it('throws when called with undefined', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      // @ts-expect-error — testing runtime undefined behavior
      expect(() => pm.getProviderForModel(undefined)).toThrow(/empty|missing|model/i);
    });
  });

  describe('genuinely-unknown model ids — throw MODEL_NOT_IN_REGISTRY (#912)', () => {
    it('throws when no map entry, no provider type available', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      expect(() => pm.getProviderForModel('anthropic.claude-sonnet-4-6')).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });

    it('throws for a totally novel id with no known prefix', () => {
      const pm = makePopulatedPM({
        modelToProvider: { 'gpt-oss:20b': 'ollama-hal' },
        providerTypes: { 'ollama-hal': 'ollama' },
      });
      expect(() => pm.getProviderForModel('totally-novel-vendor.fake-model-v1')).toThrow(/MODEL_NOT_IN_REGISTRY/);
    });
  });

  // -------------------------------------------------------------------------
  // 2026-05-01 — Multi-host cloud trust: AIF/Bedrock/Vertex host third-party
  // model families under the family name (gpt-oss-120b, claude-*, llama-*).
  // ProviderManager.buildModelToProviderMap MUST trust the explicit
  // registration on these clouds and skip the name-pattern → ollama heuristic
  // that was reassigning AIF's gpt-oss-120b to ollama (which is disabled).
  // Live regression: user added gpt-oss-120b on AIF eastus2 and got
  //   "Model 'gpt-oss-120b' maps to provider 'ollama' which is currently disabled"
  // -------------------------------------------------------------------------
  describe('multi-host cloud trust (AIF/Bedrock/Vertex hosting third-party families)', () => {
    /**
     * Drive a real buildModelToProviderMap pass against a synthetic config
     * (no DB, no live providers). Returns the resulting model→provider map.
     */
    function buildMapFromConfig(opts: {
      providers: Array<{ name: string; type: string; models: string[] }>;
    }): Map<string, string> {
      const fakeLogger: any = {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
        child: () => fakeLogger,
      };
      const pm = new ProviderManager(fakeLogger, {
        providers: opts.providers.map(p => ({
          name: p.name,
          type: p.type,
          enabled: true,
          // buildModelToProviderMap reads providerConfig.config.models[] —
          // each entry is `{ id: 'foo' }` or `{ name: 'foo' }`. See
          // ProviderManager.ts:725-732.
          config: {
            models: p.models.map(m => ({ id: m })),
          },
        })) as any,
        enableFailover: false,
        failoverTimeout: 30000,
        imageGenTimeout: 60000,
        enableLoadBalancing: false,
        loadBalancingStrategy: 'priority',
      });
      // Fake initialized provider instances (just for hasProvider checks).
      const providers = new Map<string, any>();
      const providerConfigs: Array<{ name: string; provider_type: string }> = [];
      for (const p of opts.providers) {
        providers.set(p.name, { type: p.type });
        providerConfigs.push({ name: p.name, provider_type: p.type });
      }
      (pm as any).providers = providers;
      (pm as any).providerConfigs = providerConfigs;
      // Run the real builder.
      (pm as any).buildModelToProviderMap();
      return (pm as any).modelToProviderMap as Map<string, string>;
    }

    it('AIF (azure-ai-foundry) hosting gpt-oss-120b registers it to AIF, NOT ollama', () => {
      // The smoking-gun fix: Microsoft Azure AI Foundry hosts the OpenAI-OSS
      // family in Azure datacenters under the original name. The previous
      // name-pattern heuristic was reassigning to ollama (disabled) → fatal
      // routing error in chat. Trust the explicit AIF registration.
      const map = buildMapFromConfig({
        providers: [
          {
            name: 'aif-eastus2',
            type: 'azure-ai-foundry',
            models: ['gpt-oss-120b', 'gpt-5.4', 'text-embedding-3-large'],
          },
        ],
      });
      expect(map.get('gpt-oss-120b')).toBe('aif-eastus2');
      expect(map.get('gpt-oss-120b')).not.toBe('ollama');
    });

    it('AIF hosting claude-* family (Anthropic in MS DC) registers them to AIF', () => {
      // Microsoft hosts Anthropic Claude on AIF in MS datacenters
      // (NIST 800-53 / sovereignty-relevant). Bare `claude-*` family names on AIF
      // are NOT caught by the existing `anthropic.` Bedrock prefix table —
      // without trust they would fall through to no provider at all.
      const map = buildMapFromConfig({
        providers: [
          {
            name: 'aif-eastus2',
            type: 'azure-ai-foundry',
            models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-7'],
          },
        ],
      });
      expect(map.get('claude-sonnet-4-6')).toBe('aif-eastus2');
      expect(map.get('claude-haiku-4-5')).toBe('aif-eastus2');
      expect(map.get('claude-opus-4-7')).toBe('aif-eastus2');
    });

    it('AWS Bedrock hosting gpt-oss-120b (cross-vendor) registers it to Bedrock, not ollama', () => {
      // Bedrock has begun hosting OpenAI-OSS and other cross-vendor families.
      // Same trust rule as AIF.
      const map = buildMapFromConfig({
        providers: [
          {
            name: 'bedrock-east1',
            type: 'aws-bedrock',
            models: ['anthropic.claude-sonnet-4-6', 'gpt-oss-120b'],
          },
        ],
      });
      expect(map.get('gpt-oss-120b')).toBe('bedrock-east1');
    });

    it('Vertex AI hosting llama-* (cross-vendor) registers to Vertex, not ollama', () => {
      const map = buildMapFromConfig({
        providers: [
          {
            name: 'vertex-prod',
            type: 'vertex-ai',
            models: ['gemini-2.5-flash', 'llama-3.1-70b'],
          },
        ],
      });
      // llama-* would normally fall to ollama by the heuristic; Vertex
      // legitimately hosts it now via Model Garden.
      expect(map.get('llama-3.1-70b')).toBe('vertex-prod');
    });

    it('non-trusted ollama provider declaring anthropic.* still gets name-pattern correction', () => {
      // Trust whitelist is narrow: only multi-host clouds (AIF/Bedrock/Vertex).
      // Ollama declaring an explicit Bedrock id (`anthropic.*`) is genuinely
      // misconfigured — the original cross-provider correction still fires.
      const map = buildMapFromConfig({
        providers: [
          {
            name: 'ollama-hal',
            type: 'ollama',
            models: ['anthropic.claude-sonnet-4-6'],  // misconfigured
          },
          {
            name: 'bedrock-blitz',
            type: 'aws-bedrock',
            models: ['anthropic.claude-haiku-4-5'],
          },
        ],
      });
      // anthropic.* MUST route to bedrock, NOT ollama.
      expect(map.get('anthropic.claude-sonnet-4-6')).toBe('bedrock-blitz');
    });
  });
});
