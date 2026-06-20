/**
 * A2/A3 — render_artifact wire stamps tool_use_id + _meta.outputTemplate.
 *
 * the design notes
 *       §2.2.2 + §2.2.3.
 */
import { describe, it, expect } from 'vitest';
import { executeRenderArtifact } from '../RenderArtifactTool.js';

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

describe('render_artifact — A2 wire-stamp tool_use_id', () => {
  it('stamps tool_use_id on artifact_render emit when ctx.toolUseId is set', async () => {
    const { ctx, emits } = makeCtx('toolu_art1');
    const result = await executeRenderArtifact(ctx, {
      kind: 'html',
      content: '<p>ok</p>',
    } as any);
    expect(result.ok).toBe(true);
    const artifactRender = emits.find((e) => e.event === 'artifact_render');
    expect(artifactRender).toBeDefined();
    expect(artifactRender!.payload.tool_use_id).toBe('toolu_art1');
  });
});

describe('render_artifact — A3 wire-stamp _meta.outputTemplate', () => {
  it('puts the kind slug inside _meta.outputTemplate', async () => {
    const { ctx, emits } = makeCtx('toolu_art2');
    await executeRenderArtifact(ctx, {
      kind: 'svg',
      content: '<svg></svg>',
    } as any);
    const artifactRender = emits.find((e) => e.event === 'artifact_render');
    expect(artifactRender).toBeDefined();
    expect(artifactRender!.payload._meta).toBeDefined();
    expect(artifactRender!.payload._meta.outputTemplate).toBe('svg');
  });
});
