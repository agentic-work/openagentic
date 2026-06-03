/**
 * stripLeadingReasoning — strip the leaked gpt-oss Harmony "analysis" channel
 * from a flow LLM node's final content.
 *
 * WHY (confirmed live 2026-06-02 against workflow_executions.node_outputs on
 * api pod agenticwork-api-6b968d546-bvr6b + a live wire capture against
 * /api/v1/chat/completions):
 *
 *   gpt-oss:20b emits a Harmony "analysis" channel (chain-of-thought) before
 *   its "final" channel. On the OpenAI-compatible streaming endpoint the
 *   shim DROPS the `<|channel|>analysis … <|channel|>final` markers and glues
 *   the reasoning prose straight onto the final answer, with NO separator —
 *   the channel boundary lands mid-string at a sentence/word break. The chat
 *   path (#1071) sends `think:false` + reads the final channel, but the FLOW
 *   LLM-node executors hit the streaming OpenAI shim where thinking is folded
 *   back into `content` (openai-compatible.ts:366-370 — "OpenAI API has no
 *   separate thinking stream"). So flow node `.content` carries verbatim
 *   reasoning like "We need to produce…", "The user asks…", "So say that."
 *   followed by the real answer.
 *
 * No reliable channel marker survives to this layer, so this stripper works on
 * the already-glued string. It is CONSERVATIVE: it only removes a *leading run*
 * of chain-of-thought meta sentences. If content does not start with CoT meta,
 * it is returned unchanged. It never returns empty for non-empty input.
 *
 * The CoT-meta heuristics mirror the chat-path's thinkingOnlyFallback.ts so the
 * two surfaces stay consistent.
 */

/**
 * Phrases that signal the model is narrating its REASONING about the task
 * (Harmony analysis channel) rather than producing the user-facing answer.
 * Verbatim-derived from live gpt-oss:20b flow-node leaks.
 */
