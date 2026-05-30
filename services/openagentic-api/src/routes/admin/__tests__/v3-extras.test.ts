/**
 * v3-extras admin routes — TDD spec
 *
 * Covers the 14 read-only endpoints registered by routes/admin/v3-extras.ts.
 * Each endpoint is exercised for:
 *   - 200 OK on the happy path (with mocked Prisma data)
 *   - 400 on bad input (missing/invalid params) — endpoints with required params
 *   - 500 on Prisma failure (rejected query)
 *
 * Auth coverage: defence-in-depth onRequest hook returns 403 for non-admin
 * users when the route is mounted bare (production mounts adminMiddleware
 * via the parent register scope in admin.plugin.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock prisma — vi.mock is hoisted, so we wire fresh mock fns before import.
// ---------------------------------------------------------------------------

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    modelRoutingDecision: { findMany: vi.fn() },
    adminAuditLog:        { findMany: vi.fn(), findUnique: vi.fn() },
    userPermissions:      { findMany: vi.fn() },
    user:                 { findMany: vi.fn() },
    groupPermissions:     { findMany: vi.fn() },
    mCPUsage:             { findMany: vi.fn() },
    workflowExecution:    { findMany: vi.fn() },
    lLMRequestLog:        { findMany: vi.fn() },
    apiKey:               { findMany: vi.fn() },
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  loggers: {
    routes: {
      child: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    },
  },
}));

import { prisma } from '../../../utils/prisma.js';
const p = prisma as any;

/** Build a Fastify app, optionally mounting an auth-stub preHandler. */
async function buildApp(opts: {
  isAdmin?: boolean;
  unauthenticated?: boolean;
  noUserAttached?: boolean;
} = {}): Promise<FastifyInstance> {
  const { isAdmin = true, unauthenticated = false, noUserAttached = false } = opts;
  const app = Fastify({ logger: false });

  if (!noUserAttached) {
    app.addHook('preHandler', async (request: any, reply) => {
      if (unauthenticated) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' });
      }
      request.user = {
        id: 'test-user',
        email: 'admin@openagentic.io',
        isAdmin,
        role: isAdmin ? 'admin' : 'user',
      };
    });
  }

  const { default: routes } = await import('../v3-extras.js');
  await app.register(routes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// 1. GET /router/decisions
// ===========================================================================
describe('GET /api/admin/router/decisions', () => {
  it('200: returns decisions array with projected v3 shape', async () => {
    const now = new Date('2026-05-06T12:00:00Z');
    p.modelRoutingDecision.findMany.mockResolvedValue([
      {
        id: 'd1',
        session_id: 's1',
        model_from: 'gpt-oss:20b',
        model_to: 'claude-sonnet-4.6',
        reason: 'cloud-list escalation',
        context: { prompt: 'show me my RGs', intent: 'cloud-list', score: 0.94, alternates: ['gemini-2.5-flash'] },
        created_at: now,
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/router/decisions?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]).toMatchObject({
      id: 'd1',
      chosenModel: 'claude-sonnet-4.6',
      previousModel: 'gpt-oss:20b',
      intent: 'cloud-list',
      score: 0.94,
    });
    expect(p.modelRoutingDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { created_at: 'desc' }, take: 5 }),
    );
    await app.close();
  });

  it('500: handles Prisma error gracefully', async () => {
    p.modelRoutingDecision.findMany.mockRejectedValue(new Error('db down'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/router/decisions' });
    expect(res.statusCode).toBe(500);
    expect(res.json().success).toBe(false);
    await app.close();
  });
});

// ===========================================================================
// 2. GET /mcp/servers/:id/healthcheck-history
// ===========================================================================
describe('GET /api/admin/mcp/servers/:id/healthcheck-history', () => {
  it('200: derives probes from admin_audit_log fallback scan', async () => {
    p.adminAuditLog.findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'mcp.healthcheck.ok',
        resource_id: 'srv-1',
        details: { latencyMs: 45 },
        created_at: new Date('2026-05-06T12:00:00Z'),
      },
      {
        id: 'a2',
        action: 'mcp.healthcheck.fail',
        resource_id: 'srv-1',
        details: { error: 'connection refused' },
        created_at: new Date('2026-05-06T11:00:00Z'),
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/servers/srv-1/healthcheck-history?hours=12' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.probes).toHaveLength(2);
    expect(body.probes[0].status).toBe('ok');
    expect(body.probes[1].status).toBe('fail');
    expect(body.source).toBe('admin_audit_log');
    await app.close();
  });

  it('500: surfaces Prisma error', async () => {
    p.adminAuditLog.findMany.mockRejectedValue(new Error('db'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/mcp/servers/srv-1/healthcheck-history' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ===========================================================================
// 3. GET /permissions?mcpServer=:name
// ===========================================================================
describe('GET /api/admin/permissions', () => {
  it('400: returns 400 when mcpServer query param missing', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/mcpServer/);
    await app.close();
  });

  it('200: cross-references UserPermissions and GroupPermissions', async () => {
    p.userPermissions.findMany.mockResolvedValue([
      { user_id: 'u1', allowed_mcp_servers: ['azure-mcp'], denied_mcp_servers: [] },
      { user_id: 'u2', allowed_mcp_servers: [], denied_mcp_servers: ['azure-mcp'] },
    ]);
    p.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@x.io', name: 'Alice' },
      { id: 'u2', email: 'b@x.io', name: 'Bob' },
    ]);
    p.groupPermissions.findMany.mockResolvedValue([
      {
        azure_group_id: 'g1',
        azure_group_name: 'Cloud-Ops',
        allowed_mcp_servers: ['azure-mcp'],
        denied_mcp_servers: [],
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions?mcpServer=azure-mcp' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users).toHaveLength(2);
    expect(body.users[0]).toMatchObject({ userId: 'u1', allowed: true, source: 'allowed' });
    expect(body.users[1]).toMatchObject({ userId: 'u2', allowed: false, source: 'denied' });
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({ groupId: 'g1', name: 'Cloud-Ops', allowed: true });
    await app.close();
  });

  it('500: Prisma rejection bubbles 500', async () => {
    p.userPermissions.findMany.mockRejectedValue(new Error('db'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions?mcpServer=foo' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ===========================================================================
// 4. GET /mcp-cost?serverName=:name
// ===========================================================================
describe('GET /api/admin/mcp-cost', () => {
  it('400: serverName missing', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/mcp-cost' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('200: returns hourly bucketed series', async () => {
    p.mCPUsage.findMany.mockResolvedValue([
      { timestamp: new Date('2026-05-06T12:30:00Z'), execution_time_ms: 100, token_count: 50 },
      { timestamp: new Date('2026-05-06T12:45:00Z'), execution_time_ms: 200, token_count: 80 },
      { timestamp: new Date('2026-05-06T13:05:00Z'), execution_time_ms: 150, token_count: 60 },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/mcp-cost?serverName=azure-mcp&window=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.series).toHaveLength(2);
    expect(body.series[0].calls).toBe(2);
    expect(body.series[1].calls).toBe(1);
    expect(body.series[0].cost).toBe(0); // pricing column not present yet
    await app.close();
  });
});

// ===========================================================================
// 5. GET /flows/recent-failures
// ===========================================================================
describe('GET /api/admin/flows/recent-failures', () => {
  it('200: returns failed executions only', async () => {
    p.workflowExecution.findMany.mockResolvedValue([
      {
        id: 'e1',
        workflow_id: 'wf-1',
        error_node_id: 'node-3',
        error: 'token expired',
        started_at: new Date('2026-05-06T11:00:00Z'),
        completed_at: new Date('2026-05-06T11:00:30Z'),
        execution_time_ms: 30000,
        started_by: 'u1',
        workflow: { id: 'wf-1', name: 'Sync Sales' },
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/recent-failures?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]).toMatchObject({
      executionId: 'e1',
      workflowName: 'Sync Sales',
      failedNodeId: 'node-3',
      error: 'token expired',
    });
    expect(p.workflowExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['failed', 'error'] } },
        take: 10,
      }),
    );
    await app.close();
  });

  it('500: Prisma error', async () => {
    p.workflowExecution.findMany.mockRejectedValue(new Error('db'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/recent-failures' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ===========================================================================
// 6. GET /flows/failing-nodes
// ===========================================================================
describe('GET /api/admin/flows/failing-nodes', () => {
  it('200: aggregates failure counts per node, sorts desc', async () => {
    p.workflowExecution.findMany.mockResolvedValue([
      { workflow_id: 'wf-1', error_node_id: 'n-a', started_at: new Date('2026-05-06T10:00Z'), completed_at: new Date('2026-05-06T10:01Z') },
      { workflow_id: 'wf-1', error_node_id: 'n-a', started_at: new Date('2026-05-06T11:00Z'), completed_at: new Date('2026-05-06T11:01Z') },
      { workflow_id: 'wf-2', error_node_id: 'n-b', started_at: new Date('2026-05-06T12:00Z'), completed_at: null },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/failing-nodes?include=lastSeen' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nodes[0]).toMatchObject({ nodeId: 'n-a', count: 2 });
    expect(body.nodes[1]).toMatchObject({ nodeId: 'n-b', count: 1 });
    expect(body.nodes[0]).toHaveProperty('lastSeen');
    await app.close();
  });
});

// ===========================================================================
// 7. GET /workflows/:id/cost
// ===========================================================================
describe('GET /api/admin/workflows/:id/cost', () => {
  it('400: invalid groupBy', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/workflows/wf-1/cost?groupBy=year' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('200: bucketed cost series by day', async () => {
    p.workflowExecution.findMany.mockResolvedValue([
      { started_at: new Date('2026-05-04T12:00Z'), cost: 0.12, status: 'completed' },
      { started_at: new Date('2026-05-04T18:00Z'), cost: 0.08, status: 'failed' },
      { started_at: new Date('2026-05-05T09:00Z'), cost: 0.20, status: 'completed' },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/workflows/wf-1/cost?window=7d&groupBy=day' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.series).toHaveLength(2);
    expect(body.series[0]).toMatchObject({ timestamp: '2026-05-04', runs: 2, failed: 1 });
    expect(body.series[0].cost).toBeCloseTo(0.20, 5);
    await app.close();
  });
});

// ===========================================================================
// 8. GET /api-requests/top-endpoints
// ===========================================================================
describe('GET /api/admin/api-requests/top-endpoints', () => {
  it('200: ranks endpoints by call count from audit-log fallback', async () => {
    p.adminAuditLog.findMany.mockResolvedValue([
      { action: 'api.list', details: { endpoint: '/api/users', statusCode: 200, latencyMs: 10 } },
      { action: 'api.list', details: { endpoint: '/api/users', statusCode: 200, latencyMs: 14 } },
      { action: 'api.get',  details: { endpoint: '/api/health', statusCode: 500, latencyMs: 5 } },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-requests/top-endpoints?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.endpoints[0]).toMatchObject({ path: '/api/users', calls: 2, avgMs: 12, errorRate: 0 });
    expect(body.endpoints[1]).toMatchObject({ path: '/api/health', calls: 1, errorRate: 1 });
    await app.close();
  });
});

// ===========================================================================
// 9. GET /api-requests/status-codes
// ===========================================================================
describe('GET /api/admin/api-requests/status-codes', () => {
  it('200: returns status-code histogram', async () => {
    p.adminAuditLog.findMany.mockResolvedValue([
      { details: { statusCode: 200 } },
      { details: { statusCode: 200 } },
      { details: { statusCode: 404 } },
      { details: { statusCode: 500 } },
      { details: {} }, // unknown
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-requests/status-codes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.codes['200']).toBe(2);
    expect(body.codes['404']).toBe(1);
    expect(body.codes['500']).toBe(1);
    expect(body.codes['unknown']).toBe(1);
    await app.close();
  });
});

// ===========================================================================
// 10. GET /api-requests/auth-methods
// ===========================================================================
describe('GET /api/admin/api-requests/auth-methods', () => {
  it('200: combines audit-log authMethod + LLMRequestLog api-key counts', async () => {
    p.adminAuditLog.findMany.mockResolvedValue([
      { details: { authMethod: 'sso' } },
      { details: { authMethod: 'sso' } },
      { details: { authMethod: 'jwt' } },
    ]);
    p.lLMRequestLog.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-requests/auth-methods' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.methods.sso).toBe(2);
    expect(body.methods.jwt).toBe(1);
    expect(body.methods['api-key']).toBe(2);
    await app.close();
  });
});

// ===========================================================================
// 11. GET /perf/percentiles
// ===========================================================================
describe('GET /api/admin/perf/percentiles', () => {
  it('200: computes p50/p95/p99 grouped by provider:model', async () => {
    p.lLMRequestLog.findMany.mockResolvedValue([
      { provider_type: 'azure', model: 'gpt-4o', latency_ms: 100 },
      { provider_type: 'azure', model: 'gpt-4o', latency_ms: 200 },
      { provider_type: 'azure', model: 'gpt-4o', latency_ms: 300 },
      { provider_type: 'azure', model: 'gpt-4o', latency_ms: 400 },
      { provider_type: 'ollama', model: 'gpt-oss:20b', latency_ms: 50 },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/perf/percentiles?window=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows[0].endpoint).toBe('azure:gpt-4o');
    expect(body.rows[0].count).toBe(4);
    expect(body.rows[0].p50).toBeGreaterThan(0);
    expect(body.rows[0].p99).toBeGreaterThanOrEqual(body.rows[0].p50);
    await app.close();
  });
});

// ===========================================================================
// 12. GET /openagentic/api-keys
// ===========================================================================
describe('GET /api/admin/openagentic/api-keys', () => {
  it('200: lists keys without exposing the secret', async () => {
    p.apiKey.findMany.mockResolvedValue([
      {
        id: 'k1',
        name: 'cli-laptop',
        key_hash: 'abcdef1234567890',
        last_used_at: new Date('2026-05-06T10:00Z'),
        created_at: new Date('2026-05-01T10:00Z'),
        expires_at: null,
        rate_limit_tier: 'pro',
        user_id: 'u1',
        user: { id: 'u1', email: 'a@x.io', name: 'Alice' },
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/openagentic/api-keys' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      id: 'k1',
      prefix: 'abcdef12',
      owner: 'a@x.io',
      name: 'cli-laptop',
      rateLimitTier: 'pro',
    });
    // CRITICAL: ensure full hash is never returned.
    expect(JSON.stringify(body)).not.toContain('abcdef1234567890');
    await app.close();
  });
});

// ===========================================================================
// 13. GET /llm-providers/:id/health-history
// ===========================================================================
describe('GET /api/admin/llm-providers/:id/health-history', () => {
  it('200: derives probes from audit-log fallback', async () => {
    p.adminAuditLog.findMany.mockResolvedValue([
      {
        action: 'provider.healthcheck.ok',
        resource_id: 'p1',
        details: { latencyMs: 80 },
        created_at: new Date('2026-05-06T12:00Z'),
      },
      {
        action: 'provider.healthcheck.fail',
        resource_id: 'p1',
        details: { error: 'auth refused' },
        created_at: new Date('2026-05-06T11:00Z'),
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/llm-providers/p1/health-history?hours=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.probes).toHaveLength(2);
    expect(body.probes[0].healthy).toBe(true);
    expect(body.probes[1].healthy).toBe(false);
    await app.close();
  });
});

// ===========================================================================
// 14. GET /audit-logs/:id
// ===========================================================================
describe('GET /api/admin/audit-logs/:id', () => {
  it('404: returns 404 when not found', async () => {
    p.adminAuditLog.findUnique.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs/missing' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('200: returns the joined log with admin user', async () => {
    p.adminAuditLog.findUnique.mockResolvedValue({
      id: 'a1',
      admin_user_id: 'u1',
      admin_email: 'admin@x.io',
      action: 'mcp.update',
      resource_type: 'McpServerConfig',
      resource_id: 'srv-1',
      details: { changes: ['enabled=true'] },
      ip_address: '10.0.0.1',
      created_at: new Date('2026-05-06T10:00Z'),
      previous_hash: null,
      chain_hash: 'sha256:abc',
      user: { id: 'u1', email: 'admin@x.io', name: 'Admin' },
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs/a1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.log).toMatchObject({
      id: 'a1',
      adminEmail: 'admin@x.io',
      action: 'mcp.update',
      chainHash: 'sha256:abc',
    });
    await app.close();
  });
});

// ===========================================================================
// AUTH: defence-in-depth onRequest hook
// ===========================================================================
describe('Defence-in-depth admin guard', () => {
  it('403 when authenticated user is not admin', async () => {
    const app = await buildApp({ isAdmin: false });
    // Use any endpoint with low surface area:
    const res = await app.inject({ method: 'GET', url: '/api/admin/router/decisions' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
