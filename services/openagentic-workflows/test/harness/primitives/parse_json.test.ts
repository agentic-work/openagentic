/**
 * parse_json — Flows harness test.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('parse_json node — typed processing primitive', () => {
  it('parses a JSON string passed via {{trigger.body}}', async () => {
    const payload = { items: [1, 2, 3], status: 'ok' };
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'p1',
            type: 'parse_json',
            data: { input: '{{trigger.bodyStr}}' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: { bodyStr: JSON.stringify(payload) },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.p1 as { parsed: unknown; parseError: string | null };
    expect(out.parsed).toEqual(payload);
    expect(out.parseError).toBeNull();
  });

  it('emits node_error when JSON is malformed and onError=fail (default)', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'p1',
            type: 'parse_json',
            data: { input: '{{trigger.bodyStr}}' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: { bodyStr: '{ malformed' },
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/parse_json:/);
  });

  it('returns empty_object + parseError when onError=empty_object', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'p1',
            type: 'parse_json',
            data: { input: '{{trigger.bodyStr}}', onError: 'empty_object' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: { bodyStr: 'oops not json' },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.p1 as { parsed: unknown; parseError: string | null };
    expect(out.parsed).toEqual({});
    expect(out.parseError).toMatch(/parse_json:/);
  });
});
