/**
 * Flows RBAC gate — TDD test for requireFlowsAccess preHandler.
 *
 * Three cases per RBAC contract:
 *  (a) admin user  → 200 (or any non-403) on a representative workflow route
 *  (b) non-admin without flows access → 403 with FORBIDDEN_FLOWS code
 *  (c) non-admin WITH flows access    → 200 (or any non-403)
 *
 * Pattern mirrors workflows.plugin.test.ts (lessons 2, 3, 9, 10):
 *  - vi.mock before any dynamic import
 *  - env vars saved + assigned in beforeAll
 *  - inject()-based assertions
 *
 * Why inject() returns 401/403 not 200 for "passing" cases:
 *   The auth middleware runs first and validates the token. In test runtime
 *   there is no valid JWT, so the auth middleware returns 401 before RBAC
 *   is even checked. We therefore assert on what the gate DOES NOT return:
 *   - Admin     → must NOT be 403 (the flows gate must not fire at all)
 *   - Non-admin with flows → must NOT be 403 with FORBIDDEN_FLOWS
 *   - Non-admin without flows → MUST be 403 with FORBIDDEN_FLOWS
 *
 *   For the non-admin without flows case we bypass auth by injecting a
 *   fake request with a pre-hydrated user object on `request.user`, using
 *   the Fastify inject + a stub authMiddleware that populates request.user
 *   from a header.  See TEST_USER header pattern below.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppContext, decorateApp } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

// ---------------------------------------------------------------------------
// Stub logger (must be before any dynamic import that loads loggers)
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => createLoggerMock());

// ---------------------------------------------------------------------------
// Stub prisma — minimal surface for WorkflowsService + requireFlowsAccess
// ---------------------------------------------------------------------------
const stubUserNoFlows = {
  id: 'user-no-flows',
  email: 'noflows@test.com',
  is_admin: false,
  groups: [],
};

const stubUserWithFlows = {
  id: 'user-with-flows',
  email: 'withflows@test.com',
  is_admin: false,
  groups: [],
};

const stubAdminUser = {
  id: 'admin-user',
  email: 'admin@test.com',
  is_admin: true,
  groups: [],
};

// UserPermissions rows keyed by user_id
const stubPermissions: Record<string, { workflows_enabled: boolean }> = {
  'user-no-flows':  { workflows_enabled: false },
  'user-with-flows': { workflows_enabled: true },
  // admin has no row — falls through to default; admin bypass in hook handles it
};

const stubPrisma = {
  userPermissions: {
    findUnique: vi.fn(({ where }: any) => {
      const row = stubPermissions[where.user_id];
      return Promise.resolve(row ? { ...row } : null);
    }),
  },
  openagenticflow: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'stub-id', name: 'stub', created_at: new Date(), updated_at: new Date(), definition: {} }),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
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
  _stub: true,
} as any;

// ---------------------------------------------------------------------------
// Stub unifiedAuth + authMiddleware — populates request.user from X-Test-User
// header so we can inject arbitrary user contexts without a real JWT.
// ---------------------------------------------------------------------------
const TEST_USER_HEADER = 'x-test-user';

vi.mock('../../middleware/unifiedAuth.js', async () => {
  const users: Record<string, any> = {
    'admin':      { userId: 'admin-user',      isAdmin: true,  groups: [] },
    'no-flows':   { userId: 'user-no-flows',   isAdmin: false, groups: [] },
    'with-flows': { userId: 'user-with-flows', isAdmin: false, groups: [] },
  };

  return {
    authMiddleware: vi.fn(async (request: any, reply: any) => {
      const key = request.headers?.[TEST_USER_HEADER];
      if (key && users[key]) {
        request.user = users[key];
        return;
      }
      // No test header → 401
      await reply.code(401).send({ error: 'Unauthorized', message: 'No auth' });
    }),
    AuthenticatedRequest: {},
  };
});

// ---------------------------------------------------------------------------
// Stub prisma module — requireFlowsAccess.ts imports prisma directly from
// '../../utils/prisma.js'.  We must mock this module so the hook resolves
// the test user_permissions rows, not the real DB.
// ---------------------------------------------------------------------------
vi.mock('../../utils/prisma.js', () => ({
  prisma: stubPrisma,
}));

// ---------------------------------------------------------------------------
// Stub remaining heavy deps that workflows.ts pulls in
// ---------------------------------------------------------------------------
vi.mock('../../services/executeViaWorkflowsService.js', () => ({
  executeViaWorkflowsService: vi.fn(),
}));
vi.mock('../../services/workflowFinishedSubscriptions.js', () => ({
  fireWorkflowFinishedSubscribers: vi.fn(),
}));
vi.mock('../../services/WorkflowExecutionEngine.js', () => ({
  abortWorkflowExecution: vi.fn(),
}));
vi.mock('../../services/workflowAgentProgressBridge.js', () => ({
  subscribeAgentProgressForFlowsStream: vi.fn(),
}));
vi.mock('../../services/WorkflowCompiler.js', () => ({
  WorkflowCompiler: vi.fn().mockImplementation(() => ({ compile: vi.fn() })),
}));
vi.mock('../../services/NodeSchemasProxyService.js', () => ({
  getNodeSchemasProxyService: vi.fn().mockReturnValue({ getNodeSchemas: vi.fn().mockResolvedValue({ schemas: [], aiPromptFragment: '' }) }),
}));
vi.mock('../../services/workflowServiceUrlGuard.js', () => ({
  reportLocalEngineFallback: vi.fn(),
}));
vi.mock('../../utils/internalKeyReader.js', () => ({
  getInternalKey: vi.fn().mockReturnValue('stub-internal-key'),
}));
vi.mock('@openagentic/workflow-engine', () => ({
  deriveFlowToolSchema: vi.fn().mockReturnValue({}),
  ExecutionEvent: {},
}));

// Mock workflow routes to avoid pulling in all of workflows.ts's heavy deps.
// We only want to test the requireFlowsAccess hook inserted by workflows.plugin.ts.
vi.mock('../../routes/workflows.js', () => ({
  workflowRoutes: async (fastify: any) => {
    fastify.addHook('preHandler', (await import('../../middleware/unifiedAuth.js')).authMiddleware);
    fastify.get('/', async (_req: any, reply: any) => reply.send({ ok: true }));
  },
}));
vi.mock('../../routes/workflow-approvals.js', () => ({
  workflowApprovalRoutes: async (fastify: any) => {
    fastify.get('/', async (_req: any, reply: any) => reply.send({ ok: true }));
  },
}));
vi.mock('../../routes/workflow-marketplace.js', () => ({
  workflowMarketplaceRoutes: async (fastify: any) => {
    fastify.get('/', async (_req: any, reply: any) => reply.send({ ok: true }));
  },
}));
vi.mock('../../routes/user-context.js', () => ({
  default: async (fastify: any) => {
    fastify.get('/api/user-context', async (_req: any, reply: any) => reply.send({ ok: true }));
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workflowsRoutesPlugin — Flows RBAC gate (requireFlowsAccess)', () => {
  let server: FastifyInstance;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.JWT_SECRET = process.env.JWT_SECRET;
    savedEnv.DATABASE_URL = process.env.DATABASE_URL;
    process.env.JWT_SECRET = 'test-jwt-flows-rbac';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@localhost:5432/stub';

    server = Fastify({ logger: false });

    const stubLogger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      child: function() { return this; },
    } as any;

    const ctx = new AppContext({ prisma: stubPrisma, logger: stubLogger });
    decorateApp(server, ctx);

    // Inject prisma onto server for requireFlowsAccess to use
    (server as any).prisma = stubPrisma;

    const { workflowsRoutesPlugin } = await import('../workflows.plugin.js');
    await server.register(workflowsRoutesPlugin, {});
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    if (savedEnv.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedEnv.JWT_SECRET;
    if (savedEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedEnv.DATABASE_URL;
  });

  // ── Case (b): non-admin user WITHOUT flows access → 403 FORBIDDEN_FLOWS ──
  it('non-admin user without flows access → 403 FORBIDDEN_FLOWS', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/api/workflows',
      headers: { [TEST_USER_HEADER]: 'no-flows' },
    });

    expect(resp.statusCode).toBe(403);
    const body = JSON.parse(resp.body);
    expect(body?.error?.code).toBe('FORBIDDEN_FLOWS');
  });

  // ── Case (a): admin user → flows gate does NOT fire (200 from stub route) ──
  it('admin user → flows gate does not fire (request reaches route)', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/api/workflows',
      headers: { [TEST_USER_HEADER]: 'admin' },
    });

    // Admin bypasses the RBAC gate entirely → 200 from stub route
    expect(resp.statusCode).not.toBe(403);
    // Specifically expect the stub route response
    expect(resp.statusCode).toBe(200);
  });

  // ── Case (c): non-admin user WITH flows access → gate passes through ──
  it('non-admin user WITH flows access → flows gate passes through (200)', async () => {
    const resp = await server.inject({
      method: 'GET',
      url: '/api/workflows',
      headers: { [TEST_USER_HEADER]: 'with-flows' },
    });

    // Flows-enabled user → gate allows through → 200 from stub route
    expect(resp.statusCode).not.toBe(403);
    expect(resp.statusCode).toBe(200);
  });
});
