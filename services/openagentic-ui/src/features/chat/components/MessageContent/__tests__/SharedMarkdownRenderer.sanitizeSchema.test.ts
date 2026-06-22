/**
 * Regression: the generate_image tool's base64 fallback path emits
 * `![Generated Image](data:image/png;base64,...)` when MinIO storage
 * fails. Before this fix, the sanitize schema only added `image` to
 * src protocols — rehype-sanitize's default schema disallows `data:`
 * URIs, so the base64 image src got stripped, the <img> tag became
 * invalid, and the rendered DOM collapsed to an empty <p></p>.
 *
 * Contract: the `src` protocols list must include both `image` (for
 * Milvus-stored images) AND `data` (for inline base64 fallback),
 * on top of the defaults (http/https).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeSchema } from '../SharedMarkdownRenderer';

describe('SharedMarkdownRenderer sanitizeSchema', () => {
  it('allows `image` protocol for Milvus-stored images (image://...)', () => {
    expect(sanitizeSchema.protocols?.src).toContain('image');
  });

  it('allows `data` protocol for inline base64 images (data:image/png;base64,...)', () => {
    expect(sanitizeSchema.protocols?.src).toContain('data');
  });

  it('preserves default http/https protocols for regular images', () => {
    expect(sanitizeSchema.protocols?.src).toContain('http');
    expect(sanitizeSchema.protocols?.src).toContain('https');
  });

  it('allows KaTeX math tags (math, mrow, mi, etc.)', () => {
    expect(sanitizeSchema.tagNames).toContain('math');
    expect(sanitizeSchema.tagNames).toContain('mrow');
    expect(sanitizeSchema.tagNames).toContain('mfrac');
  });

  it('allows className + style on all elements (for inline theming)', () => {
    const starAttrs = sanitizeSchema.attributes?.['*'] || [];
    expect(starAttrs).toContain('className');
    expect(starAttrs).toContain('style');
  });
});
