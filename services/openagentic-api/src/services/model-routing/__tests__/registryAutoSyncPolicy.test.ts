/**
 * Task 1 test — Registry auto-upsert must be GATED by provider type.
 *
 * Rule (from feedback_registry_explicit_add):
 *   - 'azure-ai-foundry' → auto-add on discovery
 *   - 'ollama' → auto-add on discovery
 *   - 'aws-bedrock' → admin uses "Add Model" UI, Registry stays empty
 *   - 'vertex-ai' → admin uses "Add Model" UI, Registry stays empty
 *   - 'openai' / 'anthropic' / 'azure-openai' direct → no auto-add
 *
 * These tests exercise the pure `shouldAutoSyncRegistry(providerType)` gate
 * that the POST /api/admin/llm-providers handler must call before invoking
 * RegistryUpsertService. Unit-level so it runs without a DB.
 */
import { describe, it, expect } from 'vitest';
import { shouldAutoSyncRegistry } from '../registryAutoSyncPolicy.js';

describe('shouldAutoSyncRegistry (pure gate)', () => {
  it('returns true for azure-ai-foundry (AIF deployments curated upstream)', () => {
    expect(shouldAutoSyncRegistry('azure-ai-foundry')).toBe(true);
  });

  it('returns true for ollama (operator-curated via `ollama pull` on host)', () => {
    expect(shouldAutoSyncRegistry('ollama')).toBe(true);
  });

  it('returns false for aws-bedrock (117+ foundation models; needs curation)', () => {
    expect(shouldAutoSyncRegistry('aws-bedrock')).toBe(false);
  });

  it('returns false for vertex-ai (32+ preview variants; needs curation)', () => {
    expect(shouldAutoSyncRegistry('vertex-ai')).toBe(false);
  });

  it('returns false for google-vertex (legacy alias for vertex-ai)', () => {
    expect(shouldAutoSyncRegistry('google-vertex')).toBe(false);
  });

  it('returns false for openai (bulk catalog)', () => {
    expect(shouldAutoSyncRegistry('openai')).toBe(false);
  });

  it('returns false for anthropic (bulk catalog)', () => {
    expect(shouldAutoSyncRegistry('anthropic')).toBe(false);
  });

  it('returns false for azure-openai (bulk catalog; direct Azure OpenAI, not AIF)', () => {
    expect(shouldAutoSyncRegistry('azure-openai')).toBe(false);
  });

  it('returns false for unknown/future provider types (fail-closed, safer default)', () => {
    expect(shouldAutoSyncRegistry('some-new-provider')).toBe(false);
    expect(shouldAutoSyncRegistry('')).toBe(false);
    expect(shouldAutoSyncRegistry(undefined as any)).toBe(false);
    expect(shouldAutoSyncRegistry(null as any)).toBe(false);
  });

  it('is case-sensitive (DB values are always kebab-case)', () => {
    // Intentional — DB schema enforces lowercase; fail fast on uppercase bugs
    expect(shouldAutoSyncRegistry('Ollama')).toBe(false);
    expect(shouldAutoSyncRegistry('AZURE-AI-FOUNDRY')).toBe(false);
  });
});

describe('shouldAutoSyncRegistry.AUTO_SYNC_PROVIDER_TYPES (exported constant)', () => {
  it('exports the allowlist so other modules (RegistrySyncJob) can reuse it', async () => {
    const mod = await import('../registryAutoSyncPolicy.js');
    expect(Array.isArray(mod.AUTO_SYNC_PROVIDER_TYPES)).toBe(true);
    expect(mod.AUTO_SYNC_PROVIDER_TYPES).toContain('azure-ai-foundry');
    expect(mod.AUTO_SYNC_PROVIDER_TYPES).toContain('ollama');
    expect(mod.AUTO_SYNC_PROVIDER_TYPES).not.toContain('aws-bedrock');
    expect(mod.AUTO_SYNC_PROVIDER_TYPES).not.toContain('vertex-ai');
  });
});
