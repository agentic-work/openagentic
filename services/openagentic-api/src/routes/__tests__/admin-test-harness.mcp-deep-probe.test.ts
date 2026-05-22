/**
 * Admin Test Harness — MCP category MUST do tools/list + call ONE idempotent
 * tool per server with duration captured.
 *
 * RED before fix (2026-05-21): the MCP block only reads /health and emits
 * pass/fail per server from `status === 'running'`. No tool exercise, no
 * duration, no operation evidence. User feedback verbatim: "there is no
 * message or operation time on the mcps making me believe they are not
 * being tested".
 *
 * GREEN after fix: per server in /health.servers.statuses, the harness
 *   1. GET /v1/mcp/tools?server=<name>  (auth: Bearer MCP_PROXY_API_KEY)
 *   2. Pick the first tool with name matching /^(list|get|health|describe)_/
 *   3. POST /mcp/tool {server,tool,arguments:{},id:'harness-...'}
 *   4. Emit {category:'mcp', test:<server>, durationMs:<n>, details:{tool}}
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => {
  const noop: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  };
  noop.child = () => noop;
  noop.bindings = () => ({});
  return { default: noop, logger: noop, loggers: {}, logError: vi.fn(), shutdown: vi.fn() };
});

describe('admin-test-harness — MCP category deep probe', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls /v1/mcp/tools per server then POSTs /mcp/tool with first idempotent tool', async () => {
    const axiosGets: string[] = [];
    const axiosPosts: Array<{ url: string; body: any }> = [];

    vi.doMock('axios', () => ({
      default: {
        get: vi.fn(async (url: string) => {
          axiosGets.push(url);
          if (url.endsWith('/health')) {
            return {
              data: {
                status: 'healthy',
                servers: {
                  total: 2,
                  running: 2,
                  statuses: {
                    openagentic_admin: { status: 'running', transport: 'stdio', enabled: true, pid: 1 },
                    openagentic_kubernetes: { status: 'running', transport: 'stdio', enabled: true, pid: 2 },
                  },
                },
              },
            };
          }
          if (url.includes('/v1/mcp/tools')) {
            return {
              data: {
                tools: [
                  { name: 'list_namespaces', description: 'List k8s namespaces' },
                  { name: 'get_pod_logs', description: 'Get logs from a pod' },
                ],
              },
            };
          }
          return { data: {} };
        }),
        post: vi.fn(async (url: string, body: any) => {
          axiosPosts.push({ url, body });
          return { data: { result: { ok: true } } };
        }),
      },
    }));

    const { runTestHarness } = await import('../admin-test-harness-helpers.js').catch(() => ({
      runTestHarness: null,
    }));

    // If the helper isn't exported yet, drive via the handler directly.
    // To keep the test surgical we just assert that the MCP block, when run
    // with categories:['mcp'], performs ≥1 GET against /v1/mcp/tools per
    // server AND ≥1 POST to /mcp/tool per server.
    const harnessModule = await import('../admin-test-harness.js');
    const fakeRequest: any = {
      body: { categories: ['mcp'] },
      user: { id: 'admin', isAdmin: true },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    };
    const writes: string[] = [];
    const fakeReply: any = {
      raw: {
        write: (chunk: string) => { writes.push(chunk); return true; },
        end: () => {},
        writableEnded: false,
      },
      header: () => fakeReply,
      type: () => fakeReply,
      send: () => fakeReply,
    };

    // Locate the POST /run handler factory + invoke it.
    const register = (harnessModule as any).registerAdminTestHarnessRoutes
      || (harnessModule as any).default
      || (harnessModule as any).registerAdminTestHarness;
    expect(register, 'registerAdminTestHarnessRoutes export exists').toBeTruthy();

    const fastifyStub: any = {
      get: () => {},
      post: (path: string, ...args: any[]) => {
        const handler = args[args.length - 1];
        if (path === '/run') (fastifyStub as any)._runHandler = handler;
      },
    };
    await register(fastifyStub);
    expect(fastifyStub._runHandler, 'POST /run handler registered').toBeTruthy();
    await fastifyStub._runHandler(fakeRequest, fakeReply);

    // ASSERT: tools/list called per server
    const toolsListCalls = axiosGets.filter((u) => u.includes('/v1/mcp/tools'));
    expect(toolsListCalls.length, 'tools/list called per server').toBeGreaterThanOrEqual(2);

    // ASSERT: tool invocation called per server
    const toolCalls = axiosPosts.filter((p) => p.url.endsWith('/mcp/tool'));
    expect(toolCalls.length, 'tool call POSTed per server').toBeGreaterThanOrEqual(2);

    // ASSERT: NDJSON emits include per-server rows with durationMs > 0 and details.tool
    const rows = writes
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean) as any[];

    const serverRows = rows.filter((r) => r.category === 'mcp' && r.test !== 'MCP Proxy');
    expect(serverRows.length, 'one mcp row per server').toBeGreaterThanOrEqual(2);
    for (const row of serverRows) {
      expect(row.durationMs, `${row.test} has durationMs`).toBeGreaterThan(0);
      expect(row.details?.tool, `${row.test} carries invoked tool name`).toBeTruthy();
    }
  });

  /**
   * #1027 (2026-05-22) — RED: the Authorization header MUST be
   * `Bearer awc_system_${HMAC(INTERNAL_SERVICE_SECRET, 'openagentic-system-token')}`,
   * NOT `Bearer ${process.env.MCP_PROXY_API_KEY}` (the wrong env var that's
   * never set in the live api pod → empty Bearer → 401 on every openagentic_* MCP).
   *
   * Smoking gun: live harness probe on the dev environment showed mcp 1p/10f, all 10 fails
   * with `Request failed with status code 401`. api pod env: MCP_PROXY_API_KEY
   * length 0, INTERNAL_SERVICE_SECRET length 64. mcp-proxy auth scheme spec is
   * services/openagentic-mcp-proxy/src/main.py:913.
   */
  it('signs MCP proxy requests with awc_system_ token minted from INTERNAL_SERVICE_SECRET', async () => {
    const { createHmac } = await import('node:crypto');
    const TEST_SECRET = 'test-internal-service-secret-for-#1027';
    const expectedSuffix = createHmac('sha256', TEST_SECRET)
      .update('openagentic-system-token')
      .digest('base64url');
    const expectedAuth = `Bearer awc_system_${expectedSuffix}`;

    const prevSecret = process.env.INTERNAL_SERVICE_SECRET;
    const prevApiKey = process.env.MCP_PROXY_API_KEY;
    process.env.INTERNAL_SERVICE_SECRET = TEST_SECRET;
    delete process.env.MCP_PROXY_API_KEY; // PROVES: we MUST use INTERNAL_SERVICE_SECRET, not MCP_PROXY_API_KEY

    try {
      const capturedAuth: string[] = [];

      vi.doMock('axios', () => ({
        default: {
          get: vi.fn(async (url: string, config?: any) => {
            const auth = config?.headers?.Authorization || '';
            if (url.includes('/v1/mcp/tools')) capturedAuth.push(auth);
            if (url.endsWith('/health')) {
              return {
                data: {
                  status: 'healthy',
                  servers: {
                    total: 1,
                    running: 1,
                    statuses: {
                      openagentic_admin: { status: 'running', transport: 'stdio', enabled: true, pid: 1 },
                    },
                  },
                },
              };
            }
            if (url.includes('/v1/mcp/tools')) {
              return { data: { tools: [{ name: 'list_users', description: 'list' }] } };
            }
            return { data: {} };
          }),
          post: vi.fn(async (url: string, _body: any, config?: any) => {
            const auth = config?.headers?.Authorization || '';
            if (url.endsWith('/mcp/tool')) capturedAuth.push(auth);
            return { data: { result: { ok: true } } };
          }),
        },
      }));

      const harnessModule = await import('../admin-test-harness.js');
      const register = (harnessModule as any).registerAdminTestHarnessRoutes
        || (harnessModule as any).default
        || (harnessModule as any).registerAdminTestHarness;

      const fastifyStub: any = {
        get: () => {},
        post: (path: string, ...args: any[]) => {
          const handler = args[args.length - 1];
          if (path === '/run') (fastifyStub as any)._runHandler = handler;
        },
      };
      await register(fastifyStub);

      const fakeRequest: any = {
        body: { categories: ['mcp'] },
        user: { id: 'admin', isAdmin: true },
        log: { info: () => {}, warn: () => {}, error: () => {} },
      };
      const fakeReply: any = {
        raw: { write: () => true, end: () => {}, writableEnded: false },
        header: () => fakeReply, type: () => fakeReply, send: () => fakeReply,
      };
      await fastifyStub._runHandler(fakeRequest, fakeReply);

      // ASSERT: every captured Authorization header is the expected awc_system_ token,
      // NOT `Bearer ` (empty MCP_PROXY_API_KEY).
      expect(capturedAuth.length, 'at least one MCP proxy call captured').toBeGreaterThan(0);
      for (const auth of capturedAuth) {
        expect(auth, 'Authorization header uses awc_system_ from INTERNAL_SERVICE_SECRET').toBe(expectedAuth);
      }
    } finally {
      if (prevSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
      else process.env.INTERNAL_SERVICE_SECRET = prevSecret;
      if (prevApiKey !== undefined) process.env.MCP_PROXY_API_KEY = prevApiKey;
    }
  });
});
