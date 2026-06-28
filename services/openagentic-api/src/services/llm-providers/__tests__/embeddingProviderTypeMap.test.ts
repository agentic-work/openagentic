/**
 * embeddingProviderTypeMap — RED→GREEN regression for AIF cold-boot crash.
 *
 * Live failure (2026-05-04 fresh-DB cold-boot):
 *
 *   [AIF] ARM deployment discovery complete (3 deployments)
 *   [DB-backed embedding config loaded] provider=openai-compatible
 *      model=text-embedding-3-large source=non-ollama-preferred
 *   [milvus-vector-service] Using DB-backed embedding config (SoT)
 *   ❌ Error: OpenAI-compatible requires EMBEDDING_ENDPOINT and EMBEDDING_API_KEY
 *      → CRITICAL startup failure → CrashLoopBackOff
 *
 * Root cause: startup/04-providers.ts had an inline `providerMap` that
 * mapped admin.llm_providers.provider_type → EmbeddingProvider tag, but
 * was missing the `'azure-ai-foundry'` key. Bootstrapped AIF rows fell
 * through the `||` fallback to `'openai-compatible'`, which forces the
 * azure-openai-shaped, Entra-authed AIF endpoint into the API-key
 * branch of UniversalEmbeddingService.loadProviderConfig — which then
 * throws because Entra has no API key.
 *
 * Correct behavior: AIF rows MUST resolve to `'azure-openai'`. That
 * branch already supports Entra auth via AZURE_TENANT_ID /
 * AZURE_CLIENT_ID / AZURE_CLIENT_SECRET when AZURE_OPENAI_API_KEY is
 * absent.
 */

import { describe, it, expect } from 'vitest';
import { mapLlmProviderTypeToEmbeddingProvider } from '../embeddingProviderTypeMap.js';

describe('mapLlmProviderTypeToEmbeddingProvider', () => {
  it('maps azure-ai-foundry to azure-openai (regression: cold-boot crash)', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('azure-ai-foundry')).toBe('azure-openai');
  });

  it('maps azure-openai to itself', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('azure-openai')).toBe('azure-openai');
  });

  it('maps vertex-ai to itself', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('vertex-ai')).toBe('vertex-ai');
  });

  it('maps aws-bedrock to itself', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('aws-bedrock')).toBe('aws-bedrock');
  });

  it('maps ollama to itself', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('ollama')).toBe('ollama');
  });

  it('maps openai to openai-compatible', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('openai')).toBe('openai-compatible');
  });

  it('maps anthropic to openai-compatible', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('anthropic')).toBe('openai-compatible');
  });

  it('falls back to openai-compatible for unknown provider types', () => {
    expect(mapLlmProviderTypeToEmbeddingProvider('some-future-provider')).toBe('openai-compatible');
    expect(mapLlmProviderTypeToEmbeddingProvider('')).toBe('openai-compatible');
  });
});
