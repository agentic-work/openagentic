/**
 * loop node executor — schema-driven plugin shape (Task #45).
 *
 * Resolves the iteration source (input or {{template}}) into an array of
 * items, then delegates per-item subgraph execution to `ctx.iterateOver`.
 * The engine wires iterateOver to per-iteration executeNode calls binding
 * the item under `${itemVariable}` in the input, accumulating results.
 *
 * Migrated from WorkflowExecutionEngine.executeLoopNode. The "string source
 * that LLMs occasionally return as JSON / newline-delimited values" parsing
 * is preserved verbatim so saved flows that depend on it keep working.
 *
 * Result shape (consumed by outputAssertions in schema.json):
 *   {
 *     iterations: unknown[]    // one entry per item, returned by iterateOver
 *     itemCount: number
 *     itemVariable: string
 *   }
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export interface LoopResult {
  iterations: unknown[];
  itemCount: number;
  itemVariable: string;
}

/**
 * Find every BALANCED top-level `[...]` span in `s`, respecting string literals
 * and escapes so brackets inside JSON string values don't confuse the matcher.
 * Returns the raw substrings (including the outer brackets), in source order.
 *
 * Why this and not a regex: the live defect was the greedy `/\[[\s\S]*\]/`
 * matching from the FIRST `[` in the model's reasoning prose (a format-echo
 * decoy like `[{ "id": 1, ... }, ...]`) all the way to the LAST `]` of the real
 * array, swallowing the prose between them so JSON.parse threw and the array was
 * lost. A bracket-balanced scan returns the decoy AND the real array as separate
 * candidates so we can pick the one that actually parses to a usable array.
 */
function findBalancedArraySpans(s: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ']') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          spans.push(s.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return spans;
}

/**
 * Best-effort: extract the intended JSON array from a model-produced string that
 * may wrap the array in reasoning prose, a ```json code fence, and/or repeat a
 * decoy `[...]` example earlier in the text.
 *
 * Strategy (in priority order):
 *   1. Direct JSON.parse of the trimmed (fence-stripped) string.
 *   2. The LARGEST balanced `[...]` span that JSON.parse-es to a NON-EMPTY array
 *      (the real payload is almost always the longest valid array; the decoy
 *      format-echo is short / not valid JSON because of the trailing `, ...`).
 *   3. The LAST balanced span that parses to any array (LLMs emit the final
 *      answer after their reasoning).
 *
 * Returns `null` when no JSON array can be recovered (caller then falls back to
 * newline-splitting, preserving the legacy behavior for non-JSON strings).
 */
function extractJsonArray(raw: string): unknown[] | null {
  // Strip a single ```json … ``` (or bare ``` … ```) fence if the whole string
  // is fenced; otherwise leave inline fences for the span scanner to skip over.
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();

  // 1. Whole-string parse.
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through to span extraction */
  }

  // 2 + 3. Balanced-span extraction.
  const spans = findBalancedArraySpans(raw);
  let best: unknown[] | null = null;
  let bestLen = -1;
  let lastArray: unknown[] | null = null;
  for (const span of spans) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(span);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    lastArray = parsed;
    // Prefer the longest non-empty array (the real payload), not a decoy.
    if (parsed.length > 0 && span.length > bestLen) {
      best = parsed;
      bestLen = span.length;
    }
  }
  if (best) return best;
  // No non-empty array found, but an (empty) array did parse — honor it.
  return lastArray;
}

