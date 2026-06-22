/**
 * applyCanonicalFrame — image_render fold (generate_image).
 *
 * Regression: without an image-generation tool the model fabricated
 * `<img src="https://unsplash...">` tags. generate_image now emits an
 * `image_render` frame; this reducer folds it into a typed `image_render`
 * ContentBlock that AgenticActivityStream renders inline.
 *
 * Defensive contract: a frame whose `image_url` is an external host is
 * DROPPED — the reducer never produces a block pointing off-platform.
 */
import { describe, it, expect } from 'vitest';
import { applyCanonicalFrame, initialFrameState } from '../applyCanonicalFrame.js';

describe('applyCanonicalFrame — image_render', () => {
  it('folds an image_render frame into an image_render content block', () => {
    let state = initialFrameState();
    state = applyCanonicalFrame(state, {
      type: 'image_render',
      artifact_id: 'img_abc',
      image_url: '/api/images/img_abc.png',
      prompt: 'a man on a computer',
      model: 'amazon.nova-canvas-v1:0',
      provider: 'aws-bedrock',
      format: 'png',
    });

    const block = state.contentBlocks.find((b) => b.type === 'image_render');
    expect(block).toBeDefined();
    expect(block!.imageUrl).toBe('/api/images/img_abc.png');
    expect(block!.prompt).toBe('a man on a computer');
    expect(block!.model).toBe('amazon.nova-canvas-v1:0');
    expect(block!.provider).toBe('aws-bedrock');
    expect(block!.isComplete).toBe(true);
  });

  it('drops an image_render frame pointing at an external host', () => {
    let state = initialFrameState();
    state = applyCanonicalFrame(state, {
      type: 'image_render',
      artifact_id: 'img_evil',
      image_url: 'https://source.unsplash.com/random',
      prompt: 'a man on a computer',
    });
    expect(state.contentBlocks.some((b) => b.type === 'image_render')).toBe(false);
  });

  it('drops an image_render frame with no url / id', () => {
    let state = initialFrameState();
    state = applyCanonicalFrame(state, { type: 'image_render', artifact_id: '', image_url: '' });
    expect(state.contentBlocks.some((b) => b.type === 'image_render')).toBe(false);
  });
});
