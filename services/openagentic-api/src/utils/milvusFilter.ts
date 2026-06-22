/**
 * Milvus boolean-expression filter helpers.
 *
 * Milvus `filter`/`expr` strings are built by string interpolation across the
 * codebase (e.g. `user_id == "${userId}"`). Any value that originates from a
 * request — tenant/user ids, tool names, MCP server names, resource scopes,
 * categories — MUST be escaped before interpolation, otherwise a `"` in the
 * value can break out of the quoted literal and inject arbitrary filter
 * predicates (a Milvus analogue of SQL injection, e.g. widening a per-user
 * isolation filter into a cross-user one).
 *
 * Milvus uses C-style string literals, so a double-quote is escaped as `\"`
 * and a backslash as `\\`. We escape backslashes first, then quotes, and also
 * strip control characters (newlines etc.) that have no place in an id/scope.
 */

// Matches ASCII control characters (0x00–0x1F and 0x7F).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /["\\\x00-\x1f\x7f]/;

/**
 * Escape a string value for safe interpolation INSIDE a double-quoted Milvus
 * string literal. The caller still supplies the surrounding quotes:
 *
 *   `user_id == "${escapeMilvusFilterValue(userId)}"`
 */
export function escapeMilvusFilterValue(value: unknown): string {
  return String(value ?? '')
    .replace(CONTROL_CHARS, '') // drop control chars
    .replaceAll(/\\/g, '\\\\') // backslash first
    .replaceAll(/"/g, '\\"'); // then double-quote
}

/**
 * Stricter variant: reject (throw) rather than escape when a value contains a
 * quote/backslash/control char. Use for fields that are NEVER expected to
 * contain such characters (ids, scopes, server names) so a malformed value is
 * surfaced loudly instead of silently coerced.
 */
export function assertSafeMilvusFilterValue(value: unknown, field = 'value'): string {
  const s = String(value ?? '');
  if (UNSAFE_CHARS.test(s)) {
    throw new Error(`Unsafe ${field} for Milvus filter: contains quote, backslash, or control character`);
  }
  return s;
}
