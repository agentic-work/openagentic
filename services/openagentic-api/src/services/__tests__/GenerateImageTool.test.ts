/**
 * GenerateImageTool — T1 meta-tool surface for real image generation.
 *
 * Root cause (regression): a user added an image-generation model
 * (`amazon.nova-canvas-v1:0`, role `image-generation`, the imageGen default)
 * and asked chat "create an image of a man on a computer". The model
 * produced a hallucinated `<img src="https://source.unsplash.com/...">` tag
 * instead of a real generated image, because the chat tool catalog had NO
 * image-generation tool — `generate_image` was deleted with the legacy
 * `ChatPipeline.ts` in the #741 chatmode rip and never re-added.
 *
 * This tool mirrors ComposeAppTool: a pure tool def + alias matcher + a
 * DI-testable handler that emits an `image_render` frame the UI renders
 * inline (the same way compose_app emits `app_render`).
 *
 * Trust rule: the handler NEVER satisfies an image request with an external
 * `<img>` URL. On provider error it returns { ok:false } and emits NO frame.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  GENERATE_IMAGE_TOOL,
  isGenerateImageTool,
  executeGenerateImage,
  type GenerateImageInput,
  type GenerateImageDeps,
} from '../GenerateImageTool.js';

function makeCtx() {
  const emits: Array<{ event: string; payload: any }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) => emits.push({ event, payload }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sessionId: 'test-session',
      userId: 'test-user',
      toolUseId: 'toolu_abc123',
    },
  };
}

describe('isGenerateImageTool', () => {
  test('matches canonical name + camelCase alias', () => {
    expect(isGenerateImageTool('generate_image')).toBe(true);
    expect(isGenerateImageTool('generateImage')).toBe(true);
  });

  test('rejects non-image tool names + empty', () => {
    expect(isGenerateImageTool('compose_app')).toBe(false);
    expect(isGenerateImageTool('')).toBe(false);
    expect(isGenerateImageTool('image_render')).toBe(false);
  });
});

describe('GENERATE_IMAGE_TOOL definition', () => {
  test('tool name is generate_image and prompt is required', () => {
    expect(GENERATE_IMAGE_TOOL.function.name).toBe('generate_image');
    expect(GENERATE_IMAGE_TOOL.function.parameters.required).toContain('prompt');
    expect(GENERATE_IMAGE_TOOL.function.parameters.properties).toHaveProperty('prompt');
    expect(GENERATE_IMAGE_TOOL.function.parameters.properties).toHaveProperty('size');
    expect(GENERATE_IMAGE_TOOL.function.parameters.properties).toHaveProperty('style');
  });

  test('description forbids external <img> URL fabrication', () => {
    const d = GENERATE_IMAGE_TOOL.function.description.toLowerCase();
    // anti-fabrication clause must be present so the model never emits an
    // <img src="https://unsplash..."> tag instead of calling this tool.
    expect(d).toContain('<img');
    expect(d).toContain('unsplash');
    expect(d).toMatch(/never|do not|don't/);
  });
});

describe('executeGenerateImage', () => {
  test('emits an image_render frame with image_url + prompt + model on success', async () => {
    const { ctx, emits } = makeCtx();
    const deps: GenerateImageDeps = {
      generateImage: vi.fn(async (prompt: string) => ({
        image_url: '/api/images/img_fake123.png',
        artifact_id: 'img_fake123',
        model: 'amazon.nova-canvas-v1:0',
        provider: 'aws-bedrock',
        format: 'png' as const,
        revisedPrompt: prompt,
      })),
    };

    const input: GenerateImageInput = {
      prompt: 'a man on a computer',
      size: '1024x1024',
    };

    const result = await executeGenerateImage(ctx, input, deps);

    expect(result.ok).toBe(true);
    expect((result as any).artifact_id).toBe('img_fake123');
    expect(deps.generateImage).toHaveBeenCalledOnce();

    const frame = emits.find((e) => e.event === 'image_render');
    expect(frame).toBeDefined();
    expect(frame!.payload.image_url).toBe('/api/images/img_fake123.png');
    expect(frame!.payload.prompt).toBe('a man on a computer');
    expect(frame!.payload.model).toBe('amazon.nova-canvas-v1:0');
    expect(frame!.payload.provider).toBe('aws-bedrock');
    expect(frame!.payload.tool_use_id).toBe('toolu_abc123');
    expect(frame!.payload._meta?.outputTemplate).toBe('image_render');
    // NEVER an external host in the rendered url.
    expect(String(frame!.payload.image_url)).not.toMatch(/^https?:\/\//);
  });

  test('result.output is a natural-language string containing the image url + artifact id so the model can narrate it (#1083 follow-up)', async () => {
    // Live regression in the dev environment 2026-05-24: Vertex Imagen 3 succeeded
    // end-to-end (UI rendered the 1024x1024 image via image_render frame),
    // but the model's prose said "platform didn't provide an artifact ID or
    // URL" because result.output was the literal string "image generated".
    // The model uses the tool_result.output string to narrate the result;
    // it does NOT introspect the parallel NDJSON image_render frame. The
    // output MUST mention both the artifact id and the same-origin URL so
    // the model knows the image was actually rendered.
    const { ctx } = makeCtx();
    const deps: GenerateImageDeps = {
      generateImage: vi.fn(async () => ({
        image_url: '/api/images/img_real_xyz.png',
        artifact_id: 'img_real_xyz',
        model: 'imagen-3.0-generate-001',
        provider: 'vertex-dev-openagentic-example-us-central1',
        format: 'png' as const,
      })),
    };
    const result = await executeGenerateImage(
      ctx,
      { prompt: 'pixel-art man at a CRT' },
      deps,
    );
    expect(result.ok).toBe(true);
    const out = String((result as any).output ?? '');
    expect(out).toContain('img_real_xyz');
    expect(out).toContain('/api/images/img_real_xyz.png');
    // Must NOT be the unhelpful literal "image generated" that the regression
    // shipped with.
    expect(out).not.toBe('image generated');
    // Must signal success unambiguously so the model doesn't apologize.
    expect(out).toMatch(/success|generated|rendered/i);
  });

  test('rejects empty prompt without calling the provider', async () => {
    const { ctx, emits } = makeCtx();
    const deps: GenerateImageDeps = { generateImage: vi.fn() };
    const result = await executeGenerateImage(ctx, { prompt: '' } as GenerateImageInput, deps);
    expect(result.ok).toBe(false);
    expect(deps.generateImage).not.toHaveBeenCalled();
    expect(emits.find((e) => e.event === 'image_render')).toBeUndefined();
  });

  test('on provider error returns {ok:false}, emits NO image_render and NO external <img>', async () => {
    const { ctx, emits } = makeCtx();
    const deps: GenerateImageDeps = {
      generateImage: vi.fn(async () => {
        throw new Error('Nova Canvas unavailable');
      }),
    };

    const result = await executeGenerateImage(
      ctx,
      { prompt: 'a man on a computer' },
      deps,
    );

    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/Nova Canvas unavailable/);
    // No frame emitted at all — the model gets the error as a tool result and
    // must NOT fall back to fabricating an external image URL.
    expect(emits.find((e) => e.event === 'image_render')).toBeUndefined();
    for (const e of emits) {
      expect(JSON.stringify(e.payload)).not.toMatch(/unsplash|<img/i);
    }
  });
});
