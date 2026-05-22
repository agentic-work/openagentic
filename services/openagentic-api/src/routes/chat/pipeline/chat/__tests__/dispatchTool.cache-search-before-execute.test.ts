/**
 * dispatchTool — cache-search-before-execute (2026-05-20).
 *
 * Pins:
 *  - When `toolResultCache.searchCache` returns a hit for an MCP tool, the
 *    inner MCP executor is NOT called and the cached result is returned to
 *    chatLoop with `_meta.cacheHit: true` on the output payload.
 *  - When the tool is uncacheable (e.g. `web_search`), the cache is NOT
 *    consulted and the inner executor runs.
 *  - When `searchCache` returns null (miss), the inner executor runs and
 *    its real result flows through.
 *
 * The cache wraps `executeMcpTool` at the buildChatV2Deps factory; this
 * test exercises the wrap via the full `makeDispatch` chain so we prove
 * the seam fires on the same code path production uses.
 *
 * Plan: T1 cache wire-up (controller-dispatched 2026-05-20 PM).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';
import { wrapWithToolResultCache } from '../../../../../services/buildChatV2Deps.js';
import type { ToolResultCacheLike } from '../types.js';

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

function makeV2Deps(executeMcpTool: any) {
  return {
    executeComposeVisual: vi.fn(),
    executeComposeApp: vi.fn(),
    executeRenderArtifact: vi.fn(),
    executeTask: vi.fn(),
    executeRequestClarification: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    executeMemorize: vi.fn(),
    executeMcpTool,
    listSubagentTypes: vi.fn().mockResolvedValue([]),
    runSubagent: vi.fn(),
  } as any;
}

describe('dispatchTool — cache-search-before-execute', () => {
  let innerMcp: ReturnType<typeof vi.fn>;
  let cache: ToolResultCacheLike & {
    searchCache: ReturnType<typeof vi.fn>;
    cacheResult: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    innerMcp = vi.fn().mockResolvedValue({
      ok: true,
      output: { subscriptions: [{ id: 'sub-1', name: 'fresh-from-mcp' }] },
    });
    cache = {
      isReady: () => true,
      searchCache: vi.fn(),
      cacheResult: vi.fn().mockResolvedValue(true),
    } as any;
  });

  it('returns the cached result and SKIPS MCP execution on a cache hit', async () => {
    cache.searchCache.mockResolvedValue({
      result: { subscriptions: [{ id: 'sub-1', name: 'cached-from-other-user' }] },
      similarity: 0.97,
      cacheId: 'cache-xyz',
      toolName: 'azure_list_subscriptions',
      cachedAt: new Date(),
      hitCount: 3,
      crossUserHit: true,
      originalUserId: 'user-b',
    });

    const wrappedExec = wrapWithToolResultCache(cache, innerMcp);
    const dispatch = makeDispatch({
      v2Deps: makeV2Deps(wrappedExec),
      enrichedTools: {},
    });

    const result = await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: { subscription_id: 'sub-123' },
    });

    expect(result.ok).toBe(true);
    expect(innerMcp).not.toHaveBeenCalled();
    expect(cache.searchCache).toHaveBeenCalledTimes(1);
    // Output carries the cached value plus the _meta.cacheHit marker.
    const out: any = result.output;
    expect(out).toBeDefined();
    expect(out.subscriptions?.[0]?.name).toBe('cached-from-other-user');
    expect(out._meta?.cacheHit).toBe(true);
    expect(out._meta?.crossUserHit).toBe(true);
    expect(out._meta?.cacheSimilarity).toBeCloseTo(0.97);
  });

  it('does NOT consult the cache for uncacheable tools (e.g. web_search)', async () => {
    cache.searchCache.mockResolvedValue({
      // Even with a hit set up, the cache shouldn't be queried.
      result: { results: ['stale'] },
      similarity: 0.99,
      cacheId: 'should-not-be-used',
      toolName: 'web_search',
      cachedAt: new Date(),
      hitCount: 1,
      crossUserHit: false,
    });

    const wrappedExec = wrapWithToolResultCache(cache, innerMcp);
    const dispatch = makeDispatch({
      v2Deps: makeV2Deps(wrappedExec),
      enrichedTools: {},
    });

    await dispatch(makeRunCtx(), {
      name: 'web_search',
      input: { query: 'latest news' },
    });

    expect(cache.searchCache).not.toHaveBeenCalled();
    expect(innerMcp).toHaveBeenCalledTimes(1);
  });

  it('falls through to MCP execution on a cache miss (searchCache returns null)', async () => {
    cache.searchCache.mockResolvedValue(null);

    const wrappedExec = wrapWithToolResultCache(cache, innerMcp);
    const dispatch = makeDispatch({
      v2Deps: makeV2Deps(wrappedExec),
      enrichedTools: {},
    });

    const result = await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: { subscription_id: 'sub-123' },
    });

    expect(cache.searchCache).toHaveBeenCalledTimes(1);
    expect(innerMcp).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    const out: any = result.output;
    expect(out.subscriptions?.[0]?.name).toBe('fresh-from-mcp');
    // No cacheHit marker — output is the raw inner result.
    expect(out._meta?.cacheHit).toBeUndefined();
  });

  it('falls through to MCP execution when searchCache throws (fail-open)', async () => {
    cache.searchCache.mockRejectedValue(new Error('milvus unreachable'));

    const wrappedExec = wrapWithToolResultCache(cache, innerMcp);
    const dispatch = makeDispatch({
      v2Deps: makeV2Deps(wrappedExec),
      enrichedTools: {},
    });

    const result = await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: { subscription_id: 'sub-123' },
    });

    expect(innerMcp).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});
