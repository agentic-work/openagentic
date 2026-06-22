/**
 * generate_image registry presence — the chat tool catalog MUST expose a
 * real image-generation tool so the model dispatches `generate_image`
 * instead of fabricating an `<img src="https://unsplash...">` tag.
 *
 * Regression: `generate_image` was deleted with the legacy ChatPipeline.ts
 * in the #741 chatmode rip and never re-added to the new pipeline. This pins
 * its re-addition next to the other always-available meta-tools.
 */
import { describe, it, expect } from 'vitest';
import { getAllBaseTools } from '../toolRegistry.js';

describe('getAllBaseTools — generate_image meta-tool present', () => {
  it('includes a tool whose function.name === "generate_image"', () => {
    const tools = getAllBaseTools();
    const names = tools.map((t) => t?.function?.name);
    expect(names).toContain('generate_image');
  });

  it('the generate_image entry has the OpenAI tool envelope shape', () => {
    const tools = getAllBaseTools();
    const gen = tools.find((t) => t?.function?.name === 'generate_image');
    expect(gen).toBeDefined();
    expect(gen!.type).toBe('function');
    expect(typeof gen!.function?.description).toBe('string');
    expect(gen!.function?.parameters?.required).toContain('prompt');
  });
});
