/**
 * buildChatV2Deps — LargeResultStorage wire-up.
 *
 * Why this test exists: ToolEnvelopeSplitter already accepts a
 * `SplitterLargeResultStorage` adapter that offloads >30KB results to Redis
 * via LargeResultStorageService. BUT the deps factory NEVER wired the
 * adapter into the deps struct. As a result every chat-pipeline dispatch
 * called `splitEnvelope` with `largeResultStorage: undefined`, the splitter
 * fell into its defensive inline path, and multi-MB enterprise tool results
 * (e.g. "list all Azure subs + RGs across 100 tenants") blew up the model
 * context window — exactly the failure mode the splitter was built to avoid.
 *
 * Pin: after `buildChatV2Deps(...)` returns, the deps struct MUST expose:
 *   - `largeResultStorage` — adapter shape `{ put: (raw, opts) => Promise<string> }`
 *     wrapping `LargeResultStorageService.storeResult(...)`.
 *   - `thresholdBytes` — number (30 * 1024 default).
 *
 * Then `runChat.ts` reads those two fields off `deps` and threads them
 * through `V3DispatchDeps` so `splitEnvelope` actually offloads.
 *
 * the design notes
 *       (LargeResultStorage seam) + plan Phase 4 / Task 4.5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildChatV2Deps, type BuildChatV2DepsOptions } from '../buildChatV2Deps.js';
import { setLargeResultStorageServiceInstance } from '../LargeResultStorageService.js';
import pino from 'pino';

function makeBaseOpts(): BuildChatV2DepsOptions {
  return {
    providerManager: { createCompletion: vi.fn() },
  };
}

describe('buildChatV2Deps — LargeResultStorage wire-up', () => {
  beforeEach(() => {
    // Install a fake storage singleton so the factory's `getLargeResultStorageService()`
    // call returns a controllable adapter — no Redis IO in unit tests.
    const fakeSvc = {
      storeResult: vi.fn().mockResolvedValue({
        resultId: 'result_test_abc123',
        summary: 'fake summary',
        sizeBytes: 50000,
        chunkCount: 3,
      }),
    } as any;
    setLargeResultStorageServiceInstance(fakeSvc);
  });

  it('exposes deps.largeResultStorage with a put() that delegates to LargeResultStorageService.storeResult', async () => {
    const deps = buildChatV2Deps(makeBaseOpts());

    expect(deps.largeResultStorage).toBeDefined();
    expect(typeof deps.largeResultStorage?.put).toBe('function');

    // Calling put() must produce a resultId string (per SplitterLargeResultStorage contract).
    const handle = await deps.largeResultStorage!.put(
      { subscriptions: [{ id: 's-1' }] },
      {
        sessionId: 'sess-1',
        toolUseId: 'tool_xyz',
        expiresAt: Date.now() + 60_000,
      },
    );
    expect(typeof handle).toBe('string');
    expect(handle.length).toBeGreaterThan(0);
  });

  it('exposes deps.thresholdBytes === 30 * 1024 (the splitter default)', () => {
    const deps = buildChatV2Deps(makeBaseOpts());
    expect(deps.thresholdBytes).toBe(30 * 1024);
  });

  it('put() forwards opts.toolName through to storeResult (so the storage row carries it)', async () => {
    const storeResult = vi.fn().mockResolvedValue({
      resultId: 'r1',
      summary: 's',
      sizeBytes: 100,
      chunkCount: 1,
    });
    setLargeResultStorageServiceInstance({ storeResult } as any);

    const deps = buildChatV2Deps(makeBaseOpts());
    await deps.largeResultStorage!.put(
      { rows: [1, 2, 3] },
      {
        sessionId: 'sess-1',
        toolUseId: 'tool_xyz',
        expiresAt: Date.now() + 60_000,
        toolName: 'azure_list_subscriptions',
      } as any,
    );

    expect(storeResult).toHaveBeenCalledTimes(1);
    const callArg = storeResult.mock.calls[0]![0];
    expect(callArg.toolName).toBe('azure_list_subscriptions');
    expect(callArg.sessionId).toBe('sess-1');
    expect(callArg.toolCallId).toBe('tool_xyz');
    expect(callArg.result).toEqual({ rows: [1, 2, 3] });
  });

  it('put() defaults toolName to "unknown" when opts.toolName missing', async () => {
    const storeResult = vi.fn().mockResolvedValue({
      resultId: 'r2',
      summary: 's',
      sizeBytes: 100,
      chunkCount: 1,
    });
    setLargeResultStorageServiceInstance({ storeResult } as any);

    const deps = buildChatV2Deps(makeBaseOpts());
    await deps.largeResultStorage!.put(
      { rows: [] },
      {
        sessionId: 'sess-1',
        toolUseId: 'tool_xyz',
        expiresAt: Date.now() + 60_000,
      },
    );

    const callArg = storeResult.mock.calls[0]![0];
    expect(callArg.toolName).toBe('unknown');
  });
});
