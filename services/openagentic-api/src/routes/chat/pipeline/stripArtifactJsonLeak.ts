/**
 * Sev-0 #492 / #807 / #880 / 2026-05-21 regression — strip
 * `compose_visual` / `compose_app` tool_use JSON args when models leak
 * them into the assistant prose body after dispatching the tool. The
 * iframe still mounts, but the user sees raw JSON in their chat bubble.
 *
 * Class of leak this targets:
 *
 *   1. gpt-oss:20b "JSON\n{...}" preamble shape:
 *
 *        Chord diagram of cross-account/tenant trust relationships ...
 *
 *        JSON
 *        {
 *          "template":"sankey",
 *          "title":"...",
 *          "data":{ "flows":[ ... ] },
 *          "group_id":"..."
 *        }
 *
 *        Explanation:
 *        ...
 *
 *   2. Sonnet 4.6 fenced ` ```json ` shape with `"template"` inside.
 *
 *   3. Bare `{...}` JSON object containing `"template"` + `"data"` after
 *      an "artifact rendered" caption.
 *
 * Replacement for the legacy `response.stripArtifactProseTokens.ts` helper
 * that was deleted in the v3 pipeline rip. Pure function — no side effects,
 * no logger calls.
 *
 * Caller (chatLoop / stream.handler.ts persistence site) MUST gate this on
 * whether the turn actually dispatched a `compose_visual` / `compose_app`
 * tool_use — applying it blindly to every turn would corrupt legitimate
 * conversational JSON snippets.
 */

const BLANK_LINE_RUN = /\n{3,}/g;

/**
 * True when a JSON-parseable string is an artifact-tool args payload —
 * i.e. it has a `template` field AND either `data` OR `flows` OR an
 * `x`/`y` chart-axis pair. Plain conversational JSON (`{"theme": "dark"}`,
 * `{"debug": true}`) does NOT match.
 */
function looksLikeArtifactArgs(jsonText: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.template !== 'string') return false;
  // template field present — confirm it's actually artifact-shaped by
  // checking for one of the structured payload keys.
  if (obj.data !== undefined) return true;
  if (Array.isArray((obj as { flows?: unknown }).flows)) return true;
  if (Array.isArray((obj as { x?: unknown }).x) || Array.isArray((obj as { y?: unknown }).y)) return true;
  // `group_id` alone is also a strong artifact-args tell.
  if (typeof obj.group_id === 'string') return true;
  return false;
}

/**
 * Find the matching closing brace for a `{` at `start` in `src`. Returns
 * the index AFTER the `}` (exclusive end), or -1 if unbalanced. Walks past
 * string literals so a `{` inside a string doesn't throw off the balance.
 */
function findJsonObjectEnd(src: string, start: number): number {
  if (src[start] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Strip a single occurrence of a leaked artifact JSON block starting at
 * cursor `from`. Returns `{ stripped, nextCursor }` where `stripped` is
 * the text with the leak removed and `nextCursor` is the index in
 * `stripped` to resume scanning from.
 *
 * Recognises three shapes:
 *   - ```json … ``` fenced block whose body looksLikeArtifactArgs
 *   - bare `JSON\n{ … }` (optionally preceded by whitespace/blank lines)
 *   - bare `{ … }` whose body looksLikeArtifactArgs
 *
 * Returns null when no leak found at/after the cursor.
 */
function stripNextLeak(
  text: string,
  from: number,
): { stripped: string; nextCursor: number } | null {
  // --- shape 1: ```json fenced block -----------------------------------
  const fenceRe = /```json\s*\n([\s\S]*?)\n```/gi;
  fenceRe.lastIndex = from;
  const fenceMatch = fenceRe.exec(text);
  // --- shape 2: bare `JSON\n{...}` line preamble -----------------------
  const jsonPreambleRe = /(^|\n)[ \t]*JSON[ \t]*\n[ \t]*\{/g;
  jsonPreambleRe.lastIndex = from;
  const preambleMatch = jsonPreambleRe.exec(text);
  // --- shape 3: bare `{...}` JSON object -------------------------------
  // Find the earliest `{` at/after cursor; check if balanced JSON parses
  // and looks like an artifact args payload.
  // Earliest `{` at/after the cursor (-1 when none remain).
  const bareBraceIdx = from < text.length ? text.indexOf('{', from) : -1;

  // Choose the earliest candidate.
  type Candidate = { kind: 'fence' | 'preamble' | 'bare'; start: number; end: number };
  const candidates: Candidate[] = [];
  if (fenceMatch && looksLikeArtifactArgs(fenceMatch[1].trim())) {
    candidates.push({
      kind: 'fence',
      start: fenceMatch.index,
      end: fenceMatch.index + fenceMatch[0].length,
    });
  }
  if (preambleMatch) {
    // Preamble match includes the optional leading newline; find the
    // actual `JSON` token + `{` position so we strip from the JSON line.
    const matchStart = preambleMatch.index + (preambleMatch[1] ? preambleMatch[1].length : 0);
    const braceIdx = text.indexOf('{', matchStart);
    if (braceIdx >= 0) {
      const objectEnd = findJsonObjectEnd(text, braceIdx);
      if (objectEnd > 0) {
        const body = text.substring(braceIdx, objectEnd);
        if (looksLikeArtifactArgs(body)) {
          candidates.push({
            kind: 'preamble',
            start: matchStart,
            end: objectEnd,
          });
        }
      }
    }
  }
  if (bareBraceIdx >= 0) {
    const objectEnd = findJsonObjectEnd(text, bareBraceIdx);
    if (objectEnd > 0) {
      const body = text.substring(bareBraceIdx, objectEnd);
      if (looksLikeArtifactArgs(body)) {
        candidates.push({
          kind: 'bare',
          start: bareBraceIdx,
          end: objectEnd,
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.start - b.start);
  const winner = candidates[0];

  // Expand the strip region to swallow trailing whitespace/newlines so
  // we don't leave a yawning gap.
  let stripEnd = winner.end;
  while (stripEnd < text.length && (text[stripEnd] === '\n' || text[stripEnd] === '\r' || text[stripEnd] === ' ' || text[stripEnd] === '\t')) {
    stripEnd += 1;
  }
  // And trailing-trim the preceding blank lines on the front edge if the
  // preamble shape was used (the `JSON` line is part of the leak).
  let stripStart = winner.start;
  while (stripStart > 0 && (text[stripStart - 1] === ' ' || text[stripStart - 1] === '\t')) {
    stripStart -= 1;
  }

  const stripped = text.substring(0, stripStart) + text.substring(stripEnd);
  return { stripped, nextCursor: stripStart };
}

/**
 * Strip leaked compose_visual / compose_app tool_use JSON args from an
 * assistant prose body. Idempotent — re-applying the function on its own
 * output produces the same string. Returns the input unchanged when no
 * leak is detected.
 */
export function stripArtifactJsonLeak(input: string): string {
  if (!input) return input;
  let out = input;
  let cursor = 0;
  // Bounded iteration — each strip shrinks the string, so worst case is
  // O(n) leaks. Hard-cap at 16 to defend against pathological inputs.
  for (let i = 0; i < 16; i++) {
    const result = stripNextLeak(out, cursor);
    if (!result) break;
    out = result.stripped;
    cursor = result.nextCursor;
  }
  // Collapse 3+ consecutive newlines down to a single blank-line
  // separator (mirrors the legacy stripArtifactProseTokens hygiene).
  out = out.replace(BLANK_LINE_RUN, '\n\n');
  return out;
}
