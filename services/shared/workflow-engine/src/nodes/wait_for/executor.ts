/**
 * wait_for node executor — poll-until-condition primitive.
 *
 * Differs from the existing `wait` node (fixed sleep). wait_for evaluates
 * a JS expression against `input` on a poll interval, returning as soon
 * as the expression becomes truthy or the timeout elapses.
 *
 * Closes P1 #3 from the n8n/Flowise/Langflow gap analysis
 * (reports/flowbuilder-gap-analysis/2026-05-14/recommendations.md).
 *
 * Sandbox semantics mirror the `condition` node so authors can use the
 * same expression syntax in both. Abort-signal-aware: when the engine
 * cancels the run, the next poll iteration aborts cleanly.
 *
 * Output:
 *   {
 *     satisfied: boolean,
 *     polls: number,
 *     durationMs: number,
 *     lastValue: unknown,    // the final evaluated expression value
 *     timedOut: boolean
 *   }
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { runSandboxed } from '../../sandbox.js';

const DEFAULT_POLL_SECONDS = 5;
const DEFAULT_TIMEOUT_SECONDS = 300;

async function evaluateExpression(
  expression: string,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (!expression) return false;
  try {
    const sandboxed = await runSandboxed(`return (${expression});`, {
      input,
      timeoutMs: 2000,
    });
    if (sandboxed.ok) return sandboxed.value;

    const resolved = ctx.interpolateTemplate(expression, input);
    if (resolved !== expression) {
      const sandboxed2 = await runSandboxed(`return (${resolved});`, {
        input,
        timeoutMs: 2000,
      });
      if (sandboxed2.ok) return sandboxed2.value;
    }

    // Final fallback: a literal truthy / falsy interpolation.
    const interpolated = ctx.interpolateTemplate(expression, input);
    if (typeof interpolated === 'boolean') return interpolated;
    if (typeof interpolated === 'string') {
      const lower = interpolated.toLowerCase().trim();
      if (lower === 'true' || lower === 'yes') return true;
      if (lower === 'false' || lower === 'no' || lower === '') return false;
    }
    return Boolean(interpolated);
  } catch {
    return false;
  }
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(handle);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<{
  satisfied: boolean;
  polls: number;
  durationMs: number;
  lastValue: unknown;
  timedOut: boolean;
}> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const condition = typeof data.condition === 'string' ? data.condition.trim() : '';
  if (!condition) {
    throw new Error("wait_for: 'condition' is required");
  }

  const pollSeconds = typeof data.pollIntervalSeconds === 'number' && data.pollIntervalSeconds >= 1
    ? data.pollIntervalSeconds
    : DEFAULT_POLL_SECONDS;
  const timeoutSeconds = typeof data.timeoutSeconds === 'number' && data.timeoutSeconds >= 1
    ? data.timeoutSeconds
    : DEFAULT_TIMEOUT_SECONDS;
  const failOnTimeout = data.failOnTimeout === true;

  const pollMs = pollSeconds * 1000;
  const timeoutMs = timeoutSeconds * 1000;
  const start = Date.now();

  let polls = 0;
  let lastValue: unknown;

  while (true) {
    if (ctx.signal.aborted) throw new Error('aborted');

    polls += 1;
    lastValue = await evaluateExpression(condition, input, ctx);
    const truthy = !!lastValue;

    ctx.logger.info(
      { nodeId: node.id, polls, truthy, elapsedMs: Date.now() - start },
      '[wait_for] Poll',
    );

    if (truthy) {
      return {
        satisfied: true,
        polls,
        durationMs: Date.now() - start,
        lastValue,
        timedOut: false,
      };
    }

    const elapsed = Date.now() - start;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      // Timed out.
      if (failOnTimeout) {
        throw new Error(
          `wait_for: condition still falsy after ${timeoutSeconds}s (polls=${polls})`,
        );
      }
      return {
        satisfied: false,
        polls,
        durationMs: elapsed,
        lastValue,
        timedOut: true,
      };
    }

    // Sleep min(pollMs, remaining) so we don't overshoot the deadline.
    await sleepAbortable(Math.min(pollMs, remaining), ctx.signal);
  }
}
