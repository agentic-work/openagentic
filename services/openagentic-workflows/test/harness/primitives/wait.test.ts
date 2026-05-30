/**
 * wait node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - Short waits (< 30s) sleep in-process and return
 *     `{ waited: true, duration: durationMs }`.
 *   - Total flow duration is >= the configured wait.
 *
 * No mocks needed — pure setTimeout.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('wait node — in-process short wait', () => {
  it('waits the configured duration and returns the elapsed ms', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'w', type: 'wait', data: { duration: 100, unit: 'ms' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'w' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.w as { waited: boolean; duration: number };
    expect(out.waited).toBe(true);
    expect(out.duration).toBe(100);
    expect(result.durationMs).toBeGreaterThanOrEqual(100);
  });

  it('converts seconds to ms correctly', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'w', type: 'wait', data: { duration: 0.05, unit: 'seconds' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'w' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.w as { waited: boolean; duration: number };
    expect(out.duration).toBe(50);
  });
});
