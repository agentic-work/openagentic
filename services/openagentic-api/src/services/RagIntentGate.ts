/**
 * RagIntentGate
 *
 * Decides whether the RAG retrieval stage should run for a given user
 * message. Without this gate, RAG fired unconditionally on every chat
 * request — wasting Milvus calls + bloating the system prompt with
 * irrelevant documentation excerpts on requests that just want a tool
 * to be invoked.
 *
 * The decision is intent-based: only fetch documentation when the user
 * is asking ABOUT the platform (meta-questions, feature explanations,
 * "how do I…" tutorials, internal docs lookups). Skip when the user is
 * asking the platform to DO something for them (cloud queries, file
 * operations, web search, chart generation, etc).
 *
 * Strategy (cheap → expensive):
 *   1. Strong positive: explicit doc-seek phrases, platform-internal
 *      feature names, meta-question patterns ("what is X", "explain X",
 *      "how do I use X" combined with platform self-reference). Fire
 *      RAG immediately.
 *   2. Strong negative: tool-action signals (cloud verbs, web search,
 *      visualization requests). Skip immediately.
 *   3. Default: skip. Asymmetric — false negatives ("user wanted docs
 *      and got none") are recoverable by re-asking with the word
 *      "documentation" or a feature name; false positives ("we ran a
 *      Milvus query and bloated the prompt for no reason") cost time
 *      and tokens on every single chat.
 *
 * A future Phase B can add embedding-similarity matching against a small
 * set of "platform-meta-question" prototype embeddings for cases where
 * the keyword heuristics miss. The gate's IntentDecision.reason field is
 * already structured for that — log the reason at runtime so prototype
 * tuning has data to draw on.
 *
 * Background: openagentic-omhs#330 follow-up — user reported RAG was
 * firing on every chat and showing "RAG Knowledge (5 docs)" in the
 * activity stream even when their question (e.g. "what are my Azure
 * costs?") had nothing to do with platform documentation.
 */

export interface RagIntentDecision {
  /** Whether to fire RAG retrieval for this message. */
  shouldFetchRag: boolean;
  /** Stable, log-friendly reason string for debugging + future tuning. */
  reason:
    | 'explicit-doc-seek'
    | 'platform-meta-question'
    | 'internal-feature-name'
    | 'tool-action-signal'
    | 'web-search-action'
    | 'visualization-action'
    | 'no-positive-signal'
    | 'empty-message';
  /** When matched, the substring that triggered the decision. */
  matched?: string;
}

// ─── Strong-positive patterns (fire RAG) ───────────────────────────────────

/**
 * Words that explicitly request documentation. If any appears, RAG fires.
 */
const DOC_SEEK_RE = /\b(docs?|documentation|user[-\s]?guide|tutorial|how[-\s]to(?:\s|$)|reference\s+(guide|page|docs?)|manual|knowledge[-\s]?base|kb\b|readme|wiki)\b/i;

/**
 * Internal platform feature / component names. The user asking about
 * any of these is asking about the platform itself → fetch docs.
 *
 * Keep this list tight — only true PRODUCT names, not every word the
 * platform uses internally. Adding generic terms like "tool" or "agent"
 * here would cause false positives on every tool-using request.
 */
const FEATURE_NAME_RE = /\b(openagentic|agentic\s?work|smart\s?router|prompt\s?(composer|module|stage)|capability\s?gate|code[-\s]?mode|chat[-\s]?mode|flow[-\s]?mode|mcp\s?(proxy|server|stage|orchestrator)|agentic\s?activity\s?stream|artifact[-\s]?creation|rag\s?(stage|service|module))\b/i;

/**
 * Platform self-reference. When combined with a question word, the user
 * is asking ABOUT the platform (vs. asking it to DO something).
 */
const PLATFORM_SELF_RE = /\b(this\s+platform|the\s+platform|this\s+system|the\s+system|this\s+tool|the\s+tool|this\s+app(?:lication)?|the\s+app(?:lication)?|your\s+(platform|system|tool|app)|openagentic)\b/i;

/**
 * Meta-question lead-ins: "what is X", "how does X work", "explain X".
 * On their own these are too broad — they have to combine with platform
 * self-reference or a feature name to fire.
 */