const COT_META_PREFIXES: readonly RegExp[] = [
  // Third-person narration of the user's request (the analysis channel
  // routinely refers to "the user" AND, mid-blob, to "they").
  /^the\s+user('?s)?\s+(asks?|says?|wants?|typed?|requested|posted|gave|hasn'?t|did|is\s+(asking|requesting|interested))\b/i,
  // "The user:" / "The user says:" colon form — the analysis channel quotes the
  // prompt back verbatim ("The user: \"Explain …\""). The colon (optionally after
  // a verb) signals a quote of the request, NOT a user-facing sentence. We REQUIRE
  // the colon so a legitimate "The user interface presents …" is never matched.
  /^the\s+user\s*(?:says?|asks?|wants?|wrote|posted)?\s*:/i,
  /^they\s+(want|gave|say|said|ask|asked|mention|already|might|may)\b/i,
  // Bare "User wants/requests/asks/says/needs/wrote/provided …" — gpt-oss frequently
  // drops the leading "The" and narrates the request directly ("User wants a concise
  // explanation: …", "User requests: \"Provide …\""). A reasoning verb is REQUIRED so a
  // real answer like "User accounts are created during onboarding." (verb "accounts"/
  // "are") is never matched. Live: aee00ae7 llm-balanced, 526a1def llm-detail.
  /^user\s+(wants?|requests?|asks?|says?|said|needs?|wrote|posted|provided|gave|typed|hasn'?t|didn'?t|is\s+(asking|requesting))\b/i,
  /^the\s+(question|instruction|context|retrieved\s+context|assistant|prompt|code|example)\b/i,
  // "The task:" / "The task is:" / "The task is to …" — the analysis channel restating
  // its assignment to itself. The COLON (or "is to") is REQUIRED so a genuine answer
  // like "The task scheduler runs every five minutes." is never matched. Live: b98be4f6.
  /^the\s+task\s*(?::|is\s*:|is\s+to\b)/i,
  // "Just answer." / "Just answer:" / "Just answer the question/that/it." — a bare
  // self-instruction the model gives itself. REQUIRES a terminator or a meta object
  // (question/that/it/prompt/user) right after, so genuine guidance like "Just answer
  // the security questions on the recovery page." (object "the security questions")
  // is NOT matched. Live: aee00ae7 llm-eco.
  /^just\s+answer\s*(?:[.:!]|the\s+(?:question|prompt|user)\b|that\b|it\b)/i,
  // "The best we can do …" / "The safe(st) approach is …" / "The best approach is …" —
  // analysis-channel hedging openers that precede a glued real answer. Anchored to the
  // start so a mid-sentence "the best we can do is batch …" is never matched. Live:
  // 55c3698c llm-synthesize.
  /^the\s+(?:best|safe(?:st)?)\s+(?:thing\s+)?(?:we\s+can\s+do|approach|option|bet|way)\b/i,
  // "We …" — any first-person-plural reasoning ("We have many pods", "We
  // need to", "We can't"). gpt-oss narrates almost everything as "We …".
  /^we\s+\w+/i,
  /^let\s+me\b/i,
  /^let'?s\b/i,
  /^i\s+(should|need|must|will|am\s+going\s+to|am\s+supposed|'?ll|'?d|prefer|can|could)\b/i,
  /^(probably|likely|possibly|perhaps|maybe)\b/i,
  /^(ok|okay|alright|so|thus|now|also|but|hence|therefore)[,.:]?\s+/i,
  // "According to instruction(s)/the prompt/the system" — the model citing the
  // SYSTEM prompt to itself (analysis). A real answer that opens "According to the
  // specification/docs/RFC/study …" must NOT be stripped, so we scope this to the
  // instruction-citing forms only (was a blanket `according\s+to` — too broad).
  /^according\s+to\s+(?:the\s+)?(?:instructions?|prompt|system|guidelines?|rules?|directions?)\b/i,
  /^(consider|think|reason|analy[sz]e|step\s+\d)\b/i,
  // Imperative self-instruction the model gives ITSELF in the analysis
  // channel ("Must say so explicitly.", "Need to produce JSON.", "Cannot
  // evaluate."). These are reasoning, not the user-facing answer.
  /^(must|should|need\s+to|have\s+to|cannot|can'?t|could|would)\s+\w+/i,
  /^(first|second|third|next|then|finally)[,.]?\s/i,
  /^(make\s+sure|ensure|provide|return|produce|craft|output)\b.{0,80}\b(json|answer|final|response)\b/i,
  // Self-instruction about OUTPUT SHAPE — the analysis channel tells itself how
  // long / what form the answer should take ("Provide 2-3 sentences …", "Ensure
  // exactly 2-3 sentences.", "Write 2-3 sentences.", "Should keep to 2 sentences.").
  // These describe the answer, they are not it. To avoid eating REAL imperatives
  // ("Provide your team with runbooks.", "Write three unit tests."), we require a
  // DIGIT bound to a length-unit (the model's verbatim length self-constraint) OR
  // one of the literal self-talk meta phrases below — never a bare adjective.
  /^(?:provide|write|produce|give|craft|output|make|keep|generate|create)\b[^.]{0,40}?\b\d+(?:\s*[-–]\s*\d+)?\s+(?:sentences?|words?|paragraphs?|bullets?)\b/i,
  /^(?:ensure|make\s+sure)\b[^.]{0,40}?\b(?:exactly\s+)?\d+(?:\s*[-–]\s*\d+)?\s+(?:sentences?|words?|paragraphs?)\b/i,
  /^(?:should|must|need\s+to|just)\b[^.]{0,40}?\b(?:keep\s+(?:it\s+)?to\s+\d|\d+(?:\s*[-–]\s*\d+)?\s+(?:sentences?|words?|paragraphs?))\b/i,
  // Literal self-talk meta phrases — these only occur in the analysis channel,
  // never in a genuine answer. "No meta.", "No preamble.", "Use simple language.",
  // "Provide explanation." (bare object = the model naming the deliverable to
  // itself), "Produce a concise/final answer.".
  /^no\s+(?:meta|preamble|extra\s+commentary|markdown|fluff)\b/i,
  /^use\s+simple\s+language\b/i,
  /^provide\s+(?:an?\s+)?(?:explanation|answer|response|summary)\b\s*\.?$/i,
  /^(?:so\s+)?produce\s+(?:an?\s+)?(?:concise|short|brief|final|direct)\b/i,
  /^(?:should\s+be\s+)?(?:concise|direct|brief)\s*,?\s*no\s+(?:meta|preamble)\b/i,
];

/**
 * STRONG meta self-instruction phrases that, when they appear ANYWHERE inside the
 * leading prose, prove the surrounding text is the Harmony analysis channel — even
 * if the run did not *start* with an obvious meta sentence. gpt-oss frequently
 * opens the analysis with a plausible-sounding domain sentence ("In payment
 * processing, if a client retries …") then drifts into self-instruction
 * ("Should keep to 2-3 sentences. No meta. So produce a concise answer.") before
 * gluing on the real answer. These are intentionally narrow & output-shape-specific
 * so they never fire on a genuine answer. Used only to LOCATE the analysis run; the
 * cut still happens at a sentence boundary, never mid-sentence.
 */
const STRONG_META_MARKERS: readonly RegExp[] = [
  // Literal analysis-channel self-talk — never appears in a genuine answer.
  /\bno\s+(?:meta|preamble|extra\s+commentary)\b/i,
  /\bso\s+produce\s+a?\s*(?:concise|short|brief|final)\s+(?:answer|response|explanation)\b/i,
  // "Let's produce 2-3 sentences" / "Let's produce 2 sentences:" — REQUIRES the
  // length self-constraint so a real "Let's produce a great product" is excluded.
  /\blet'?s\s+produce\b[^.]{0,30}?\b\d+(?:\s*[-–]\s*\d+)?\s+(?:sentences?|words?|paragraphs?|bullets?)\b/i,
  // "Write/Provide/Ensure (exactly) N sentences/words" with an explicit count.
  /\b(?:should\s+keep\s+to|keep\s+(?:it\s+)?to|ensure\s+(?:exactly\s+)?|write|provide)\s*\d+(?:\s*[-–]\s*\d+)?\s+(?:sentences?|words?|paragraphs?)\b/i,
  // The model quoting/obeying the SYSTEM prompt to itself — pure analysis. These
  // phrases ("According to instruction: …", "So we should say that …") never occur
  // in a user-facing answer; they precede a glued real reply (live 90a5a2a4).
  /\baccording\s+to\s+(?:the\s+)?instruction\b/i,
  /\bso\s+we\s+(?:should|must|need\s+to|will|can)\b/i,
  /\bso\s+(?:the\s+)?(?:answer|assistant)\s+should\b/i,
  // gpt-oss self-counting its own sentences/items ("That's 3? Let's count: 1) … 2) …")
  // followed by "Yes. Ensure concise. Good." — pure analysis-channel verification that
  // only ever precedes a re-stated real answer. Live: aee00ae7 llm-premium.
  /\bthat'?s\s+\d+\?\s*let'?s\s+count\b/i,
  /\bensure\s+concise\.\s*good\.?/i,
  // "No extra fluff." / "No extraneous text." — terminal analysis self-talk that glues
  // straight onto the real answer. Live: aee00ae7 llm-eco, b98be4f6 llm-extract.
  /\bno\s+extra(?:neous)?\s+(?:fluff|text|commentary)\b/i,
  // "Need to produce JSON …" / "Provide entire array." — the extract node narrating the
  // output shape it must emit before gluing the trailing JSON. Live: b98be4f6 llm-extract.
  /\bneed\s+to\s+produce\s+(?:a\s+)?json\b/i,
  /\bprovide\s+(?:the\s+)?entire\s+(?:array|json|object)\b/i,
  // "That satisfies the instruction" / "The safe approach is to say" — synthesize-node
  // analysis hedging that precedes a glued refusal/answer. Live: 55c3698c llm-synthesize.
  /\bthat\s+satisfies\s+the\s+instruction\b/i,
  /\bthe\s+safe(?:st)?\s+approach\s+is\s+to\s+say\b/i,
  // "Let's do that." repeated as the analysis channel commits to a plan before gluing
  // the real deliverable. REQUIRES the terminal-decision form (period) so a genuine
  // "let's do that next sprint" mid-prose is excluded. Live: 526a1def llm-detail.
  /\blet'?s\s+do\s+that\s*\.(?=\s|$|\*|#)/i,
];

/**
 * VERY-STRONG terminal markers that ONLY appear at the tail of a gpt-oss analysis
 * run immediately before the glued real answer, and that NEVER appear in genuine
 * prose. Unlike STRONG_META_MARKERS (which the word-level walk uses and which
 * includes softer phrases like "so we should …"), these are used by the precise
 * character-offset cut and so must be unambiguous: a numbered self-counting run,
 * the "Ensure concise. Good." verification close, "No extra fluff/text.", or
 * "Let's produce." as a terminal decision. Each pins the END of the analysis.
 */
const TERMINAL_ANALYSIS_MARKERS: readonly RegExp[] = [
  /\bthat'?s\s+\d+\?\s*let'?s\s+count\b/i,
  /\bensure\s+concise\.\s*good\.?/i,
  /\bno\s+extra(?:neous)?\s+(?:fluff|text|commentary)\b/i,
  /\bprovide\s+(?:the\s+)?entire\s+(?:array|json|object)\b/i,
  /\blet'?s\s+produce\s*\.(?=\s|$|\[|\{|\*|#|[A-Z])/i,
];

/**
 * Inline "the final answer follows" markers that gpt-oss writes at the END of
 * its analysis blob, glued onto the actual answer
 * (e.g. "…No extra commentary. So answer: pong."). When present, the user-
 * facing answer is the tail AFTER the LAST such marker.
 */
const INLINE_FINAL_MARKERS: readonly RegExp[] = [
  // "Thus final answer: \"…\"" / "So final answer: …" — the analysis channel announcing
  // the deliverable right before gluing it on. Live: 55c3698c llm-synthesize.
  /\b(?:thus|so|hence|therefore)\s+(?:the\s+)?final\s+answer\s*:?\s*/gi,
  /\b(?:so\s+)?(?:the\s+)?(?:final\s+)?answer\s+(?:is|should\s+be|would\s+be)\s*:?\s*/gi,
  /\bso\s+answer\s*:\s*/gi,
  /\b(?:final\s+answer|answer|result|response|conclusion)\s*[:\-]\s*/gi,
];

/**
 * Reasoning signals that, when present ANYWHERE in a prefix segment, prove that the
 * segment is the analysis channel rather than a legitimate report intro. Used to
 * GUARD the fast-path structural cut so a clean report that opens with bold and has
 * later bold headers is never severed at one of its own headings.
 *
 * These are the phrases gpt-oss only ever emits while narrating its own plan — they
 * do not appear in a polished deliverable. Deliberately broad here (this only ever
 * GATES a cut whose boundary is already pinned by a structural marker), but each is
 * still self-talk, never report prose.
 */
const PREFIX_REASONING_SIGNALS: readonly RegExp[] = [
  /\bwe\s+(?:need\s+to|can|could|should|must|must\s+produce|will|have\s+to|can'?t|cannot|might)\b/i,
  /\blet'?s\s+(?:do|produce|count|interpret|craft|compute|approximate|give|provide|list|use)\b/i,
  /\bthe\s+(?:user|task|instruction|request)\b\s*:?/i,
  /\buser\s+(?:wants?|requests?|asks?|says?|needs?|provided|wrote)\b/i,
  /\bthat'?s\s+(?:huge|too\s+(?:long|much|large)|\d+\?)/i,
  /\bneed\s+to\s+produce\b/i,
  /\bcould\s+be\s+(?:too\s+large|interpreted|ambiguous)\b/i,
  /\bthe\s+instruction\s+(?:ambiguous|is\s+ambiguous|might\s+mean)\b/i,
  /\bjust\s+answer\s*[.:!]/i,
  ...TERMINAL_ANALYSIS_MARKERS,
];

function prefixLooksLikeReasoning(prefix: string): boolean {
  return PREFIX_REASONING_SIGNALS.some((re) => re.test(prefix));
}

/** A sentence is CoT meta if it matches any of the reasoning-narration prefixes. */
function looksLikeCoTMeta(sentence: string): boolean {
  const t = sentence.trim();
  if (!t) return true;
  for (const re of COT_META_PREFIXES) {
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * Split prose into sentences. Naïve but adequate for gpt-oss reasoning blobs:
 * split after `.`/`!`/`?`/`:` when followed by whitespace OR directly by a
 * start-of-sentence signal (capital letter, quote, brace, bracket, markdown
 * bold). The "directly by" case is what catches the GLUED boundary
 * (`say that.I’m sorry`, `final JSON.{"severity"`).
 */
function splitSentences(text: string): string[] {
  // Insert a split point after a terminator when the next char starts a new
  // unit: whitespace, an uppercase/quote/brace/bracket, or markdown bold.
  const marked = text
    // glued: terminator immediately followed by capital / quote / brace / bracket
    .replace(/([.!?])(?=["“”'(\[{]?[A-Z])/g, '$1 ')
    .replace(/([.!?])(?=[{\[])/g, '$1 ')
    // glued markdown header: terminator immediately followed by ** or ## or #
    .replace(/([.!?:])(?=\*\*|#{1,6}\s)/g, '$1 ')
    // normal: terminator + whitespace + start signal
    .replace(/([.!?])\s+(?=["“”'(\[{]?[A-Z0-9*#])/g, '$1 ');
  return marked
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Remove `<think>…</think>` blocks anywhere in the text (defensive — some
 * provider paths surface raw think tags).
 */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * If raw Harmony channel markers survived to this layer (some provider paths
 * forward them un-stripped), the answer is the LAST `final` channel's message.
 * Returns the final-channel text, or null when no usable channel marker exists.
 *
 * Handles both the full form `<|channel|>final<|message|>…<|end|>` and the
 * truncated tail form where the closing `<|end|>` was dropped.
 */
function extractHarmonyFinalChannel(text: string): string | null {
  if (!/<\|channel\|>/i.test(text)) return null;
  // Grab every `<|channel|>final<|message|> … (<|end|> | <|channel|> | EOS)`.
  const re = /<\|channel\|>\s*final\s*<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|channel\|>|$)/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1].trim();
    if (body.length > 0) last = body;
  }
  if (last !== null) return last;
  // No `final` channel, but markers are present — strip ALL channel scaffolding
  // and any analysis block, returning whatever prose remains.
  const stripped = text
    .replace(/<\|channel\|>\s*analysis\s*<\|message\|>[\s\S]*?(?=<\|channel\|>|<\|end\|>|$)/gi, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
  return stripped.length > 0 ? stripped : null;
}

/**
 * Locate the cut point for a mid-blob analysis run: the model opened with a
 * non-meta-looking sentence, drifted into self-instruction, then glued the real
 * answer on. We only act when a STRONG_META_MARKER is present (proof it's the
 * analysis channel). We then walk sentences and return the index of the first
 * sentence AFTER the last meta sentence in the leading contiguous-ish meta region.
 *
 * Conservative guards:
 *  - requires a STRONG_META_MARKER somewhere in the text (else returns -1),
 *  - the cut must leave a non-empty tail,
 *  - never cuts past the halfway point unless the strong marker itself sits
 *    in the back half (so we don't strip a long legitimate answer that merely
 *    contains a strong-marker-like phrase late).
 */
function findMetaRunCut(sentences: string[], text: string): number {
  const hasStrong = STRONG_META_MARKERS.some((re) => re.test(text));
  if (!hasStrong) return -1;
  if (sentences.length < 2) return -1;

  // Identify which sentence holds the LAST strong marker — the analysis run ends
  // at or after it; the real answer begins at the next non-meta sentence.
  let lastStrongIdx = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (STRONG_META_MARKERS.some((re) => re.test(sentences[i]))) lastStrongIdx = i;
  }
  if (lastStrongIdx < 0) return -1;

  // From the sentence after the last strong-marker sentence, skip any further
  // CoT-meta sentences, then cut at the first real one.
  for (let i = lastStrongIdx + 1; i < sentences.length; i++) {
    if (!looksLikeCoTMeta(sentences[i])) return i;
  }
  return -1;
}

/**
 * Char-offset variant of the mid-blob cut. The `splitSentences` helper produces a
 * coarse (whitespace-level) token list that the sentence-walking `findMetaRunCut`
 * relies on — that walk is reliable for short refusal-style leaks but cannot pin
 * the boundary when the analysis run contains numbered self-counting items
 * ("1) … 2) … 3) …") followed by a re-stated real answer (live aee00ae7 llm-premium).
 *
 * This function works directly on character offsets: it finds the END offset of the
 * LAST TERMINAL_ANALYSIS_MARKER match in the raw text, then advances to the next real
 * sentence boundary (terminator + space + capital, OR a glued bold/heading) and
 * returns that offset. Everything before it is the analysis run.
 *
 * Conservative guards (must ALL hold or it returns -1, leaving text untouched):
 *  - at least one TERMINAL_ANALYSIS_MARKER must be present,
 *  - the cut offset must be > 0 and leave a non-empty tail,
 *  - the tail must NOT itself open with a CoT-meta token (don't cut into more
 *    reasoning), and
 *  - the tail must be at least 20 chars (avoid surfacing a stray fragment).
 */
function findStrongMarkerCharCut(text: string): number {
  let lastEnd = -1;
  for (const re of TERMINAL_ANALYSIS_MARKERS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      const end = m.index + m[0].length;
      if (end > lastEnd) lastEnd = end;
      if (m.index === g.lastIndex) g.lastIndex++; // guard zero-width
    }
  }
  if (lastEnd <= 0 || lastEnd >= text.length) return -1;

  // From lastEnd, advance over any whitespace then over any further CoT-meta
  // sentences until we reach a real sentence. We locate sentence boundaries with a
  // forward scan for terminator+space+Capital OR a glued bold/heading start.
  const rest = text.slice(lastEnd);
  // Skip a leading run of analysis sentences that follow the marker (e.g. "Good.").
  // Split the remainder on real sentence boundaries (proper boundaries here, not the
  // word-level split) and drop leading meta sentences.
  const boundary = /(?<=[.!?])\s+(?=["“”'(\[{]?[A-Z])|(?<=[.!?:])\s*(?=\*\*|#{1,6}\s)/;
  const parts = rest.split(boundary).filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  let consumed = 0;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i].trim();
    if (looksLikeCoTMeta(seg)) {
      consumed += parts[i].length;
      // account for the boundary whitespace that split() removed by re-finding it
      const after = rest.slice(consumed);
      const ws = after.match(/^\s+/);
      if (ws) consumed += ws[0].length;
      continue;
    }
    // First real sentence — cut here.
    const cut = lastEnd + (rest.length - rest.slice(consumed).length);
    const tail = text.slice(cut).trim();
    if (tail.length >= 20 && !looksLikeCoTMeta(tail.split(/(?<=[.!?])\s+/)[0] ?? tail)) {
      return cut;
    }
    return -1;
  }
  return -1;
}

/**
 * Locate the start index of the "final" answer when it is glued onto reasoning
 * via a structural marker. Returns -1 when no such marker is found.
 *
 * Markers (proven from live data), in priority order:
 *   1. A markdown bold "Answer:" / "Final answer:" / "Bottom line" header.
 *   2. The first top-level JSON object/array that runs to the end of string
 *      (reasoning is prose, the answer is the trailing JSON).
 */
function findStructuralFinalStart(text: string): number {
  // 1a. Markdown final-answer LABEL glued onto reasoning ("**Answer:**",
  //     "**Bottom line**", "**Summary**").
  const header = text.match(/\*\*(?:final\s+answer|answer|bottom\s+line|summary|result)\b/i);
  if (header && header.index !== undefined && header.index > 0) {
    return header.index;
  }

  // 1b. A markdown TITLE/HEADING that begins the final answer — a bold span
  //     ("**Title**") or ATX heading ("# Title") that starts a new block
  //     glued directly onto reasoning prose. gpt-oss routinely ends its
  //     analysis with "…We'll produce.**Title**\n\n<answer>". We only accept
  //     a boundary that follows a sentence terminator or a blank line so a
  //     mid-answer bold word is never mistaken for the start.
  const blockStart = text.match(/(?:[.!?:]\s*|\n\s*\n\s*|\n\s*)(\*\*[^\n*][^\n]*?\*\*|#{1,6}\s+\S)/);
  if (blockStart && blockStart.index !== undefined && blockStart.index > 0) {
    // Index of the captured group (the actual markdown), not the leading punctuation.
    const groupIdx = text.indexOf(blockStart[1], blockStart.index);
    if (groupIdx > 0) return groupIdx;
  }

  // 2. Trailing top-level JSON. Find the last '{' or '[' whose matching close
  //    is at (or near) end-of-string and which parses as JSON.
  for (const open of ['{', '['] as const) {
    let idx = text.lastIndexOf(open);
    while (idx > 0) {
      const candidate = text.slice(idx).trim();
      try {
        JSON.parse(candidate);
        return idx;
      } catch {
        /* keep searching earlier */
      }
      idx = text.lastIndexOf(open, idx - 1);
    }
  }
  return -1;
}

/**
 * Strip the leading Harmony/CoT reasoning run from a flow LLM node's content.
 *
 * Algorithm:
 *   0. Strip any `<think>…</think>` blocks.
 *   1. If a structural final-answer marker (bold "Answer:" header or trailing
 *      JSON) sits after a CoT-meta lead-in, cut there.
 *   2. Otherwise drop the leading consecutive run of CoT-meta sentences and
 *      keep from the first non-CoT sentence onward.
 *   3. If everything looked like reasoning, fall back to the LAST sentence
 *      (the model's closing statement) so we never return empty.
 */
export function stripLeadingReasoning(content: string): string {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return content;
  }

  // (0a) Raw Harmony channel markers survived — take the final channel verbatim.
  const harmonyFinal = extractHarmonyFinalChannel(content);
  if (harmonyFinal !== null) {
    // Recurse once: the final-channel body itself is usually clean, but defend
    // against any residual glued reasoning inside it.
    return stripLeadingReasoning(stripThinkTags(harmonyFinal));
  }

  const dethought = stripThinkTags(content);
  if (dethought.length === 0) return content; // was entirely a think block? keep original
  const text = dethought;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return text;

  // Fast path — content does not begin with reasoning narration. BUT before we
  // trust it, check for a mid-blob analysis run: gpt-oss sometimes opens with a
  // plausible domain sentence then drifts into self-instruction ("…Should keep to
  // 2-3 sentences. No meta. So produce a concise answer.<real answer>"). A
  // STRONG_META_MARKER anywhere proves it's the analysis channel; cut to the real
  // answer that follows the meta run.
  if (!looksLikeCoTMeta(sentences[0])) {
    // (a) Structural marker — a glued bold/heading or trailing JSON can pin the real
    //     answer (live 526a1def llm-detail opens with a bare "User requests:" the
    //     word-split misses, but the glued "**Dataset Overview**" header is exact).
    //     GUARD: only cut here when the prose BEFORE the marker actually reads as
    //     reasoning. A clean report that LEGITIMATELY opens with bold and contains
    //     several bold headers ("**1. …** … **3. Best Value**") must NOT be cut at a
    //     later header. We require a reasoning signal (bare-user opener, "We …",
    //     "Let's …", a self-instruction prefix, or a TERMINAL_ANALYSIS_MARKER) in the
    //     prefix segment before honoring the structural cut.
    const structIdx = findStructuralFinalStart(text);
    if (structIdx > 0 && prefixLooksLikeReasoning(text.slice(0, structIdx))) {
      const tail = text.slice(structIdx).trim();
      if (tail.length > 0) return tail;
    }
    // (b) Char-offset terminal-marker cut — pins the boundary after a numbered
    //     self-counting / verification run ("That's 3? Let's count: 1) … Ensure
    //     concise. Good.<real answer>"). More precise than the word-level walk.
    const charCut = findStrongMarkerCharCut(text);
    if (charCut > 0) {
      const tail = text.slice(charCut).trim();
      if (tail.length > 0) return tail;
    }
    // (c) Word-level meta-run walk (legacy path for the short "…No meta. So produce
    //     a concise answer.<real>" form).
    const midCut = findMetaRunCut(sentences, text);
    if (midCut > 0) {
      const tail = sentences.slice(midCut).join(' ').trim();
      if (tail.length > 0) return tail;
    }
    return text;
  }

  // (1) Structural marker — cut at a glued bold "Answer:" header or trailing JSON.
  const structIdx = findStructuralFinalStart(text);
  if (structIdx > 0) {
    const tail = text.slice(structIdx).trim();
    if (tail.length > 0) return tail;
  }

  // (1.5) Strong-meta-run cut. When an output-shape self-instruction marker
  // ("Let's produce…", "Write 2-3 sentences", "No meta", "So produce a concise
  // answer") is present, it reliably pins the END of the analysis channel — the
  // real answer is the first non-meta sentence AFTER the last such marker. This
  // is more robust than the naive contiguous-run drop below, which stops early at
  // the first sentence it doesn't recognize as meta even though more analysis
  // (and the giveaway marker) follows. Live: 95c4d1fc llm-premium / llm-balanced.
  const strongCut = findMetaRunCut(sentences, text);
  if (strongCut > 0) {
    const tail = sentences.slice(strongCut).join(' ').trim();
    if (tail.length > 0) return tail;
  }

  // (2) Drop the leading run of CoT-meta sentences.
  let firstReal = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (!looksLikeCoTMeta(sentences[i])) {
      firstReal = i;
      break;
    }
  }
  if (firstReal >= 0) {
    return sentences.slice(firstReal).join(' ').trim();
  }

  // (3) Everything parsed as reasoning. Try an INLINE final-answer marker
  // ("…So answer: pong.") and surface the tail after the LAST occurrence.
  for (const re of INLINE_FINAL_MARKERS) {
    re.lastIndex = 0;
    let lastIdx = -1;
    let lastLen = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      lastIdx = m.index;
      lastLen = m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loop
    }
    if (lastIdx >= 0) {
      const tail = text.slice(lastIdx + lastLen).trim();
      if (tail.length > 0) return tail;
    }
  }

  // (4) No marker at all — surface the last sentence rather than empty.
  return sentences[sentences.length - 1].trim();
}
