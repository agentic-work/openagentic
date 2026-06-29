/**
 * AzureAIFoundryProvider.normalizeAifToolParameters — TDD coverage for the
 * tool-parameter schema normalizer.
 *
 * 2026-05-05 repro: codemode → /v1/messages → Azure AIF gpt-5.4 returned
 *   "Invalid schema for function 'TailServeLog': schema must be a JSON
 *    Schema of 'type: \"object\"', got 'type: \"None\"'."
 * Root cause: openagentic's TailServeLogTool uses zod discriminatedUnion
 * which serializes to `{anyOf:[obj,obj]}` with no top-level `type`. The
 * Chat Completions path (line ~1531) forwarded params as-is. Azure
 * rejected the whole tool array → no model response.
 *
 * The Responses-API path (line ~2129) had an inline normalizer; this
 * test pins the hoisted/shared `normalizeAifToolParameters` so BOTH
 * code paths can apply the same fix.
 */

import { describe, it, expect } from 'vitest';
import { normalizeAifToolParameters } from '../AzureAIFoundryProvider.js';

describe('normalizeAifToolParameters', () => {
  it('coerces a missing top-level type to "object"', () => {
    const out = normalizeAifToolParameters({ properties: { x: { type: 'string' } } });
    expect(out.type).toBe('object');
    expect(out.properties).toEqual({ x: { type: 'string' } });
  });

  it('strips top-level anyOf and forces type:"object" (the TailServeLog case)', () => {
    // What zodToJsonSchema produces for `z.discriminatedUnion('action', [...])`
    const raw = {
      anyOf: [
        { type: 'object', properties: { action: { const: 'tail' }, id: { type: 'string' } } },
        { type: 'object', properties: { action: { const: 'list' } } },
      ],
    };
    const out = normalizeAifToolParameters(raw);
    expect(out.type).toBe('object');
    expect(out).not.toHaveProperty('anyOf');
    expect(out).toHaveProperty('properties');
  });

  it('strips top-level oneOf, allOf, enum, not — none survive', () => {
    const raw = {
      oneOf: [{}],
      allOf: [{}],
      enum: ['a', 'b'],
      not: {},
      properties: { y: { type: 'number' } },
    };
    const out = normalizeAifToolParameters(raw);
    expect(out).not.toHaveProperty('oneOf');
    expect(out).not.toHaveProperty('allOf');
    expect(out).not.toHaveProperty('enum');
    expect(out).not.toHaveProperty('not');
    expect(out.type).toBe('object');
    expect(out.properties).toEqual({ y: { type: 'number' } });
  });

  it('returns a safe empty schema for null / undefined / non-object parameters', () => {
    for (const bad of [null, undefined, 42, 'string', [1, 2]]) {
      const out = normalizeAifToolParameters(bad);
      expect(out.type).toBe('object');
      expect(out.properties).toEqual({});
      expect(out.additionalProperties).toBe(false);
    }
  });

  it('wraps top-level type:"string"/"array" as a single "value" property', () => {
    const stringy = normalizeAifToolParameters({ type: 'string' });
    expect(stringy.type).toBe('object');
    expect((stringy.properties as any).value).toEqual({ type: 'string' });
    expect(stringy.required).toEqual(['value']);
  });

  it('preserves a fully-formed object schema unchanged in spirit', () => {
    const raw = {
      type: 'object',
      properties: { path: { type: 'string' }, depth: { type: 'integer', default: 1 } },
      required: ['path'],
    };
    const out = normalizeAifToolParameters(raw);
    expect(out.type).toBe('object');
    expect(out.properties).toEqual(raw.properties);
    expect(out.required).toEqual(['path']);
  });

  it('falls back to empty properties when properties is missing', () => {
    const out = normalizeAifToolParameters({ type: 'object' });
    expect(out.properties).toEqual({});
  });
});
