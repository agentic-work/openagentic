/**
 * wait node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeWaitNode.
 *
 * Short waits (< 30 s) sleep in-process via setTimeout and return
 * { waited: true, duration: durationMs }.
 *
 * Long waits (>= 30 s) cannot block the executor thread — the engine
 * must persist state and schedule a resume. The executor signals this
 * intent by returning a sentinel: { status: 'waiting', durationMs, resumeAt, message }.
 * The engine (runRegistryNode path) detects the sentinel and handles the
 * Prisma state-save + emitEvent, preserving the existing long-wait behavior.
 *
 * Design decision: keep the state-save and event-emit in the engine.
 * The executor owns "how long to sleep and how to compute durationMs";
 * the engine owns "how to pause and resume a workflow execution".
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

/** Sentinel returned for long waits so the engine can persist state. */
export interface WaitSentinel {
  status: 'waiting';
  durationMs: number;
  resumeAt: string; // ISO-8601
  message: string;
}

/** Result for completed short waits. */
export interface WaitResult {
  waited: true;
  duration: number; // durationMs
}

/** Threshold above which the wait is handled by the engine scheduler. */
export const LONG_WAIT_THRESHOLD_MS = 30_000;

export async function execute(
  node: WorkflowNode,
  _input: unknown,
  ctx: NodeExecutionContext,
): Promise<WaitResult | WaitSentinel> {
  const { duration = 0, unit = 'seconds' } = node.data as Record<string, any>;

  const rawDuration = Math.max(0, Number(duration) || 0);

  let durationMs: number;
  switch (unit) {
    case 'ms':
    case 'milliseconds':
      durationMs = rawDuration;
      break;
    case 'minutes':
      durationMs = rawDuration * 60 * 1000;
      break;
    case 'hours':
      durationMs = rawDuration * 60 * 60 * 1000;
      break;
    case 'days':
      durationMs = rawDuration * 24 * 60 * 60 * 1000;
      break;
    default: // 'seconds'
      durationMs = rawDuration * 1000;
  }

  ctx.logger.info(
    { nodeId: node.id, duration: rawDuration, unit, durationMs },
    '[wait] Executing wait node',
  );

  // For long waits, return a sentinel — the engine persists state + schedules resume.
  if (durationMs >= LONG_WAIT_THRESHOLD_MS) {
    const resumeAt = new Date(Date.now() + durationMs).toISOString();
    return {
      status: 'waiting',
      durationMs,
      resumeAt,
      message: `Workflow paused - will resume in ${rawDuration} ${unit}`,
    };
  }

  // Short wait: sleep in-process.
  await new Promise<void>(resolve => setTimeout(resolve, durationMs));
  return { waited: true, duration: durationMs };
}
