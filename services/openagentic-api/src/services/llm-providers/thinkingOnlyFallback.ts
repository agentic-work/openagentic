export type AnthropicStreamEvent =
  | { type: 'content_block_start'; index: number; content_block: { type: 'text' } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } }
  | { type: 'content_block_stop'; index: number };

export interface FallbackDecisionInput {
  /** Concatenated `message.content` across the stream. */
  accumulatedContent: string;
  /** Concatenated `message.thinking` across the stream. */
  accumulatedThinking: string;
  /** Whether the provider already captured tool calls. If it did, the
   *  answer is the tool call — don't synthesize filler text. */
  hasToolCalls: boolean;
}

/**
 * Return true when the provider must synthesize a trailing text block
 * so the downstream Anthropic Messages contract has at least one
 * `text_delta`.
 *
 * The three conditions that MUST hold:
 *   1. The stream yielded no `content` delta at all
 *      (`accumulatedContent` is empty after trimming).
 *   2. The stream yielded some `thinking` delta
 *      (`accumulatedThinking` has non-whitespace content).
 *   3. There are no native tool calls to emit instead.
 */
export function shouldSynthesizeFinalText(input: FallbackDecisionInput): boolean {
  if (input.hasToolCalls) return false;
  if ((input.accumulatedContent || '').trim().length > 0) return false;
  if ((input.accumulatedThinking || '').trim().length === 0) return false;
  return true;
}

/**
 * Heuristics — phrases that signal the model is talking *about* its task
 * (chain-of-thought meta-commentary) rather than producing a final
 * user-facing answer. Used to suppress raw chain-of-thought leakage
 * into the text channel when the model never wrote a clean closing
 * answer (live bug 2026-04-30 with gpt-oss:20b).
 */
const COT_META_PREFIXES: readonly RegExp[] = [
  /^\s*user\s+(asks?|says?|wants?|typed?|requested|posted)\b/i,
  /^\s*the\s+user\s+(asks?|says?|wants?|typed?|requested|is\s+(asking|requesting|interested))\b/i,
  /^\s*we\s+(need|should|must|could|will)\b/i,
  /^\s*let\s+me\b/i,
  /^\s*let'?s\b/i,
  /^\s*i\s+(should|need|must|will|am\s+going\s+to|am\s+supposed)\b/i,
  /^\s*(probably|likely|possibly|perhaps|maybe)\b/i,
  /^\s*(ok|okay|alright|so)[,.]?\s+(let|we|the\s+user|i)\b/i,
  /^\s*(consider|think|reason|analy[sz]e|step\s+\d)\b/i,
];

function looksLikeCoTMeta(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return true;
  for (const re of COT_META_PREFIXES) {
    if (re.test(trimmed)) return true;
  }
  return false;
}

/**
 * Split a paragraph into sentences. Naïve but adequate: split on
 * `. ` / `? ` / `! ` followed by an uppercase letter or quote. We
 * intentionally don't import a full NLP tokenizer — gpt-oss reasoning
 * blobs don't justify the dep.
 */
