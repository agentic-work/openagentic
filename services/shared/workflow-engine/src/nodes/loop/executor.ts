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

function resolveItems(
  iterateOver: string | undefined,
  input: unknown,
  ctx: NodeExecutionContext,
  nodeId: string,
): unknown[] {
  if (!iterateOver) {
    return Array.isArray(input) ? input : [input];
  }

  const resolved = ctx.interpolateTemplate(`{{${iterateOver}}}`, input);
  if (Array.isArray(resolved)) return resolved;

  if (typeof resolved === 'string') {
    try {
      const parsed = JSON.parse(resolved);
      if (Array.isArray(parsed)) return parsed;
      return [parsed];
    } catch {
      // LLM-style fallback: extract JSON array, else newline split.
      const arrayMatch = resolved.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          const parsed = JSON.parse(arrayMatch[0]);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          /* fall through */
        }
      }
      const items = resolved.split('\n').filter((s: string) => s.trim());
      ctx.logger.warn(
        { nodeId, resolvedLength: resolved.length, itemCount: items.length },
        '[loop] iterateOver value was not valid JSON, split into lines',
      );
      return items;
    }
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

  const items = resolveItems(iterateOver, input, ctx, node.id);

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
