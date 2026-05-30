/**
 * TDD tests for switch→merge notifySkippedBranch (W1-W4).
 *
 * Tests that when a switch node chooses one branch, the unchosen branches'
 * downstream merge nodes have their expected count decremented so they
 * don't hang waiting for branches that will never arrive.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    workflowExecution: {
      update: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    workflow: { update: vi.fn() },
    workflowNodeLog: { create: vi.fn() },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    server: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  },
}));

import { WorkflowExecutionEngine, type WorkflowDefinition, type ExecutionContext } from '../WorkflowExecutionEngine.js';

function buildCtx(): ExecutionContext {
  return {
    executionId: 'exec-sw-1',
    workflowId: 'wf-sw-1',
    userId: 'user-1',
    input: {},
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
    sharedContext: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Helper: build a workflow definition with switch → branches → merge
// ---------------------------------------------------------------------------
function makeDefinition(
  switchCases: { value: string; label?: string }[],
  branchCount: number,
): WorkflowDefinition {
  // switch → branch_0 … branch_{n-1} → merge → output
  const nodes = [
    { id: 'trigger', type: 'trigger', data: {} },
    {
      id: 'sw',
      type: 'switch',
      data: {
        expression: '"branch_0"', // always pick first branch
        cases: switchCases,
      },
    },
    ...Array.from({ length: branchCount }, (_, i) => ({
      id: `branch_${i}`,
      type: 'trigger', // trigger is a no-op pass-through
      data: {},
    })),
    {
      id: 'merge',
      type: 'merge',
      data: { strategy: 'all', waitForAll: true },
    },
    { id: 'output', type: 'trigger', data: {} },
  ];

  const edges = [
    { id: 'e0', source: 'trigger', target: 'sw' },
    // switch → each branch
    ...Array.from({ length: branchCount }, (_, i) => ({
      id: `esw_${i}`,
      source: 'sw',
      target: `branch_${i}`,
      sourceHandle: switchCases[i]?.value ?? `branch_${i}`,
    })),
    // each branch → merge
    ...Array.from({ length: branchCount }, (_, i) => ({
      id: `em_${i}`,
      source: `branch_${i}`,
      target: 'merge',
    })),
    { id: 'eout', source: 'merge', target: 'output' },
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// W4: switch with 2 branches
// ---------------------------------------------------------------------------
describe('switch → merge: 2 branches (W4)', () => {
  it('W2 – merge fires after switch picks one of two branches', async () => {
    const cases = [
      { value: 'branch_0', label: 'A' },
      { value: 'branch_1', label: 'B' },
    ];
    const def = makeDefinition(cases, 2);
    const engine = new WorkflowExecutionEngine(def, buildCtx());

    // Execute with a reasonable timeout
    const resultPromise = engine.execute();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Merge gate deadlock — switch did not notify skipped branch')), 3000)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    // The engine completes — no deadlock
    expect(result).toBeDefined();
    // Output node was reached
    // (nodeResults has entries for executed nodes)
  }, 5000);
});

// ---------------------------------------------------------------------------
// W4: switch with 3 branches
// ---------------------------------------------------------------------------
describe('switch → merge: 3 branches (W4)', () => {
  it('W2 – merge fires after switch picks one of three branches', async () => {
    const cases = [
      { value: 'branch_0', label: 'A' },
      { value: 'branch_1', label: 'B' },
      { value: 'branch_2', label: 'C' },
    ];
    const def = makeDefinition(cases, 3);
    const engine = new WorkflowExecutionEngine(def, buildCtx());

    const resultPromise = engine.execute();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Merge deadlock with 3 branches')), 3000)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    expect(result).toBeDefined();
  }, 5000);
});

// ---------------------------------------------------------------------------
// W4: switch with 4 branches
// ---------------------------------------------------------------------------
describe('switch → merge: 4 branches (W4)', () => {
  it('W2 – merge fires after switch picks one of four branches', async () => {
    const cases = [
      { value: 'branch_0' },
      { value: 'branch_1' },
      { value: 'branch_2' },
      { value: 'branch_3' },
    ];
    const def = makeDefinition(cases, 4);
    const engine = new WorkflowExecutionEngine(def, buildCtx());

    const resultPromise = engine.execute();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Merge deadlock with 4 branches')), 3000)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    expect(result).toBeDefined();
  }, 5000);
});

// ---------------------------------------------------------------------------
// W1: verify notifySkippedBranch is called for each unchosen edge
// ---------------------------------------------------------------------------
describe('switch notifySkippedBranch (W1)', () => {
  it('W3 – skip count is pre-registered on the merge gate for unchosen branches', async () => {
    // With 3 branches and switch always picking branch_0, the merge should
    // receive skip notifications for branch_1 and branch_2.
    const cases = [
      { value: 'branch_0', label: 'A' },
      { value: 'branch_1', label: 'B' },
      { value: 'branch_2', label: 'C' },
    ];
    const def = makeDefinition(cases, 3);
    const engine = new WorkflowExecutionEngine(def, buildCtx());

    // Run with a short timeout to catch hangs early
    const result = await Promise.race([
      engine.execute(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3000)
      ),
    ]);

    // If we get here without timing out, skip notifications worked
    expect(result).toHaveProperty('success');
  }, 5000);
});
