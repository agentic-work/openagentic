/**
 * pgvector HNSW caps `halfvec` indexes at 4000 dimensions. Embedding
 * providers (qwen3-embedding:8b returns 4096-d) above that can't have
 * an HNSW index — INSERTs and ALTERs succeed but `CREATE INDEX … USING
 * hnsw` errors with SQLSTATE 54000 and search falls back to seq-scan.
 *
 * SoT: `services/openagentic-api/prisma/schema.prisma` declares every
 * embedding column `Unsupported("halfvec(4000)")`. Both `DatabaseService.
 * ensureEmbeddingDimensions` (column ALTER) and `UniversalEmbeddingService.
 * generateSingleEmbedding` (insert payload truncate) MUST go through these
 * helpers so the runtime never overshoots the column width.
 */

export const HALFVEC_HNSW_MAX_DIM = 4000 as const;

export function capEmbeddingDimForHnsw(rawDim: number): number {
  if (Number.isNaN(rawDim)) return Number.NaN;
  if (rawDim <= 0) return rawDim;
  return Math.min(rawDim, HALFVEC_HNSW_MAX_DIM);
}

export function truncateVectorToColumnDim(
  vector: number[],
  columnDim: number,
): number[] {
  if (!Array.isArray(vector)) {
    throw new TypeError('truncateVectorToColumnDim: vector must be an array');
  }
  if (!Number.isFinite(columnDim) || columnDim <= 0) {
    throw new RangeError(
      `truncateVectorToColumnDim: columnDim must be a positive integer (got ${columnDim})`,
    );
  }
  if (vector.length <= columnDim) return vector;
  return vector.slice(0, columnDim);
}
