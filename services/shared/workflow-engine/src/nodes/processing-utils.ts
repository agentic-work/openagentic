/**
 * Shared utilities for the 5 typed processing primitives:
 *   filter_data, select_data, extract_key, parse_json, regex.
 *
 * These nodes were split out of the JS-expression-only `transform` path
 * per the n8n/Flowise/Langflow gap analysis
 * (reports/flowbuilder-gap-analysis/2026-05-14/recommendations.md, P0 #4).
 *
 * The helpers here are intentionally tiny + pure:
 *   - resolveDotPath: dot/bracket-aware lookup (e.g. 'data.items[0].name')
 *   - resolveInputValue: turns a `data.X` field that may be either an
 *     inline literal, a {{template}} string, or an upstream `input`
 *     reference back into the original structured value (object/array).
 *
 * The "templates only return strings" rule (engine interpolateTemplate
 * always returns a string, JSON.stringify'ing objects) means a literal
 * value like `'{{trigger.pods}}'` arrives at the executor as a JSON
 * string `'[{...},{...}]'`. resolveInputValue handles that by attempting
 * JSON.parse on the interpolated result and falling back to the raw
 * string when parsing fails. This mirrors the rag_query / data_source_query
 * pattern already in the codebase.
 */

import type { NodeExecutionContext } from './types.js';

/**
 * Resolve a dot/bracket path against a value. Supports:
 *   - 'foo.bar.baz'    → value.foo.bar.baz
 *   - 'items[0].name'  → value.items[0].name
 *   - 'a.b[2].c'       → value.a.b[2].c
 *
 * Returns `{ value, found }` so the caller can distinguish a real
 * `undefined` from "path did not resolve". `found` is true iff every
 * segment of the path was a defined key (or valid index for arrays).
 */
export function resolveDotPath(
  source: unknown,
  path: string,
): { value: unknown; found: boolean } {
  if (!path || path.trim() === '') return { value: source, found: source !== undefined };
  // Normalize bracket notation `foo[2]` → `foo.2` so we can split on '.'.
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const segments = normalized.split('.').filter((s) => s.length > 0);
  let cursor: any = source;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) {
      return { value: undefined, found: false };
    }
    if (typeof cursor !== 'object') {
      return { value: undefined, found: false };
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, seg)) {
      // Allow numeric array index (Array.isArray check)
      if (Array.isArray(cursor) && /^\d+$/.test(seg)) {
        const idx = Number(seg);
        if (idx >= 0 && idx < cursor.length) {
          cursor = cursor[idx];
          continue;
        }
      }
      return { value: undefined, found: false };
    }
    cursor = cursor[seg];
  }
  return { value: cursor, found: true };
}

/**
 * Resolve a node data field that may be:
 *   1. A literal (already an object/array/primitive) → return as-is.
 *   2. A template string like '{{trigger.pods}}' → interpolate, then
 *      attempt JSON.parse on the result (engine stringifies objects).
 *   3. A plain string that's not JSON → return the interpolated string.
 *
 * When `field` is undefined and an upstream `input` is supplied, fall
 * back to `input` directly — this is the canonical "no items field;
 * just pipe the upstream array through" UX.
 */
export function resolveInputValue(
  fieldValue: unknown,
  upstreamInput: unknown,
  ctx: NodeExecutionContext,
): unknown {
  // Inline literal path — non-string values come through as themselves.
  if (fieldValue === undefined || fieldValue === null) {
    return upstreamInput;
  }
  if (typeof fieldValue !== 'string') {
    return fieldValue;
  }

  // Template path — call the engine substitution layer.
  const interpolated = ctx.interpolateTemplate(fieldValue, upstreamInput);
  if (typeof interpolated !== 'string') return interpolated;

  // The engine stringifies any object/array it substitutes. Try to parse
  // back to the structured form; if that fails this is just a regular
  // string (e.g. a tag name, a single-value field).
  const trimmed = interpolated.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through — looked like JSON but wasn't.
    }
  }
  return interpolated;
}
