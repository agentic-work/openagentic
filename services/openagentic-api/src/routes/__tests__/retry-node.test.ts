/**
 * A4 — POST /api/workflows/:id/retry-node
 *
 * Tests for the per-node retry endpoint:
 *   - Body: { executionId, nodeId }
 *   - Looks up original WorkflowExecution, finds failed node + upstream outputs
 *   - Creates a new WorkflowExecution with resume state
 *   - Returns { newExecutionId }
 *
 * Strategy: stub Prisma + WorkflowExecutionEngine so tests run without a DB.
 * Auth middleware is stubbed to inject a synthetic user.
 *
 * All tests follow the Bun vitest pattern: vi.fn() factories declared before
 * dynamic imports; dynamic imports inside beforeAll.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Logger stub (must be declared before dynamic imports)
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof stub> = {};
  for (const c of cats) loggers[c] = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  return { default: stub, logger: stub, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------------------------------------------------------------------------
// Prisma stub
// ---------------------------------------------------------------------------
const mockFindFirstExecution = vi.fn();
const mockCreateExecution = vi.fn();
const mockFindFirstWorkflow = vi.fn();

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    workflow: {
      findFirst: mockFindFirstWorkflow,
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'wf-1', name: 'test', definition: { nodes: [], edges: [] } }),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    workflowExecution: {
      findFirst: mockFindFirstExecution,
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: mockCreateExecution,
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    workflowApprovalRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'stub-approval' }),
      update: vi.fn().mockResolvedValue({}),
    },
    userContextEntry: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

// ---------------------------------------------------------------------------
// WorkflowExecutionEngine stub
// ---------------------------------------------------------------------------
const mockExecuteWorkflow = vi.fn().mockResolvedValue(undefined);
const mockAbortWorkflowExecution = vi.fn().mockReturnValue(true);

vi.mock('../../services/WorkflowExecutionEngine.js', () => ({
  executeWorkflow: mockExecuteWorkflow,
  abortWorkflowExecution: mockAbortWorkflowExecution,
  WorkflowExecutionEngine: vi.fn(),
  ExecutionContext: vi.fn(),
  WorkflowDefinition: vi.fn(),
  ExecutionEvent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Supporting service stubs
// ---------------------------------------------------------------------------
vi.mock('../../services/workflowAgentProgressBridge.js', () => ({
  subscribeAgentProgressForFlowsStream: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../../services/WorkflowCompiler.js', () => ({
  WorkflowCompiler: vi.fn().mockImplementation(() => ({
    compile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    validate: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
  })),
}));

vi.mock('../../services/WorkflowMarketplaceService.js', () => ({
  getWorkflowMarketplaceService: vi.fn().mockReturnValue({
    searchTemplates: vi.fn().mockResolvedValue({ templates: [], total: 0 }),
    getFeaturedTemplates: vi.fn().mockResolvedValue([]),
    getTemplate: vi.fn().mockResolvedValue(null),
    publishTemplate: vi.fn().mockResolvedValue({}),
  }),
  WorkflowMarketplaceService: vi.fn(),
}));

vi.mock('../../services/UserContextService.js', () => ({
  userContextService: {
    getUserContext: vi.fn().mockResolvedValue({ entries: [], totalEntries: 0 }),
    indexUserData: vi.fn().mockResolvedValue(undefined),
    searchUserContext: vi.fn().mockResolvedValue([]),
    purgeUserContext: vi.fn().mockResolvedValue({ deleted: 0 }),
  },
}));

vi.mock('../../services/MCPProxyClient.js', () => ({
  createMCPProxyClient: vi.fn().mockReturnValue({ callTool: vi.fn().mockResolvedValue({}) }),
}));

vi.mock('../../services/llm-providers/GoogleVertexProvider.js', () => ({
  GoogleVertexProvider: vi.fn().mockImplementation(() => ({
    generateCompletion: vi.fn().mockResolvedValue({ content: 'stub' }),
  })),
}));

vi.mock('../../services/NotificationService.js', () => ({
  getNotificationService: vi.fn().mockReturnValue({
    notify: vi.fn().mockResolvedValue(undefined),
    sendApprovalNotification: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
  initializeRedis: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/NodeSchemasProxyService.js', () => ({
  getNodeSchemasProxyService: vi.fn().mockReturnValue({
    getNodeSchemas: vi.fn().mockResolvedValue({ schemas: [], aiPromptFragment: '' }),
  }),
}));

vi.mock('../../middleware/unifiedAuth.js', () => ({
  authMiddleware: vi.fn(async (request: any, _reply: any) => {
    request.user = { userId: 'user-test', id: 'user-test', isAdmin: false };
  }),
}));

vi.mock('../../infra/ndjson.js', () => ({
  ndjsonHeaders: vi.fn().mockReturnValue({ 'Content-Type': 'application/x-ndjson' }),
  writeNDJSON: vi.fn(),
  createSSEToNDJSONTranslator: vi.fn().mockReturnValue({ translate: vi.fn().mockReturnValue(''), flush: vi.fn().mockReturnValue('') }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKFLOW_ID = 'wf-abc123';
const EXECUTION_ID = 'exec-abc456';
const NODE_ID = 'llm-node-1';

const makeWorkflow = (overrides?: any) => ({
  id: WORKFLOW_ID,
  name: 'Test Workflow',
  created_by: 'user-test',
  definition: {
    nodes: [
      { id: 'trigger-1', type: 'trigger', data: { label: 'Trigger' } },
      { id: NODE_ID, type: 'llm_completion', data: { label: 'LLM Node' } },
    ],
    edges: [{ id: 'e1', source: 'trigger-1', target: NODE_ID }],
  },
  is_active: true,
  ...overrides,
});

const makeExecution = (overrides?: any) => ({
  id: EXECUTION_ID,
  workflow_id: WORKFLOW_ID,
  started_by: 'user-test',
  status: 'failed',
  node_outputs: {
    'trigger-1': { status: 'completed', output: { triggered: true } },
    [NODE_ID]: { status: 'failed', error: 'LLM timeout' },
  },
  workflow: { created_by: 'user-test' },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('A4 — POST /api/workflows/:id/retry-node', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register the workflow routes under the prefix used in production
    const { workflowRoutes } = await import('../workflows.js');
    await app.register(workflowRoutes, { prefix: '/api/workflows' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('T1: returns 400 when executionId is missing from body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WORKFLOW_ID}/retry-node`,
      payload: { nodeId: NODE_ID },  // no executionId
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it('T2: returns 400 when nodeId is missing from body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WORKFLOW_ID}/retry-node`,
      payload: { executionId: EXECUTION_ID },  // no nodeId
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it('T3: returns 404 when the original execution does not exist', async () => {
    mockFindFirstExecution.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WORKFLOW_ID}/retry-node`,
      payload: { executionId: 'nonexistent-exec', nodeId: NODE_ID },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it('T4: returns 200 with newExecutionId on success', async () => {
    mockFindFirstExecution.mockResolvedValueOnce(makeExecution());
    mockCreateExecution.mockResolvedValueOnce({ id: 'new-exec-789' });
    mockExecuteWorkflow.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WORKFLOW_ID}/retry-node`,
      payload: { executionId: EXECUTION_ID, nodeId: NODE_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newExecutionId).toBe('new-exec-789');
  });

  it('T5: new execution includes resume_from_node and upstream_outputs in state', async () => {
    mockFindFirstExecution.mockResolvedValueOnce(makeExecution());
    mockCreateExecution.mockResolvedValueOnce({ id: 'new-exec-xyz' });
    mockExecuteWorkflow.mockResolvedValueOnce(undefined);

    await app.inject({
      method: 'POST',
      url: `/api/workflows/${WORKFLOW_ID}/retry-node`,
      payload: { executionId: EXECUTION_ID, nodeId: NODE_ID },
    });

    // Verify the created execution has the correct resume state
    expect(mockCreateExecution).toHaveBeenCalled();
    const createCall = mockCreateExecution.mock.calls[0][0];
    const state = createCall?.data?.state as any;
    expect(state).toBeDefined();
    expect(state.resume_from_node).toBe(NODE_ID);
    // upstream_outputs should contain the upstream (non-failed) node output
    expect(state.upstream_outputs).toBeDefined();
    expect(state.upstream_outputs['trigger-1']).toBeDefined();
  });
});
