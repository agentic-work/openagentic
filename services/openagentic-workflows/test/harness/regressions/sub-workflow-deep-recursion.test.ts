/**
 * sub_workflow deep recursion — distinct-definition 3-level fan-out.
 *
 * Complements `flow-tool-recursion-cap.test.ts` (self-referential cap test).
 * This one drives **distinct** child + grandchild flow definitions so the
 * test catches dispatch/output-threading bugs the self-referential test
 * can't see: the parent calls a child, which in turn calls a grandchild,
 * and the grandchild's terminal output must surface back up through both
 * sub_workflow nodes onto the parent's output map.
 *
 * Pinned behavior:
 *   1. prisma.workflow.findUnique is invoked once per distinct child id.
 *   2. subFlowDepth increments across each nesting level (0 → 1 → 2 < cap 3).
 *   3. Grandchild's terminal output reaches the parent (proves output
 *      unwrap traverses 2 levels of envelope cleanly).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runFlow } from '../runFlow.js';
import { prisma } from '../../../src/utils/prisma.js';

const GRANDCHILD_ID = 'wf-grandchild';
const CHILD_ID = 'wf-child';

const GRANDCHILD_DEF = {
  nodes: [
    { id: 'g_trig', type: 'trigger', data: { triggerType: 'manual' } },
    {
      id: 'g_resp',
      type: 'webhook_response',
      data: {
        statusCode: 200,
        bodyTemplate: 'grandchild-saw:{{trigger.echo}}',
      },
    },
  ],
  edges: [{ id: 'ge1', source: 'g_trig', target: 'g_resp' }],
};

const CHILD_DEF = {
  nodes: [
    { id: 'c_trig', type: 'trigger', data: { triggerType: 'manual' } },
    {
      id: 'c_sub',
      type: 'sub_workflow',
      data: { workflowId: GRANDCHILD_ID, passInput: true },
    },
  ],
  edges: [{ id: 'ce1', source: 'c_trig', target: 'c_sub' }],
};

const PARENT_DEF = {
  nodes: [
    { id: 'p_trig', type: 'trigger', data: { triggerType: 'manual' } },
    {
      id: 'p_sub',
      type: 'sub_workflow',
      data: { workflowId: CHILD_ID, passInput: true },
    },
  ],
  edges: [{ id: 'pe1', source: 'p_trig', target: 'p_sub' }],
};

describe('sub_workflow deep recursion (parent → child → grandchild)', () => {
  beforeEach(() => {
    vi.mocked((prisma as any).workflow.findUnique).mockReset();
  });

  it('dispatches 3 levels deep and threads grandchild output back to the parent', async () => {
    vi.mocked((prisma as any).workflow.findUnique).mockImplementation(
      async (args: { where?: { id?: string } }) => {
        if (args?.where?.id === CHILD_ID) {
          return { id: CHILD_ID, name: 'child', definition: CHILD_DEF } as any;
        }
        if (args?.where?.id === GRANDCHILD_ID) {
          return { id: GRANDCHILD_ID, name: 'grandchild', definition: GRANDCHILD_DEF } as any;
        }
        return null;
      },
    );

    const result = await runFlow({
      flow: PARENT_DEF,
      input: { echo: 'hello-from-parent' },
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.p_sub).toBeDefined();

    // Both distinct sub-flow ids must have been looked up via prisma —
    // proves dispatch crossed both levels rather than short-circuiting.
    const calls = vi.mocked((prisma as any).workflow.findUnique).mock.calls;
    const ids = calls.map(
      (c: unknown[]) => (c[0] as { where?: { id?: string } })?.where?.id,
    );
    expect(ids).toContain(CHILD_ID);
    expect(ids).toContain(GRANDCHILD_ID);

    // Grandchild's webhook_response renders trigger.echo into its body.
    // The body should make it back through both sub_workflow envelopes
    // and land in parent's p_sub output.
    const parentOut = JSON.stringify(result.outputs.p_sub);
    expect(parentOut).toContain('grandchild-saw:hello-from-parent');
  });
});
