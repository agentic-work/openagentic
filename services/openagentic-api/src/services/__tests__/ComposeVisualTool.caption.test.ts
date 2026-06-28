/**
 * #816 — compose_visual exposes an optional `caption` string the model can
 * use to add a prose explainer that renders under the visualization. This
 * is the missing "story" beat from the mock-16 anatomy where every .viz
 * has a head + body + caption directly below.
 */
import { describe, test, expect } from 'vitest';
import { COMPOSE_VISUAL_TOOL } from '../ComposeVisualTool.js';

describe('#816 compose_visual caption field', () => {
  test('schema exposes optional caption with description telling the model what to put there', () => {
    const props = (COMPOSE_VISUAL_TOOL.function.parameters as { properties: Record<string, { type?: string; description?: string }> }).properties;
    expect(props.caption).toBeDefined();
    expect(props.caption.type).toBe('string');
    expect(typeof props.caption.description).toBe('string');
    // Description must reference the actual UX purpose so the model knows
    // when to populate it.
    expect(props.caption.description!.toLowerCase()).toContain('caption');
  });

  test('caption is NOT in required list (always optional)', () => {
    const required = (COMPOSE_VISUAL_TOOL.function.parameters as { required: string[] }).required;
    expect(required).not.toContain('caption');
  });

  test('description body mentions caption so the model knows the field exists', () => {
    const desc = COMPOSE_VISUAL_TOOL.function.description as string;
    expect(desc.toLowerCase()).toMatch(/caption/);
  });
});
