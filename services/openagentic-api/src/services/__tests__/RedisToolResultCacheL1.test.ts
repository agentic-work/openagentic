/**
 * RedisToolResultCacheL1 — TDD RED → GREEN
 *
 * Layer 1 (Redis) of the per-user tool-result cache. Exact-match by
 * (tenantId, userId, toolName, JSON-stable args hash) with a configurable TTL.
 *
 * Layer ordering:
 *   L1 (this) — Redis SETEX, exact-match, ~1ms. Per-user repeats hit here.
 *   L2 (existing ToolResultCacheService) — pgvector + Milvus semantic search,
 *      cross-user, ~50-200ms. Repeats with slight phrasing diffs hit here.
 *
 * Why L1 exists: the existing L2 silently falls through to null when
 * embeddings or Milvus init are unavailable, and even when healthy it pays
 * a semantic-search round trip on every tool call. L1 catches the
 * "same user just asked this 30 seconds ago" case at memory speed.
 *
 * Pins:
 *  - searchExact(tenant, user, tool, args) → null on miss, value on hit
 *  - storeExact(tenant, user, tool, args, value) writes with TTL (default 300s)
 *  - searchExact handles redis offline gracefully (returns null, never throws)
 *  - storeExact handles redis offline gracefully (returns false, never throws)
 *  - argsHash is deterministic across key-order variations (JSON-stable)
 *  - same tenant/user/tool but different args → DIFFERENT cache slots
 *  - same args/tool/user but different tenants → DIFFERENT cache slots
 *  - same args/tool/tenant but different users → DIFFERENT cache slots
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the redis-client module BEFORE importing the L1 service so its
// internal getRedisClient() call binds to our mock.
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockIsConnected = vi.fn().mockReturnValue(true);

vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: () => ({
    get: mockGet,
    set: mockSet,
    isConnected: mockIsConnected,
  }),
}));

import { RedisToolResultCacheL1 } from '../RedisToolResultCacheL1.js';

describe('RedisToolResultCacheL1 — searchExact', () => {
  let svc: RedisToolResultCacheL1;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
    svc = new RedisToolResultCacheL1();
  });

  it('returns null on miss (redis.get returns null)', async () => {
    mockGet.mockResolvedValue(null);
    const result = await svc.searchExact('tenant-x', 'user-a', 'azure_list_subscriptions', {});
    expect(result).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('returns the cached value on hit', async () => {
    const stored = { subscriptions: [{ id: 'sub-1', name: 'Prod' }] };
    mockGet.mockResolvedValue(stored);
    const result = await svc.searchExact('tenant-x', 'user-a', 'azure_list_subscriptions', { region: 'eastus' });
    expect(result).toEqual(stored);
  });

  it('returns null when redis is disconnected (graceful degradation)', async () => {
    mockIsConnected.mockReturnValue(false);
    mockGet.mockResolvedValue({ should: 'not-be-returned' });
    const result = await svc.searchExact('tenant-x', 'user-a', 'azure_list_subscriptions', {});
    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns null and does not throw when redis.get throws', async () => {
    mockGet.mockRejectedValue(new Error('ECONNRESET'));
    const result = await svc.searchExact('tenant-x', 'user-a', 'azure_list_subscriptions', {});
    expect(result).toBeNull();
  });
});

describe('RedisToolResultCacheL1 — storeExact', () => {
  let svc: RedisToolResultCacheL1;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
    mockSet.mockResolvedValue(true);
    svc = new RedisToolResultCacheL1();
  });

  it('writes with default 300s TTL', async () => {
    await svc.storeExact('tenant-x', 'user-a', 'azure_list_subscriptions', {}, { ok: true });
    expect(mockSet).toHaveBeenCalledTimes(1);
    const [, value, ttl] = mockSet.mock.calls[0];
    expect(value).toEqual({ ok: true });
    expect(ttl).toBe(300);
  });

  it('respects ttlSeconds override', async () => {
    await svc.storeExact('tenant-x', 'user-a', 'tool', {}, { ok: true }, 60);
    const [, , ttl] = mockSet.mock.calls[0];
    expect(ttl).toBe(60);
  });

  it('returns false when redis is disconnected', async () => {
    mockIsConnected.mockReturnValue(false);
    const ok = await svc.storeExact('tenant-x', 'user-a', 'tool', {}, { ok: true });
    expect(ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('returns false (no throw) when redis.set throws', async () => {
    mockSet.mockRejectedValue(new Error('Redis down'));
    const ok = await svc.storeExact('tenant-x', 'user-a', 'tool', {}, { ok: true });
    expect(ok).toBe(false);
  });
});

describe('RedisToolResultCacheL1 — key isolation', () => {
  let svc: RedisToolResultCacheL1;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
    svc = new RedisToolResultCacheL1();
  });

  // Capture the keys searchExact uses so we can prove isolation without
  // depending on the exact hash algorithm.
  async function keyFor(tenant: string, user: string, tool: string, args: any): Promise<string> {
    mockGet.mockResolvedValue(null);
    await svc.searchExact(tenant, user, tool, args);
    const lastCall = mockGet.mock.calls.at(-1);
    return lastCall![0] as string;
  }

  it('same args/tool/user — different tenants get different keys', async () => {
    const k1 = await keyFor('tenant-a', 'user-1', 'azure_list_subs', { foo: 'bar' });
    const k2 = await keyFor('tenant-b', 'user-1', 'azure_list_subs', { foo: 'bar' });
    expect(k1).not.toBe(k2);
  });

  it('same args/tool/tenant — different users get different keys', async () => {
    const k1 = await keyFor('tenant-a', 'user-1', 'azure_list_subs', { foo: 'bar' });
    const k2 = await keyFor('tenant-a', 'user-2', 'azure_list_subs', { foo: 'bar' });
    expect(k1).not.toBe(k2);
  });

  it('same tenant/user/tool — different args get different keys', async () => {
    const k1 = await keyFor('tenant-a', 'user-1', 'azure_list_subs', { region: 'eastus' });
    const k2 = await keyFor('tenant-a', 'user-1', 'azure_list_subs', { region: 'westus' });
    expect(k1).not.toBe(k2);
  });

  it('same logical args in different key order produce the SAME key (stable JSON)', async () => {
    const k1 = await keyFor('tenant-a', 'user-1', 'azure_list_subs', { a: 1, b: 2 });
    const k2 = await keyFor('tenant-a', 'user-1', 'azure_list_subs', { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });

  it('key uses the "tool:l1:" prefix convention so SCAN+invalidate is trivial', async () => {
    const k = await keyFor('tenant-a', 'user-1', 'azure_list_subs', {});
    expect(k.startsWith('tool:l1:')).toBe(true);
  });
});
