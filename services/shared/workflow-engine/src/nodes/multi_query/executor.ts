/**
 * multi_query node executor.
 *
 * Expands one question into N retrieval query variants — the "multi-query
 * retriever" pattern. A single phrasing often misses chunks a paraphrase
 * would surface; fanning several variants into retrieval and unioning the
 * hits raises recall before the reranker tightens precision.
 *
 * The default path is DETERMINISTIC and model-free, so RAG harness runs are
 * reproducible. It derives distinct reformulations from the question:
 *
 *   1. The original question verbatim (when includeOriginal, always first —
 *      retrieval never loses the user's exact phrasing).
 *   2. Keyword-only — strip stopwords + question words down to the content
 *      terms. Matches chunks that share vocabulary but not sentence shape.
 *   3. Question → declarative statement — drop the leading interrogative
 *      ("what are the key features of X" → "the key features of X").
 *      Embeds closer to how a document states the answer than how a user
 *      asks for it.
 *   4. Topic-phrase — the noun-ish tail after the interrogative+verb, framed
 *      as a lookup ("X key features and architectural decisions").
 *   5. Paraphrase prefixes — reframe with retrieval-friendly lead-ins
 *      ("information about ...", "details on ...", "overview of ...").
 *
 * Variants are de-duplicated (case-insensitive, whitespace-normalized) and
 * trimmed to `numQueries`. The expander always returns at least one query
 * (the original / cleaned question) so a downstream retriever never gets an
 * empty fan-out.
 *
 * Output: { original, queries (string[]), count, method }.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

const QUESTION_WORDS = new Set([
  'what', 'which', 'who', 'whom', 'whose', 'how', 'when', 'where', 'why',
]);

const LEADING_VERBS = new Set([
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should',
  'would', 'will', 'shall', 'may', 'might', 'has', 'have', 'had',
]);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'it', 'its', 'as', 'by', 'from', 'into', 'about', 'what',
  'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'do', 'does', 'did',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'has',
  'have', 'had', 'i', 'you', 'we', 'they', 'me', 'us', 'them', 'my', 'your',
  'our', 'their', 'so', 'if', 'then', 'than', 'there', 'here', 'behind',
]);

const PARAPHRASE_PREFIXES = [
  'information about',
  'details on',
  'overview of',
  'explanation of',
];

/** Tokenize, preserving order, lowercased, punctuation stripped. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Content terms only — stopwords + question words removed, order preserved. */
function keywordsOf(text: string): string[] {
  return words(text).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Drop a leading interrogative (+ a following auxiliary verb) so a question
 * reads as a declarative phrase. "what are the key features" → "the key
 * features". Returns the trimmed phrase (original casing preserved for the
 * surviving words is not required; lowercased is fine for embedding).
 */
function toDeclarative(question: string): string {
  const toks = words(question);
  let start = 0;
  if (toks.length > 0 && QUESTION_WORDS.has(toks[0])) {
    start = 1;
    if (toks.length > 1 && LEADING_VERBS.has(toks[1])) {
      start = 2;
    }
  }
  return toks.slice(start).join(' ').trim();
}

function normalizeForDedupe(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;

  const rawQuestion = data.question;
  if (rawQuestion === undefined || rawQuestion === null || String(rawQuestion).trim() === '') {
    throw new Error('multi_query requires a non-empty `question`.');
  }
  const original = ctx.interpolateTemplate(String(rawQuestion), input).trim();
  if (!original) {
    throw new Error('multi_query `question` resolved to empty after interpolation.');
  }

  const numQueries = Number.isFinite(Number(data.numQueries))
    ? Math.max(1, Math.min(10, Number(data.numQueries)))
    : 4;
  const includeOriginal = data.includeOriginal !== false;

  // Build candidate variants in priority order, then de-dupe + trim.
  const candidates: string[] = [];

  if (includeOriginal) candidates.push(original);

  // 2. Keyword-only.
  const kws = keywordsOf(original);
  if (kws.length > 0) candidates.push(kws.join(' '));

  // 3. Question → declarative.
  const declarative = toDeclarative(original);
  if (declarative) candidates.push(declarative);

  // 4. Topic phrase — the declarative with stopwords thinned (keeps a couple
  //    of connectives so it reads as a phrase, not just a bag of words).
  if (kws.length > 1) {
    candidates.push(kws.slice(0, Math.max(2, Math.ceil(kws.length * 0.75))).join(' '));
  }

  // 5. Paraphrase prefixes over the keyword core.
  const core = kws.length > 0 ? kws.join(' ') : declarative || original;
  for (const prefix of PARAPHRASE_PREFIXES) {
    candidates.push(`${prefix} ${core}`);
  }

  // De-duplicate (case-insensitive, whitespace + trailing-punct normalized),
  // preserving first-seen order.
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const c of candidates) {
    const trimmed = c.trim();
    if (!trimmed) continue;
    const key = normalizeForDedupe(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(trimmed);
    if (queries.length >= numQueries) break;
  }

  // Safety net — never return an empty fan-out. If every candidate collapsed
  // (e.g. a one-word question), fall back to the cleaned original.
  if (queries.length === 0) {
    queries.push(original);
  }

  ctx.logger.info(
    {
      nodeId: node.id,
      original,
      requested: numQueries,
      produced: queries.length,
    },
    '[multi_query] Expanded question into retrieval query variants',
  );

  return {
    original,
    queries,
    count: queries.length,
    method: 'rule-based-expansion',
  };
}
