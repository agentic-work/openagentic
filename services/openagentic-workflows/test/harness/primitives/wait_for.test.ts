/**
 * wait_for — Flows harness test.
 *
 * Verifies the poll-until-condition primitive through the full
 * WorkflowExecutionEngine path. Covers the "condition already true" first-poll
 * path and the timeout path (failOnTimeout=false).
 *
 * Shipped originally in `a7eef1ed` without a harness test; this closes that
 * gap retroactively (caught by the nodes-have-harness-tests cage).
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('wait_for node — poll-until-condition', () => {
  it('returns immediately when the condition is true on first poll', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'w',
            type: 'wait_for',
            data: {
              condition: 'input.ready === true',
              pollIntervalSeconds: 1,
              timeoutSeconds: 5,
              failOnTimeout: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'w' }],
      },
      input: { ready: true },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.w as {
      satisfied: boolean;
      polls: number;
      timedOut: boolean;
    };
    expect(out.satisfied).toBe(true);
    expect(out.timedOut).toBe(false);
    expect(out.polls).toBeGreaterThanOrEqual(1);
  });

  it('returns {satisfied:false, timedOut:true} when condition stays false and failOnTimeout=false', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'w',
            type: 'wait_for',
            data: {
              condition: 'input.never === true',
              pollIntervalSeconds: 1,
              timeoutSeconds: 2,
              failOnTimeout: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'w' }],
      },
      input: { never: false },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.w as {
      satisfied: boolean;
      timedOut: boolean;
    };
    expect(out.satisfied).toBe(false);
    expect(out.timedOut).toBe(true);
  }, 6000);
});
