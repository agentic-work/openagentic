/**
 * Phase 6 — sankey_3col template renders a 3-column Sankey for cost-flow
 * visualizations. Mock 10:300-365 anatomy (subscription → RG → service).
 */

import { describe, it, expect } from 'vitest';

// We import the dispatcher indirectly via the executor's surface — mirror
// the existing ComposeVisualTool.test.ts pattern.
import { executeComposeVisual } from '../ComposeVisualTool.js';

function makeCtx() {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  return {
    emitted,
    ctx: {
      emit: (frameType: string, payload: unknown) => {
        emitted.push({ type: frameType, payload });
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      sessionId: 's-1',
      userId: 'u-1',
    },
  };
}

const VALID_INPUT = {
  template: 'sankey_3col' as const,
  title: 'Cost flow · 6 months',
  data: {
    left: [{ name: 'prod-openagentic' }, { name: 'dev-openagentic' }],
    mid: [{ name: 'core-api' }, { name: 'data' }, { name: 'sandbox' }],
    right: [{ name: 'compute' }, { name: 'storage' }, { name: 'sql' }, { name: 'misc' }],
    flows_lm: [
      { from: 'prod-openagentic', to: 'core-api', value: 30000 },
      { from: 'prod-openagentic', to: 'data', value: 15000 },
      { from: 'dev-openagentic', to: 'sandbox', value: 8000 },
    ],
    flows_mr: [
      { from: 'core-api', to: 'compute', value: 20000 },
      { from: 'core-api', to: 'storage', value: 10000 },
      { from: 'data', to: 'sql', value: 15000 },
      { from: 'sandbox', to: 'misc', value: 8000 },
    ],
  },
};

describe('ComposeVisualTool sankey_3col (mock 10:300-365)', () => {
  it('emits a visual_render frame with kind=svg containing 3-col Sankey', async () => {
    const { ctx, emitted } = makeCtx();
    const res = await executeComposeVisual(ctx, VALID_INPUT);
    expect(res.ok).toBe(true);
    const visualFrame = emitted.find((e) => e.type === 'visual_render');
    expect(visualFrame).not.toBeUndefined();
    const payload = visualFrame!.payload as { kind: string; content: string };
    expect(payload.kind).toBe('svg');
    // 3-col sankey: must reference the 3 gradient IDs we declared.
    expect(payload.content).toContain('cmg1');
    expect(payload.content).toContain('cmg2');
    // Must contain at least one cubic-bezier ribbon path (C ... Z).
    expect(payload.content).toMatch(/d="M\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+C\s/);
    // All node labels must appear in the SVG.
    for (const name of ['prod-openagentic', 'core-api', 'compute', 'sql']) {
      expect(payload.content).toContain(name);
    }
  });

  it('rejects empty node arrays', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(
      ctx,
      { ...VALID_INPUT, data: { ...VALID_INPUT.data, left: [] } },
    );
    expect(res.ok).toBe(false);
  });

  it('rejects missing flows', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(
      ctx,
      { ...VALID_INPUT, data: { ...VALID_INPUT.data, flows_mr: [] } },
    );
    expect(res.ok).toBe(false);
  });

  it('rejects non-positive flow values', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(
      ctx,
      {
        ...VALID_INPUT,
        data: {
          ...VALID_INPUT.data,
          flows_lm: [{ from: 'prod-openagentic', to: 'core-api', value: 0 }],
        },
      },
    );
    expect(res.ok).toBe(false);
  });
});
