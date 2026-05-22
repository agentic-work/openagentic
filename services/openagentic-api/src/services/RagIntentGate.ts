/**
 * RagIntentGate (V2 — explicit opt-in only)
 *
 * The legacy V1 gate used a stack of keyword regex constants to GUESS
 * whether a user message wanted platform docs. They false-positive'd
 * on common prose ("show me cloud resources and give me a sankey cost
 * diagram for the last 6 months") and bloated the system prompt with
 * irrelevant doc excerpts.
 *
 * V2 model: RAG fires ONLY on EXPLICIT user opt-in markers:
 *   1. `@docs` token (whitespace-bounded, case-insensitive)
 *   2. `/rag`, `/docs`, `@kb`, `/kb` slash/at command at start
 *   3. attachment with `kind === 'rag_collection'` (or `type === ...`)
 *
 * This is NOT regex intent classification — the user TYPED the marker
 * explicitly; we're parsing it, the same shape Claude Code uses for
 * slash commands. Per the architecture-test EXEMPT note: "tool-name
 * prefix string-match is a contract, not routing".
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §150
 * Task: 1.9 + 1.13 (Wave2-F trim)
 */

export interface RagIntentDecision {
  shouldFetchRag: boolean;
  reason: 'explicit-opt-in' | 'no-opt-in' | 'empty-message';
  matched?: string;
}

/**
 * Slash / at prefixes the user can type at the start of a message
 * to explicitly request RAG retrieval. Whitespace before is tolerated.
 * Matched case-insensitively.
 */
const OPT_IN_PREFIXES = ['@docs', '/docs', '@kb', '/kb', '/rag'] as const;

/**
 * Explicit opt-in detector for RAG retrieval.
 *
 * Returns `true` ONLY when the user explicitly opts in via:
 *   - `@docs` token anywhere in the message (whitespace-bounded, case-insensitive)
 *   - any `OPT_IN_PREFIXES` entry at message start (whitespace-stripped)
 *   - an attachment whose `kind` or `type` equals `'rag_collection'`
 *
 * This function does NOT infer intent from message content. Keyword
 * stacks ("documentation", "knowledge base", platform feature names)
 * are deliberately ignored — they were the V1 false-positive source.
 *
 * @param message - User-typed message text
 * @param attachments - Optional attachment list (defensive: any shape)
 * @returns `true` iff an explicit opt-in marker is present
 */
export function detectExplicitRagOptIn(
  message: string | undefined | null,
  attachments?: Array<{ kind?: string; type?: string } | null | undefined>,
): boolean {
  // Attachment-based opt-in (defensive: tolerate null entries / missing fields).
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a && (a.kind === 'rag_collection' || a.type === 'rag_collection')) {
        return true;
      }
    }
  }

  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (!text) return false;

  const lower = text.toLowerCase();

  // Slash / at-prefix opt-in (whitespace-stripped via .trim() above).
  for (const prefix of OPT_IN_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }

  // `@docs` token anywhere in the message (whitespace-bounded). We pad
  // a leading space so the test matches when @docs is the very first
  // token. Word-boundary on the right side prevents `@docsearch` from
  // matching. This is parsing an explicit user marker, not classifying
  // intent — the same shape as detecting a slash command.
  if (/\s@docs\b/i.test(' ' + text)) return true;

  return false;
}

/**
 * Legacy V2 evaluator surface — kept for the rag.stage.ts consumer
 * which expects `{ shouldFetchRag, reason, matched }`. New callers
 * should use `detectExplicitRagOptIn` directly.
 */
export function evaluateRagIntent(
  message: string | undefined | null,
  attachments?: Array<{ kind?: string; type?: string } | null | undefined>,
): RagIntentDecision {
  const text = (message ?? '').trim();
  if (!text && !(Array.isArray(attachments) && attachments.length > 0)) {
    return { shouldFetchRag: false, reason: 'empty-message' };
  }

  // Attachment opt-in
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a && (a.kind === 'rag_collection' || a.type === 'rag_collection')) {
        return {
          shouldFetchRag: true,
          reason: 'explicit-opt-in',
          matched: 'attachment:rag_collection',
        };
      }
    }
  }

  if (!text) return { shouldFetchRag: false, reason: 'empty-message' };

  const lower = text.toLowerCase();

  for (const prefix of OPT_IN_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return { shouldFetchRag: true, reason: 'explicit-opt-in', matched: prefix };
    }
  }

  if (/\s@docs\b/i.test(' ' + text)) {
    return { shouldFetchRag: true, reason: 'explicit-opt-in', matched: '@docs' };
  }

  return { shouldFetchRag: false, reason: 'no-opt-in' };
}
