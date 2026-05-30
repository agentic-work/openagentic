/**
 * wrapWithToolResultCache — L1 (Redis exact-match) tier wiring — TDD RED → GREEN
 *
 * Pins the per-user L1 Redis cache tier sits IN FRONT of the L2 semantic
 * (Milvus/pgvector) cache and the inner MCP executor. Read order:
 *   1. L1.searchExact (~1ms) → hit → return immediately
 *   2. L2.searchCache (~50-200ms) → hit → populate L1 (so next exact hits L1) → return
 *   3. inner executor → on success: populate BOTH L1 and L2 (fire-and-forget)
 *
 * Why this exists: the existing wrap goes straight to L2 semantic which
 * silently fails when Milvus init isn't ready and pays a vector round-trip
 * on every call when healthy. L1 catches "user just asked this 30s ago"
 * at memory speed and survives L2 init races.
 *
 * Pins:
 *  - L1 hit returns the cached value with _meta.cacheHit:true, cacheLayer:'L1'
 *  - On L1 hit: inner executor NOT called, L2 searchCache NOT called
 *  - On L1 miss + L2 hit: inner executor NOT called, L1 IS populated (write-through)
 *  - On L1 miss + L2 miss: inner runs, on success L1 + L2 both populated (FaF)
 *  - L1 absent (undefined) → wrap behaves exactly like the old L2-only path
 *  - Uncacheable tools (e.g. web_search) → L1 not consulted, L2 not consulted
 *  - L1 throws → fall-through to L2, never propagate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { wrapWithToolResultCache } from '../buildChatV2Deps.js';
import type { ToolResultCacheLike } from '../../routes/chat/pipeline/chat/types.js';
import type { RedisToolResultCacheL1 } from '../RedisToolResultCacheL1.js';

function makeRunCtx(overrides: Record<string, any> = {}) {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-1',
    userId: 'user-a',
    user: { id: 'user-a', tenantId: 'tenant-x', groups: ['g1'], isAdmin: false },
    toolUseId: 'toolu_abc',
    ...overrides,
  } as any;
}

function makeL2Cache(): ToolResultCacheLike & {
  searchCache: ReturnType<typeof vi.fn>;
  cacheResult: ReturnType<typeof vi.fn>;
} {
  return {
    isReady: () => true,
    searchCache: vi.fn().mockResolvedValue(null),
    cacheResult: vi.fn().mockResolvedValue(true),
  } as any;
}

function makeL1Cache(): RedisToolResultCacheL1 & {
  searchExact: ReturnType<typeof vi.fn>;
  storeExact: ReturnType<typeof vi.fn>;
} {
  return {
    searchExact: vi.fn().mockResolvedValue(null),
    storeExact: vi.fn().mockResolvedValue(true),
  } as any;
}

describe('wrapWithToolResultCache — L1 tier ahead of L2', () => {
  let innerMcp: ReturnType<typeof vi.fn>;
  let l1: ReturnType<typeof makeL1Cache>;
  let l2: ReturnType<typeof makeL2Cache>;

  beforeEach(() => {
    innerMcp = vi.fn().mockResolvedValue({
      ok: true,
      output: { subscriptions: [{ id: 'sub-1', name: 'fresh-from-mcp' }] },
    });
    l1 = makeL1Cache();
    l2 = makeL2Cache();
  });

  it('L1 HIT: returns L1 value, skips L2 searchCache AND inner execution', async () => {
    const cached = { subscriptions: [{ id: 'sub-1', name: 'cached-l1' }] };
    l1.searchExact.mockResolvedValue(cached);

    const wrapped = wrapWithToolResultCache(l2, innerMcp, { l1Cache: l1 });
    const result = await wrapped(makeRunCtx(), 'azure_list_subscriptions', { subscription_id: 'sub-123' });

    expect(result.ok).toBe(true);
    expect(l1.searchExact).toHaveBeenCalledTimes(1);
    expect(l2.searchCache).not.toHaveBeenCalled();
    expect(innerMcp).not.toHaveBeenCalled();

    const out: any = result.output;
    expect(out.subscriptions?.[0]?.name).toBe('cached-l1');
    expect(out._meta?.cacheHit).toBe(true);
    expect(out._meta?.cacheLayer).toBe('L1');
  });

  it('L1 MISS + L2 HIT: returns L2 value, populates L1 write-through, skips inner', async () => {
    l1.searchExact.mockResolvedValue(null);
    l2.searchCache.mockResolvedValue({
      result: { subscriptions: [{ id: 'sub-1', name: 'cached-l2' }] },
      similarity: 0.96,
      cacheId: 'c-l2-1',
      hitCount: 2,
      crossUserHit: false,
    });

    const wrapped = wrapWithToolResultCache(l2, innerMcp, { l1Cache: l1 });
    const result = await wrapped(makeRunCtx(), 'azure_list_subscriptions', { subscription_id: 'sub-123' });

    expect(result.ok).toBe(true);
    expect(l1.searchExact).toHaveBeenCalledTimes(1);
    expect(l2.searchCache).toHaveBeenCalledTimes(1);
    expect(innerMcp).not.toHaveBeenCalled();

    // Write-through: L1 populated from L2 hit so next exact repeat goes faster.
    // Fire-and-forget — give it a microtask tick to land.
    await new Promise(resolve => setImmediate(resolve));
    expect(l1.storeExact).toHaveBeenCalledTimes(1);
    const storeArgs = l1.storeExact.mock.calls[0];
    expect(storeArgs[0]).toBe('tenant-x');
    expect(storeArgs[1]).toBe('user-a');
    expect(storeArgs[2]).toBe('azure_list_subscriptions');
    expect(storeArgs[3]).toEqual({ subscription_id: 'sub-123' });
  });

  it('L1 MISS + L2 MISS: inner runs, BOTH L1 and L2 populated on success (FaF)', async () => {
    l1.searchExact.mockResolvedValue(null);
    l2.searchCache.mockResolvedValue(null);

    const wrapped = wrapWithToolResultCache(l2, innerMcp, { l1Cache: l1 });
    const result = await wrapped(makeRunCtx(), 'azure_list_subscriptions', { subscription_id: 'sub-123' });

    expect(result.ok).toBe(true);
    expect(innerMcp).toHaveBeenCalledTimes(1);

    await new Promise(resolve => setImmediate(resolve));
    expect(l1.storeExact).toHaveBeenCalledTimes(1);
    expect(l2.cacheResult).toHaveBeenCalledTimes(1);
  });

  it('L1 not provided: wrap behaves identically to the old L2-only path', async () => {
    l2.searchCache.mockResolvedValue(null);

    const wrapped = wrapWithToolResultCache(l2, innerMcp); // no opts arg at all
    await wrapped(makeRunCtx(), 'azure_list_subscriptions', { subscription_id: 'sub-1' });

    expect(innerMcp).toHaveBeenCalledTimes(1);
    expect(l2.searchCache).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setImmediate(resolve));
    expect(l2.cacheResult).toHaveBeenCalledTimes(1);
    // L1 wasn't constructed, no assertion needed — just proving no error.
  });

  it('L1 searchExact THROWS → falls through to L2 (resilience)', async () => {
    l1.searchExact.mockRejectedValue(new Error('redis ECONNRESET'));
    l2.searchCache.mockResolvedValue(null);

    const wrapped = wrapWithToolResultCache(l2, innerMcp, { l1Cache: l1 });
    const result = await wrapped(makeRunCtx(), 'azure_list_subscriptions', {});

    expect(result.ok).toBe(true);
    expect(l2.searchCache).toHaveBeenCalledTimes(1);
    expect(innerMcp).toHaveBeenCalledTimes(1);
  });

  it('Uncacheable tool (web_search): L1 not consulted, L2 not consulted, inner runs', async () => {
    const wrapped = wrapWithToolResultCache(l2, innerMcp, { l1Cache: l1 });
    await wrapped(makeRunCtx(), 'web_search', { query: 'latest news' });

    expect(l1.searchExact).not.toHaveBeenCalled();
    expect(l2.searchCache).not.toHaveBeenCalled();
    expect(innerMcp).toHaveBeenCalledTimes(1);
  });
});
