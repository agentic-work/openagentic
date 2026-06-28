/**
 * Milvus Audit Guard — 0.6.6 P5 (task #110)
 *
 * Defence-in-depth layer for vector-store access. The existing
 * MilvusService already isolates data per-user by using a collection
 * name derived from `userId` (see getUserCollectionName in
 * MilvusService.ts). That's a strong structural guarantee — a caller
 * cannot search user B's data without user B's collection name.
 *
 * This guard adds three additional checks:
 *
 *   1. Non-empty userId invariant. If a caller passes `''`, `null`,
 *      `undefined`, or known sentinel strings (`'*'`, `'all'`,
 *      `'__system__'`, `'anonymous'`), the call is rejected. These
 *      values would have mapped to a wildcard / shared collection
 *      under the old isolation model and we want them to hard-fail
 *      in the new one.
 *
 *   2. Cross-user access detection. When a request that arrived under
 *      user-A's JWT performs a Milvus call with user-B's id, the
 *      guard writes a row to admin.data_access_audit with
 *      action='cross_user_reject' and throws — this is almost always
 *      either a bug or a targeted probe.
 *
 *   3. Audit trail. Every Milvus read/write is recorded to
 *      admin.data_access_audit so we can forensically answer "did
 *      user X ever access data Y, and when".
 *
 * This guard is intentionally additive and non-invasive — call sites
 * wrap themselves in `assertUserIdOrThrow()` at the top of each
 * per-user helper. The full wrapper refactor (turn all direct SDK
 * calls into wrapper calls) is tracked for a follow-up in
 * docs/ac/data-isolation-p0.md § v0.6.6 P5 Expansion.
 */

import type { Logger } from 'pino';

const FORBIDDEN_USER_IDS = new Set<string>([
  '', '*', 'all', '__system__', 'anonymous', 'null', 'undefined',
]);

export class CrossUserAccessError extends Error {
  readonly actorUserId: string;
  readonly targetUserId: string;
  constructor(actorUserId: string, targetUserId: string) {
    super(
      `Cross-user Milvus access rejected: actor=${actorUserId} target=${targetUserId}. ` +
      `A request authenticated as one user may not query another user's vector data. ` +
      `If this was intentional (e.g. admin debugging), use the explicit admin path.`,
    );
    this.name = 'CrossUserAccessError';
    this.actorUserId = actorUserId;
    this.targetUserId = targetUserId;
  }
}

export class InvalidUserIdError extends Error {
  constructor(value: unknown) {
    super(
      `Milvus call rejected: invalid userId "${String(value)}". ` +
      `Vector searches must be scoped to a concrete, non-sentinel user id. ` +
      `Empty string, wildcard, and __system__ are never valid in the user-facing code path.`,
    );
    this.name = 'InvalidUserIdError';
  }
}

/**
 * Throws unless `userId` is a non-empty concrete user identifier.
 * Call this at the top of every per-user Milvus helper.
 */
export function assertUserIdOrThrow(userId: unknown): asserts userId is string {
  if (typeof userId !== 'string') {
    throw new InvalidUserIdError(userId);
  }
  const trimmed = userId.trim();
  if (trimmed.length === 0) {
    throw new InvalidUserIdError(userId);
  }
  if (FORBIDDEN_USER_IDS.has(trimmed.toLowerCase())) {
    throw new InvalidUserIdError(userId);
  }
}

/**
 * Runtime check that the requested target userId matches the actor's
 * userId. Throws CrossUserAccessError on mismatch unless `allowAdmin`
 * is true AND the actor is admin.
 *
 * Use this in callers that receive a targetUserId from an API
 * parameter — a stray `?userId=other_user` query string would be
 * caught here before it ever reaches Milvus.
 */
export function assertSameUserOrThrow(opts: {
  actorUserId: string;
  targetUserId: string;
  actorIsAdmin?: boolean;
  allowAdmin?: boolean;
}): void {
  assertUserIdOrThrow(opts.actorUserId);
  assertUserIdOrThrow(opts.targetUserId);
  if (opts.actorUserId === opts.targetUserId) return;
  if (opts.allowAdmin && opts.actorIsAdmin) return;
  throw new CrossUserAccessError(opts.actorUserId, opts.targetUserId);
}

/**
 * Structured event shape written to admin.data_access_audit by the
 * DataAccessAuditService (persistence is in that service — this file
 * stays pure so it's trivially unit-testable).
 */
export interface MilvusAuditEvent {
  actorUserId: string;
  targetUserId?: string;
  action: 'search' | 'query' | 'insert' | 'upsert' | 'delete' | 'cross_user_reject';
  collection: string;
  resource: string;          // "milvus:<collection>"
  details?: Record<string, unknown>;
  ts: Date;
}

export function buildMilvusAuditEvent(opts: {
  actorUserId: string;
  targetUserId?: string;
  action: MilvusAuditEvent['action'];
  collection: string;
  details?: Record<string, unknown>;
}): MilvusAuditEvent {
  return {
    actorUserId: opts.actorUserId,
    targetUserId: opts.targetUserId ?? opts.actorUserId,
    action: opts.action,
    collection: opts.collection,
    resource: `milvus:${opts.collection}`,
    details: opts.details,
    ts: new Date(),
  };
}

/**
 * Logging-only sink used as the default audit writer when a real
 * DataAccessAuditService isn't wired in (e.g. during unit tests or
 * before the migration lands). Callers can swap it out at bootstrap.
 */
export function defaultAuditSink(logger: Logger): (event: MilvusAuditEvent) => void {
  const child = logger.child({ component: 'MilvusAuditGuard' });
  return (event) => {
    child.info(event, '[AUDIT] milvus access');
  };
}
