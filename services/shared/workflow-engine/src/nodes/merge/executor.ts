/**
 * merge node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeMergeNode.
 * Behavior is preserved verbatim — same strategy options, same single-input
 * passthrough, same labeled-object approach to avoid key collisions.
 *
 * Engine coupling addressed via ctx.getIncomingResults hook:
 *   The legacy method read incomingEdges + nodeResults + nodeMap directly from
 *   the engine instance. After migration, the engine wires up
 *   ctx.getIncomingResults to return the same data via the hook, keeping the
 *   executor decoupled from the engine class.
 *
 *   When the hook is absent (e.g. tests that don't wire it up), the executor
 *   treats the single upstream input as the only input, which is equivalent
 *   to the single-input passthrough path.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { mergeStrategy = 'object' } = node.data as Record<string, any>;

  // Gather incoming results via the context hook, or fall back to [input].
  const incomingResults = ctx.getIncomingResults
    ? ctx.getIncomingResults(node.id)
    : [{ sourceId: 'upstream', label: 'upstream', value: input }];

  const inputs = incomingResults.map(r => r.value);
  const labeledInputs: Record<string, unknown> = {};
  for (const r of incomingResults) {
    labeledInputs[r.label] = r.value;
  }

  // Single input or no input → passthrough.
  if (inputs.length <= 1) {
    return inputs[0] ?? input;
  }

  ctx.logger.info(
    { nodeId: node.id, inputCount: inputs.length, mergeStrategy },
    '[merge] Executing merge node',
  );

  switch (mergeStrategy) {
    case 'array':
      return inputs;

    case 'object':
      return labeledInputs;

    case 'concat':
      return inputs.flat();

    default:
      return inputs;
  }
}
