/**
 * RenderArtifactTool — TDD for the structured artifact-emission tool.
 *
 * REPLACES the regex-based `stripUnsolicitedArtifactFences` middleware.
 * Visual artifacts arrive as structured `tool_use` calls, not embedded
 * text fences. The model emits one `render_artifact` tool call per
 * artifact it wants to show; the api emits a single NDJSON
 * `artifact_render` frame; the UI mounts the renderer off the structured
 * payload (no fence parsing, anywhere).
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md
 */
import { describe, it, expect, vi } from 'vitest';
import {
  RENDER_ARTIFACT_TOOL,
  RENDER_ARTIFACT_KINDS,
  executeRenderArtifact,
  isRenderArtifactTool,
  type RenderArtifactInput,
} from '../RenderArtifactTool.js';

describe('RENDER_ARTIFACT_TOOL — schema shape', () => {
  it('is a valid OpenAI/Anthropic function-tool definition', () => {
    expect(RENDER_ARTIFACT_TOOL.type).toBe('function');
    expect(RENDER_ARTIFACT_TOOL.function.name).toBe('render_artifact');
    expect(typeof RENDER_ARTIFACT_TOOL.function.description).toBe('string');
    expect(RENDER_ARTIFACT_TOOL.function.parameters.type).toBe('object');
  });

  it('description is at least 200 chars (Anthropic encyclopedia-article rubric)', () => {
    expect(RENDER_ARTIFACT_TOOL.function.description.length).toBeGreaterThanOrEqual(200);
  });

  it('description mentions when to use AND when not to use (Anthropic rubric)', () => {
    const desc = RENDER_ARTIFACT_TOOL.function.description.toLowerCase();
    expect(desc).toMatch(/use when|when to use/);
    expect(desc).toMatch(/do not use|don't use|when not to use/);
  });

  it('exposes the four canonical artifact kinds (mermaid moved to compose_visual)', () => {
    // Per RenderArtifactTool.ts:28-33 and the source description: mermaid was
    // moved to `compose_visual.template = 'mermaid'` so the model picks ONE
    // canonical path for diagram authoring. render_artifact is the escape
    // hatch for raw html / svg / react / python_plot only.
    expect(RENDER_ARTIFACT_KINDS).toEqual([
      'html',
      'svg',
      'react',
      'python_plot',
    ]);
  });

  it('schema enum matches RENDER_ARTIFACT_KINDS exactly', () => {
    const params = RENDER_ARTIFACT_TOOL.function.parameters as any;
    expect(params.properties.kind.enum).toEqual(RENDER_ARTIFACT_KINDS);
  });

  it('requires kind + content; title and group_id are optional', () => {
    const params = RENDER_ARTIFACT_TOOL.function.parameters as any;
    expect(params.required).toEqual(['kind', 'content']);
    expect(params.properties.title).toBeDefined();
    expect(params.properties.group_id).toBeDefined();
    expect(params.properties.placement).toBeDefined();
  });
});

describe('isRenderArtifactTool — name match (with aliases)', () => {
  it('matches the canonical name', () => {
    expect(isRenderArtifactTool('render_artifact')).toBe(true);
  });

  it('matches common model-emitted variants without regex on user content', () => {
    // Common variants we've observed gpt-oss + gemini emit; these are exact
    // string compares against a tiny allow-list, NOT regex on user message.
    expect(isRenderArtifactTool('renderArtifact')).toBe(true);
    expect(isRenderArtifactTool('RenderArtifact')).toBe(true);
    expect(isRenderArtifactTool('render-artifact')).toBe(true);
  });

  it('rejects unrelated tool names', () => {
    expect(isRenderArtifactTool('bash')).toBe(false);
    expect(isRenderArtifactTool('delegate_to_agents')).toBe(false);
    expect(isRenderArtifactTool('artifact_creation')).toBe(false);
    expect(isRenderArtifactTool('')).toBe(false);
  });
});

describe('executeRenderArtifact — emits NDJSON frame, returns tool result', () => {
  function makeCtx(emit = vi.fn()) {
    return {
      emit,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 'sess-test',
      userId: 'user-test',
    } as any;
  }

  it('emits a single artifact_render NDJSON frame with all the input fields', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    // Use 'html' (canonical escape-hatch kind) — mermaid was removed in favor
    // of `compose_visual.template = 'mermaid'`.
    const input: RenderArtifactInput = {
      kind: 'html',
      content: '<!doctype html><html><body><div id="x">cost flow</div></body></html>',
      title: 'cost flow',
      group_id: 'cost-sankey-1',
    };

    const result = await executeRenderArtifact(ctx, input);

    expect(emit).toHaveBeenCalledTimes(1);
    const [frameType, payload] = emit.mock.calls[0];
    expect(frameType).toBe('artifact_render');
    expect(payload).toMatchObject({
      kind: 'html',
      content: input.content,
      title: 'cost flow',
      group_id: 'cost-sankey-1',
    });
    expect(typeof payload.artifact_id).toBe('string');
    expect(payload.artifact_id.length).toBeGreaterThan(0);
    // The handler returns a tool-result that the model can read back —
    // confirms which artifact was emitted so the model can reference it.
    expect(result.ok).toBe(true);
    expect(result.artifact_id).toBe(payload.artifact_id);
  });

  it('rejects unknown kinds with a structured tool error (no throw)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const result = await executeRenderArtifact(ctx, {
      kind: 'docx' as any,
      content: '<x/>',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/kind/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it('rejects empty content with a structured tool error (no throw)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const result = await executeRenderArtifact(ctx, {
      kind: 'svg',
      content: '',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/content/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it('reuses group_id across hot-swaps so the UI replaces in place', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    await executeRenderArtifact(ctx, {
      kind: 'svg',
      content: '<svg width="10"/>',
      group_id: 'logo-v1',
    });
    await executeRenderArtifact(ctx, {
      kind: 'svg',
      content: '<svg width="20"/>',
      group_id: 'logo-v1',
    });
    expect(emit).toHaveBeenCalledTimes(2);
    const [, p1] = emit.mock.calls[0];
    const [, p2] = emit.mock.calls[1];
    expect(p1.group_id).toBe('logo-v1');
    expect(p2.group_id).toBe('logo-v1');
    // Each call gets its own artifact_id (the UI uses group_id for swap).
    expect(p1.artifact_id).not.toBe(p2.artifact_id);
  });

  it('does NOT post-process content (no regex strip, no fence parsing)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    // Content that contains a fenced block in TEXT — model literally sent
    // this as part of a `kind: 'html'` artifact body.
    const html = '<pre>```mermaid\ngraph TD; A-->B\n```</pre>';
    await executeRenderArtifact(ctx, { kind: 'html', content: html });
    const [, payload] = emit.mock.calls[0];
    // Crucial: the body MUST be preserved verbatim. The strip middleware
    // we're replacing would have mangled this.
    expect(payload.content).toBe(html);
  });

  it('logs at info level once per emission (audit trail)', async () => {
    const ctx = makeCtx();
    await executeRenderArtifact(ctx, { kind: 'svg', content: '<svg/>' });
    expect(ctx.logger.info).toHaveBeenCalledTimes(1);
  });
});
