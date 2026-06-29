/**
 * loop node — RED (pins Phase B sweep failure).
 *
 * Phase B evidence: feeding `input.items = ["alpha","beta","gamma"]`
 * resulted in `iterations.length === 1` because the loop executor's
 * iterateOver branch failed to receive an array — the resolved value
 * dropped to the string-fallback path (`'[loop] iterateOver value was
 * not valid JSON, split into lines'` in api logs).
 *
 * Contract under test: when iterateOver points at an upstream array,
 * the loop emits one iteration per element of that array. Three-element
 * input must yield three iterations.
 *
 * The second test guards the empty-array edge: zero items should
 * complete cleanly with iterations.length === 0 (or zero downstream
 * executions, however the schema chooses to encode it) — not crash and
 * not silently degrade to a singleton iteration.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('loop node — array iteration', () => {
  it('iterates each element of an input array', async () => {
    harnessServer.use(
      http.get('https://api.test/loop-item', () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'loop', type: 'loop', data: { iterateOver: 'input.items' } },
          {
            id: 'each',
            type: 'http_request',
            data: { url: 'https://api.test/loop-item', method: 'GET' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'loop' },
          { id: 'e2', source: 'loop', target: 'each' },
        ],
      },
      input: { items: ['alpha', 'beta', 'gamma'] },
    });

    expect(result.status).toBe('completed');
    const loopOut = result.outputs.loop as { iterations?: unknown[]; itemCount?: number };
    expect(loopOut.iterations).toBeDefined();
    expect(loopOut.iterations).toHaveLength(3);
    expect(loopOut.itemCount).toBe(3);
  });

  it('handles empty array gracefully with zero iterations', async () => {
    harnessServer.use(
      http.get('https://api.test/loop-item', () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'loop', type: 'loop', data: { iterateOver: 'input.items' } },
          {
            id: 'each',
            type: 'http_request',
            data: { url: 'https://api.test/loop-item', method: 'GET' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'loop' },
          { id: 'e2', source: 'loop', target: 'each' },
        ],
      },
      input: { items: [] },
    });

    expect(result.status).toBe('completed');
    const loopOut = result.outputs.loop as { iterations?: unknown[]; itemCount?: number };
    expect(loopOut.itemCount).toBe(0);
    expect(loopOut.iterations).toHaveLength(0);
    // The downstream node must not have executed since there were no items.
    expect(result.outputs.each).toBeUndefined();
  });
});
