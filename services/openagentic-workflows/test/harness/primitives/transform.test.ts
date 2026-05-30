/**
 * transform node — RED (pins Phase B sweep failure).
 *
 * Phase B evidence: transform executes but applies no transformation —
 * the output of the node was observed identical to its input regardless
 * of what was configured. The sweep tried four common config keys
 * (operations[], expression, transformExpression, set/path) and none
 * triggered a real transformation.
 *
 * The actual executor (services/shared/workflow-engine/src/nodes/transform/
 * executor.ts) supports a typed shape:
 *     { transformType: 'map'|'filter'|'reduce'|'extract', transformExpression }
 * but does NOT support the `operations: [{ op:'set', target, value }]` shape
 * that the UI / docs / Phase B sweep all reach for. When transformType is
 * absent the executor falls through to `default: return input` — exactly
 * the silent pass-through Phase B observed.
 *
 * These tests assert the EXPECTED contract — a transform-set operation
 * that adds a derived field — which the engine does not yet implement.
 * That makes them RED today; the Phase C fix-implementer can wire the
 * op-handlers and turn them GREEN.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('transform node — apply operation', () => {
  it('applies a set operation to add a derived field', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'xform',
            type: 'transform',
            data: {
              operations: [
                { op: 'set', target: 'doubled', value: '{{input.x * 2}}' },
              ],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'xform' }],
      },
      input: { x: 7 },
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.xform).toMatchObject({ x: 7, doubled: 14 });
  });

  it('errors clearly when given an unknown operation type', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'xform',
            type: 'transform',
            data: {
              operations: [
                { op: 'bogusOp', target: 'whatever', value: 'noop' },
              ],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'xform' }],
      },
      input: { x: 7 },
    });

    // Should NOT silently pass through input unchanged — must surface an
    // error on the result envelope so the user can fix the config.
    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/operation|unknown|bogus/i);
  });
});
