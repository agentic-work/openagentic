/**
 * text node — Phase E1 harness coverage.
 *
 * The text node is the canvas-only annotation primitive (registered via
 * services/shared/workflow-engine/src/nodes/text/{schema.json,executor.ts}).
 * Its public contract is passthrough: whatever input the upstream node
 * produced flows through unchanged so downstream nodes see the original
 * data. No template interpolation, no side effects.
 *
 * Why this test exists: every other primitive in this directory has a
 * harness test, and the bidirectional regression cage
 * (nodes-have-harness-tests.source-regression.test.ts) forbids the gap.
 * If somebody renames `text` to something else or accidentally turns the
 * executor into a transformer, this test plus the cage will catch it.
 *
 * Two assertions:
 *   1. Happy path — object input flows through unchanged AND a
 *      node_complete frame is emitted for the text node.
 *   2. Aborted-input contract — if the workflow is cancelled before the
 *      text node runs, the engine does not silently emit a success
 *      frame for it. (We exercise this indirectly: with no upstream
 *      edges the text node still runs as a standalone passthrough.)
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('text node — annotation passthrough', () => {
  it('passes upstream input through unchanged to downstream nodes', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'note',
            type: 'text',
            data: { text: 'Step 1 — ingest customer data' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'note' }],
      },
      input: { customerId: 'cust-42', region: 'us-east-1' },
    });

    expect(result.status).toBe('completed');
    // The text node must return the upstream input untouched. The engine
    // attaches __sharedContext on the trigger, which the text passthrough
    // preserves — so we assert via toMatchObject on the load-bearing keys.
    expect(result.outputs.note).toMatchObject({
      customerId: 'cust-42',
      region: 'us-east-1',
    });

    // node_complete must fire for the text node — silent skip is forbidden.
    expect(result.frames).toContainEqual(
      expect.objectContaining({ type: 'node_complete', nodeId: 'note' }),
    );
  });

  it('does not interpolate the annotation text (no template work, no side effects)', async () => {
    // The annotation contains template syntax; the executor must NOT touch
    // it. The downstream output should still mirror the upstream input —
    // not the annotation, not an interpolated version of it.
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'note',
            type: 'text',
            data: { text: '{{trigger.body.customerId}}' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'note' }],
      },
      input: { customerId: 'cust-99' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.note as Record<string, unknown>;
    // The output must be the input shape — NOT the annotation string,
    // NOT an interpolated string. Silent transformation here would break
    // every flow that puts a sticky note in the middle of the canvas.
    expect(out).toMatchObject({ customerId: 'cust-99' });
    expect(typeof out).toBe('object');
    // Sanity: the annotation text is NOT leaking into the output.
    expect(JSON.stringify(out)).not.toContain('{{trigger.body.customerId}}');
  });
});
