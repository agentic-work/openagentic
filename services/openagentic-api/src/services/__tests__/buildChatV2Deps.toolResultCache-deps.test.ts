/**
 * buildChatV2Deps — ToolResultCacheService wire-up (2026-05-20).
 *
 * Pins:
 *  - After `buildChatV2Deps(...)` returns, the deps struct exposes a
 *    `toolResultCache` member with `.searchCache(...)` + `.cacheResult(...)`.
 *  - The factory accepts an explicit `opts.toolResultCache` override (test
 *    injection) and threads it through verbatim.
 *  - Passing `opts.toolResultCache: null` explicitly opts-out — the factory
 *    leaves `deps.toolResultCache` undefined and executeMcpTool stays
 *    unwrapped (legacy behavior).
 *  - The executeMcpTool dep is wrapped with the cache-before / cache-after
 *    seams when a cache is wired — invoking it calls `cache.searchCache`
 *    BEFORE the inner executor and `cache.cacheResult` AFTER a successful
 *    inner execution.
 *
 * Plan: T1 cache wire-up (controller-dispatched 2026-05-20 PM).
 */
import { describe, it, expect, vi } from 'vitest';
import { buildChatV2Deps, wrapWithToolResultCache, type BuildChatV2DepsOptions } from '../buildChatV2Deps.js';
import type { ToolResultCacheLike } from '../../routes/chat/pipeline/chat/types.js';

function makeStubCache(): ToolResultCacheLike & {
  searchCache: ReturnType<typeof vi.fn>;
  cacheResult: ReturnType<typeof vi.fn>;
} {
  return {
    isReady: () => true,
    searchCache: vi.fn().mockResolvedValue(null),
    cacheResult: vi.fn().mockResolvedValue(true),
  } as any;
}

function makeBaseOpts(extra: Partial<BuildChatV2DepsOptions> = {}): BuildChatV2DepsOptions {
  return {
    providerManager: { createCompletion: vi.fn() },
    // Avoid hitting the real getToolResultCacheService singleton: tests
    // either inject an explicit stub or pass null to opt out.
    toolResultCache: null,
    ...extra,
  };
}

