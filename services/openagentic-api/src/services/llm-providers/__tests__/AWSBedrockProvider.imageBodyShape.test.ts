/**
 * Image-gen GAP (sev2): the Bedrock Stability branch only emitted the
 * LEGACY SDXL wire shape `{ text_prompts, cfg_scale, steps, samples }`
 * — the shape `stability.stable-diffusion-xl-v1` expects. The currently-
 * invokable modern Stability models on Bedrock —
 *   stability.sd3-5-large-v1:0
 *   stability.stable-image-core-v1:1
 *   stability.stable-image-ultra-v1:1
 * — use a DIFFERENT request shape:
 *   { prompt, aspect_ratio, output_format, mode, seed }
 * and return `{ images: [base64], seeds, finish_reasons }`.
 *
 * Sending the legacy `text_prompts/cfg_scale/steps` body to a modern
 * model → 400 ValidationException → generate_image silently fails.
 *
 * Legacy SDXL is being retired on Bedrock, so the default modern model
 * is the only thing that actually works today.
 *
 * Contract pinned here (pure body builder, no SDK instantiation):
 *  - modern Stability families → { prompt, aspect_ratio, output_format:'png',
 *    mode:'text-to-image' } with aspect_ratio derived from size, and
 *    NO text_prompts/cfg_scale/steps keys.
 *  - legacy stable-diffusion-xl → unchanged SDXL shape.
 *  - Amazon Nova/Titan → unchanged taskType:TEXT_IMAGE shape.
 */
import { describe, it, expect } from 'vitest';
import { buildBedrockImageBody } from '../AWSBedrockProvider.js';

describe('buildBedrockImageBody — modern vs legacy Stability wire shape', () => {
  it('modern stability.sd3-5-large uses {prompt, aspect_ratio, output_format, mode} — NOT legacy text_prompts', () => {
    const body = buildBedrockImageBody('stability.sd3-5-large-v1:0', {
      prompt: 'a red fox in snow',
      size: '1024x1024',
    });

    // modern shape keys present
    expect(body.prompt).toBe('a red fox in snow');
    expect(body.aspect_ratio).toBe('1:1');
    expect(body.output_format).toBe('png');
    expect(body.mode).toBe('text-to-image');

    // legacy SDXL keys MUST be absent (those cause 400 ValidationException)
    expect(body.text_prompts).toBeUndefined();
    expect(body.cfg_scale).toBeUndefined();
    expect(body.steps).toBeUndefined();
    expect(body.samples).toBeUndefined();
  });

  it('modern stable-image-core/ultra also use the modern shape', () => {
    for (const model of ['stability.stable-image-core-v1:1', 'stability.stable-image-ultra-v1:1']) {
      const body = buildBedrockImageBody(model, { prompt: 'p', size: '1024x1024' });
      expect(body.prompt).toBe('p');
      expect(body.mode).toBe('text-to-image');
      expect(body.text_prompts).toBeUndefined();
    }
  });

  it('derives aspect_ratio from size', () => {
    expect(buildBedrockImageBody('stability.sd3-5-large-v1:0', { prompt: 'p', size: '1792x1024' }).aspect_ratio).toBe('16:9');
    expect(buildBedrockImageBody('stability.sd3-5-large-v1:0', { prompt: 'p', size: '1024x1792' }).aspect_ratio).toBe('9:16');
    expect(buildBedrockImageBody('stability.sd3-5-large-v1:0', { prompt: 'p' }).aspect_ratio).toBe('1:1');
  });

  it('legacy stable-diffusion-xl keeps the SDXL text_prompts shape', () => {
    const body = buildBedrockImageBody('stability.stable-diffusion-xl-v1', {
      prompt: 'legacy prompt',
      size: '1024x1024',
    });
    expect(body.text_prompts).toEqual([{ text: 'legacy prompt', weight: 1.0 }]);
    // RECONCILED (2026-06-17): cfg_scale is no longer a fixed 7 — it is derived
    // from the style hint (styleToCfgScale). With no style passed it is the
    // Bedrock default 6.5. The vivid>natural style relationship is pinned in
    // bedrockImageBody.test.ts. cfg_scale must still be a valid SDXL guidance number.
    expect(body.cfg_scale).toBe(6.5);
    expect(body.steps).toBe(50);
    // modern keys must NOT leak into the legacy body
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.mode).toBeUndefined();
  });

  it('Amazon Nova/Titan keeps the taskType:TEXT_IMAGE shape', () => {
    const body = buildBedrockImageBody('amazon.nova-canvas-v1:0', {
      prompt: 'nova prompt',
      size: '1024x1024',
    });
    expect(body.taskType).toBe('TEXT_IMAGE');
    expect((body.textToImageParams as any).text).toBe('nova prompt');
    expect(body.text_prompts).toBeUndefined();
    expect(body.prompt).toBeUndefined();
  });
});
