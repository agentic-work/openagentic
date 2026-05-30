/**
 * Sev-1 / Audit L3-5 (was F1-1) — raw dispatcher object leaks as model-facing
 * output when the inner dispatcher returns success without an `output` field.
 *
 * Plan: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *       §Phase 2.3.4 — "L3-5 dispatchTool.ts:119 raw-leak fix".
 */
import { describe, it, expect, vi } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';

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

describe('makeDispatch — Sev-1 L3-5 raw output leak', () => {
  it('does NOT leak raw dispatcher metadata as model-facing output when output field is missing', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({
      ok: true,
      serverName: 'azure',
      confidenceScore: 0.87,
      // NOTE: no `output` field on purpose
    });

    const dispatch = makeDispatch({
      v2Deps: {} as any,
      enrichedTools: {},
    });
    const result = await dispatch(makeRunCtx(), {
      name: 'azure_probe',
      input: {},
      toolUseId: 'toolu_test',
    } as any);

    expect(
      result.output,
      'output must not contain dispatcher metadata fields like serverName/confidenceScore',
    ).not.toEqual(expect.objectContaining({ serverName: 'azure' }));
    expect(
      result.output,
      "output must be '' (empty-string sentinel) when dispatcher returned no output field",
    ).toBe('');
  });

  it('preserves real output when the dispatcher does provide one', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({
      ok: true,
      output: 'real tool output text',
      serverName: 'azure',
    });

    const dispatch = makeDispatch({
      v2Deps: {} as any,
      enrichedTools: {},
    });
    const result = await dispatch(makeRunCtx(), {
      name: 'azure_probe',
      input: {},
      toolUseId: 'toolu_test2',
    } as any);

    expect(result.output).toBe('real tool output text');
  });
});
