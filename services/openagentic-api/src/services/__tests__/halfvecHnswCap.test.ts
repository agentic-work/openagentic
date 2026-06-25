/**
 * RED→GREEN: halfvec HNSW dimension cap.
 *
 * pgvector caps HNSW indexes on `halfvec` columns at 4000 dimensions.
 * Embedding providers like qwen3-embedding:8b return 4096-d natively;
 * leaving the column at 4096 causes every HNSW index creation to fail
 * with code 54000 "column cannot have more than 4000 dimensions for
 * hnsw index" and search falls back to seq-scan.
 *
 * SoT: `services/openagentic-api/prisma/schema.prisma` declares every
 * embedding column as `Unsupported("halfvec(4000)")`. The runtime
 * helpers below must agree with that declaration.
 */

import { describe, it, expect } from 'vitest';
import {
  HALFVEC_HNSW_MAX_DIM,
  capEmbeddingDimForHnsw,
  truncateVectorToColumnDim,
} from '../halfvecHnswCap.js';

describe('HALFVEC_HNSW_MAX_DIM constant', () => {
  it('is 4000 — the pgvector hard cap for HNSW on halfvec', () => {
    expect(HALFVEC_HNSW_MAX_DIM).toBe(4000);
  });
});

describe('capEmbeddingDimForHnsw', () => {
  it('caps 4096 (qwen3-embedding:8b native) down to 4000', () => {
    expect(capEmbeddingDimForHnsw(4096)).toBe(4000);
  });

  it('is a no-op at the boundary (4000 stays 4000)', () => {
    expect(capEmbeddingDimForHnsw(4000)).toBe(4000);
  });

  it('preserves smaller dims unchanged (1536 → 1536)', () => {
    expect(capEmbeddingDimForHnsw(1536)).toBe(1536);
  });

  it('preserves 768 (nomic-embed-text native) unchanged', () => {
    expect(capEmbeddingDimForHnsw(768)).toBe(768);
  });

  it('returns the input when it is 1 (degenerate but valid)', () => {
    expect(capEmbeddingDimForHnsw(1)).toBe(1);
  });

  it('returns 0 for non-positive input (caller must guard separately)', () => {
    expect(capEmbeddingDimForHnsw(0)).toBe(0);
    expect(capEmbeddingDimForHnsw(-1)).toBe(-1);
  });

  it('rejects NaN by returning NaN (so callers must guard explicitly)', () => {
    expect(capEmbeddingDimForHnsw(Number.NaN)).toBe(Number.NaN);
  });
});

describe('truncateVectorToColumnDim', () => {
  it('truncates a 4096-d vector to 4000 elements (qwen3 → halfvec(4000) column)', () => {
    const v4096 = Array.from({ length: 4096 }, (_, i) => i);
    const result = truncateVectorToColumnDim(v4096, 4000);
    expect(result).toHaveLength(4000);
    // Matryoshka — truncation must preserve the prefix, not random subset
    expect(result[0]).toBe(0);
    expect(result[3999]).toBe(3999);
  });

  it('returns the vector unchanged when already smaller than column dim', () => {
    const v768 = Array.from({ length: 768 }, (_, i) => i);
    const result = truncateVectorToColumnDim(v768, 4000);
    expect(result).toHaveLength(768);
    // No padding — the column accepts narrower vectors
    expect(result).toBe(v768);
  });

  it('returns the vector unchanged when length matches column dim exactly', () => {
    const v4000 = Array.from({ length: 4000 }, (_, i) => i);
    const result = truncateVectorToColumnDim(v4000, 4000);
    expect(result).toHaveLength(4000);
    expect(result).toBe(v4000);
  });

  it('handles a 1536-d vector against a 1536 column (no-op)', () => {
    const v1536 = Array.from({ length: 1536 }, (_, i) => i);
    const result = truncateVectorToColumnDim(v1536, 1536);
    expect(result).toBe(v1536);
  });

  it('throws when given a non-array', () => {
    // @ts-expect-error — intentionally invalid input
    expect(() => truncateVectorToColumnDim(null, 4000)).toThrow();
  });

  it('throws when given non-positive column dim', () => {
    expect(() => truncateVectorToColumnDim([1, 2, 3], 0)).toThrow();
    expect(() => truncateVectorToColumnDim([1, 2, 3], -1)).toThrow();
  });
});
