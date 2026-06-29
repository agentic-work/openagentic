/**
 * map_reduce node executor — fan-out over a collection, then reduce.
 *
 * MAP phase: resolves the input collection (from `items` template/array, or
 * the upstream input when `items` is unset), then runs the downstream subgraph
 * once per item via `ctx.iterateOver(nodeId, items, itemVariable, input,
 * concurrency)`. The engine bounds concurrency to the configured limit.
 *
 * REDUCE phase: folds the per-item results into a single value with a
 * deterministic, model-free strategy chosen by `reduce`:
 *   - collect (default) — return the array of per-item results verbatim
 *   - concat           — flatten arrays / join strings across items
 *   - sum / avg / min / max — numeric reductions (coerces each item result)
 *   - count            — number of items processed
 *
 * Refuses to run on a non-collection input (must say so — never run blind).
 * An empty collection is a VALID outcome: returns the reduce identity
 * (e.g. [] for collect, 0 for sum/count) with itemCount=0 and no subgraph run.
 *
 * The MAP phase delegates to the same `ctx.iterateOver` hook the loop node
 * uses, so engine wiring is shared; the new `concurrency` arg bounds fan-out.
 */

import type { NodeExecutionContext, WorkflowNode } from '../types.js';

export type ReduceStrategy =
  | 'collect'
  | 'concat'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count';

const REDUCE_STRATEGIES: ReadonlySet<string> = new Set<ReduceStrategy>([
  'collect',
  'concat',
  'sum',
  'avg',
  'min',
  'max',
  'count',
]);

export interface MapReduceResult {
  reduceStrategy: ReduceStrategy;
  itemCount: number;
  concurrency: number;
  mapped: unknown[];
  output: unknown;
}

function resolveItems(
  itemsRaw: unknown,
  input: unknown,
  ctx: NodeExecutionContext,
  nodeId: string,
): unknown[] {
  // Unset `items` → fan out over the upstream input directly.
  if (itemsRaw === undefined || itemsRaw === null || itemsRaw === '') {
    if (Array.isArray(input)) return input;
    throw new Error(
      "map_reduce: no collection to map over — `items` is unset and the upstream input is not an array " +
        `(got ${input === null ? 'null' : typeof input}). Provide an array via the input or set the items field.`,
    );
  }

  // Template string → interpolate, then coerce to an array.
  const resolved =
    typeof itemsRaw === 'string' && itemsRaw.includes('{{')
      ? ctx.interpolateTemplate(itemsRaw, input)
      : itemsRaw;

  if (Array.isArray(resolved)) return resolved;

  if (typeof resolved === 'string') {
    const trimmed = resolved.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to the explicit error below
    }
  }

  throw new Error(
    `map_reduce: \`items\` did not resolve to an array — got ${
      resolved === null ? 'null' : typeof resolved
    }. Provide a JSON array (or a templated path that resolves to one).`,
  );
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if (v && typeof v === 'object') {
    // Common shape: { value: N } / { count: N }
    const obj = v as Record<string, unknown>;
    for (const k of ['value', 'count', 'result', 'total']) {
      if (typeof obj[k] === 'number') return obj[k] as number;
    }
  }
  throw new Error(
    `map_reduce: numeric reduce could not coerce a per-item result to a number (got ${
      v === null ? 'null' : typeof v
    }).`,
  );
}

function reduce(strategy: ReduceStrategy, mapped: unknown[]): unknown {
  switch (strategy) {
    case 'collect':
      return mapped;
    case 'count':
      return mapped.length;
    case 'concat': {
      // If every item is an array, flatten; otherwise string-join.
      if (mapped.every((m) => Array.isArray(m))) {
        return ([] as unknown[]).concat(...(mapped as unknown[][]));
      }
      return mapped.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('');
    }
    case 'sum':
      return mapped.reduce<number>((acc, m) => acc + toNumber(m), 0);
    case 'avg':
      return mapped.length === 0
        ? 0
        : mapped.reduce<number>((acc, m) => acc + toNumber(m), 0) / mapped.length;
    case 'min':
      return mapped.length === 0
        ? null
        : mapped.reduce<number>(
            (acc, m) => Math.min(acc, toNumber(m)),
            Number.POSITIVE_INFINITY,
          );
    case 'max':
      return mapped.length === 0
        ? null
        : mapped.reduce<number>(
            (acc, m) => Math.max(acc, toNumber(m)),
            Number.NEGATIVE_INFINITY,
          );
    default:
      // Unreachable — strategy is validated before reduce() is called.
      return mapped;
  }
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<MapReduceResult> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = (node.data || {}) as Record<string, unknown>;

  const reduceStrategy = (
    typeof data.reduce === 'string' ? data.reduce : 'collect'
  ) as ReduceStrategy;
  if (!REDUCE_STRATEGIES.has(reduceStrategy)) {
    throw new Error(
      `map_reduce: unknown reduce strategy '${reduceStrategy}'. ` +
        `Expected one of: ${Array.from(REDUCE_STRATEGIES).join(', ')}.`,
    );
  }

  const itemVariable = typeof data.itemVariable === 'string' ? data.itemVariable : 'item';
  const concurrencyRaw = data.concurrency;
  const concurrency =
    typeof concurrencyRaw === 'number' && concurrencyRaw >= 1
      ? Math.floor(concurrencyRaw)
      : 1;

  const items = resolveItems(data.items, input, ctx, node.id);

  ctx.logger.info(
    { nodeId: node.id, itemCount: items.length, concurrency, reduceStrategy, itemVariable },
    '[map_reduce] Mapping collection',
  );

  // Empty collection — short-circuit with the reduce identity, no subgraph run.
  if (items.length === 0) {
    return {
      reduceStrategy,
      itemCount: 0,
      concurrency,
      mapped: [],
      output: reduce(reduceStrategy, []),
    };
  }

  if (!ctx.iterateOver) {
    throw new Error(
      '[map_reduce] ctx.iterateOver hook is required — engine is not wired correctly',
    );
  }

  const mapped = await ctx.iterateOver(node.id, items, itemVariable, input, concurrency);

  const output = reduce(reduceStrategy, mapped);

  ctx.logger.info(
    { nodeId: node.id, itemCount: items.length, reduceStrategy },
    '[map_reduce] Reduced mapped results',
  );

  return {
    reduceStrategy,
    itemCount: items.length,
    concurrency,
    mapped,
    output,
  };
}
