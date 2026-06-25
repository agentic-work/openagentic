/**
 * dispatchTool — splitEnvelope MUST be wired with a real `largeResultStorage`
 * adapter, not undefined.
 *
 * Why this test exists: before this slice, the chat pipeline NEVER passed
 * `v3Deps.largeResultStorage` through to `splitEnvelope`. The splitter has a
 * defensive fallback ("no storage → keep inline") which silently kept full
 * multi-MB payloads inline in `structuredContent.data` and blew up the model
 * context window on enterprise cloud-list cascades.
 *
 * Pin: when `v3Deps.largeResultStorage` is supplied, oversize results
 *   - call `largeResultStorage.put(...)` exactly once
 *   - produce an envelope with `_meta.artifactHandle` defined
 *   - produce a `structuredContent` smaller than the raw payload (truncated).
 *
 * the design notes
 */
import { describe, it, expect, vi } from 'vitest';
import { makeDispatch, type V3DispatchDeps } from '../dispatchTool.js';

// Stub the inner dispatcher import so we can drive it inline.
vi.mock('../dispatchChatToolCall.js', () => ({
  dispatchChatToolCall: vi.fn(),
}));

import { dispatchChatToolCall } from '../dispatchChatToolCall.js';

function makeRunCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-1',
    userId: 'u-1',
  } as any;
}

/**
 * Build a synthetic 50KB tool result — well above the default 30KB
 * splitter threshold so the overflow path fires.
 */
function makeLargePayload(): Record<string, unknown> {
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i < 500; i++) {
    rows.push({
      id: `sub-${i}`,
      name: `Subscription ${i}`,
      tenantId: `tenant-${i % 100}`,
      // Pad each row so the total JSON is well over 30KB.
      filler: 'x'.repeat(80),
    });
  }
  return { subscriptions: rows };
}

describe('makeDispatch — splitEnvelope receives largeResultStorage when supplied on V3DispatchDeps', () => {
  it('passes the largeResultStorage adapter to splitEnvelope on overflow → artifactHandle set', async () => {
    const largePayload = makeLargePayload();
    const serialized = JSON.stringify(largePayload);
    expect(serialized.length).toBeGreaterThan(30 * 1024); // sanity — overflow path

    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: largePayload });

    const putSpy = vi.fn().mockResolvedValue('result_handle_xyz');
    const v3Deps: V3DispatchDeps = {
      v2Deps: {} as any,
      enrichedTools: {},
      largeResultStorage: { put: putSpy },
      thresholdBytes: 30 * 1024,
    };

    const dispatch = makeDispatch(v3Deps);
    const result = await dispatch(makeRunCtx(), { name: 'azure_list_subscriptions', input: {} });

    // The splitter MUST have called put() once.
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(result.envelope).toBeDefined();
    expect(result.envelope!._meta.artifactHandle).toBe('result_handle_xyz');

    // The structuredContent should be smaller than the raw payload — proof
    // we're not just inlining the multi-MB blob in the model channel.
    const sc = JSON.stringify(result.envelope!.structuredContent);
    expect(sc.length).toBeLessThan(serialized.length);
  });

  it('does NOT call put() for small payloads (inline path preserved)', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: { tiny: 'result' } });

    const putSpy = vi.fn();
    const v3Deps: V3DispatchDeps = {
      v2Deps: {} as any,
      enrichedTools: {},
      largeResultStorage: { put: putSpy },
      thresholdBytes: 30 * 1024,
    };

    const dispatch = makeDispatch(v3Deps);
    const result = await dispatch(makeRunCtx(), { name: 'tool_x', input: {} });

    expect(putSpy).not.toHaveBeenCalled();
    expect(result.envelope!._meta.artifactHandle).toBeUndefined();
  });

  it('falls back to inline when largeResultStorage is undefined (defensive path)', async () => {
    const largePayload = makeLargePayload();
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: largePayload });

    const v3Deps: V3DispatchDeps = {
      v2Deps: {} as any,
      enrichedTools: {},
      // NO largeResultStorage — defensive fallback expected.
    };

    const dispatch = makeDispatch(v3Deps);
    const result = await dispatch(makeRunCtx(), { name: 'azure_list_subscriptions', input: {} });

    expect(result.envelope).toBeDefined();
    expect(result.envelope!._meta.artifactHandle).toBeUndefined();
  });
});
