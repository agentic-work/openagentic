/**
 * RedisToolResultCacheL1 — Layer 1 of the tool-result cache.
 *
 * Exact-match Redis cache keyed by (tenantId, userId, toolName, JSON-stable
 * args hash). Per-user repeats within TTL window short-circuit MCP execution
 * at sub-ms latency, before the L2 semantic cache (pgvector + Milvus) is
 * even consulted.
 *
 * This layer was documented in `ToolResultCacheService.ts:1-50` header as
 * "Layer 1 (Redis): Session-level, exact-match caching with 5-60 min TTL"
 * but never implemented. The wrap at `buildChatV2Deps.wrapWithToolResultCache`
 * went straight to L2 semantic — which silently bails when Milvus init fails
 * and pays a vector round-trip every call when healthy. This module is the
 * missing L1.
 *
 * Architecture (read sequence at chat dispatch):
 *   1. wrapWithToolResultCache.searchExact (this) — ~1ms, exact match
 *   2. wrapWithToolResultCache.searchCache (existing L2) — ~50-200ms, semantic
 *   3. inner executeMcpTool — actual MCP call
 *
 * On successful inner execute, BOTH layers are populated so the next exact
 * repeat hits L1 and the next near-paraphrase hits L2.
 *
 * Failure mode: every Redis op degrades to a benign null/false; this layer
 * NEVER throws into the dispatch hot path. Redis offline = cache miss,
 * not crash.
 */
import { createHash } from 'crypto';

import { getRedisClient } from '../utils/redis-client.js';

const DEFAULT_TTL_SECONDS = 300; // 5 minutes — aligned with the documented L1 spec
const KEY_PREFIX = 'tool:l1:';

/**
 * JSON-stable stringify — sorts object keys recursively so `{a:1,b:2}` and
 * `{b:2,a:1}` hash identically. Without this, key-order differences in
 * model-emitted tool args would silently cache-miss.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as any)[k]));
  return '{' + parts.join(',') + '}';
}

function argsHash(args: unknown): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex').slice(0, 16);
}

function cacheKey(tenantId: string, userId: string, toolName: string, args: unknown): string {
  return `${KEY_PREFIX}${tenantId}:${userId}:${toolName}:${argsHash(args)}`;
}

export class RedisToolResultCacheL1 {
  /**
   * Returns the cached value on exact match, or null on miss / redis-down /
   * any thrown error. Never throws.
   */
  async searchExact(
    tenantId: string,
    userId: string,
    toolName: string,
    args: unknown,
  ): Promise<unknown | null> {
    const redis = getRedisClient();
    if (!redis.isConnected()) return null;
    try {
      const key = cacheKey(tenantId, userId, toolName, args);
      return await redis.get(key);
    } catch {
      return null;
    }
  }

  /**
   * Writes value under the (tenant, user, tool, args) exact key with the
   * given TTL (default 300s). Returns false on redis-down or any thrown
   * error; the caller's dispatch path is unaffected.
   */
  async storeExact(
    tenantId: string,
    userId: string,
    toolName: string,
    args: unknown,
    value: unknown,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis.isConnected()) return false;
    try {
      const key = cacheKey(tenantId, userId, toolName, args);
      return await redis.set(key, value, ttlSeconds);
    } catch {
      return false;
    }
  }
}

let serviceInstance: RedisToolResultCacheL1 | null = null;
export function getRedisToolResultCacheL1(): RedisToolResultCacheL1 {
  if (!serviceInstance) serviceInstance = new RedisToolResultCacheL1();
  return serviceInstance;
}
