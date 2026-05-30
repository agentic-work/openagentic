/**
 * text node executor — passthrough annotation.
 *
 * The text node is a visual canvas-only construct. It accepts whatever
 * upstream input flows in and returns it unchanged so downstream nodes
 * see the original data. No template interpolation, no side effects.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  _node: WorkflowNode,
  input: unknown,
  _ctx: NodeExecutionContext,
): Promise<unknown> {
  // Honor abort signal even on no-op nodes — keeps cancellation deterministic.
  if (_ctx.signal.aborted) {
    throw new Error('aborted');
  }
  return input;
}
