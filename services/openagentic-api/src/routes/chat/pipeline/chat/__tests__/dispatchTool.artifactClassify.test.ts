/**
 * #781 Phase A2 — wire ArtifactRegistry.classify into the chat dispatch
 * envelope so every tool_result carries `_meta.artifactKind` and the UI
 * never has to re-derive it from the slug.
 *
 * Plan: docs/superpowers/plans/2026-05-13-next-gen-artifact-slideouts.md §A2
 *
 * Contract: when an enriched tool entry provides an `outputTemplate`
 * known to `ArtifactRegistry.classify` (e.g. 'sankey' → 'chart'), the
 * envelope returned by `dispatchTool` must stamp
 * `envelope._meta.artifactKind` with the classified `ArtifactKind`.
 *
 * Coverage drift between this assertion and the registry's slug table is
 * already pinned by `services/__tests__/ArtifactRegistry.test.ts`.
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
    sessionId: 's-a2',
    userId: 'u-a2',
  } as any;
}

describe('makeDispatch — #781 Phase A2 artifact classification', () => {
  it('stamps envelope._meta.artifactKind from outputTemplate via ArtifactRegistry', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({
      ok: true,
      output: '{"nodes":[],"links":[]}',
    });

    const dispatch = makeDispatch({
      v2Deps: {} as any,
      enrichedTools: {
        cost_sankey: { outputTemplate: 'sankey' },
      },
    });

    const result = await dispatch(makeRunCtx(), {
      name: 'cost_sankey',
      input: {},
      toolUseId: 'toolu_a2',
    } as any);

    expect(result.envelope, 'splitter must produce an envelope').toBeDefined();
    expect(
      (result.envelope as any)?._meta?.artifactKind,
      "envelope._meta.artifactKind must be 'chart' for outputTemplate='sankey'",
    ).toBe('chart');
  });
});
