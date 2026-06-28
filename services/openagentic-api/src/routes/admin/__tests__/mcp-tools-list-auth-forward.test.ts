/**
 * Bug fix regression — GET /api/admin/mcp/tools-list must forward
 * the user's Authorization bearer to mcp-proxy.
 *
 * LIVE failure observed 2026-05-11 (k3s-local openagentic):
 *   - UI Admin > MCP Fleet click on "tools" tab → request hits
 *     /api/admin/mcp/tools-list → handler at routes/admin/mcp-management.ts:162
 *     forwards to mcp-proxy /tools WITHOUT an Authorization header →
 *     mcp-proxy logs "[auth] missing Authorization header — refusing 401"
 *     → 401 propagates back to UI → global response interceptor signs
 *     the user out + the MCP list page shows 0 tools.
 *
 * Contract under test:
 *   1. The handler forwards `Authorization: Bearer <accessToken>` from
 *      request.user.accessToken to mcp-proxy.
 *   2. Content-Type: application/json stays unchanged.
 *   3. When the user has no accessToken (e.g. internal service-to-service),
 *      the handler does NOT crash — it sends Content-Type only.
 *   4. The successful tools list returned by mcp-proxy is passed through
 *      to the UI unchanged.
 *
 * Per CLAUDE.md TDD discipline: this test is RED before the fix, GREEN after.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Module mocks — the handler imports adminMiddleware and a few prisma-touching
// dependencies. We stub them out so we can test the auth-forward path in
// isolation.
// ---------------------------------------------------------------------------

vi.mock('../../../middleware/unifiedAuth.js', () => ({
  adminMiddleware: vi.fn(async (_request: any, _reply: any) => {
    // No-op: tests inject request.user via preHandler hook.
  }),
}));

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {} as any,
}));

vi.mock('../../../services/MCPSyncService.js', () => ({
  MCPSyncService: vi.fn().mockImplementation(() => ({
    startSync: vi.fn().mockResolvedValue(undefined),
    stopSync: vi.fn(),
  })),
}));

vi.mock('../../../services/CredentialAuditService.js', () => ({
  credentialAuditService: {
    record: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchSpy(opts: { responseBody?: any; status?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(opts.responseBody ?? { tools: [] }), {
      status: opts.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchSpy, calls };
}

async function buildApp(opts: {
  user?: { id?: string; accessToken?: string; isAdmin?: boolean } | null;
} = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request: any) => {
    if (opts.user) {
      request.user = {
        id: opts.user.id ?? 'local_abc123',
        email: 'admin@example.com',
        isAdmin: opts.user.isAdmin ?? true,
        accessToken: opts.user.accessToken,
        authMethod: 'local',
      };
    }
  });

  const { default: mcpManagementRoutes } = await import('../mcp-management.js');
  await app.register(mcpManagementRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/mcp/tools-list — auth forward to mcp-proxy (LIVE 2026-05-11)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8080';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('forwards request.user.accessToken as Authorization: Bearer to mcp-proxy', async () => {
    const { fetchSpy, calls } = makeFetchSpy({
      responseBody: { tools: [{ name: 'azure_list_subscriptions' }] },
    });
    globalThis.fetch = fetchSpy as any;

    const app = await buildApp({
      user: { accessToken: 'TEST_USER_ACCESS_TOKEN_abc.def.ghi' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/mcp/tools-list',
    });

    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://mcp-proxy:8080/tools');

    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Authorization']).toBe('Bearer TEST_USER_ACCESS_TOKEN_abc.def.ghi');
    expect(headers['Content-Type']).toBe('application/json');

    await app.close();
  });

  it('passes mcp-proxy tools list through to caller verbatim', async () => {
    const expectedTools = [
      { name: 'aws_list_ec2', server: 'openagentic-aws' },
      { name: 'azure_list_subscriptions', server: 'openagentic-azure' },
    ];
    const { fetchSpy } = makeFetchSpy({ responseBody: { tools: expectedTools } });
    globalThis.fetch = fetchSpy as any;

    const app = await buildApp({
      user: { accessToken: 'TEST_TOKEN' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/mcp/tools-list',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tools).toEqual(expectedTools);
    expect(body.total).toBe(2);
    expect(body.source).toBe('mcp-proxy');

    await app.close();
  });

  it('does NOT crash when request.user.accessToken is missing (sends Content-Type only)', async () => {
    const { fetchSpy, calls } = makeFetchSpy();
    globalThis.fetch = fetchSpy as any;

    const app = await buildApp({
      user: { /* no accessToken */ },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/mcp/tools-list',
    });

    // Handler still calls mcp-proxy (mcp-proxy will return 401 in prod, but
    // that's its responsibility, not ours to short-circuit).
    expect(calls).toHaveLength(1);
    const headers = (calls[0].init.headers as Record<string, string>) ?? {};
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBeUndefined();
    // Response is still 200 because our stub returns 200 regardless.
    expect(res.statusCode).toBe(200);

    await app.close();
  });
});
