/**
 * rate_limiter node executor — fixed-window throttle.
 *
 * Buckets are keyed by `${tenantId}::${interpolatedKey}` so cross-tenant
 * traffic never shares a counter. Counter + window-start live in a module
 * Map; V1 is single-replica-accurate. V1.1 will add a Redis-backed scope
 * (the `scope` setting is wired but currently only `local` is supported).
 *
 * Three overflow modes:
 *   - `block` (default): sleep until window reset, then increment + allow
 *   - `drop`:           return { allowed:false, limited:true } without sleep
 *   - `error`:          throw
 *
 * Sleep is abort-signal aware so cancelled executions exit promptly.
 */

import type { NodeExecutionContext, WorkflowNode } from '../types.js';

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export function _resetForTests(): void {
  buckets.clear();
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = (node.data || {}) as Record<string, unknown>;
  const keyRaw = typeof data.key === 'string' ? data.key : '';
  const key = keyRaw.includes('{{') ? ctx.interpolateTemplate(keyRaw, input).trim() : keyRaw.trim();
  if (!key) {
    throw new Error("rate_limiter: 'key' is required");
  }

  const maxCalls =
    typeof data.maxCalls === 'number' && data.maxCalls > 0 ? Math.floor(data.maxCalls) : 10;
  const windowSeconds =
    typeof data.windowSeconds === 'number' && data.windowSeconds > 0
      ? Math.floor(data.windowSeconds)
      : 60;
  const windowMs = windowSeconds * 1000;
  const onLimit = (typeof data.onLimit === 'string' ? data.onLimit : 'block') as
    | 'block'
    | 'drop'
    | 'error';

  const tenant = ctx.tenantId ?? '';
  const bucketKey = `${tenant}::${key}`;

  const now = Date.now();
  let bucket = buckets.get(bucketKey);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { windowStart: now, count: 0 };
    buckets.set(bucketKey, bucket);
  }

  bucket.count += 1;
  const calls = bucket.count;

  if (calls <= maxCalls) {
    ctx.logger.info(
      { nodeId: node.id, key, calls, maxCalls, windowSeconds },
      '[rate_limiter] allowed',
    );
    return {
      allowed: true,
      limited: false,
      key,
      calls,
      maxCalls,
      windowSeconds,
      waitedMs: 0,
    };
  }

  if (onLimit === 'error') {
    throw new Error(
      `rate_limiter: limit exceeded for key='${key}' (${calls} > ${maxCalls} in ${windowSeconds}s window)`,
    );
  }

  if (onLimit === 'drop') {
    ctx.logger.info(
      { nodeId: node.id, key, calls, maxCalls, windowSeconds },
      '[rate_limiter] dropped',
    );
    return {
      allowed: false,
      limited: true,
      key,
      calls,
      maxCalls,
      windowSeconds,
      waitedMs: 0,
    };
  }

  // block — sleep until window boundary, reset counter, allow this call
  const waitMs = Math.max(0, bucket.windowStart + windowMs - Date.now());
  await sleepAbortable(waitMs, ctx.signal);
  // After the wait, force a fresh window and treat this call as the first
  // entry. We don't increment-and-check again — the caller has waited their
  // turn and the contract is that block resolves into an `allowed: true`.
  const after = Date.now();
  buckets.set(bucketKey, { windowStart: after, count: 1 });
  ctx.logger.info(
    { nodeId: node.id, key, waitedMs: waitMs, maxCalls, windowSeconds },
    '[rate_limiter] blocked then allowed',
  );
  return {
    allowed: true,
    limited: false,
    key,
    calls: 1,
    maxCalls,
    windowSeconds,
    waitedMs: waitMs,
  };
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
