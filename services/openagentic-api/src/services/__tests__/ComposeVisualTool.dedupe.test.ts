/**
 * Bug C — content-hash dedupe at compose_visual emit (2026-05-24).
 *
 * Live failure: 4 identical compose_visual calls produced 4 different
 * artifact_ids, all rendered. Each emit allocates a fresh random id via
 * `crypto.randomBytes` so the UI cannot dedupe by id — the same chart
 * shows up 4 times.
 *
 * Fix: compute sha256(template + JSON.stringify(input)) per emission.
 * Cache scoped to the current turn (keyed off ctx.turnId, fallback
 * ctx.sessionId). If hash already seen this turn, skip the emit, log a
 * dedupe warning, and return the existing artifact_id.
 */
import { describe, test, expect, vi } from 'vitest';
import { executeComposeVisual } from '../ComposeVisualTool.js';

function makeCtx(turnId: string) {
  const emitted: Array<{ frame: string; payload: any }> = [];
  const warns: Array<{ obj: any; msg: any }> = [];
  return {
    emitted,
    warns,
    ctx: {
      emit: (frame: string, payload: any) => emitted.push({ frame, payload }),
      logger: {
        info: vi.fn(),
        warn: (obj: any, msg: any) => warns.push({ obj, msg }),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sessionId: 'sess-1',
      userId: 'user-1',
      turnId,
    } as any,
  };
}

describe('compose_visual content-hash dedupe (Bug C, 2026-05-24)', () => {
  test('two identical calls in the SAME turn → second is deduped, only one visual_render frame emitted', async () => {
    const { ctx, emitted, warns } = makeCtx('turn-A');
    const input = {
      template: 'bar_chart',
      data: { x: ['Q1', 'Q2'], y: [100, 200] },
      title: 'Quarterly',
    };

    const r1 = await executeComposeVisual(ctx, input as any);
    const r2 = await executeComposeVisual(ctx, input as any);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // Second call returns the SAME artifact_id as the first.
    expect(r2.artifact_id).toBe(r1.artifact_id);

    // Only ONE visual_render frame on the wire.
    const visualFrames = emitted.filter(e => e.frame === 'visual_render');
    expect(visualFrames.length).toBe(1);

    // Dedupe warning was logged.
    const dedupeWarn = warns.find(w => /dedup/i.test(String(w.msg)));
    expect(dedupeWarn).toBeDefined();
  });

  test('two calls with DIFFERENT data in the same turn → both emit (different hash)', async () => {
    const { ctx, emitted } = makeCtx('turn-B');
    const r1 = await executeComposeVisual(ctx, {
      template: 'bar_chart',
      data: { x: ['Q1'], y: [100] },
    } as any);
    const r2 = await executeComposeVisual(ctx, {
      template: 'bar_chart',
      data: { x: ['Q2'], y: [200] },
    } as any);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.artifact_id).not.toBe(r1.artifact_id);

    const visualFrames = emitted.filter(e => e.frame === 'visual_render');
    expect(visualFrames.length).toBe(2);
  });

  test('identical input across DIFFERENT turns → both emit (turn-scoped cache)', async () => {
    const ctxA = makeCtx('turn-X');
    const ctxB = makeCtx('turn-Y');
    const input = {
      template: 'bar_chart',
      data: { x: ['A'], y: [1] },
    };

    const r1 = await executeComposeVisual(ctxA.ctx, input as any);
    const r2 = await executeComposeVisual(ctxB.ctx, input as any);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Different turns — both must emit.
    expect(ctxA.emitted.filter(e => e.frame === 'visual_render').length).toBe(1);
    expect(ctxB.emitted.filter(e => e.frame === 'visual_render').length).toBe(1);
  });
});
