/**
 * dedup node executor — idempotency / de-duplication gate.
 *
 * Computes a key from the configured `key` expression (templated against the
 * input) and consults a seen-keys store. If the key has NOT been seen (within
 * the optional TTL window), it is recorded and the call passes through
 * (`duplicate:false`, `firstSeen:true`). If it HAS been seen, the call is a
 * duplicate and the node either drops it (`duplicate:true`, downstream should
 * skip) or throws, per the `onDuplicate` setting.
 *
 * Scope is keyed by `${tenantId}::${executionId}::${key}` so:
 *   - two tenants never collide on the same logical key, and
 *   - by default the gate is scoped to a single execution (idempotency within
 *     one flow run — the canonical "don't process the same record twice in
 *     this fan-out" case).
 * Set `scope:'global'` to dedup across executions (drops the executionId from
 * the bucket key) — useful with a TTL to suppress repeated webhook deliveries.
 *
 * The store is a module-level Map; V1 is single-replica-accurate. A future
 * V1.1 will add a Redis-backed scope. TTL entries are lazily expired on read
 * and opportunistically swept to bound memory.
 *
 * Refuses to run when the key resolves empty — a dedup gate with no key would
 * silently let everything through (or block everything), so we say so instead.
 */

import type { NodeExecutionContext, WorkflowNode } from '../types.js';

interface SeenEntry {
  /** epoch ms when the key was first recorded. */
  firstSeenAt: number;
  /** epoch ms when this entry expires (Infinity = never within the scope). */
  expiresAt: number;
}

const seen = new Map<string, SeenEntry>();

export function _resetForTests(): void {
  seen.clear();
}

function sweepExpired(now: number): void {
  // Opportunistic cleanup — only walk when the map is non-trivially sized.
  if (seen.size < 256) return;
  for (const [k, entry] of seen) {
    if (entry.expiresAt <= now) seen.delete(k);
  }
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<{
  duplicate: boolean;
  firstSeen: boolean;
  key: string;
  passthrough: unknown;
  firstSeenAt?: number;
}> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = (node.data || {}) as Record<string, unknown>;

  const keyRaw = typeof data.key === 'string' ? data.key : '';
  if (!keyRaw.trim()) {
    throw new Error("dedup: 'key' is required — a dedup gate with no key cannot decide anything");
  }
  const key = (keyRaw.includes('{{') ? ctx.interpolateTemplate(keyRaw, input) : keyRaw).trim();
  if (!key) {
    throw new Error(
      `dedup: 'key' resolved to an empty string (template='${keyRaw}'). ` +
        'The key expression must produce a non-empty value for every item.',
    );
  }

  const onDuplicate = (typeof data.onDuplicate === 'string' ? data.onDuplicate : 'drop') as
    | 'drop'
    | 'error';
  const scope = (typeof data.scope === 'string' ? data.scope : 'execution') as
    | 'execution'
    | 'global';
  const ttlSeconds =
    typeof data.ttlSeconds === 'number' && data.ttlSeconds > 0 ? Math.floor(data.ttlSeconds) : 0;

  const tenant = ctx.tenantId ?? '';
  const execScope = scope === 'global' ? 'global' : ctx.executionId;
  const bucketKey = `${tenant}::${execScope}::${key}`;

  const now = Date.now();
  sweepExpired(now);

  const existing = seen.get(bucketKey);
  const stillValid = existing && existing.expiresAt > now;

  if (stillValid) {
    // Duplicate within the active window.
    ctx.logger.info(
      { nodeId: node.id, key, scope, firstSeenAt: existing!.firstSeenAt, onDuplicate },
      '[dedup] duplicate key',
    );
    if (onDuplicate === 'error') {
      throw new Error(
        `dedup: duplicate key '${key}' (first seen ${new Date(
          existing!.firstSeenAt,
        ).toISOString()}, scope=${scope}).`,
      );
    }
    return {
      duplicate: true,
      firstSeen: false,
      key,
      passthrough: input,
      firstSeenAt: existing!.firstSeenAt,
    };
  }

  // First sighting (or a previously-expired entry) — record and pass through.
  const expiresAt = ttlSeconds > 0 ? now + ttlSeconds * 1000 : Number.POSITIVE_INFINITY;
  seen.set(bucketKey, { firstSeenAt: now, expiresAt });

  ctx.logger.info(
    { nodeId: node.id, key, scope, ttlSeconds },
    '[dedup] new key — passing through',
  );

  return {
    duplicate: false,
    firstSeen: true,
    key,
    passthrough: input,
    firstSeenAt: now,
  };
}
