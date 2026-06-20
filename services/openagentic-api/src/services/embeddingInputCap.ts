/**
 * Embedding INPUT-text safety cap.
 *
 * Distinct from `halfvecHnswCap.ts` (which caps the OUTPUT vector width to
 * fit the pgvector `halfvec(4000)` column). This module caps the INPUT text
 * length BEFORE it is sent to the embedding provider, so a single very long
 * tool description (e.g. aws_knowledge `read_documentation`) cannot exceed the
 * embed model's context window and 500 the whole indexing run.
 *
 * Live failure this guards against (openagentic, 2026-06-01):
 *   `Ollama embedding request failed: 500 Internal Server Error -
 *    {"error":"the input length exceeds the context length"}`
 *   thrown from UniversalEmbeddingService.generateOllamaEmbedding while
 *   MCPToolIndexingService.indexToolsInMilvus batch-embedded 14 MCP tool
 *   descriptions. ONE pathological description zeroed out the entire catalog.
 *
 * Truncation (vs. chunking) is acceptable for semantic tool discovery: the
 * leading text of a tool description is the most discriminative — the name,
 * the one-line "what it does", and the first sentences carry the signal a
 * search query matches against. Tail text (exhaustive parameter prose) adds
 * little ranking value.
 *
 * nomic-embed-text has a ~2048-token context (~8192 chars at ~4 chars/token).
 * We cap CONSERVATIVELY below that so there is headroom for the model's own
 * prompt framing and multi-byte chars. 6000 chars ≈ 1500 tokens — safely
 * inside every embed model we ship.
 */

/** Conservative default character budget for a single embedding input. */
export const EMBEDDING_INPUT_MAX_CHARS = 6000 as const;

/**
 * Truncate a single embedding input to `maxChars`.
 *
 * - Under/at cap → returned unchanged (referential identity preserved).
 * - Over cap → sliced to the first `maxChars` characters (leading text).
 * - Non-string / non-positive cap → returns the input coerced to a string
 *   without throwing (embedding inputs must never crash the indexer).
 */
export function capEmbeddingInput(
  text: string,
  maxChars: number = EMBEDDING_INPUT_MAX_CHARS,
): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  if (!Number.isFinite(maxChars) || maxChars <= 0) return s;
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars);
}

/**
 * Cap every input in a batch. Pure, allocation-light: inputs already under
 * the cap are passed through by reference (no copy), so the common case is
 * effectively free.
 */
export function capEmbeddingInputs(
  texts: string[],
  maxChars: number = EMBEDDING_INPUT_MAX_CHARS,
): string[] {
  if (!Array.isArray(texts)) return [];
  return texts.map((t) => capEmbeddingInput(t, maxChars));
}

/**
 * Aggressively shrink an input that STILL 500'd after the normal cap.
 *
 * Used as the retry-on-failure escape hatch: if a provider rejects an input
 * even at `EMBEDDING_INPUT_MAX_CHARS` (e.g. a tighter-than-expected context
 * window, or a token-dense input where chars/token is far below 4), halve the
 * budget and try again rather than dropping the tool entirely. Floors at
 * `floor` chars so we never spin forever and always send SOMETHING
 * embeddable.
 */
export function shrinkEmbeddingInput(
  text: string,
  currentMaxChars: number,
  floor = 256,
): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  const next = Math.max(floor, Math.floor(currentMaxChars / 2));
  if (s.length <= next) {
    // Already shorter than the shrink target — can't shrink by length, but
    // still honor the floor so a degenerate caller gets a bounded result.
    return s.length <= floor ? s : s.slice(0, floor);
  }
  return s.slice(0, next);
}
