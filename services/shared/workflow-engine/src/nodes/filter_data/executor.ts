/**
 * filter_data node executor — typed processing primitive.
 *
 * Filters an array by a field predicate. Replaces the JS-expression-only
 * path through `transform` for the most common AIOps case ("give me the
 * pods where status.phase === 'Pending'").
 *
 * Inputs (node.data):
 *   - items: path-template (e.g. '{{trigger.pods}}') OR omitted to use
 *     the upstream connection's input directly.
 *   - field: dot-path to test against each item (e.g. 'status.phase').
 *   - operator: eq | neq | gt | lt | gte | lte | contains | exists |
 *     starts_with | ends_with | in | not_in | matches_regex.
 *   - value: comparand for the operator (omit for 'exists').
 *
 * Output:
 *   { filtered: <Array>, droppedCount: number, totalCount: number }
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { resolveDotPath, resolveInputValue } from '../processing-utils.js';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'exists'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'matches_regex';

const SUPPORTED_OPS: ReadonlySet<FilterOperator> = new Set([
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'exists',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'matches_regex',
]);

function compare(
  actual: unknown,
  operator: FilterOperator,
  expected: unknown,
): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains': {
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected);
      }
      if (Array.isArray(actual)) return actual.includes(expected);
      return false;
    }
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'starts_with':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'ends_with':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'matches_regex': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return false;
      // Construct the regex per-comparison so a bad pattern surfaces at the
      // first item (clear error) rather than silently mismatching every row.
      const re = new RegExp(expected);
      return re.test(actual);
    }
    default:
      return false;
  }
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<{ filtered: unknown[]; droppedCount: number; totalCount: number }> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const field = typeof data.field === 'string' ? data.field : '';
  const operator = data.operator as FilterOperator;
  const value = data.value;

  if (!operator || !SUPPORTED_OPS.has(operator)) {
    throw new Error(
      `filter_data: unsupported operator '${String(operator)}'. ` +
        `Allowed: ${Array.from(SUPPORTED_OPS).join(', ')}`,
    );
  }
  if (!field && operator !== 'exists') {
    throw new Error(`filter_data: 'field' is required for operator '${operator}'`);
  }

  const resolved = resolveInputValue(data.items, input, ctx);
  if (!Array.isArray(resolved)) {
    throw new Error(
      `filter_data: items must resolve to an array, got ${
        resolved === null ? 'null' : typeof resolved
      }`,
    );
  }

  const filtered: unknown[] = [];
  for (const item of resolved) {
    const { value: actual } = resolveDotPath(item, field);
    if (compare(actual, operator, value)) {
      filtered.push(item);
    }
  }

  ctx.logger.info(
    { nodeId: node.id, total: resolved.length, kept: filtered.length, operator, field },
    '[filter_data] Applied predicate',
  );

  return {
    filtered,
    droppedCount: resolved.length - filtered.length,
    totalCount: resolved.length,
  };
}
