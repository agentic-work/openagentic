/**
 * dispatchTool envelope wiring (Plan §Phase 4 / Task 4.3 — RED → GREEN).
 *
 * `makeDispatch` returns a dispatcher that wraps `dispatchChatToolCall`
 * with `splitEnvelope`. Each call goes:
 *   dispatchChatToolCall → normalizeDispatchResult → splitEnvelope →
 *     ToolDispatchResult { ok, output, envelope }
 *
 * Verifies the envelope is attached, _meta has elapsed + size + outputTemplate.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';

// Stub the inner dispatcher import so we can drive it inline.
vi.mock('../dispatchChatToolCall.js', () => ({
  dispatchChatToolCall: vi.fn(),
}));

import { dispatchChatToolCall } from '../dispatchChatToolCall.js';

function makeRunCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 's',
    userId: 'u',
  } as any;
}

describe('makeDispatch — envelope wiring', () => {
  it('attaches envelope to ToolDispatchResult on success', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: { items: [1, 2, 3] } });

    const dispatch = makeDispatch({
      v2Deps: {} as any,
      enrichedTools: {
        'test_tool': { outputTemplate: 'list' },
      },
    });

    const result = await dispatch(makeRunCtx(), { name: 'test_tool', input: {} });

    expect(result.ok).toBe(true);
    expect(result.envelope).toBeDefined();
    expect(result.envelope!.structuredContent).toBeDefined();
    expect(result.envelope!._meta.outputTemplate).toBe('list');
    expect(result.envelope!._meta.elapsed).toBeGreaterThanOrEqual(0);
    expect(result.envelope!._meta.size).toBeGreaterThan(0);
  });

  it('attaches envelope on tool failure with ok:false', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({ ok: false, error: 'kaboom' });

    const dispatch = makeDispatch({
      v2Deps: {} as any,
      enrichedTools: {},
    });

    const result = await dispatch(makeRunCtx(), { name: 'broken_tool', input: {} });

    expect(result.ok).toBe(false);
    expect(result.envelope).toBeDefined();
    expect(result.envelope!.ok).toBe(false);
  });

  it('falls back to no envelope when enrichedTools is omitted (backward compat)', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: { ok: true } });

    const dispatch = makeDispatch({ v2Deps: {} as any });

    const result = await dispatch(makeRunCtx(), { name: 't', input: {} });
    expect(result.ok).toBe(true);
    // Without enrichedTools we still produce a default envelope (size + elapsed).
    expect(result.envelope).toBeDefined();
    expect(result.envelope!._meta.outputTemplate).toBeUndefined();
  });

  it('preserves discoveredTools / artifact side-channels alongside envelope', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({
      ok: true,
      discoveredTools: [{ type: 'function', function: { name: 'azure_x' } }],
      artifact: { kind: 'visual', payload: { svg: '<svg/>' } },
    });

    const dispatch = makeDispatch({ v2Deps: {} as any });
    const result = await dispatch(makeRunCtx(), { name: 'tool_search', input: {} });

    expect(result.discoveredTools).toBeDefined();
    expect(result.discoveredTools!.length).toBe(1);
    expect(result.artifact?.kind).toBe('visual');
    expect(result.envelope).toBeDefined();
  });
});
