/**
 * trigger node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeTrigger (legacy switch case
 * 'trigger' around line 1149 / 1487).
 *
 * The trigger node is the workflow's entry point. It:
 *   - Publishes the input on the execution context as __trigger__ data so
 *     downstream nodes can resolve {{trigger.body.*}} (canonical nested
 *     shape) and {{trigger.<key>}} (flat alias for object payloads).
 *   - Returns the input as-is so downstream nodes can reference it directly
 *     via the input port.
 *
 * The publish step is performed via the optional ctx.setTriggerData hook —
 * the engine wires this up to `this.context.nodeResults.set('__trigger__', ...)`.
 * Tests can omit the hook when they only care about the executor return value.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (ctx.signal.aborted) {
    throw new Error('aborted');
  }

  const { triggerType } = (node.data || {}) as Record<string, unknown>;

  ctx.logger.info(
    { nodeId: node.id, triggerType: triggerType ?? 'manual' },
    '[trigger] Executing trigger node',
  );

  // Build the triggerData shape. Always includes the canonical nested
  // `body` field so {{trigger.body.<x>}} works for any input shape; for
  // object payloads also spread the keys to support {{trigger.<x>}}.
  const triggerData: Record<string, unknown> = {};
  if (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input)
  ) {
    Object.assign(triggerData, input as Record<string, unknown>);
  }
  triggerData.body = input;

  ctx.setTriggerData?.(triggerData);

  return input;
}
