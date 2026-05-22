/**
 * flow_tool sub-flow recursion cap — engine-level regression.
 *
 * The flow_tool executor's unit test (under shared/workflow-engine) covers
 * the cap when ctx.subFlowDepth is injected directly. This harness test
 * exercises the FULL engine path: opts.subFlowDepth → context → ctx →
 * recursive executeSubWorkflow call increments → cap triggers in the
 * recursive call.
 *
 * Catches the wiring gap fixed at commit d7099bbc:
 *   1. executeWorkflow opts → context.subFlowDepth
 *   2. NodeExecutionContext build reads context.subFlowDepth
 *   3. Recursive executeSubWorkflow passes subFlowDepth + 1
 *
 * Without all three, the cap is a no-op (the parent always sees depth 0
 * regardless of nesting). The harness test below mocks
 * prisma.workflow.findUnique with a self-referential flow definition —
 * the parent calls itself via flow_tool, which would infinite-loop if
 * the cap didn't fire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runFlow } from '../runFlow.js';
import { prisma } from '../../../src/utils/prisma.js';

const TENANT = 't-harness-flow-tool-recursion';
const SELF_FLOW_ID = 'wf-self-referential';

const SELF_REFERENTIAL_DEFINITION = {
  nodes: [
    { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
    {
      id: 'recurse',
      type: 'flow_tool',
      data: {
        flowId: SELF_FLOW_ID,
        inputMapping: {},
      },
    },
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 'recurse' }],
};

describe('flow_tool sub-flow recursion cap (full engine wiring)', () => {
  beforeEach(() => {
    Object.values(prisma as any).forEach((t: any) => {
      if (t && typeof t.findUnique?.mockReset === 'function') t.findUnique.mockReset();
    });
  });

  it('caps recursion at default depth 3 — the deepest sub-flow refuses to nest further', async () => {
    // Every prisma lookup for the self-referential flow id returns the same definition.
    vi.mocked((prisma as any).workflow.findUnique).mockResolvedValue({
      id: SELF_FLOW_ID,
      name: 'self_recursive',
      definition: SELF_REFERENTIAL_DEFINITION,
    } as any);

    const result = await runFlow({
      flow: SELF_REFERENTIAL_DEFINITION,
      tenantId: TENANT,
      input: {},
    });

    // The outer flow_tool catches the recursive failure at depth >= 3 and
    // surfaces it as node_error. The top-level run propagates that error.
    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/depth|recursion|nested|flow_tool/i);

    // The cap proves the wiring: without subFlowDepth threading the call
    // would infinite-loop until the test framework killed it.
  });

  it('honors explicit maxDepth: 1 — refuses to nest after depth 1', async () => {
    const oneDeepDefinition = {
      nodes: [
        { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
        { id: 'recurse', type: 'flow_tool', data: { flowId: SELF_FLOW_ID, inputMapping: {}, maxDepth: 1 } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'recurse' }],
    };
    vi.mocked((prisma as any).workflow.findUnique).mockResolvedValue({
      id: SELF_FLOW_ID,
      name: 'self_recursive',
      definition: oneDeepDefinition,
    } as any);

    const result = await runFlow({
      flow: oneDeepDefinition,
      tenantId: TENANT,
      input: {},
    });

    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/depth|recursion|nested/i);
  });
});
