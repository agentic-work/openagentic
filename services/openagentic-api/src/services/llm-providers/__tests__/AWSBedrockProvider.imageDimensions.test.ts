/**
 * AWSBedrockProvider.resolveBedrockImageDimensions — Nova Canvas dimension
 * allow-list mapping (sev3 gap).
 *
 * Root cause: GenerateImageTool's `size` enum was copied from DALL-E
 * (`1024x1024 | 1792x1024 | 1024x1792`). `generateImage()` did
 * `(request.size||'1024x1024').split('x').map(Number)` and fed the raw
 * width/height straight into Nova Canvas's `imageGenerationConfig`. Nova
 * Canvas only accepts a fixed allow-list of width/height combinations —
 * `1792x1024` / `1024x1792` are NOT valid Nova Canvas dimensions, so Bedrock
 * returns a `ValidationException` and the image silently fails.
 *
 * The `width||1024` / `height||1024` fallbacks at the call site only mask
 * NaN; they do nothing for a numeric-but-unsupported size like 1792x1024.
 *
 * Correct behavior (pinned here): a pure resolver maps the requested size to
 * the NEAREST Nova-Canvas-valid dimension set (preserving aspect intent —
 * wide stays wide, tall stays tall), and for Stability/SD models clamps to
 * their valid range. A NaN / garbage size falls back to the square default.
 */

import { describe, test, expect } from 'vitest';
import { resolveBedrockImageDimensions } from '../AWSBedrockProvider.js';

describe('resolveBedrockImageDimensions — Nova Canvas allow-list', () => {
  const NOVA = 'amazon.nova-canvas-v1:0';

  test('square 1024x1024 passes through unchanged (it IS a valid Nova dim)', () => {
    expect(resolveBedrockImageDimensions(NOVA, '1024x1024')).toEqual({ width: 1024, height: 1024 });
  });

  test('DALL-E wide 1792x1024 is NOT a Nova-valid dim — maps to a valid WIDE preset', () => {
    const { width, height } = resolveBedrockImageDimensions(NOVA, '1792x1024');
    // The whole point: it must NOT pass 1792x1024 through (Bedrock rejects it).
    expect([width, height]).not.toEqual([1792, 1024]);
    // Must stay landscape (wider than tall) to preserve the user's aspect intent.
    expect(width).toBeGreaterThan(height);
    // Must be an actual Nova-Canvas-supported combination.
    expect(NOVA_VALID).toContainEqual([width, height]);
  });

  test('DALL-E tall 1024x1792 is NOT a Nova-valid dim — maps to a valid TALL preset', () => {
    const { width, height } = resolveBedrockImageDimensions(NOVA, '1024x1792');
    expect([width, height]).not.toEqual([1024, 1792]);
    expect(height).toBeGreaterThan(width);
    expect(NOVA_VALID).toContainEqual([width, height]);
  });

  test('undefined size falls back to the 1024x1024 square default', () => {
    expect(resolveBedrockImageDimensions(NOVA, undefined)).toEqual({ width: 1024, height: 1024 });
  });

  test('garbage/NaN size falls back to the square default (no NaN leaks)', () => {
    const r = resolveBedrockImageDimensions(NOVA, 'wide' as any);
    expect(Number.isNaN(r.width)).toBe(false);
    expect(Number.isNaN(r.height)).toBe(false);
    expect(r).toEqual({ width: 1024, height: 1024 });
    const r2 = resolveBedrockImageDimensions(NOVA, '1792' as any); // missing 'x'
    expect(Number.isNaN(r2.width)).toBe(false);
    expect(Number.isNaN(r2.height)).toBe(false);
  });

  test('every returned Nova dim is on the Nova allow-list (no arbitrary passthrough)', () => {
    for (const size of ['1024x1024', '1792x1024', '1024x1792', undefined] as const) {
      const { width, height } = resolveBedrockImageDimensions(NOVA, size);
      expect(NOVA_VALID).toContainEqual([width, height]);
    }
  });

  test('Stability/SD model clamps to a valid SDXL dim (1024x1024 default)', () => {
    const SD = 'stability.stable-diffusion-xl-v1';
    const sq = resolveBedrockImageDimensions(SD, '1024x1024');
    expect(sq).toEqual({ width: 1024, height: 1024 });
    // SDXL has its own preset list; wide should stay wide and be valid SDXL.
    const wide = resolveBedrockImageDimensions(SD, '1792x1024');
    expect(wide.width).toBeGreaterThan(wide.height);
  });
});

// Documented Nova Canvas supported dimensions (subset used by the resolver).
const NOVA_VALID: Array<[number, number]> = [
  [1024, 1024],
  [2048, 2048],
  [1280, 720],
  [1280, 768],
  [768, 1280],
  [1024, 576],
  [576, 1024],
  [1024, 768],
  [768, 1024],
];
