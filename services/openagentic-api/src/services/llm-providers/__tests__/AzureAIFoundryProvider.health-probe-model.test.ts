/**
 * Regression for #370: AIF health probe POSTs to deployment endpoint with
 * `this.model`, which falls through to DEFAULT_MODEL=gpt-oss:20b when
 * config.model/AIF_MODEL/AIF_CHAT_MODEL are unset. AIF doesn't have a
 * gpt-oss:20b deployment → 404 → row shows unhealthy despite the provider
 * being functional.
 *
 * Fix: prefer the first entry of `this.discoveredModels[]` (populated by
 * ARM auto-discovery on init/refresh) for the probe target.
 */
import { describe, it, expect } from 'vitest';
import { pickHealthProbeModel } from '../AzureAIFoundryProvider.js';

describe('AIF pickHealthProbeModel — picks the right deployment for health probe', () => {
  it('returns first discovered deployment id when discoveredModels has entries', () => {
    const result = pickHealthProbeModel(
      [{ id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', provider: 'azure-ai-foundry' }],
      'gpt-oss:20b'
    );
    expect(result).toBe('gpt-5.3-codex');
  });

  it('prefers discovered over the configured fallback even when both are set', () => {
    const result = pickHealthProbeModel(
      [{ id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', provider: 'azure-ai-foundry' }],
      'something-else'
    );
    expect(result).toBe('gpt-5.3-codex');
  });

  it('falls back to the configured model when discoveredModels is empty', () => {
    const result = pickHealthProbeModel([], 'gpt-5.4');
    expect(result).toBe('gpt-5.4');
  });

  it('returns empty string when neither discovered nor fallback is meaningful', () => {
    expect(pickHealthProbeModel([], '')).toBe('');
    expect(pickHealthProbeModel([], undefined as any)).toBe('');
  });
});
