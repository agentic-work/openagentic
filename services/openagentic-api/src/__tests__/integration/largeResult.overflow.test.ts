/**
 * Integration: 5MB tool result overflow → LargeResultStorage → digest summary
 * → read_large_result retrieves full payload.
 *
 * Why this test exists: the unit tests cover each seam in isolation
 * (buildChatV2Deps adapter, splitEnvelope overflow, dispatchTool wiring,
 * applyTruncateTemplate digest). This test stitches them together so we
 * can prove the end-to-end contract:
 *
 *   1. A 5MB synthetic tool result lands in dispatchTool.
 *   2. ToolEnvelopeSplitter offloads via the buildChatV2Deps-wired adapter
 *      (in-memory storage stub modeling the LargeResultStorageService).
 *   3. The envelope returned to chatLoop carries:
 *        - `_meta.artifactHandle` defined
 *        - `structuredContent.summary` populated from the seeded template
 *        - `structuredContent.truncated === true`
 *        - The structuredContent JSON < 2KB (model channel stays compact).
 *   4. A subsequent `read_large_result(handle)` call retrieves the full
 *      5MB payload (paged) from the same storage stub.
 *
 * No Redis IO — the stub records puts in a Map keyed by resultId. Real
 * production wiring uses `LargeResultStorageService.storeResult` (Redis
 * with 48h TTL); the contract is identical.
 *
 * Plan: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §6.2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDispatch, type V3DispatchDeps } from '../../routes/chat/pipeline/chat/dispatchTool.js';
import { setLargeResultStorageServiceInstance } from '../../services/LargeResultStorageService.js';
import { buildChatV2Deps } from '../../services/buildChatV2Deps.js';
import { compileTruncateSummary } from '../../services/EnrichedToolService.js';

// Stub the inner dispatcher so we can return a controlled 5MB payload.
vi.mock('../../routes/chat/pipeline/chat/dispatchChatToolCall.js', () => ({
  dispatchChatToolCall: vi.fn(),
}));
import { dispatchChatToolCall } from '../../routes/chat/pipeline/chat/dispatchChatToolCall.js';

function makeRunCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-overflow',
    userId: 'u-overflow',
  } as any;
}

/**
 * Build a 5MB synthetic tool result that looks like the Azure
 * MCP subscriptions-list output: array of objects under
 * `subscriptions`, each with stable id+name+filler.
 */
function makeFiveMegabytePayload(): { subscriptions: Array<{ id: string; name: string; filler: string }> } {
  const subs: Array<{ id: string; name: string; filler: string }> = [];
  // ~5MB total: each row is ~1KB after JSON serialization.
  for (let i = 0; i < 5000; i++) {
    subs.push({
      id: `sub-${i}`,
      name: `Subscription ${i}`,
      filler: 'x'.repeat(950),
    });
  }
  return { subscriptions: subs };
}