function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  // Match sentence terminators followed by whitespace + start-of-sentence
  // signal. The lookahead avoids capturing the next sentence's leading
  // character so each sentence keeps its own terminator.
  const parts = paragraph.split(/(?<=[.!?])\s+(?=["“]?[A-Z])/);
  for (const p of parts) {
    const t = p.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Extract the user-facing answer from a reasoning-only chain of thought.
 *
 * Strategy, in priority order:
 *   1. Harmony `<|channel|>final<|message|> … <|return|>` — gpt-oss's
 *      explicit "this is the user-facing answer" channel. If present,
 *      return the text between the `final` message marker and the next
 *      channel marker or end of string.
 *   2. A `final answer:` / `answer:` / `result:` label on its own line —
 *      take everything after it. Common when the model isn't using
 *      Harmony but still signals the final answer inline.
 *   3. Fallback: return the LAST non-empty paragraph of the thinking
 *      IF it looks like a closing statement. If the trailing
 *      paragraph is multi-sentence chain-of-thought, return only its
 *      LAST sentence. If even the last sentence is meta-commentary
 *      ("We need to…", "Let me think…", "User asks…"), return the
 *      empty string — the caller's `buildFallbackEvents` substitutes
 *      a generic placeholder so we never leak the full chain of
 *      thought into the user-visible text channel.
 *      (Live bug 2026-04-30: gpt-oss:20b's reasoning was being dumped
 *       verbatim into plain assistant content because step 3 always
 *       returned the last paragraph, and a one-paragraph chain of
 *       thought IS its own last paragraph.)
 */
export function extractFinalAnswerFromThinking(thinking: string): string {
  if (!thinking) return '';
  const raw = thinking.trim();
  if (!raw) return '';

  // (1) Harmony final channel.
  //
  // Shape: "<|channel|>final<|message|> HELLO WORLD <|return|>"
  //    or: "<|channel|>final<|message|>HELLO<|end|>"
  //
  // The regex is intentionally forgiving: we only require the channel
  // marker and message marker and then capture up to either another
  // `<|` token or end of string.
  const harmony = raw.match(
    /<\|channel\|>\s*final\s*<\|message\|>([\s\S]*?)(?:<\|[a-z_]+\|>|$)/i,
  );
  if (harmony && harmony[1].trim()) {
    return harmony[1].trim();
  }

  // (2) Explicit "Final answer:" / "Answer:" / "Result:" label, case
  // insensitive, on its own line. We take everything after the LAST
  // such label so nested citations (e.g. "Answer: blah. Also: foo")
  // don't split the answer prematurely.
  const labeled = raw.split(/\r?\n/).reduce<string | null>((acc, line, i, arr) => {
    const m = line.match(/^\s*(?:final\s+answer|answer|result)\s*[:\-]\s*(.*)$/i);
    if (!m) return acc;
    // Join the matching line tail + all subsequent lines
    const tail = [m[1], ...arr.slice(i + 1)].join('\n').trim();
    return tail.length > 0 ? tail : acc;
  }, null);
  if (labeled) return labeled;

  // (3) Last non-empty paragraph — but only when it looks like a
  // closing statement, not chain-of-thought.
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const lastPara = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : raw;

  // Single-sentence trailing paragraph: trust it as the final answer
  // (avoids regressing the "single line answer" / "I am claude." cases).
  const sentences = splitSentences(lastPara);
  if (sentences.length <= 1) {
    // If even this single sentence is pure meta-commentary, suppress.
    // But for the "I am claude." style of short, direct statement we
    // want to keep it — looksLikeCoTMeta returns false for those.
    if (looksLikeCoTMeta(lastPara)) return '';
    return lastPara;
  }

  // Multi-sentence trailing paragraph: prefer the LAST sentence,
  // working backward to skip any pure meta-commentary tail.
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (!looksLikeCoTMeta(sentences[i])) {
      return sentences[i];
    }
  }
  // Every sentence is meta-commentary — surface no answer; the caller
  // will substitute a generic placeholder.
  return '';
}

export interface BuildFallbackInput {
  accumulatedThinking: string;
  /** The next free block index. Caller tracks this; we consume one. */
  nextBlockIndex: number;
  /** Whether a thinking block is currently open — if so we must close
   *  it before opening the synthesized text block. */
  thinkingBlockOpen: boolean;
  /** The block index of the currently-open thinking block, if any. */
  openThinkingBlockIndex?: number;
}

export interface BuildFallbackOutput {
  /** Events to yield just before emitting the final `content_block_stop`
   *  for the stream. The synthesized text block's OWN stop event IS
   *  included so the caller does not need to emit one separately. */
  events: AnthropicStreamEvent[];
  /** Index that was consumed for the synthesized text block. */
  synthesizedBlockIndex: number;
  /** The text that was synthesized (useful for logging / tests). */
  synthesizedText: string;
}

/**
 * Generic, intentionally-bland placeholder shown when the thinking
 * channel was pure chain-of-thought meta-commentary and we have no
 * extractable user-facing answer. The full reasoning IS still visible
 * to the user under the `∴ Thinking` block — we just don't pretend
 * the chain-of-thought is the answer (live bug 2026-04-30 with
 * gpt-oss:20b leaking "User asks: 'what model are you'. We need to
 * answer..." into plain assistant content).
 */
const COT_ONLY_PLACEHOLDER = '(reasoning above — no separate final answer.)';

/**
 * Build the Anthropic-streaming event sequence to convert the trailing
 * thinking into a final text block. The caller should yield* these
 * events from its stream generator just before ending, instead of
 * emitting its own text block.
 */
export function buildFallbackEvents(input: BuildFallbackInput): BuildFallbackOutput {
  const events: AnthropicStreamEvent[] = [];
  let cursor = input.nextBlockIndex;

  // Close any still-open thinking block first.
  if (input.thinkingBlockOpen && input.openThinkingBlockIndex !== undefined) {
    events.push({ type: 'content_block_stop', index: input.openThinkingBlockIndex });
  }

  const extracted = extractFinalAnswerFromThinking(input.accumulatedThinking);
  // If extraction yielded nothing (pure chain-of-thought reasoning),
  // emit a generic placeholder so the Anthropic Messages contract still
  // gets ≥1 text_delta — but never leak the chain-of-thought as text.
  const synthesizedText = extracted || COT_ONLY_PLACEHOLDER;
  const synthesizedBlockIndex = cursor;
  cursor += 1;

  events.push({
    type: 'content_block_start',
    index: synthesizedBlockIndex,
    content_block: { type: 'text' },
  });
  events.push({
    type: 'content_block_delta',
    index: synthesizedBlockIndex,
    delta: { type: 'text_delta', text: synthesizedText },
  });
  events.push({ type: 'content_block_stop', index: synthesizedBlockIndex });

  return { events, synthesizedBlockIndex, synthesizedText };
}
