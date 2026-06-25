/**
 * #1055 — Classify the Milvus checkHealth() response so callers can tell
 * "still loading collections" (transient — keep waiting) from "actually
 * unreachable" (fatal — fail fast).
 *
 * Live failure response captured 2026-05-22T19:14:48Z while api was
 * crash-looping:
 *
 *   {
 *     "reasons": ["loaded collection do not found any channel in target,
 *                  may be in recovery: collection on recovering[
 *                  collection=466456455935201500]"],
 *     "status": {"error_code": "Success", "code": 0, "retriable": false},
 *     "isHealthy": false
 *   }
 *
 * Pre-fix every Milvus call site treated `isHealthy === false` as a hard
 * failure (`throw new Error('Milvus health check failed: ...')`). The
 * 08-tool-cache bootstrap step retries that 10× with 3·N back-off — total
 * 135 s — which is shorter than a cold Milvus collection-load on a fresh
 * helm install. Result: api in CrashLoopBackOff while Milvus was minutes
 * away from finishing segment-load.
 *
 * Post-fix call sites still throw on truly-fatal states (connection
 * refused, non-Success error_code) but throw `MilvusRecoveringError`
 * when the response looks like in-flight collection recovery. The
 * 08-tool-cache loop catches that error subclass and uses a longer
 * retry budget (10 s × 30 attempts = 5 min) so collection-load can
 * actually finish.
 */

export type MilvusHealthState = 'ready' | 'recovering' | 'fatal';

const RECOVERY_HINT_RE = /recover|recovering|loading|not\s+found\s+any\s+channel\s+in\s+target/i;

export class MilvusRecoveringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MilvusRecoveringError';
  }
}

export function classifyMilvusHealth(health: any): MilvusHealthState {
  if (!health || typeof health !== 'object') return 'fatal';
  if (health.isHealthy === true) return 'ready';

  // Basic gRPC call succeeded (error_code === 'Success') but the broker
  // reports queryNode hasn't finished loading collections yet. That's a
  // transient state — keep polling.
  const errorCode = health?.status?.error_code;
  const reasons = Array.isArray(health?.reasons) ? (health.reasons as string[]) : [];
  const looksLikeRecovery =
    errorCode === 'Success' &&
    reasons.some((r) => typeof r === 'string' && RECOVERY_HINT_RE.test(r));

  return looksLikeRecovery ? 'recovering' : 'fatal';
}
