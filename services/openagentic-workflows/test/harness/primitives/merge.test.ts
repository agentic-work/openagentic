/**
 * merge node — RED (pins Phase B sweep failure).
 *
 * Phase B evidence: merge produces a correct labeled-object OUTPUT but
 * emits DUPLICATE node_complete frames — for a 2-edge merge the engine
 * was observed emitting arrived:1 → arrived:2 → arrived:3 → arrived:4
 * worth of completion frames (effectively 1 emit per incoming branch
 * instead of 1 emit total when the gate fully arrives).
 *
 * Contract under test:
 *   1. A merge with 2 incoming branches emits exactly ONE node_complete
 *      frame for the merge node (the gate-release emit).
 *   2. The merge output is the labeled-object that surfaces every branch
 *      result under its source-id key.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('merge node — fan-in completion semantics', () => {
  it('emits exactly once per completion when 2 branches converge', async () => {
    harnessServer.use(
      http.get('https://api.test/merge-a', () =>
        HttpResponse.json({ branch: 'a', value: 1 }),
      ),
      http.get('https://api.test/merge-b', () =>
        HttpResponse.json({ branch: 'b', value: 2 }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'par', type: 'parallel', data: {} },
          {
            id: 'branch_a',
            type: 'http_request',
            data: { url: 'https://api.test/merge-a', method: 'GET' },
          },
          {
            id: 'branch_b',
            type: 'http_request',
            data: { url: 'https://api.test/merge-b', method: 'GET' },
          },
          { id: 'merge_1', type: 'merge', data: { mergeStrategy: 'object' } },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'par' },
          { id: 'e2', source: 'par', target: 'branch_a' },
          { id: 'e3', source: 'par', target: 'branch_b' },
          { id: 'e4', source: 'branch_a', target: 'merge_1' },
          { id: 'e5', source: 'branch_b', target: 'merge_1' },
        ],
      },
      input: {},
    });

    expect(result.status).toBe('completed');

    const mergeCompletes = result.frames.filter(
      f => f.type === 'node_complete' && f.nodeId === 'merge_1',
    );
    expect(mergeCompletes).toHaveLength(1);
  });

  it('combines both branch outputs under their labeled keys', async () => {
    harnessServer.use(
      http.get('https://api.test/merge-a', () =>
        HttpResponse.json({ branch: 'a', value: 1 }),
      ),
      http.get('https://api.test/merge-b', () =>
        HttpResponse.json({ branch: 'b', value: 2 }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'par', type: 'parallel', data: {} },
          {
            id: 'branch_a',
            type: 'http_request',
            data: { url: 'https://api.test/merge-a', method: 'GET' },
          },
          {
            id: 'branch_b',
            type: 'http_request',
            data: { url: 'https://api.test/merge-b', method: 'GET' },
          },
          { id: 'merge_1', type: 'merge', data: { mergeStrategy: 'object' } },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'par' },
          { id: 'e2', source: 'par', target: 'branch_a' },
          { id: 'e3', source: 'par', target: 'branch_b' },
          { id: 'e4', source: 'branch_a', target: 'merge_1' },
          { id: 'e5', source: 'branch_b', target: 'merge_1' },
        ],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const mergeOut = result.outputs.merge_1 as Record<string, unknown>;
    expect(mergeOut).toHaveProperty('branch_a');
    expect(mergeOut).toHaveProperty('branch_b');
  });
});
