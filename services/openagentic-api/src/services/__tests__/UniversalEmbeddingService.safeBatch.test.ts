/**
 * Service-level proof that a single oversized/pathological embedding input
 * does NOT fail the whole batch (which would leave the MCP tool catalog empty
 * — the live openagentic failure on 2026-06-01).
 *
 * generateBatchEmbeddings (ollama) must:
 *   - cap each input before sending
 *   - on a context-overflow 500, shrink-and-retry that ONE input
 *   - if still failing, emit a zero-vector placeholder (never drop / abort)
 *   - return exactly N embeddings for N inputs (index→tool alignment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniversalEmbeddingService } from '../UniversalEmbeddingService.js';

function makeOllamaService(dimensions = 768): UniversalEmbeddingService {
  return new UniversalEmbeddingService(undefined, {
    provider: 'ollama',
    ollamaUrl: 'http://test-host:11434',
    ollamaModel: 'nomic-embed-text',
    dimensions,
  });
}

describe('UniversalEmbeddingService.generateBatchEmbeddings — one bad input must not fail the batch', () => {
  let svc: UniversalEmbeddingService;

  beforeEach(() => {
    svc = makeOllamaService(768);
  });

  it('emits a zero-vector placeholder for an input that always 500s, embeds the rest, drops none', async () => {
    const good = Array.from({ length: 768 }, () => 0.5);

    // Stub the raw provider call: any input over a tiny threshold "500s" the
    // same way Ollama does, no matter how much we shrink it.
    (svc as any).generateOllamaEmbedding = vi.fn(async (text: string) => {
      if (text.length > 4) {
        const err: any = new Error(
          'Ollama embedding request failed: 500 Internal Server Error - {"error":"the input length exceeds the context length"}',
        );
        throw err;
      }
      return good;
    });

    const inputs = ['ok1', 'ok2', 'x'.repeat(50000)]; // 3rd is the pathological one
    const result = await svc.generateBatchEmbeddings(inputs);

    // NONE dropped — index→tool alignment preserved.
    expect(result.embeddings).toHaveLength(3);

    // The two good inputs embedded normally.
    expect(result.embeddings[0]).toEqual(good);
    expect(result.embeddings[1]).toEqual(good);

    // The pathological input degraded to a zero vector at the right dimension.
    expect(result.embeddings[2]).toHaveLength(768);
    expect(result.embeddings[2].every((v) => v === 0)).toBe(true);
  });

  it('shrink-retry recovers an input that only fits below the normal cap', async () => {
    const good = Array.from({ length: 768 }, () => 0.25);
    let calls = 0;

    // Fails while the input is long, succeeds once it has been shrunk below 3000 chars.
    (svc as any).generateOllamaEmbedding = vi.fn(async (text: string) => {
      calls++;
      if (text.length > 3000) {
        throw new Error('the input length exceeds the context length');
      }
      return good;
    });

    const inputs = ['y'.repeat(50000)];
    const result = await svc.generateBatchEmbeddings(inputs);

    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toEqual(good); // real embedding, not a zero vector
    expect(calls).toBeGreaterThan(1); // proves a retry happened
  });

  it('a non-overflow error (e.g. model-not-found) still propagates — not masked', async () => {
    (svc as any).generateOllamaEmbedding = vi.fn(async () => {
      throw new Error('model "nomic-embed-text" not found, pull it first');
    });

    await expect(svc.generateBatchEmbeddings(['hello'])).rejects.toThrow(/not found/);
  });
});
