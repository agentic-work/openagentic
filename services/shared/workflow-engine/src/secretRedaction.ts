/**
 * B3 — Secret-redaction layer
 *
 * Pure helper that replaces resolved secret values with [redacted:<secretName>]
 * placeholders before data is persisted or emitted.
 */

// TODO(S0-11 / engine-dedup): Until services/openagentic-workflows and
// services/openagentic-api consolidate their WorkflowExecutionEngine,
// this file is duplicated. Keep both copies byte-for-byte identical.
// See docs/superpowers/specs/2026-04-25-flows-enterprise-gap-analysis-design.md

/** Minimum secret value length to redact. Prevents false-positive redaction
 *  of short common strings like "ok", "1", "true". */
const MIN_SECRET_LENGTH = 4;

export interface RedactionMap {
  /** Map of secret name → resolved cleartext value */
  resolvedSecrets?: Map<string, string>;
}

/**
 * Build the sorted replacement list: longer values first to prevent a shorter
 * secret that is a sub-string of a longer one from winning the race.
 */
function buildReplacements(ctx: RedactionMap): Array<{ name: string; value: string }> {
  if (!ctx.resolvedSecrets || ctx.resolvedSecrets.size === 0) return [];

  return Array.from(ctx.resolvedSecrets.entries())
    .filter(([, value]) => value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b[1].length - a[1].length) // longest value first
    .map(([name, value]) => ({ name, value }));
}

/**
 * Redact all secret values within a single string.
 * Each occurrence of a secret value is replaced with `[redacted:<secretName>]`.
 */
export function redactString(target: string, ctx: RedactionMap): string {
  const replacements = buildReplacements(ctx);
  if (replacements.length === 0) return target;

  let result = target;
  for (const { name, value } of replacements) {
    // Use split+join for a global replace without regex (avoids escaping issues)
    result = result.split(value).join(`[redacted:${name}]`);
  }
  return result;
}

/**
 * Deep-redact every occurrence of resolved secret values in `target`.
 *
 * - Strings: all secret values replaced with `[redacted:<secretName>]`.
 * - Objects / arrays: deep-walked and returned as a new (cloned) structure.
 * - Primitives (number, boolean, null, undefined): returned as-is.
 * - Cycles: handled via a WeakSet; cyclic references in the copy point to
 *   an empty object sentinel rather than causing infinite recursion.
 * - The original `target` is never mutated.
 */
export function redactSecrets<T>(target: T, ctx: RedactionMap): T {
  const replacements = buildReplacements(ctx);
  if (replacements.length === 0) return target;

  const seen = new WeakSet<object>();

  function walk(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      let s = value;
      for (const { name, value: secretValue } of replacements) {
        s = s.split(secretValue).join(`[redacted:${name}]`);
      }
      return s;
    }

    if (typeof value !== 'object') {
      // number, boolean, bigint, symbol, function — pass through
      return value;
    }

    // Object or array — cycle-check first
    if (seen.has(value as object)) {
      // Return a cycle sentinel that won't leak the original reference
      return Array.isArray(value) ? [] : {};
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map(walk);
    }

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = walk((value as Record<string, unknown>)[key]);
    }
    return out;
  }

  return walk(target) as T;
}

/**
 * Redact a pino log meta object before it is emitted.
 * Returns the redacted meta (same shape as input), or passes through
 * null/undefined unchanged.
 *
 * Extracted as a pure function so it can be independently tested and reused
 * by any engine that proxies pino.
 */
export function redactLogMeta<T extends Record<string, unknown>>(meta: T, ctx: RedactionMap): T {
  return redactSecrets(meta, ctx);
}
