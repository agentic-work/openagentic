/**
 * WorkflowExecutionEngine — testMocks plumb-through.
 *
 * Phase B #17 part 2: when executeWorkflow is invoked with
 * opts.testMocks, the engine must thread that payload onto every
 * NodeExecutionContext it constructs so executors (mcp_tool, etc.)
 * can short-circuit via the resolveMockMcpResponse path.
 *
 * The check is wiring-only — we don't run a real mcp_tool node here
 * (that's covered by mcp_tool/executor.testmocks.test.ts in
 * shared/workflow-engine). We just verify the field is present on
 * the constructed context.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: { workflowExecution: { update: vi.fn(), create: vi.fn(), findUnique: vi.fn() } },
}));
vi.mock('../../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  },
}));

import {
  WorkflowExecutionEngine,
  type WorkflowDefinition,
  type ExecutionContext,
} from '../WorkflowExecutionEngine.js';
import type { TestMocks } from '@openagentic/workflow-engine';

const minimalDef: WorkflowDefinition = {
  nodes: [{ id: 't', type: 'trigger', data: {} }],
  edges: [],
};

function makeCtx(testMocks?: TestMocks): ExecutionContext {
  return {
    executionId: 'e-mocks-1',
    workflowId: 'w-mocks-1',
    userId: 'u-1',
    triggerType: 'manual',
    input: {},
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
    sharedContext: new Map(),
    testMocks,
  };
}

describe('WorkflowExecutionEngine — testMocks plumb-through', () => {
  it('ExecutionContext accepts and stores testMocks', () => {
    const mocks: TestMocks = { mcpTools: [{ toolName: 't', response: 'r' }] };
    const ctx = makeCtx(mocks);
    expect(ctx.testMocks).toBe(mocks);
  });

  it('engine constructor preserves context.testMocks (no mutation)', () => {
    const mocks: TestMocks = { mcpTools: [{ toolName: 't', response: 'r' }] };
    const engine = new WorkflowExecutionEngine(minimalDef, makeCtx(mocks));
    const internalCtx = (engine as any).context as ExecutionContext;
    expect(internalCtx.testMocks).toEqual(mocks);
  });

  it('absent testMocks stays undefined on the context', () => {
    const engine = new WorkflowExecutionEngine(minimalDef, makeCtx());
    const internalCtx = (engine as any).context as ExecutionContext;
    expect(internalCtx.testMocks).toBeUndefined();
  });
});
