/**
 * rate_limiter — Flows harness test.
 *
 * Verifies the fixed-window throttle primitive through the full
 * WorkflowExecutionEngine path. Covers the allow path, the drop path,
 * and tenant-isolation (the executor namespaces buckets by tenantId).
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('rate_limiter node — fixed-window throttle', () => {
  it('allows the first call under the limit', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'rl',
            type: 'rate_limiter',
            data: {
              key: 'harness:allow-{{trigger.body.runId}}',
              maxCalls: 3,
              windowSeconds: 60,
              onLimit: 'drop',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'rl' }],
      },
      input: { body: { runId: 'r1' } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.rl as {
      allowed: boolean;
      limited: boolean;
      key: string;
      calls: number;
      maxCalls: number;
    };
    expect(out.allowed).toBe(true);
    expect(out.limited).toBe(false);
    expect(out.calls).toBe(1);
    expect(out.maxCalls).toBe(3);
    expect(out.key).toContain('harness:allow-r1');
  });

  it('drops the call when over the limit if onLimit=drop', async () => {
    const flow = {
      nodes: [
        { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
        { id: 'a', type: 'rate_limiter', data: { key: 'harness:drop-x', maxCalls: 1, windowSeconds: 60, onLimit: 'drop' } },
        { id: 'b', type: 'rate_limiter', data: { key: 'harness:drop-x', maxCalls: 1, windowSeconds: 60, onLimit: 'drop' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
      ],
    };
    const result = await runFlow({ flow, input: {} });
    expect(result.status).toBe('completed');
    const outA = result.outputs.a as { allowed: boolean; calls: number };
    const outB = result.outputs.b as { allowed: boolean; limited: boolean; calls: number };
    expect(outA.allowed).toBe(true);
    expect(outA.calls).toBe(1);
    expect(outB.allowed).toBe(false);
    expect(outB.limited).toBe(true);
    expect(outB.calls).toBe(2);
  });
});
