/**
 * retry_with_backoff node executor — exponential-backoff retry wrapper.
 *
 * Drives the downstream subgraph (the "operation" this node guards) through
 * `ctx.runSubStep`, retrying on rejection with exponentially-growing delays:
 *
 *   attempt 1 → run
 *   on failure → sleep min(baseDelayMs * 2^(n-1), maxDelayMs) [± jitter] → retry
 *   …up to maxRetries additional attempts
 *
 * On the FIRST success it returns the operation's result wrapped in an
 * envelope ({ ok, attempts, result, … }). When every attempt is exhausted it
 * throws a clear error that names the last failure, the attempt count, and the
 * total time spent — never swallows the failure into a falsy-but-ok shape.
 *
 * Both WorkflowExecutionEngine copies wire `ctx.runSubStep` to a single
 * executeNode pass over this node's outgoing (non-error) edges, surfacing the
 * first rejection — and add `retry_with_backoff` to ROUTING_OWNS_DOWNSTREAM so
 * the outer walker does not also re-fire those edges. Unit tests inject a stub
 * attempt function via `_attemptForTests` on node.data so the retry/backoff
 * logic is exercised without an engine; executor.engine.test.ts additionally
 * drives the REAL plugin through a faithful runSubStep mirror against a real
 * downstream node (no injected attempt) so the wiring itself is covered.
 *
 * Backoff sleeps are abort-signal aware so cancelled executions exit promptly.
 */

import type { NodeExecutionContext, WorkflowNode } from '../types.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

export interface RetryResult {
  ok: true;
  attempts: number;
  retries: number;
  totalDelayMs: number;
  result: unknown;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function computeDelayMs(
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  factor: number,
  jitter: boolean,
): number {
  // retryIndex is 1-based: the delay BEFORE the (retryIndex+1)th attempt.
  const exp = baseDelayMs * Math.pow(factor, retryIndex - 1);
  const capped = Math.min(exp, maxDelayMs);
  if (!jitter) return Math.round(capped);
  // Full jitter in [capped/2, capped] — keeps a floor so retries don't
  // hot-loop, while de-correlating concurrent retriers.
  const floor = capped / 2;
  return Math.round(floor + Math.random() * (capped - floor));
}

async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<RetryResult> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = (node.data || {}) as Record<string, unknown>;

  // The operation under retry. In production this is the downstream subgraph
  // driven via ctx.runSubStep. Tests inject `_attemptForTests`. One of them
  // MUST be present — a retry node with nothing to retry is a misconfiguration,
  // and we refuse to run blind.
  const injected = data._attemptForTests as ((attempt: number) => Promise<unknown>) | undefined;
  const attempt: (attemptNum: number) => Promise<unknown> =
    typeof injected === 'function'
      ? injected
      : ctx.runSubStep
        ? () => ctx.runSubStep!(node.id, input)
        : (() => {
            throw new Error(
              "retry_with_backoff: no operation to retry — ctx.runSubStep hook is missing " +
                '(engine not wired) and no test attempt was injected. This node must wrap a ' +
                'downstream step.',
            );
          })();

  const maxRetries = clampInt(data.maxRetries, DEFAULT_MAX_RETRIES, 0, 50);
  const baseDelayMs = clampInt(data.baseDelayMs, DEFAULT_BASE_DELAY_MS, 0, 600_000);
  const maxDelayMs = clampInt(data.maxDelayMs, DEFAULT_MAX_DELAY_MS, 0, 3_600_000);
  const factor =
    typeof data.backoffFactor === 'number' && data.backoffFactor >= 1 ? data.backoffFactor : 2;
  const jitter = data.jitter !== false; // default on

  const maxAttempts = maxRetries + 1;
  let totalDelayMs = 0;
  let lastError: unknown;

  for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
    if (ctx.signal.aborted) throw new Error('aborted');
    try {
      const result = await attempt(attemptNum);
      ctx.logger.info(
        { nodeId: node.id, attempt: attemptNum, retries: attemptNum - 1, totalDelayMs },
        '[retry_with_backoff] attempt succeeded',
      );
      return {
        ok: true,
        attempts: attemptNum,
        retries: attemptNum - 1,
        totalDelayMs,
        result,
      };
    } catch (err) {
      lastError = err;
      const isLast = attemptNum >= maxAttempts;
      ctx.logger.warn(
        {
          nodeId: node.id,
          attempt: attemptNum,
          maxAttempts,
          error: err instanceof Error ? err.message : String(err),
        },
        isLast
          ? '[retry_with_backoff] final attempt failed — exhausted'
          : '[retry_with_backoff] attempt failed — backing off',
      );
      if (isLast) break;
      const delay = computeDelayMs(attemptNum, baseDelayMs, maxDelayMs, factor, jitter);
      totalDelayMs += delay;
      await sleepAbortable(delay, ctx.signal);
    }
  }

  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `retry_with_backoff: operation failed after ${maxAttempts} attempt(s) ` +
      `(${maxRetries} retries, ${totalDelayMs}ms total backoff). Last error: ${lastMessage}`,
  );
}
