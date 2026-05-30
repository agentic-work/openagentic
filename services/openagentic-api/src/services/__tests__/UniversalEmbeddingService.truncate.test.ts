/**
 * RED→GREEN: UniversalEmbeddingService.generateSingleEmbedding must
 * truncate the provider's returned vector to ≤ HALFVEC_HNSW_MAX_DIM (4000)
 * before returning to callers.
 *
 * Scenario: provider returns 4096-d (qwen3-embedding:8b native), but the
 * `halfvec(4000)` column can't accept it. The service MUST truncate to the
 * first 4000 elements (Matryoshka prefix preservation), not pad, not throw,
 * not return the raw 4096-d vector.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniversalEmbeddingService } from '../UniversalEmbeddingService.js';
import { HALFVEC_HNSW_MAX_DIM } from '../halfvecHnswCap.js';

describe('UniversalEmbeddingService.generateSingleEmbedding truncates to HNSW cap', () => {
  let svc: UniversalEmbeddingService;
  const provider4096 = Array.from({ length: 4096 }, (_, i) => i / 4096);

  beforeEach(() => {
    // Construct an instance with explicit ollama config + 4096 dims.
    // We override the private provider impl to skip the real HTTP call.
    svc = new UniversalEmbeddingService(undefined, {
      provider: 'ollama',
      ollamaUrl: 'http://test-host:11434',
      ollamaModel: 'qwen3-embedding:8b',
      dimensions: 4096,
    });

    // Stub the private provider call. The cap is applied AFTER the provider
    // returns, so an unchanged 4096-d stub proves the truncate fires inside
    // generateSingleEmbedding itself.
    (svc as any).generateOllamaEmbedding = vi.fn(async () => provider4096);
  });

  it('truncates a 4096-d provider response to 4000 elements', async () => {
    const result = await (svc as any).generateSingleEmbedding('hello world');

    expect(result).toHaveProperty('embedding');
    expect(Array.isArray(result.embedding)).toBe(true);
    expect(result.embedding).toHaveLength(HALFVEC_HNSW_MAX_DIM);
    expect(result.embedding).toHaveLength(4000);
  });

  it('preserves the Matryoshka prefix (first and last cap-boundary elements match provider output)', async () => {
    const result = await (svc as any).generateSingleEmbedding('hello world');

    expect(result.embedding[0]).toBe(provider4096[0]);
    expect(result.embedding[3999]).toBe(provider4096[3999]);
  });

  it('does NOT include any element beyond the cap (4000th index undefined)', async () => {
    const result = await (svc as any).generateSingleEmbedding('hello world');

    // Array length is 4000, so index 4000 must be undefined
    expect(result.embedding[4000]).toBeUndefined();
  });

  it('passes a sub-cap vector through unchanged (768-d nomic-embed-text)', async () => {
    const provider768 = Array.from({ length: 768 }, (_, i) => i);
    // Rebuild with 768 dims so cap = min(4000, 768) = 768 — exact match → no slice
    const svc768 = new UniversalEmbeddingService(undefined, {
      provider: 'ollama',
      ollamaUrl: 'http://test-host:11434',
      ollamaModel: 'nomic-embed-text',
      dimensions: 768,
    });
    (svc768 as any).generateOllamaEmbedding = vi.fn(async () => provider768);

    const result = await (svc768 as any).generateSingleEmbedding('hello world');

    expect(result.embedding).toHaveLength(768);
    expect(result.embedding[0]).toBe(0);
    expect(result.embedding[767]).toBe(767);
  });
});
