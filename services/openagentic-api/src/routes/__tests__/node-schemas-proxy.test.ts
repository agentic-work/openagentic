/**
 * GET /api/workflows/internal/node-schemas — route handler tests (TDD RED-first)
 *
 * 5 scenarios:
 *   R1. Authenticated request → 200 + schemas payload from service.
 *   R2. Service returns empty registry → 200 + { schemas: [], aiPromptFragment: '' }.
 *   R3. Auth guard rejects unauthenticated request → non-200 / route present in table.
 *   R4. Service throws unexpectedly → 500 with error body.
 *   R5. Route appears in the Fastify route table after plugin registration.
 *
 * Bun-compatibility rules (lessons 2, 3, 9, 10):
 *   - vi.fn() factories declared BEFORE dynamic imports.
 *   - Dynamic imports inside beforeAll.
 *   - Mocks declared before module load.
 *   - Auth guard: Bun's raw.writableEnded quirk → R3 uses it.todo per established pattern.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock logger — declared first (lesson 9: complete mock surfaces)
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const base = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: () => base,
    bindings: () => ({ service: 'test' }),
  };
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof base> = {};
  for (const c of cats) loggers[c] = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: () => base, bindings: () => ({ service: c }) };
  return { default: base, logger: base, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------------------------------------------------------------------------
// Mock NodeSchemasProxyService — isolate route handler from HTTP calls
// ---------------------------------------------------------------------------
const mockGetNodeSchemas = vi.fn();

vi.mock('../../services/NodeSchemasProxyService.js', () => ({
  NodeSchemasProxyService: vi.fn().mockImplementation(() => ({
    getNodeSchemas: mockGetNodeSchemas,
    invalidateCache: vi.fn(),
  })),
  getNodeSchemasProxyService: vi.fn().mockReturnValue({
    getNodeSchemas: mockGetNodeSchemas,
    invalidateCache: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock unifiedAuth — provide a passthrough authMiddleware for authenticated tests
// ---------------------------------------------------------------------------
vi.mock('../../middleware/unifiedAuth.js', () => ({
  authMiddleware: vi.fn(async (_request: any, _reply: any) => {
    // Default: pass through (simulates authenticated user)
    (_request as any).user = {
      id: 'test-user-id',
      userId: 'test-user-id',
      email: 'test@example.com',
      isAdmin: false,
      groups: [],
      localAccount: true,
    };
  }),
  unifiedAuthHook: vi.fn().mockResolvedValue(undefined),
  authMiddlewarePlugin: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Other deps required by workflows.ts at import time
// ---------------------------------------------------------------------------
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    openagenticflow: { findMany: vi.fn().mockResolvedValue([]) },
    workflow: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock('../../services/WorkflowExecutionEngine.js', () => ({
  executeWorkflow: vi.fn(),
  abortWorkflowExecution: vi.fn(),
  WorkflowExecutionEngine: vi.fn(),
}));

vi.mock('../../services/workflowAgentProgressBridge.js', () => ({
  subscribeAgentProgressForFlowsStream: vi.fn(),
}));

vi.mock('../../services/WorkflowCompiler.js', () => ({
  WorkflowCompiler: vi.fn().mockImplementation(() => ({
    compile: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    validate: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
  })),
}));

vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
  initializeRedis: vi.fn().mockResolvedValue(null),
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

vi.mock('../../services/NotificationService.js', () => ({
  getNotificationService: vi.fn().mockReturnValue({
    notify: vi.fn().mockResolvedValue(undefined),
    sendApprovalNotification: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/workflows/internal/node-schemas — route handler', () => {
  let server: FastifyInstance;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.JWT_SECRET = process.env.JWT_SECRET;
    savedEnv.DATABASE_URL = process.env.DATABASE_URL;
    process.env.JWT_SECRET = 'test-jwt-secret-node-schemas-proxy';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@localhost:5432/stub';

    server = Fastify({ logger: false });

    const { workflowRoutes } = await import('../workflows.js');
    await server.register(workflowRoutes, { prefix: '/api/workflows' });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    if (savedEnv.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedEnv.JWT_SECRET;
    if (savedEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedEnv.DATABASE_URL;
  });

  // -------------------------------------------------------------------------
  // R1. Happy path — returns schemas from service
  // -------------------------------------------------------------------------
  it('R1: GET /api/workflows/internal/node-schemas returns 200 + schemas payload', async () => {
    const mockPayload = {
      schemas: [{ type: 'llm_completion', category: 'ai' }],
      aiPromptFragment: '### Ai\n- **llm_completion**',
    };
    mockGetNodeSchemas.mockResolvedValueOnce(mockPayload);

    const response = await server.inject({
      method: 'GET',
      url: '/api/workflows/internal/node-schemas',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.schemas).toHaveLength(1);
    expect(body.schemas[0].type).toBe('llm_completion');
    expect(body.aiPromptFragment).toContain('llm_completion');
  });

  // -------------------------------------------------------------------------
  // R2. Empty registry from service
  // -------------------------------------------------------------------------
  it('R2: GET /api/workflows/internal/node-schemas returns 200 with empty registry as fallback', async () => {
    mockGetNodeSchemas.mockResolvedValueOnce({ schemas: [], aiPromptFragment: '' });

    const response = await server.inject({
      method: 'GET',
      url: '/api/workflows/internal/node-schemas',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.schemas).toEqual([]);
    expect(body.aiPromptFragment).toBe('');
  });

  // -------------------------------------------------------------------------
  // R3. Unauthenticated — auth guard (it.todo per Bun raw.writableEnded pattern)
  // -------------------------------------------------------------------------
  it.todo(
    'R3: GET /api/workflows/internal/node-schemas returns 401 when unauthenticated. ' +
    'Bun raw.writableEnded quirk causes 404 instead of 401 in test runtime. ' +
    'Memory: reference_fastify_v5_unawaited_send_bug.md. ' +
    'Verify in E2E harness with real JWT absence.',
  );

  // -------------------------------------------------------------------------
  // R4. Service throws unexpectedly
  // -------------------------------------------------------------------------
  it('R4: GET /api/workflows/internal/node-schemas returns 500 when service throws', async () => {
    mockGetNodeSchemas.mockRejectedValueOnce(new Error('Unexpected service failure'));

    const response = await server.inject({
      method: 'GET',
      url: '/api/workflows/internal/node-schemas',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // R5. Route appears in Fastify route table
  // -------------------------------------------------------------------------
  it('R5: route "internal/node-schemas" appears in the Fastify route table', () => {
    const routes = server.printRoutes();
    expect(routes).toContain('node-schemas');
  });
});
