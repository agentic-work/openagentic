/**
 * dispatchTool — cache-store-after-execute (2026-05-20).
 *
 * Pins:
 *  - After a SUCCESSFUL `azure_list_subscriptions` execution, `cacheResult`
 *    is called exactly once with the tenantId, userId, toolName, args, and
 *    result. Resource scope is computed by `extractResourceScope` internally
 *    via the cache service when shaping the row.
 *  - On an ERROR result (ok:false), `cacheResult` is NOT called.
 *  - On uncacheable tools (e.g. web_search), `cacheResult` is NOT called.
 *  - `cacheResult` is fire-and-forget — a rejection from the write does NOT
 *    propagate to the dispatch result.
 *
 * Plan: T1 cache wire-up (controller-dispatched 2026-05-20 PM).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';
import { wrapWithToolResultCache } from '../../../../../services/buildChatV2Deps.js';
import type { ToolResultCacheLike } from '../types.js';

function makeRunCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-1',
    userId: 'user-a',
    user: { id: 'user-a', tenantId: 'tenant-x', groups: ['g1'], isAdmin: false },
    toolUseId: 'toolu_abc',
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

/** Wait for a fire-and-forget microtask to drain (vitest's macrotask). */
async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('dispatchTool — cache-store-after-execute', () => {
  let cache: ToolResultCacheLike & {
    searchCache: ReturnType<typeof vi.fn>;
    cacheResult: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    cache = {
      isReady: () => true,
      // Always miss for these tests so we exercise the write path.
      searchCache: vi.fn().mockResolvedValue(null),
      cacheResult: vi.fn().mockResolvedValue(true),
    } as any;
  });

  it('calls cacheResult exactly once after a successful azure_list_subscriptions execution', async () => {
    const innerMcp = vi.fn().mockResolvedValue({
      ok: true,
      output: { subscriptions: [{ id: 'sub-1' }, { id: 'sub-2' }] },
    });

    const wrappedExec = wrapWithToolResultCache(cache, innerMcp);
    const dispatch = makeDispatch({
      v2Deps: makeV2Deps(wrappedExec),
      enrichedTools: {},
    });

    const args = { subscription_id: 'sub-123' };
    await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: args,
    });
    await flushMicrotasks();

    expect(cache.cacheResult).toHaveBeenCalledTimes(1);
    // Signature: (tenantId, userId, toolName, toolArgs, result, queryText?)
    const callArgs = cache.cacheResult.mock.calls[0]!;
    expect(callArgs[0]).toBe('tenant-x');
    expect(callArgs[1]).toBe('user-a');
    expect(callArgs[2]).toBe('azure_list_subscriptions');
    expect(callArgs[3]).toEqual(args);
    expect(callArgs[4]).toEqual({ subscriptions: [{ id: 'sub-1' }, { id: 'sub-2' }] });
  });

  it('does NOT call cacheResult when the inner executor returns ok:false', async () => {
    const innerMcp = vi.fn().mockResolvedValue({
      ok: false,
      error: 'MCP proxy returned 503: upstream unavailable',
    });

    const wrappedExec = wrapWithToolResultCache(cache, innerMcp);
    const dispatch = makeDispatch({
      v2Deps: makeV2Deps(wrappedExec),
      enrichedTools: {},
    });

    await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: { subscription_id: 'sub-123' },
    });
    await flushMicrotasks();

    expect(cache.cacheResult).not.toHaveBeenCalled();
  });

  it('does NOT call cacheResult for uncacheable tools (web_search)', async () => {
    const innerMcp = vi.fn().mockResolvedValue({
      ok: true,
      output: { results: [{ title: 't1', url: 'https://x' }] },
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
    await flushMicrotasks();

    expect(cache.cacheResult).not.toHaveBeenCalled();
  });

  it('does NOT call cacheResult when output is empty / null', async () => {
    const innerMcp = vi.fn().mockResolvedValue({ ok: true, output: '' });

    const wrappedExec = wrapWithToolResultCache(cache, innerMcp);
    const dispatch = makeDispatch({
      v2Deps: makeV2Deps(wrappedExec),
      enrichedTools: {},
    });

    await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: { subscription_id: 'sub-123' },
    });
    await flushMicrotasks();

    expect(cache.cacheResult).not.toHaveBeenCalled();
  });

  it('a cacheResult write rejection does NOT propagate to the dispatch result (fire-and-forget)', async () => {
    cache.cacheResult.mockRejectedValue(new Error('pgvector down'));
    const innerMcp = vi.fn().mockResolvedValue({
      ok: true,
      output: { subscriptions: [{ id: 'sub-1' }] },
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
    await flushMicrotasks();

    // Dispatch still succeeded — write failure was swallowed.
    expect(result.ok).toBe(true);
    expect(cache.cacheResult).toHaveBeenCalledTimes(1);
  });
});