function resolveItems(
  iterateOver: string | undefined,
  input: unknown,
  ctx: NodeExecutionContext,
  nodeId: string,
): unknown[] {
  if (!iterateOver) {
    return Array.isArray(input) ? input : [input];
  }

  // The iteration source is authored in two equivalent forms across saved flows
  // and seed templates:
  //   (a) a BARE accessor   — `steps.llm-extract.output`, `input.items`
  //   (b) a FULL template   — `{{steps.llm-extract.output}}`, `{{input.list}}`
  // Wrapping unconditionally in `{{…}}` double-wraps form (b) into
  // `{{{{steps.llm-extract.output}}}}`. The interpolator's
  // /\{\{([^}]+)\}\}/ regex then captures the inner `{{steps.llm-extract.output`
  // (NOT the real path — note the leading `{{`), which matches none of the
  // resolver branches → returns '' and leaves a stray trailing `}}`. The loop
  // then iterated ONCE over that garbage string (live exec 39ed4ae3: an 8-clause
  // array collapsed to itemCount:1). Only wrap when the source has no template
  // braces; pass an already-templated source through verbatim.
  const templated = /\{\{[\s\S]+?\}\}/.test(iterateOver) ? iterateOver : `{{${iterateOver}}}`;
  const resolved = ctx.interpolateTemplate(templated, input);
  if (Array.isArray(resolved)) return resolved;

  if (typeof resolved === 'string') {
    // LLM nodes return their array as `{ content: "<reasoning prose>…[<array>]" }`
    // and {{steps.X.output}} resolves to that content STRING (interpolateTemplate
    // always returns a string in production). A naive JSON.parse fails on the
    // surrounding prose, and the old greedy `/\[[\s\S]*\]/` regex matched a
    // format-echo decoy bracket in the prose → JSON.parse threw → the real array
    // was lost and the loop ran once over the whole blob (live exec 2a15fe7d).
    // extractJsonArray does bracket-balanced, fence-aware, decoy-resistant
    // extraction and picks the largest valid JSON array.
    const parsedDirect = (() => {
      try {
        return JSON.parse(resolved);
      } catch {
        return undefined;
      }
    })();
    if (Array.isArray(parsedDirect)) return parsedDirect;

    const extracted = extractJsonArray(resolved);
    if (extracted) {
      ctx.logger.info(
        { nodeId, resolvedLength: resolved.length, itemCount: extracted.length },
        '[loop] extracted JSON array from string source',
      );
      return extracted;
    }

    // A non-array JSON scalar/object parsed cleanly → wrap as a single item.
    if (parsedDirect !== undefined) return [parsedDirect];

    // Not JSON at all: legacy newline-split fallback (preserves saved flows that
    // iterate over newline-delimited text).
    const items = resolved.split('\n').filter((s: string) => s.trim());
    ctx.logger.warn(
      { nodeId, resolvedLength: resolved.length, itemCount: items.length },
      '[loop] iterateOver value was not valid JSON, split into lines',
    );
    return items;
  }

  // Object / other types: wrap into singleton.
  if (resolved === null || resolved === undefined) return [];
  return Array.isArray(resolved) ? resolved : [resolved];
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<LoopResult> {
  const data = node.data as Record<string, any>;
  // Accept both `iterateOver` and the legacy `collection` field.
  const iterateOver: string | undefined = data.iterateOver || data.collection;
  const itemVariable: string = data.itemVariable || 'item';

  let items = resolveItems(iterateOver, input, ctx, node.id);

  // maxIterations safety cap — when configured (the schema's Max Iterations
  // field, accepted as either camelCase or the snake_case alias), slice the
  // resolved items so the loop never exceeds the bound. Unset / non-positive
  // → unbounded, preserving the historical behavior. This turns the previously
  // dead UI field into a real guardrail against runaway loops.
  const rawMax = data.maxIterations ?? data.max_iterations;
  const maxIterations = Number(rawMax);
  if (Number.isFinite(maxIterations) && maxIterations > 0 && items.length > maxIterations) {
    ctx.logger.warn(
      { nodeId: node.id, requested: items.length, maxIterations },
      '[loop] item count exceeds maxIterations — capping to the configured limit',
    );
    items = items.slice(0, maxIterations);
  }

  ctx.logger.info(
    { nodeId: node.id, itemCount: items.length, itemVariable },
    '[loop] Iterating over collection',
  );

  if (!ctx.iterateOver) {
    throw new Error(
      '[loop] ctx.iterateOver hook is required — engine is not wired correctly',
    );
  }

  const iterations = await ctx.iterateOver(node.id, items, itemVariable, input);

  return {
    iterations,
    itemCount: items.length,
    itemVariable,
  };
}
