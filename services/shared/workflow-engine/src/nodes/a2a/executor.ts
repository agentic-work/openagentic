/**
 * a2a node executor.
 *
 * Migrated from WorkflowExecutionEngine — the legacy switch routed
 * 'a2a' through `executeAgentSpawnNode` exactly like 'agent_spawn'.
 * This thin wrapper preserves that behavior; it normalizes the
 * data field name (`prompt` -> `task`) so the shared spawn executor
 * can handle the call.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { execute as agentSpawnExecute } from '../agent_spawn/executor.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;

  // a2a uses 'prompt'; agent_spawn uses 'task'. Normalize so the shared
  // executor sees a populated `task` field.
  const normalizedData = { ...data };
  if (!normalizedData.task && !normalizedData.taskDescription && normalizedData.prompt) {
    normalizedData.task = normalizedData.prompt;
  }

  const out = (await agentSpawnExecute(
    { ...node, type: 'agent_spawn', data: normalizedData },
    input,
    ctx,
  )) as Record<string, unknown> | null;

  if (out && typeof out === 'object') {
    return { ...out, source: 'a2a' };
  }
  return out;
}
