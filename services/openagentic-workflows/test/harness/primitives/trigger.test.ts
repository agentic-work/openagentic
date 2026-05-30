/**
 * trigger node — baseline GREEN.
 *
 * Asserts the two contracts every downstream primitive test implicitly
 * relies on:
 *   1. The trigger node passes its input variables through verbatim so
 *      downstream nodes see what was handed to runFlow({ input }).
 *   2. The engine stamps __sharedContext onto the trigger output (the
 *      ambient bag every node executor adds to object-shaped inputs in
 *      executeNodeCore) so per-flow shared state is reachable from the
 *      first node onward.
 *
 * If either of these regresses, every other primitive test in this
 * directory is observing a broken seed value — the trigger is the
 * upstream-of-everything.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('trigger node — primitive contract', () => {
  it('passes input variables through to downstream nodes', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
        ],
        edges: [],
      },
      input: { x: 42, name: 'alice' },
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.trigger).toMatchObject({ x: 42, name: 'alice' });
  });

  it('seeds __sharedContext on the trigger output for downstream nodes', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
        ],
        edges: [],
      },
      input: { topic: 'sharedctx-seed' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.trigger as Record<string, unknown>;
    expect(out).toHaveProperty('__sharedContext');
    expect(typeof out.__sharedContext).toBe('object');
  });
});