const META_QUESTION_RE = /^(what\s+(is|are|does)|how\s+(do(?:es)?|can|should)|why\s+(do(?:es)?|is|are)|where\s+(can|do(?:es)?)|when\s+(should|do(?:es)?)|explain|describe|tell\s+me\s+(about|how)|walk\s+me\s+through)\b/i;

// ─── Strong-negative patterns (skip RAG) ───────────────────────────────────

/**
 * Tool-action verbs combined with cloud nouns — the user wants to DO
 * something with their cloud, not read about the platform.
 */
const CLOUD_ACTION_RE = /\b(create|delete|provision|deploy|build|launch|spin\s+up|tear\s+down|destroy|update|patch|restart|reboot|scale|list|show|get|find|fetch|enumerate|count|inventory|audit)\b.*\b(azure|aws|gcp|cloud|subscription|resource\s?group|vm|virtual\s?machine|storage|bucket|s3|cluster|aks|eks|gke|k8s|kubernetes|pod|deployment|namespace|node|cost|spend|billing|usage|application\s?gateway|load\s?balancer|key\s?vault|vnet|vpc|subnet|nsg|rds|sql|cosmos|lambda|function|key\s?vault|iam|role|policy)\b/i;

/**
 * Explicit web-search asks — handled by web tools, not internal docs.
 */
const WEB_SEARCH_RE = /\b(search\s+(the\s+)?web|google|bing|duckduckgo|web\s+search|find\s+online|look\s+(it|that)\s+up\s+online|browse\s+to|fetch\s+(the\s+)?(url|page|site)|scrape)\b/i;

/**
 * Visualization-creation asks — handled by artifact-creation flow.
 */
const VISUALIZATION_RE = /\b(create|build|make|generate|render|draw|show\s+me)\b.*\b(chart|graph|diagram|dashboard|sankey|plot|visualization|visualisation|artifact|infographic|mindmap|timeline|gantt)\b/i;

/**
 * Bash / shell / file action signals — local agentic work, not docs.
 */
const SHELL_FILE_ACTION_RE = /\b(run\s+(the\s+)?(bash|shell|command)|execute\s+(this|the)|cat\s+|grep\s+|read\s+(the\s+)?file|write\s+(to\s+)?(file|disk)|edit\s+(the\s+)?file|delete\s+(the\s+)?file|chmod|chown|kubectl|helm|az\s+|aws\s+|gcloud\s+|gh\s+|git\s+)\b/i;

// ─── Public API ────────────────────────────────────────────────────────────

export function evaluateRagIntent(message: string | undefined | null): RagIntentDecision {
  const text = (message || '').trim();
  if (!text) return { shouldFetchRag: false, reason: 'empty-message' };

  // 1. Strong-negative checks first — short-circuit before paying for any
  //    ambiguity resolution. These are the high-volume cases (every cloud
  //    query, every web search, every chart) so checking them first keeps
  //    the gate's per-call cost low.
  let m = text.match(WEB_SEARCH_RE);
  if (m) return { shouldFetchRag: false, reason: 'web-search-action', matched: m[0] };

  m = text.match(VISUALIZATION_RE);
  if (m) return { shouldFetchRag: false, reason: 'visualization-action', matched: m[0] };

  m = text.match(CLOUD_ACTION_RE);
  if (m) return { shouldFetchRag: false, reason: 'tool-action-signal', matched: m[0] };

  m = text.match(SHELL_FILE_ACTION_RE);
  if (m) return { shouldFetchRag: false, reason: 'tool-action-signal', matched: m[0] };

  // 2. Strong-positive checks — fire RAG.
  m = text.match(DOC_SEEK_RE);
  if (m) return { shouldFetchRag: true, reason: 'explicit-doc-seek', matched: m[0] };

  m = text.match(FEATURE_NAME_RE);
  if (m) return { shouldFetchRag: true, reason: 'internal-feature-name', matched: m[0] };

  // Meta-question + platform self-reference together → RAG.
  // (Either alone is too broad — "what is the smart router?" needs both
  // "what is" AND "smart router" / "the platform" to count.)
  if (META_QUESTION_RE.test(text) && PLATFORM_SELF_RE.test(text)) {
    return { shouldFetchRag: true, reason: 'platform-meta-question', matched: 'meta + self-ref' };
  }

  // 3. Default: skip. Asymmetric cost (false positive >> false negative).
  return { shouldFetchRag: false, reason: 'no-positive-signal' };
}
