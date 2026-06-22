/**
 * RenderArtifactTool — kind-inference salvage (floor-model robustness).
 *
 * LIVE-CAPTURED DEFECT (2026-06-16, brainbow, Bedrock Opus 4.8, FORCE_RENDER_
 * ARTIFACT): on a large (~8 KB) react artifact, the model's streamed tool
 * input lost/malformed the required `kind` field. `executeRenderArtifact`
 * HARD-REJECTED (ok:false, no frame emitted). Opus self-healed by re-emitting,
 * but a weaker FLOOR model would dead-turn there — which is exactly the
 * failure class this whole inline-artifact mission exists to eliminate.
 *
 * Fix: when `kind` is missing/invalid but `content` is a non-empty string,
 * INFER the kind from the content shape (export default / import → react,
 * <svg → svg, <!doctype/<html → html, bare base64 → python_plot) and render,
 * logging a warn. Only hard-reject when content is ALSO unusable. This mirrors
 * the existing Ollama envelope-salvage philosophy, applied at the universal,
 * provider-agnostic chokepoint.
 *
 * RED FIRST: these assert the salvage BEFORE it is implemented (so they fail
 * on current main where a missing kind → ok:false).
 */
import { describe, it, expect, vi } from 'vitest';
import { executeRenderArtifact } from '../RenderArtifactTool.js';

function makeCtx(emit = vi.fn()) {
  return {
    emit,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
  } as any;
}

describe('executeRenderArtifact — kind-inference salvage (floor-model robustness)', () => {
  it('infers kind:react from `export default` component source when kind is missing', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const content =
      "import { useState } from 'react';\n" +
      'export default function Widget() {\n' +
      "  const [n, setN] = useState(0);\n" +
      "  return <div style={{ color: 'var(--cm-fg)' }}>{n}</div>;\n" +
      '}';
    // kind deliberately absent (the live failure mode).
    const result = await executeRenderArtifact(ctx, { content } as any);
    expect(result.ok).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    const [frameType, payload] = emit.mock.calls[0];
    expect(frameType).toBe('artifact_render');
    expect(payload.kind).toBe('react');
    // a warn is logged so the salvage is observable in production logs.
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('infers kind:svg from a leading <svg ...> when kind is invalid', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const content =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">' +
      '<rect width="100" height="50" fill="var(--cm-bg-2)"/></svg>';
    const result = await executeRenderArtifact(ctx, { kind: 'diagram' as any, content });
    expect(result.ok).toBe(true);
    const [, payload] = emit.mock.calls[0];
    expect(payload.kind).toBe('svg');
  });

  it('infers kind:html from a leading <!doctype html> when kind is missing', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const content = '<!doctype html><html><body><div>hi</div></body></html>';
    const result = await executeRenderArtifact(ctx, { content } as any);
    expect(result.ok).toBe(true);
    const [, payload] = emit.mock.calls[0];
    expect(payload.kind).toBe('html');
  });

  it('does NOT override an explicitly VALID kind (no false inference)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    // content LOOKS like html, but the model explicitly said svg — honor it.
    const result = await executeRenderArtifact(ctx, {
      kind: 'svg',
      content: '<svg><foreignObject><!doctype html></foreignObject></svg>',
    });
    expect(result.ok).toBe(true);
    const [, payload] = emit.mock.calls[0];
    expect(payload.kind).toBe('svg');
    // valid kind → no salvage warn.
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it('still HARD-REJECTS when content is empty (nothing to salvage)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const result = await executeRenderArtifact(ctx, { content: '' } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/content/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it('still HARD-REJECTS when kind is missing AND content is unusable (non-string)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const result = await executeRenderArtifact(ctx, { content: 12345 } as any);
    expect(result.ok).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
