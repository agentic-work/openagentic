/**
 * buildChatV2Deps — A2 sub-agent trace store wire-up (2026-05-12).
 *
 * Why this test exists: TaskTool defines a `TraceStore` interface and reads
 * `deps.traceStore?.store(...)` to persist sub-agent transcripts so the parent
 * agent can call `read_subagent_trace(handle)` later. Before this change, the
 * chat deps factory NEVER set `traceStore`, so executeTask always took the
 * back-compat path and trace_handle never appeared on TaskResult.
 *
 * Pin: after `buildChatV2Deps(...)` returns, the deps struct MUST expose:
 *   - `traceStore` — adapter shape `{ store: (payload) => Promise<{handle: string}> }`
 *     wrapping `LargeResultStorageService.storeResult(...)`.
 *
 * Then `runChat.ts` forwards `traceStore` onto `v2Deps`, and
 * `dispatchChatToolCall`'s Task arm threads it into `TaskDeps`. End-to-end:
 * parent agent dispatches Task → executeTask runs the sub-agent → trace
 * persisted to Redis → parent gets `trace_handle` on the result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildChatV2Deps, type BuildChatV2DepsOptions } from '../buildChatV2Deps.js';
import { setLargeResultStorageServiceInstance } from '../LargeResultStorageService.js';

function makeBaseOpts(): BuildChatV2DepsOptions {
  return {
    providerManager: { createCompletion: vi.fn() },
  };
}

describe('buildChatV2Deps — A2 trace store wire-up', () => {
  beforeEach(() => {
    // Fake LargeResultStorageService singleton — keeps the test off Redis.
    const fakeSvc = {
      storeResult: vi.fn().mockResolvedValue({
        resultId: 'result_trace_xyz789',
        summary: 'fake trace summary',
        sizeBytes: 1024,
        chunkCount: 1,
      }),
    } as any;
    setLargeResultStorageServiceInstance(fakeSvc);
  });

  it('exposes deps.traceStore with a store() that delegates to LargeResultStorageService.storeResult', async () => {
    const deps = buildChatV2Deps(makeBaseOpts());

    expect(deps.traceStore).toBeDefined();
    expect(typeof deps.traceStore?.store).toBe('function');

    // Calling store() must produce {handle: resultId} per the TraceStore contract.
    const result = await deps.traceStore!.store({
      sessionId: 'sess-1',
      userId: 'user-1',
      role: 'cloud_operations',
      prompt: 'audit IAM drift',
      output: 'no drift found',
      stats: {
        turns: 4,
        tokens: 1234,
        durationMs: 5000,
        toolsUsed: ['azure_list_subscriptions'],
      },
    });
    expect(result).toEqual({ handle: 'result_trace_xyz789' });
  });

  it('explicit opts.traceStore wins over the default LargeResultStorage adapter', async () => {
    const fakeTraceStore = {
      store: vi.fn().mockResolvedValue({ handle: 'injected_handle_1' }),
    };
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      traceStore: fakeTraceStore,
    });

    expect(deps.traceStore).toBe(fakeTraceStore);
    const result = await deps.traceStore!.store({
      role: 'general-purpose',
      prompt: 'test',
      stats: { turns: 1, tokens: 100, durationMs: 100, toolsUsed: [] },
    });
    expect(result.handle).toBe('injected_handle_1');
    expect(fakeTraceStore.store).toHaveBeenCalledTimes(1);
  });

  it('defaults sessionId/userId on the storage write when caller omits them (back-compat with sub-agents that lack ctx)', async () => {
    const storeResultSpy = vi.fn().mockResolvedValue({
      resultId: 'result_default_abc',
      summary: 's',
      sizeBytes: 10,
      chunkCount: 1,
    });
    setLargeResultStorageServiceInstance({ storeResult: storeResultSpy } as any);

    const deps = buildChatV2Deps(makeBaseOpts());
    await deps.traceStore!.store({
      role: 'data_analysis',
      prompt: 'analyze',
      stats: { turns: 2, tokens: 50, durationMs: 100, toolsUsed: [] },
    });

    expect(storeResultSpy).toHaveBeenCalledTimes(1);
    const callArg = storeResultSpy.mock.calls[0]![0];
    expect(callArg.userId).toBe('system');
    expect(callArg.sessionId).toBe('unknown');
    expect(callArg.toolName).toBe('__subagent_trace__');
    expect(callArg.toolCallId).toMatch(/^trace_\d+_[a-z0-9]+$/);
    expect(callArg.result.kind).toBe('subagent_trace');
    expect(callArg.result.role).toBe('data_analysis');
    expect(callArg.result.stats.turns).toBe(2);
  });
});