describe('integration: large tool result overflows to LargeResultStorage', () => {
  let storedRows: Map<string, { result: unknown; toolName: string; toolCallId: string }>;
  let storeResult: ReturnType<typeof vi.fn>;
  let getResultAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storedRows = new Map();
    let counter = 0;
    storeResult = vi.fn(async (p: any) => {
      counter += 1;
      const id = `result_test_${counter}`;
      storedRows.set(id, {
        result: p.result,
        toolName: p.toolName,
        toolCallId: p.toolCallId,
      });
      return {
        resultId: id,
        summary: 'fake summary',
        sizeBytes: JSON.stringify(p.result).length,
        chunkCount: 1,
      };
    });
    getResultAsync = vi.fn(async (id: string) => {
      const row = storedRows.get(id);
      if (!row) return null;
      return {
        result: row.result,
        toolName: row.toolName,
        summary: 'fake summary',
        timestamp: Date.now(),
      };
    });
    setLargeResultStorageServiceInstance({
      storeResult,
      getResultAsync,
    } as any);
  });

  it('5MB result → offload to storage, digest summary, artifactHandle, < 2KB structuredContent', async () => {
    const payload = makeFiveMegabytePayload();
    const payloadSize = JSON.stringify(payload).length;
    // ~5MB (5000 × ~1KB after JSON serialization). Far above the 30KB
    // splitter threshold so the overflow path is guaranteed to fire.
    expect(payloadSize).toBeGreaterThan(4 * 1024 * 1024);

    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: payload });

    // Build production-style deps via the factory — proves the same
    // construction path the chat plugin runs at boot.
    const factoryDeps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() },
    });
    expect(factoryDeps.largeResultStorage).toBeDefined();
    expect(factoryDeps.thresholdBytes).toBe(30 * 1024);

    const v3Deps: V3DispatchDeps = {
      v2Deps: {} as any,
      enrichedTools: {
        azure_list_subscriptions: {
          outputTemplate: 'azure_subscription_list',
          truncate_summary: compileTruncateSummary(
            '{{count}} Azure subscriptions. First 5: {{sample_names}}. ' +
              'Use read_large_result(handle) for full inventory.',
          ),
        },
      },
      largeResultStorage: factoryDeps.largeResultStorage,
      thresholdBytes: factoryDeps.thresholdBytes,
    };

    const dispatch = makeDispatch(v3Deps);
    const result = await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: {},
    });

    // 1. Storage was called exactly once.
    expect(storeResult).toHaveBeenCalledTimes(1);

    // 2. Envelope carries the artifact handle.
    expect(result.envelope).toBeDefined();
    expect(result.envelope!._meta.artifactHandle).toBeDefined();
    expect(typeof result.envelope!._meta.artifactHandle).toBe('string');

    // 3. structuredContent.summary came from the seeded template,
    //    with {{count}} + {{sample_names}} auto-tokens resolved.
    const sc = result.envelope!.structuredContent;
    expect(sc.summary).toContain('5000 Azure subscriptions');
    expect(sc.summary).toContain('Subscription 0');
    expect(sc.truncated).toBe(true);

    // 4. Model channel stays compact even though raw is 5MB.
    const scSize = JSON.stringify(sc).length;
    expect(scSize).toBeLessThan(2048);

    // 5. Storage row records the tool slug.
    const storedArg = storeResult.mock.calls[0]![0];
    expect(storedArg.toolName).toBe('azure_list_subscriptions');
    expect(storedArg.sessionId).toBe('sess-overflow');
  });

  it('read_large_result with the artifactHandle retrieves the full 5MB payload', async () => {
    const payload = makeFiveMegabytePayload();
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: payload });

    const factoryDeps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() },
    });

    const v3Deps: V3DispatchDeps = {
      v2Deps: {} as any,
      largeResultStorage: factoryDeps.largeResultStorage,
      thresholdBytes: factoryDeps.thresholdBytes,
    };
    const dispatch = makeDispatch(v3Deps);

    // Initial dispatch — offloads to storage.
    const overflow = await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: {},
    });
    const handle = overflow.envelope!._meta.artifactHandle!;
    expect(handle).toBeDefined();

    // Now the model invokes read_large_result with that handle. This
    // hits the dispatchTool meta-tool arm at name === 'read_large_result'.
    const paged = await dispatch(makeRunCtx(), {
      name: 'read_large_result',
      input: { handle, offset: 0, limit: 10 },
    });

    expect(paged.ok).toBe(true);
    // getResultAsync was called with the same handle. #974 (2026-05-20 PM)
    // added an optional auth-context second arg threaded from ctx.user —
    // present when ctx surfaces user (production), undefined for legacy
    // contexts (this integration test's makeRunCtx doesn't stamp .user).
    expect(getResultAsync.mock.calls[0]?.[0]).toBe(handle);
    // Output is either the result object directly (when not array-paged)
    // or a slice envelope { items, total, offset, limit }. The Azure
    // subscriptions case stored an OBJECT (root is `{subscriptions:[...]}`),
    // not an array, so dispatchReadLargeResult returns the whole object.
    const out = typeof paged.output === 'string' ? JSON.parse(paged.output) : paged.output;
    expect(out).toHaveProperty('subscriptions');
    expect((out as any).subscriptions).toHaveLength(5000);
  });

  it('small (< 30KB) result stays inline — no storage call, no artifactHandle', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({
      ok: true,
      output: { subscriptions: [{ id: 's-1', name: 'Small' }] },
    });

    const factoryDeps = buildChatV2Deps({
      providerManager: { createCompletion: vi.fn() },
    });
    const v3Deps: V3DispatchDeps = {
      v2Deps: {} as any,
      largeResultStorage: factoryDeps.largeResultStorage,
      thresholdBytes: factoryDeps.thresholdBytes,
    };
    const dispatch = makeDispatch(v3Deps);

    const result = await dispatch(makeRunCtx(), {
      name: 'azure_list_subscriptions',
      input: {},
    });

    expect(storeResult).not.toHaveBeenCalled();
    expect(result.envelope!._meta.artifactHandle).toBeUndefined();
  });
});
