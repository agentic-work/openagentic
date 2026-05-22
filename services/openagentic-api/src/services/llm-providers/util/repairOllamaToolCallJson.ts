/**
 * repairOllamaToolCallJson — #869 (2026-05-15).
 *
 * Pure utility paired with `isOllamaParseToolCallError` (#851 detector).
 * When Ollama returns 500 with `error parsing tool call: raw='...'`,
 * extract the raw fragment and attempt a forgiving JSON repair.
 *
 * Repair scope (intentionally narrow):
 *   - `"key=value"` (single quoted token containing `=`) becomes
 *     `"key": value` where value is either a bare number or a quoted
 *     string. The model's "=" instead of ":" malformation is the
 *     only known failure mode from live capture; broader repair would
 *     mask other model bugs.
 *
 * Quoted string values containing literal `=` are preserved untouched
 * (we only rewrite tokens of the shape `"identifier=numeric_or_value"`
 * at the OBJECT-KEY position).
 *
 * Returns null if the fragment cannot be extracted from the error or
 * the repair output is still not valid JSON. Callers (OllamaProvider
 * #851 catch) should fall through to the existing soft-bail path on
 * null.
 */

const RAW_RE = /raw='([^']*)'/;

// Match a JSON OBJECT-KEY position token of shape `"ident=value"`
// where ident is [a-zA-Z_][a-zA-Z0-9_]* and value is either
//   - a bare number (digits + optional decimal), or
//   - a bare string of non-quote, non-comma, non-} characters.
//
// We require the preceding char to be `{` or `,` (with optional
// whitespace) so we don't accidentally rewrite content inside a quoted
// string value (e.g. `"query":"name=foo"` — that "name=foo" is inside
// a value, not at a key position).
const KEY_EQUALS_VALUE_RE =
  /([{,]\s*)"([a-zA-Z_][a-zA-Z0-9_]*)=([^"]*?)"/g;

export interface RepairOllamaToolCallJsonResult {
  /** The `raw='...'` fragment exactly as Ollama reported it. */
  raw: string;
  /** Repaired JSON string (may equal `raw` if already valid). */
  repaired: string;
  /** JSON.parse(repaired) — the recovered object. */
  parsed: unknown;
}

function repairOnce(raw: string): string {
  return raw.replace(KEY_EQUALS_VALUE_RE, (_match, prefix, key, value) => {
    // Determine if value is a bare number or needs to be quoted.
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return `${prefix}"${key}":${trimmed}`;
    }
    // Quote the value as a string. Escape any internal `"` (defensive).
    const escaped = trimmed.replace(/"/g, '\\"');
    return `${prefix}"${key}":"${escaped}"`;
  });
}

/**
 * #1025 (2026-05-22) — Ollama wraps the parser failure inside a JSON body,
 * so the errorText that reaches this function may have backslash-escaped
 * quotes inside the `raw='...'` clause:
 *   {"error":"...raw='{\"k=5\",\"query\":\"x\"}',..."}
 *
 * The `KEY_EQUALS_VALUE_RE` regex requires an unescaped `{"` or `,"` —
 * `{\"` doesn't match. Unescape JSON-style `\"` → `"`, `\\` → `\`,
 * `\/` → `/` so the repair regex can do its job. Backslash-escaped escape
 * sequences (`\n`, `\t`, `\r`, `\u00XX`) are left alone; the input is a
 * malformed JSON object whose keys/values are ASCII identifiers + ints +
 * short strings — none of those need newline / unicode unescape.
 */
function unescapeJsonEscapes(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\\//g, '/');
}

export function repairOllamaToolCallJson(
  errorText: string,
): RepairOllamaToolCallJsonResult | null {
  if (!errorText || typeof errorText !== 'string') return null;
  const match = errorText.match(RAW_RE);
  if (!match) return null;
  const rawExtracted = match[1];
  if (!rawExtracted) return null;

  // #1025 — if the extracted fragment has backslash-escaped quotes, the
  // outer error body was JSON-encoded. Unescape so repair sees plain JSON.
  const raw = rawExtracted.includes('\\"')
    ? unescapeJsonEscapes(rawExtracted)
    : rawExtracted;

  // First try the raw as-is — sometimes Ollama reports a parse error
  // for some other reason and the fragment IS valid JSON.
  try {
    const parsed = JSON.parse(raw);
    return { raw, repaired: raw, parsed };
  } catch {
    // fall through to repair
  }

  const repaired = repairOnce(raw);
  try {
    const parsed = JSON.parse(repaired);
    return { raw, repaired, parsed };
  } catch {
    return null;
  }
}
