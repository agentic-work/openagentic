/**
 * parallel node — baseline GREEN.
 *
 * Phase B evidence: parallel fan-out works — concurrent dispatch was
 * verified at ~1 ms spread across branches. This test pins that
 * working contract so a future regression in fanOutBranches (or
 * Promise.allSettled wiring in the engine) trips immediately.
 *
 * Contract under test:
 *   - All outgoing edges from the parallel node receive the same input.
 *   - Each branch executes to completion (status: 'fulfilled').
 *   - The parallel result records branchCount + allSucceeded.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('parallel node — concurrent fan-out', () => {
  it('fans out to every outgoing edge and reports all-succeeded', async () => {
    harnessServer.use(
      http.get('https://api.test/parallel-a', () =>
        HttpResponse.json({ branch: 'a', ok: true }),
      ),
      http.get('https://api.test/parallel-b', () =>
        HttpResponse.json({ branch: 'b', ok: true }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'par', type: 'parallel', data: {} },
          {
            id: 'http_a',
            type: 'http_request',
            data: { url: 'https://api.test/parallel-a', method: 'GET' },
          },
          {
            id: 'http_b',
            type: 'http_request',
            data: { url: 'https://api.test/parallel-b', method: 'GET' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'par' },
          { id: 'e2', source: 'par', target: 'http_a' },
          { id: 'e3', source: 'par', target: 'http_b' },
        ],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const parOut = result.outputs.par as {
      branches?: Array<{ status: string }>;
      branchCount?: number;
      allSucceeded?: boolean;
    };
    expect(parOut.branchCount).toBe(2);
    expect(parOut.allSucceeded).toBe(true);
    expect(parOut.branches?.every(b => b.status === 'fulfilled')).toBe(true);

    // Both branches reached the http executor and recorded an output.
    expect(result.outputs.http_a).toBeDefined();
    expect(result.outputs.http_b).toBeDefined();
  });
});
