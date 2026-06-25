/**
 * error_handler node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeErrorHandlerNode.
 * Behavior preserved verbatim — same action routing, same sandbox for transform,
 * same sentinel shapes.
 *
 * Design decision on `notify`:
 *   The legacy engine called emitEvent('node_complete', ...) for notify actions.
 *   emitEvent is a streaming side-effect that requires the engine's SSE connection.
 *   The executor cannot hold a reference to the engine. Instead, we return a
 *   { action: 'notified', channel, error } sentinel — the runRegistryNode path
 *   in the engine can detect this and emit the event. For now, the notify result
 *   is returned as-is; the SSE emission remains a follow-up if/when the NodeExecutionContext
 *   gains an `emitEvent` hook. Functional parity for the data shape is maintained.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { runSandboxed } from '../../sandbox.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { errorAction, notificationChannel, transformExpression } =
    node.data as Record<string, any>;

  const action: string = errorAction || 'log';
  const errorData = input;

  ctx.logger.info(
    { nodeId: node.id, action },
    '[error_handler] Executing error handler node',
  );

  if (action === 'log') {
    ctx.logger.warn(
      { errorData, nodeId: node.id },
      '[error_handler] Error handler: logging error',
    );
    return { action: 'logged', error: errorData };
  }

  if (action === 'transform' && transformExpression) {
    const errorPayload = (errorData as any)?.error ?? errorData;
    const inputPayload = (errorData as any)?.input;
    const result = await runSandboxed(`return ${transformExpression};`, {
      globals: { error: errorPayload, input: inputPayload },
      timeoutMs: 2000,
    });
    if (!result.ok) {
      return { action: 'transform_failed', error: errorData, transformError: result.error };
    }
    return result.value;
  }

  if (action === 'notify') {
    // Return a sentinel; the engine may emit a streaming event if configured to do so.
    return {
      action: 'notified',
      channel: notificationChannel,
      error: errorData,
    };
  }

  // retry or any unknown action — return action + error for engine to handle.
  return { action, error: errorData };
}
