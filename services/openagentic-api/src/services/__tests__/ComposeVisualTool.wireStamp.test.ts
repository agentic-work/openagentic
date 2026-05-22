/**
 * A2/A3 — compose_visual wire stamps tool_use_id + _meta.outputTemplate.
 *
 * Plan: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *       §2.2.2 (tool_use_id stamping) + §2.2.3 (_meta.outputTemplate).
 *
 * Why: parallel tool fan-out can ship multiple compose_visual frames in
 * one turn. Without `tool_use_id` on each emit, the UI's
 * FrameRendererRegistry can't bind the frame to its source tool card.
 * Without `_meta.outputTemplate`, the registry routes by shape-guess
 * (fragile) instead of by slug.
 *
 * The chatLoop stamps the parent tool_use_id on `ctx.toolUseId` before
 * dispatching (chatLoop.ts:~635). This test asserts the tool reads it
 * off ctx and threads it into every emit + that the template slug lands
 * inside `_meta.outputTemplate`.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeComposeVisual } from '../ComposeVisualTool.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

function makeCtx(toolUseId?: string) {
  const emits: Array<{ event: string; payload: any }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) =>
        emits.push({ event, payload: payload as any }),
      logger: silentLogger,
      sessionId: 'sess-test',
      userId: 'user-test',
      ...(toolUseId ? { toolUseId } : {}),
    } as any,
  };
}

describe('compose_visual — A2 wire-stamp tool_use_id', () => {
  it('stamps tool_use_id on visual_render emit when ctx.toolUseId is set', async () => {
    const { ctx, emits } = makeCtx('toolu_123');
    const result = await executeComposeVisual(ctx, {
      template: 'bar_chart',
      title: 'My Chart',
      data: { x: ['Jan', 'Feb'], y: [10, 20] },
    } as any);
    expect(result.ok).toBe(true);
    const visualRender = emits.find((e) => e.event === 'visual_render');
    expect(visualRender).toBeDefined();
    expect(visualRender!.payload.tool_use_id).toBe('toolu_123');
  });

  it('stamps tool_use_id on streaming_table emit when template=table', async () => {
    const { ctx, emits } = makeCtx('toolu_456');
    await executeComposeVisual(ctx, {
      template: 'table',
      data: { columns: ['name'], rows: [['a']] },
      title: 'T',
    } as any);
    const streamingTable = emits.find((e) => e.event === 'streaming_table');
    expect(streamingTable).toBeDefined();
    expect(streamingTable!.payload.tool_use_id).toBe('toolu_456');
  });
});

describe('compose_visual — A3 wire-stamp _meta.outputTemplate', () => {
  it('puts the template slug inside _meta.outputTemplate on visual_render', async () => {
    const { ctx, emits } = makeCtx('toolu_a3');
    await executeComposeVisual(ctx, {
      template: 'sankey',
      title: 'Cost Flow',
      data: { flows: [{ from: 'a', to: 'b', value: 1 }] },
    } as any);
    const visualRender = emits.find((e) => e.event === 'visual_render');
    expect(visualRender).toBeDefined();
    expect(visualRender!.payload._meta).toBeDefined();
    expect(visualRender!.payload._meta.outputTemplate).toBe('sankey');
  });
});
