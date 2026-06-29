/**
 * rerank node executor.
 *
 * Re-orders a list of retrieved chunks by relevance to a query, then keeps
 * the top-N. The default path is a DETERMINISTIC lexical scorer — no model
 * round-trip — so RAG harness runs are reproducible and don't depend on a
 * live model. This mirrors a cross-encoder's job (turn recall@k into
 * precision@k) without the model cost on the deterministic path.
 *
 * Scoring (deterministic, BM25-flavoured):
 *   - Tokenize query + each chunk's content (lowercase, strip punctuation,
 *     drop stopwords + 1-char tokens).
 *   - Score = Σ over distinct query terms present in the chunk of
 *       idf(term) * tf-saturation(term-count-in-chunk)
 *     where idf rewards terms that are RARE across the candidate set (a term
 *     in every chunk carries no discriminating signal) and tf-saturation is
 *     the BM25 (tf*(k+1))/(tf+k) curve so a term appearing 10× doesn't swamp
 *     a term appearing 2×. Length-normalized against the candidate-set's
 *     average chunk length.
 *   - A phrase-match boost adds a bonus when a contiguous 2+ word query
 *     n-gram appears verbatim in the chunk (exact-phrase hits are the
 *     strongest relevance signal a lexical scorer has).
 *   - Ties broken by the chunk's pre-existing retrieval `score` (so a stable,
 *     sensible order survives when the lexical scorer can't separate two
 *     chunks), then by original index (stable sort).
 *
 * Input shape: reads the chunk array off the incoming edge's `input` via the
 * configured `chunksPath` (default `results`), with auto-detection of the
 * common retriever shapes (`input.results`, `input.result.results`,
 * `input.chunks`, or `input` itself when already an array). Each chunk's text
 * is read from `contentField` (default `content`, then `text`/`body`).
 *
 * Output: { query, chunks (reordered + top-N), inputCount, outputCount,
 *           reordered, method }. Each output chunk gains a `rerankScore`
 *           and `rerankRank` field; the original chunk fields are preserved.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'it', 'its', 'as', 'by', 'from', 'into', 'about', 'what',
  'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'do', 'does', 'did',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'has',
  'have', 'had', 'i', 'you', 'we', 'they', 'he', 'she', 'me', 'us', 'them',
  'my', 'your', 'our', 'their', 'his', 'her', 'so', 'if', 'then', 'than',
  'there', 'here', 'not', 'no', 'yes', 'all', 'any', 'some', 'each',
]);

// BM25 tf-saturation constant. Higher → less saturation (term frequency
// matters more); standard BM25 default is ~1.2.
const BM25_K1 = 1.2;
// BM25 length-normalization weight (0 = no length norm, 1 = full).
const BM25_B = 0.6;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .split(/[\s_-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Extract the chunk array from a retriever's output object. */
function extractChunks(input: unknown, chunksPath: string): unknown[] {
  // 1. input itself is already an array of chunks.
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];

  const obj = input as Record<string, any>;

  // 2. explicit configured dot-path (e.g. 'results' or 'result.results').
  if (chunksPath) {
    let cursor: any = obj;
    for (const key of chunksPath.split('.')) {
      cursor = cursor?.[key];
    }
    if (Array.isArray(cursor)) return cursor;
  }

  // 3. auto-detect the common retriever shapes.
  const candidates: unknown[] = [
    obj.results,
    obj.result?.results,
    obj.chunks,
    obj.result?.chunks,
    obj.documents,
    obj.matches,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function getContent(chunk: unknown, contentField: string): string {
  if (typeof chunk === 'string') return chunk;
  if (!chunk || typeof chunk !== 'object') return String(chunk ?? '');
  const c = chunk as Record<string, any>;
  const v = c[contentField] ?? c.content ?? c.text ?? c.body;
  if (typeof v === 'string') return v;
  // Last resort: stringify the chunk so an unusually-shaped record still
  // contributes *some* lexical signal rather than scoring zero.
  return JSON.stringify(c);
}

function getExistingScore(chunk: unknown): number {
  if (chunk && typeof chunk === 'object') {
    const s = (chunk as Record<string, any>).score;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  return 0;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;

  const rawQuery = data.query;
  if (rawQuery === undefined || rawQuery === null || String(rawQuery).trim() === '') {
    throw new Error('rerank requires a non-empty `query`.');
  }
  const query = ctx.interpolateTemplate(String(rawQuery), input).trim();
  if (!query) {
    throw new Error('rerank `query` resolved to empty after interpolation.');
  }

  const chunksPath = typeof data.chunksPath === 'string' ? data.chunksPath : 'results';
  const contentField = typeof data.contentField === 'string' ? data.contentField : 'content';
  const topN = Number.isFinite(Number(data.topN)) ? Math.max(1, Number(data.topN)) : 5;

  const chunks = extractChunks(input, chunksPath);
  const inputCount = chunks.length;

  // Degenerate case: nothing to rank. Return an empty, well-formed envelope so
  // a downstream grounding/synthesis step can branch on outputCount === 0
  // instead of crashing on undefined.
  if (inputCount === 0) {
    ctx.logger.info(
      { nodeId: node.id, query, inputCount: 0 },
      '[rerank] No chunks to rerank — empty candidate set.',
    );
    return {
      query,
      chunks: [],
      inputCount: 0,
      outputCount: 0,
      reordered: false,
      method: 'lexical-bm25',
    };
  }

  const queryTerms = tokenize(query);
  const queryTermSet = new Set(queryTerms);
  // Contiguous 2-grams of the query for the exact-phrase boost.
  const queryBigrams: string[] = [];
  for (let i = 0; i < queryTerms.length - 1; i++) {
    queryBigrams.push(`${queryTerms[i]} ${queryTerms[i + 1]}`);
  }

  // Pre-tokenize every chunk + compute corpus stats for IDF + length norm.
  const docTokens: string[][] = chunks.map((ch) => tokenize(getContent(ch, contentField)));
  const docLengths = docTokens.map((t) => t.length);
  const avgDocLen =
    docLengths.reduce((a, b) => a + b, 0) / Math.max(1, docLengths.length) || 1;

  // Document frequency per query term (how many chunks contain it).
  const df = new Map<string, number>();
  for (const term of queryTermSet) {
    let count = 0;
    for (const toks of docTokens) {
      if (toks.includes(term)) count++;
    }
    df.set(term, count);
  }
  const N = chunks.length;
  // BM25-style idf with the +0.5 smoothing; floored at a small positive so a
  // term present in every chunk still contributes a sliver rather than going
  // negative and inverting the ranking.
  function idf(term: string): number {
    const n = df.get(term) ?? 0;
    const raw = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    return Math.max(0.01, raw);
  }

  const scored = chunks.map((chunk, idx) => {
    const toks = docTokens[idx];
    const len = docLengths[idx] || 0;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of queryTermSet) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const denom = f + BM25_K1 * (1 - BM25_B + (BM25_B * len) / avgDocLen);
      const tfComponent = (f * (BM25_K1 + 1)) / (denom || 1);
      score += idf(term) * tfComponent;
    }

    // Exact-phrase (bigram) boost — verbatim phrase hits are the strongest
    // lexical relevance signal.
    if (queryBigrams.length > 0) {
      const contentLower = getContent(chunk, contentField).toLowerCase();
      let phraseHits = 0;
      for (const bg of queryBigrams) {
        if (contentLower.includes(bg)) phraseHits++;
      }
      score += phraseHits * 0.75;
    }

    return {
      chunk,
      idx,
      score,
      existing: getExistingScore(chunk),
    };
  });

  // Stable, deterministic sort: lexical score desc → pre-existing retrieval
  // score desc → original index asc.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.existing !== a.existing) return b.existing - a.existing;
    return a.idx - b.idx;
  });

  const top = scored.slice(0, topN);
  const outChunks = top.map((s, rank) => {
    const base =
      s.chunk && typeof s.chunk === 'object' && !Array.isArray(s.chunk)
        ? { ...(s.chunk as Record<string, unknown>) }
        : { content: s.chunk };
    return {
      ...base,
      rerankScore: Number(s.score.toFixed(4)),
      rerankRank: rank + 1,
    };
  });

  // `reordered` is true when the kept top-N is not in the same order the
  // chunks arrived in (i.e. reranking actually changed something).
  const keptOriginalIdx = top.map((s) => s.idx);
  const reordered = keptOriginalIdx.some((origIdx, rank) => origIdx !== rank);

  ctx.logger.info(
    {
      nodeId: node.id,
      query,
      inputCount,
      outputCount: outChunks.length,
      reordered,
      topScore: outChunks[0]?.rerankScore ?? 0,
    },
    '[rerank] Reranked candidate chunks',
  );

  return {
    query,
    chunks: outChunks,
    inputCount,
    outputCount: outChunks.length,
    reordered,
    method: 'lexical-bm25',
  };
}
