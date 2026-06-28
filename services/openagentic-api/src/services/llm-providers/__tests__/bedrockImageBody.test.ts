/**
 * Nova Canvas / Titan Image body shape — cfgScale + style mapping.
 *
 * Bug (sev3): the Amazon TEXT_IMAGE body set numberOfImages/quality/
 * width/height but OMITTED cfgScale, so prompt-adherence was not
 * controllable and the GenerateImageInput.style hint (vivid|natural)
 * was dropped entirely — it mapped to NO Bedrock param. Bedrock applies
 * a default cfgScale (~6.5) so generation still works, but the user's
 * style enum was a no-op.
 *
 * Contract: the Amazon body MUST include imageGenerationConfig.cfgScale,
 * and the style hint MUST map — vivid → higher cfgScale (stronger
 * prompt adherence), natural → lower cfgScale (looser/photoreal). The
 * Stability (text_prompts) body already carries cfg_scale; assert it
 * also honors the style hint rather than a fixed 7.
 *
 * Pure body-builder is exported from AWSBedrockProvider so this can be
 * tested without instantiating the provider or mocking the Bedrock
 * runtime client (same pattern as the exported normalizer).
 *
 * RECONCILED SIGNATURE (2026-06-17): buildBedrockImageBody(model, request)
 * where request is an ImageGenerationRequest ({ prompt, size, style, n }).
 * Dimensions are no longer passed as raw width/height — the builder resolves
 * a model-valid (width, height) from request.size via
 * resolveBedrockImageDimensions, so a DALL-E size like 1792x1024 maps to the
 * nearest Nova-Canvas-valid WIDE preset (it does NOT pass 1792x1024 through —
 * Bedrock would reject that).
 */
import { describe, it, expect } from 'vitest';
import { buildBedrockImageBody } from '../AWSBedrockProvider.js';

describe('buildBedrockImageBody — Amazon Nova Canvas / Titan TEXT_IMAGE', () => {
  it('includes cfgScale in imageGenerationConfig (was omitted → relied on Bedrock default)', () => {
    const body = buildBedrockImageBody('amazon.nova-canvas-v1:0', {
      prompt: 'a red bicycle',
      size: '1024x1024',
      n: 1,
    }) as any;

    expect(body.taskType).toBe('TEXT_IMAGE');
    expect(body.imageGenerationConfig).toBeDefined();
    expect(typeof body.imageGenerationConfig.cfgScale).toBe('number');
    // Nova Canvas accepts cfgScale 1.1–10.
    expect(body.imageGenerationConfig.cfgScale).toBeGreaterThanOrEqual(1.1);
    expect(body.imageGenerationConfig.cfgScale).toBeLessThanOrEqual(10);
  });

  it('maps style=vivid to a HIGHER cfgScale than style=natural', () => {
    const vivid = buildBedrockImageBody('amazon.nova-canvas-v1:0', {
      prompt: 'a city skyline',
      size: '1024x1024',
      n: 1,
      style: 'vivid',
    }) as any;
    const natural = buildBedrockImageBody('amazon.nova-canvas-v1:0', {
      prompt: 'a city skyline',
      size: '1024x1024',
      n: 1,
      style: 'natural',
    }) as any;

    expect(vivid.imageGenerationConfig.cfgScale).toBeGreaterThan(
      natural.imageGenerationConfig.cfgScale,
    );
  });

  it('preserves the existing Amazon fields (numberOfImages/quality/prompt) + resolves a VALID wide dim', () => {
    const body = buildBedrockImageBody('amazon.titan-image-generator-v1', {
      prompt: 'a mountain lake',
      size: '1792x1024',
      n: 2,
      style: 'natural',
    }) as any;

    expect(body.textToImageParams.text).toBe('a mountain lake');
    expect(body.imageGenerationConfig.numberOfImages).toBe(2);
    expect(body.imageGenerationConfig.quality).toBe('standard');
    // RECONCILED: 1792x1024 is NOT a Nova/Titan-valid dim, so the builder maps
    // it to the nearest valid WIDE preset (width > height), never 1792x1024.
    expect(body.imageGenerationConfig.width).toBeGreaterThan(body.imageGenerationConfig.height);
    expect([body.imageGenerationConfig.width, body.imageGenerationConfig.height]).not.toEqual([
      1792, 1024,
    ]);
  });
});

describe('buildBedrockImageBody — Stability text_prompts (legacy SDXL)', () => {
  it('honors the style hint on cfg_scale (vivid > natural) instead of a fixed value', () => {
    const vivid = buildBedrockImageBody('stability.stable-diffusion-xl-v1', {
      prompt: 'a forest path',
      size: '1024x1024',
      n: 1,
      style: 'vivid',
    }) as any;
    const natural = buildBedrockImageBody('stability.stable-diffusion-xl-v1', {
      prompt: 'a forest path',
      size: '1024x1024',
      n: 1,
      style: 'natural',
    }) as any;

    expect(Array.isArray(vivid.text_prompts)).toBe(true);
    expect(vivid.text_prompts[0].text).toBe('a forest path');
    expect(typeof vivid.cfg_scale).toBe('number');
    expect(vivid.cfg_scale).toBeGreaterThan(natural.cfg_scale);
  });
});
