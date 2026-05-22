import { describe, it, expect } from 'vitest';
import { resolveCodemodeRouting } from '../codemodeModelValidation.js';

describe('resolveCodemodeRouting — Cycle 5b admin-default fallback', () => {
  // Mirror the 2026-04-26 live cluster: Bedrock claude is in validIds
  // (because some provider_config.models[] surfaces it) but the
  // ProviderManager.modelToProviderMap only knows about the actually
  // initialized providers (ollama-hal, vertex-ai, azure-ai-foundry-prod).
  const VALID_VIA_DISCOVERY = ['gpt-oss:20b', 'gemini-2.5-flash', 'gpt-5.3-codex', 'claude-sonnet-4-6'];

  // The provider mapping that ACTUALLY exists in memory — note the absence
  // of any claude id, because no Bedrock provider is enabled in this cluster.
  const ENABLED_PROVIDER_MAP: Record<string, string> = {
    'gpt-oss:20b': 'ollama-hal',
    'nomic-embed-text:latest': 'ollama-hal',
    'gemini-2.5-flash': 'vertex-ai',
    'gpt-5.3-codex': 'azure-ai-foundry-prod',
    'gpt-4': 'azure-ai-foundry-prod',
  };

  function makeProviderLookup(map = ENABLED_PROVIDER_MAP) {
    return (model: string): string | null => map[model.toLowerCase()] ?? null;
  }
  function passthroughAlias(model: string): string {
    return model;
  }

  it('falls back to admin default when caller model is in validIds but has NO provider mapping (the 2026-04-26 bug)', () => {
    const result = resolveCodemodeRouting({
      callerModel: 'claude-sonnet-4-6',
      validIds: VALID_VIA_DISCOVERY,
      resolveAlias: passthroughAlias,
      getProviderForModel: makeProviderLookup(),
      adminDefaultModel: 'gpt-oss:20b',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveModel).toBe('gpt-oss:20b');
      expect(result.providerName).toBe('ollama-hal');
      expect(result.fallbackReason).toBe('no_provider_for_model');
    }
  });

  it('uses caller model verbatim when both validation AND provider lookup succeed', () => {
    const result = resolveCodemodeRouting({
      callerModel: 'gpt-oss:20b',
      validIds: ['gpt-oss:20b'],
      resolveAlias: passthroughAlias,
      getProviderForModel: makeProviderLookup(),
      adminDefaultModel: 'gpt-oss:20b',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveModel).toBe('gpt-oss:20b');
      expect(result.providerName).toBe('ollama-hal');
      expect(result.fallbackReason).toBeNull();
    }
  });

  it('falls back to admin default when caller model is missing entirely (existing Cycle 5)', () => {
    const result = resolveCodemodeRouting({
      callerModel: undefined,
      validIds: ['gpt-oss:20b'],
      resolveAlias: passthroughAlias,
      getProviderForModel: makeProviderLookup(),
      adminDefaultModel: 'gpt-oss:20b',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveModel).toBe('gpt-oss:20b');
      expect(result.providerName).toBe('ollama-hal');
      expect(result.fallbackReason).toBe('validation_failed');
    }
  });

  it('falls back to admin default when caller model fails Registry validation (existing Cycle 5)', () => {
    const result = resolveCodemodeRouting({
      callerModel: 'definitely-not-a-real-model',
      validIds: ['gpt-oss:20b', 'gemini-2.5-flash'],
      resolveAlias: passthroughAlias,
      getProviderForModel: makeProviderLookup(),
      adminDefaultModel: 'gpt-oss:20b',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveModel).toBe('gpt-oss:20b');
      expect(result.providerName).toBe('ollama-hal');
      expect(result.fallbackReason).toBe('validation_failed');
    }
  });

  it('returns 400 when there is NO admin default AND validation fails', () => {
    const result = resolveCodemodeRouting({
      callerModel: 'unknown',
      validIds: ['gpt-oss:20b'],
      resolveAlias: passthroughAlias,
      getProviderForModel: makeProviderLookup(),
      adminDefaultModel: '', // genuine misconfig
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('model_not_in_registry');
      expect(result.body.error.available).toEqual(['gpt-oss:20b']);
    }
  });

  it('returns 400 when admin default itself has no provider (admin set a phantom default)', () => {
    const result = resolveCodemodeRouting({
      callerModel: 'unknown',
      validIds: ['gpt-oss:20b'],
      resolveAlias: passthroughAlias,
      getProviderForModel: makeProviderLookup(),
      adminDefaultModel: 'phantom-model-no-provider',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('no_provider_for_model');
      expect(result.body.error.message).toContain('phantom-model-no-provider');
    }
  });

  it('respects resolveAlias for the admin default (e.g. "claude-sonnet-4-6" → "us.anthropic.claude-sonnet-4-6")', () => {
    const aliasMap: Record<string, string> = {
      'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
    };
    const providerMap: Record<string, string> = {
      'us.anthropic.claude-sonnet-4-6': 'aws-bedrock-east1',
    };

    const result = resolveCodemodeRouting({
      callerModel: 'definitely-not-real',
      validIds: ['us.anthropic.claude-sonnet-4-6'],
      resolveAlias: (m) => aliasMap[m] ?? m,
      getProviderForModel: (m) => providerMap[m] ?? null,
      adminDefaultModel: 'claude-sonnet-4-6',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveModel).toBe('us.anthropic.claude-sonnet-4-6');
      expect(result.providerName).toBe('aws-bedrock-east1');
      expect(result.fallbackReason).toBe('validation_failed');
    }
  });

  it('respects resolveAlias for the caller model when it resolves successfully', () => {
    const aliasMap: Record<string, string> = {
      'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
    };
    const providerMap: Record<string, string> = {
      'us.anthropic.claude-sonnet-4-6': 'aws-bedrock-east1',
    };

    const result = resolveCodemodeRouting({
      callerModel: 'claude-sonnet-4-6',
      validIds: ['us.anthropic.claude-sonnet-4-6'],
      resolveAlias: (m) => aliasMap[m] ?? m,
      getProviderForModel: (m) => providerMap[m] ?? null,
      adminDefaultModel: 'us.anthropic.claude-sonnet-4-6',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Cycle 3 short-form match resolves to the full id via validateCallerModel,
      // then resolveAlias keeps it canonical for the provider map lookup.
      expect(result.effectiveModel).toBe('us.anthropic.claude-sonnet-4-6');
      expect(result.providerName).toBe('aws-bedrock-east1');
      expect(result.fallbackReason).toBeNull();
    }
  });

  it('surfaces the original validation result on the success branch (telemetry)', () => {
    const result = resolveCodemodeRouting({
      callerModel: 'gpt-oss:20b',
      validIds: ['gpt-oss:20b'],
      resolveAlias: passthroughAlias,
      getProviderForModel: makeProviderLookup(),
      adminDefaultModel: 'gpt-oss:20b',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validation.ok).toBe(true);
      if (result.validation.ok) {
        expect(result.validation.model).toBe('gpt-oss:20b');
      }
    }
  });
});
