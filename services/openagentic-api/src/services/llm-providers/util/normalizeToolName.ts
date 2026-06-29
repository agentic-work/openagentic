/**
 * Normalize a model-emitted tool name into something the openagentic CLI's
 * tool registry will recognize.
 *
 * Two real-world failure modes from gpt-oss:20b on Ollama drove this
 * (#423):
 *
 *   1. **Harmony special tokens**: `Bash<|channel|>`, `WebFetch<|end|>`.
 *      The model leaks Harmony framing into the tool_use.name field
 *      when the tokenizer doesn't fence cleanly at the call boundary.
 *      Strip every `<|...|>` token.
 *
 *   2. **Multilingual tokenizer leakage**: `WebSearchുവര` (Malayalam),
 *      `Bash世界` (CJK), `Read🔥` (emoji). gpt-oss's vocab includes
 *      multilingual subword tokens that occasionally bleed into tool
 *      names mid-decode. Strip every non-ASCII suffix.
 *
 * After stripping, optionally fuzzy-match against a list of known tool
 * names (the request's `tools[].function.name`). Match rules:
 *
 *   - exact match → keep
 *   - case-insensitive match → snap to canonical case
 *   - prefix-of-known (≥4 chars) → expand to the longer canonical
 *
 * Hallucinated names that don't fuzzy-match (e.g. `Browse`, which
 * gpt-oss sometimes invents but isn't in openagentic's registry) are
 * RETURNED AS-IS so the downstream agent loop emits its standard
 * "No such tool available: X" error. We never silently map a
 * hallucination to a different tool — that's worse than failing loud.
 */
export function normalizeToolName(
  name: string | undefined | null,
  knownTools?: string[],
): string {
  if (!name) return '';

  // 1. Strip Harmony special tokens like <|channel|>, <|end|>, <|call|>.
  let cleaned = name.replace(/<\|[^|]*\|>/g, '');

  // 2. Strip non-ASCII suffix. We keep ONLY the leading ASCII run —
  //    every printable ASCII char (codepoint 0x20–0x7E) is allowed in
  //    a tool name; the moment we hit a non-ASCII codepoint we stop
  //    and discard the rest. This handles Malayalam (`ുവര`), CJK
  //    (`世界`), emoji (`🔥`), and any other tokenizer noise without
  //    requiring a per-script allow-list.
  cleaned = cleaned.match(/^[\x20-\x7E]*/)?.[0] ?? '';

  // 3. Trim incidental whitespace introduced by the strips.
  cleaned = cleaned.trim();

  // 4. (#845, 2026-05-14) Strip TRAILING non-identifier characters.
  //    Live capture: gpt-oss:20b emitted `azure_list_vms?` with a literal
  //    `?` — printable ASCII so step 2 didn't touch it, but no MCP tool
  //    has `?` in its name so dispatch failed with "tool not found".
  //    Tool names are JS-identifier-shaped (letters/digits/underscore);
  //    any trailing `?`, `!`, `.`, `:`, etc. is model uncertainty noise
  //    that should be peeled off before the fuzzy-match retry.
  cleaned = cleaned.replace(/[^A-Za-z0-9_]+$/, '');

  if (!cleaned) return '';
  if (!knownTools || knownTools.length === 0) return cleaned;

  // 4. Fuzzy-match against the known list.
  // 4a. Exact match (preserves case).
  if (knownTools.includes(cleaned)) return cleaned;

  // 4b. Case-insensitive match.
  const lower = cleaned.toLowerCase();
  for (const k of knownTools) {
    if (k.toLowerCase() === lower) return k;
  }

  // 4c. Prefix-of-known: model truncated the name (`WebFetc` → `WebFetch`).
  // Require at least 4 chars to avoid spurious matches on short prefixes.
  if (cleaned.length >= 4) {
    const prefixMatches = knownTools.filter((k) =>
      k.toLowerCase().startsWith(lower),
    );
    if (prefixMatches.length === 1) return prefixMatches[0];
  }

  // No good fuzzy match — return cleaned as-is so the agent loop
  // surfaces a "No such tool available" error to the user.
  return cleaned;
}
