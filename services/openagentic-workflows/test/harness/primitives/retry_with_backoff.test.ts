/**
 * retry_with_backoff — Flows harness test.
 *
 * Verifies the engine-level retry loop in WorkflowExecutionEngine.executeNode.
 * Per-node `retryPolicy: { maxRetries, delayMs, backoff }` on `node.data`
 * MUST cause executeNode to re-invoke the executor on thrown errors, emit
 * `node_retry` frames for each retry attempt, and ultimately return the
 * successful attempt's result when an attempt finally resolves.
 *
 * This pins Tier 2 #8 (retry_with_backoff) — the engine hook already exists;
 * this test guards against regressing the wire-up.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('retry_with_backoff — engine-level retry loop', () => {
  it('retries a throwing node up to maxRetries and returns the first success', async () => {
    let calls = 0;
    harnessServer.use(
      http.get('https://flaky.example/probe', () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.error();
        }
        return HttpResponse.json({ ok: true, attempt: calls }, { status: 200 });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'probe',
            type: 'http_request',
            data: {
              url: 'https://flaky.example/probe',
              method: 'GET',
              retryPolicy: { maxRetries: 3, delayMs: 1, backoff: 'linear' },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'probe' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    expect(calls).toBe(3);
    const retries = result.frames.filter(f => f.type === 'node_retry');
    expect(retries.length).toBe(2);
    expect(retries.every(f => (f as any).nodeId === 'probe')).toBe(true);
    const out = result.outputs.probe as { status: number; data: { ok: boolean; attempt: number } };
    expect(out.status).toBe(200);
    expect(out.data.attempt).toBe(3);
  });

  it('gives up after maxRetries+1 attempts and surfaces a failed status', async () => {
    let calls = 0;
    harnessServer.use(
      http.get('https://always-flaky.example/probe', () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'probe',
            type: 'http_request',
            data: {
              url: 'https://always-flaky.example/probe',
              method: 'GET',
              retryPolicy: { maxRetries: 2, delayMs: 1, backoff: 'linear' },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'probe' }],
      },
      input: {},
    });

    expect(result.status).toBe('failed');
    // 1 initial attempt + 2 retries = 3 total calls
    expect(calls).toBe(3);
    const retries = result.frames.filter(f => f.type === 'node_retry');
    expect(retries.length).toBe(2);
  });
});
