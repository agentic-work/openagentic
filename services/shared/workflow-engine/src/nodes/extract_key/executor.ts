/**
 * extract_key node executor — typed processing primitive.
 *
 * Pulls a single value at a dot/bracket path from an object, with an
 * optional fallback when the path is missing. Replaces the JS-expression-
 * only `transform` extract case for the common "give me steps.X.data.id"
 * pattern.
 *
 * Inputs (node.data):
 *   - input: path-template or omitted to use upstream connection's input.
 *   - path: dot/bracket path (e.g. 'data.items[0].name').
 *   - default: optional fallback returned when path is missing.
 *
 * Output: { value: <extracted>, found: boolean }
 *   - `found = false` when path didn't resolve (caller can branch on it).
 *   - `value` is the default when supplied, undefined otherwise.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { resolveDotPath, resolveInputValue } from '../processing-utils.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<{ value: unknown; found: boolean }> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const path = typeof data.path === 'string' ? data.path : '';
  if (!path) {
    throw new Error("extract_key: 'path' is required");
  }

  const resolved = resolveInputValue(data.input, input, ctx);
  const { value, found } = resolveDotPath(resolved, path);

  if (!found && data.default !== undefined) {
    ctx.logger.info(
      { nodeId: node.id, path, fellBackToDefault: true },
      '[extract_key] Path missing — using default',
    );
    return { value: data.default, found: false };
  }

  ctx.logger.info(
    { nodeId: node.id, path, found },
    '[extract_key] Extracted value at path',
  );
  return { value, found };
}