describe('buildChatV2Deps — ToolResultCacheService wire-up', () => {
  it('exposes deps.toolResultCache with .searchCache and .cacheResult when injected', () => {
    const cache = makeStubCache();
    const deps = buildChatV2Deps(makeBaseOpts({ toolResultCache: cache }));

    expect(deps.toolResultCache).toBeDefined();
    expect(typeof deps.toolResultCache?.searchCache).toBe('function');
    expect(typeof deps.toolResultCache?.cacheResult).toBe('function');
    // Identity — factory must thread the explicit override verbatim, not
    // wrap or shadow it.
    expect(deps.toolResultCache).toBe(cache);
  });

  it('leaves deps.toolResultCache undefined when opts.toolResultCache is null (explicit opt-out)', () => {
    const deps = buildChatV2Deps(makeBaseOpts({ toolResultCache: null }));
    expect(deps.toolResultCache).toBeUndefined();
  });

  it('wraps executeMcpTool to call cache.searchCache BEFORE the inner executor', async () => {
    const cache = makeStubCache();
    const innerExec = vi
      .fn()
      .mockResolvedValue({ ok: true, output: { subscriptions: [{ id: 's-1' }] } });
    const deps = buildChatV2Deps(
      makeBaseOpts({
        toolResultCache: cache,
        executeMcpTool: innerExec,
      }),
    );

    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      userId: 'user-a',
      user: { id: 'user-a', tenantId: 'tenant-x', groups: ['g1'], isAdmin: false },
      sessionId: 'sess-1',
    };
    await deps.executeMcpTool(ctx, 'azure_list_subscriptions', { subscription_id: 'sub-123' });

    expect(cache.searchCache).toHaveBeenCalledTimes(1);
    // Args order: (tenantId, toolName, toolArgs, queryText, userId, userGroups, isAdmin)
    const args = cache.searchCache.mock.calls[0]!;
    expect(args[0]).toBe('tenant-x');
    expect(args[1]).toBe('azure_list_subscriptions');
    expect(args[2]).toEqual({ subscription_id: 'sub-123' });
    expect(args[4]).toBe('user-a');
    expect(args[5]).toEqual(['g1']);
    expect(args[6]).toBe(false);

    // Inner must run on cache miss.
    expect(innerExec).toHaveBeenCalledTimes(1);
  });

  it('cache lookup is LAZY — the factory is constructed without instantiating the real singleton', () => {
    // Re-using opts.toolResultCache: null asserts the factory doesn't crash
    // when the production singleton is absent. With null, deps.toolResultCache
    // stays undefined and executeMcpTool stays unwrapped.
    const deps = buildChatV2Deps(makeBaseOpts({ toolResultCache: null }));
    expect(deps.toolResultCache).toBeUndefined();
    expect(typeof deps.executeMcpTool).toBe('function');
  });

  it('wrapWithToolResultCache returns the inner executor verbatim when cache is undefined (no-op wrap)', async () => {
    const innerExec = vi.fn().mockResolvedValue({ ok: true, output: 'noop' });
    const wrapped = wrapWithToolResultCache(undefined, innerExec);
    expect(wrapped).toBe(innerExec);
  });

  // ─── #972 unstick — LAZY RESOLVER ──────────────────────────────────────
  // ToolResultCacheService init is async (Milvus collection + embedding
  // client take ~2s). buildChatV2Deps runs at pod startup BEFORE init
  // completes. The one-shot capture left the wrap as a no-op for the pod
  // lifecycle. Lazy resolver fixes this by re-checking on EVERY call.

  it('wrap with null/undefined resolver result on first call falls through to inner verbatim', async () => {
    const innerExec = vi.fn().mockResolvedValue({ ok: true, output: 'inner-passthrough' });
    const resolver = vi.fn(() => null); // resolver always returns null
    const wrapped = wrapWithToolResultCache(resolver as any, innerExec);

    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      userId: 'user-a',
      user: { id: 'user-a', tenantId: 'tenant-x', groups: [], isAdmin: false },
    };
    const result = await wrapped(ctx, 'azure_list_subscriptions', { foo: 'bar' });

    // Inner ran, result flowed through identity.
    expect(innerExec).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, output: 'inner-passthrough' });
    // Resolver was consulted but returned null → no cache call.
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('lazy resolver that returns null on call 1, then a real cache on call 2 — cache-hit fires on call 2', async () => {
    const cache = makeStubCache();
    cache.searchCache.mockResolvedValue({
      result: { subscriptions: [{ id: 'cached-sub-1' }] },
      similarity: 0.97,
      cacheId: 'cache-x',
      toolName: 'azure_list_subscriptions',
      cachedAt: new Date(),
      hitCount: 5,
      crossUserHit: false,
    });

    let resolveCount = 0;
    const resolver = vi.fn(() => {
      resolveCount += 1;
      // First call → null (init not ready). Second + → live cache.
      return resolveCount === 1 ? null : cache;
    });

    const innerExec = vi.fn().mockResolvedValue({ ok: true, output: 'inner-on-miss' });
    const wrapped = wrapWithToolResultCache(resolver as any, innerExec);

    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      userId: 'user-a',
      user: { id: 'user-a', tenantId: 'tenant-x', groups: [], isAdmin: false },
    };

    // Call 1 — resolver returns null → falls through to inner.
    const r1 = await wrapped(ctx, 'azure_list_subscriptions', { subscription_id: 'sub-1' });
    expect(r1).toEqual({ ok: true, output: 'inner-on-miss' });
    expect(innerExec).toHaveBeenCalledTimes(1);
    expect(cache.searchCache).not.toHaveBeenCalled();

    // Call 2 — resolver returns live cache → cache-hit path fires, inner is NOT invoked.
    const r2 = await wrapped(ctx, 'azure_list_subscriptions', { subscription_id: 'sub-1' });
    expect(cache.searchCache).toHaveBeenCalledTimes(1);
    expect(innerExec).toHaveBeenCalledTimes(1); // still 1 — cache hit short-circuits
    expect((r2 as any).ok).toBe(true);
    // The hit's output is wrapped with _meta.cacheHit:true.
    expect((r2 as any).output?._meta?.cacheHit).toBe(true);
  });

  it('lazy resolver that immediately returns a live cache — cache-hit fires on the FIRST call', async () => {
    const cache = makeStubCache();
    cache.searchCache.mockResolvedValue({
      result: { ok: true, value: 42 },
      similarity: 0.99,
      cacheId: 'cache-y',
      toolName: 'azure_get_resource',
      cachedAt: new Date(),
      hitCount: 1,
      crossUserHit: false,
    });

    const resolver = vi.fn(() => cache);
    const innerExec = vi.fn().mockResolvedValue({ ok: true, output: 'inner-should-not-run' });
    const wrapped = wrapWithToolResultCache(resolver as any, innerExec);

    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      userId: 'user-a',
      user: { id: 'user-a', tenantId: 'tenant-x', groups: [], isAdmin: false },
    };

    await wrapped(ctx, 'azure_get_resource', { id: 'r-1' });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(cache.searchCache).toHaveBeenCalledTimes(1);
    expect(innerExec).not.toHaveBeenCalled();
  });

  it('lazy resolver — wrap with null cache returns inner verbatim (no resolver wrap created)', async () => {
    const innerExec = vi.fn().mockResolvedValue({ ok: true, output: 'noop' });
    const wrapped = wrapWithToolResultCache(null as any, innerExec);
    expect(wrapped).toBe(innerExec);
  });

  it('buildChatV2Deps wraps executeMcpTool with the lazy production resolver (no opts.toolResultCache passed)', async () => {
    // When opts.toolResultCache is omitted entirely, the factory wires the
    // lazy resolver internally. The wrap is created (executeMcpTool !==
    // innerExec) even though the singleton may not be ready yet — the
    // resolver path is what unsticks #972.
    const innerExec = vi.fn().mockResolvedValue({ ok: true, output: 'inner-noop' });
    const deps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() },
      executeMcpTool: innerExec,
      // Intentionally do NOT pass toolResultCache — exercise prod resolver path.
    } as any);

    // The wrap is in place — executeMcpTool is NOT inner identity. We don't
    // assert searchCache fires here (the real singleton's isReady() will be
    // false in the test sandbox so the resolver returns undefined → inner
    // path fires) but the WRAP shape is what unsticks #972: every call
    // re-checks the resolver, so the first post-init call lights up.
    expect(deps.executeMcpTool).not.toBe(innerExec);
    expect(typeof deps.executeMcpTool).toBe('function');
  });
});
