/**
 * GAP 2 regression — POST /api/admin/mcp/servers must fire-and-forget
 * MCPToolIndexingService.indexAllMCPTools() after proxy registration.
 *
 * Tested behaviors:
 * R1. A successful create triggers indexAllMCPTools (fire-and-forget).
 * R2. indexAllMCPTools error DOES NOT fail the HTTP response (non-blocking).
 * R3. POST /api/admin/mcp/servers/manifest also triggers reindex after bulk register.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const indexAllMCPToolsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../middleware/unifiedAuth.js', () => ({
  adminMiddleware: vi.fn(async () => {}),
}));

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    mCPServerConfig: {
      findUnique: vi.fn().mockResolvedValue(null), // no existing server
      create: vi.fn().mockResolvedValue({
        id: 'test-server',
        name: 'Test Server',
        command: 'npx',
        args: [],
        env: {},
        metadata: { transport: 'stdio' },
      }),
    },
    mCPServerStatus: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../../services/MCPSyncService.js', () => ({
  MCPSyncService: vi.fn().mockImplementation(() => ({
    startSync: vi.fn().mockResolvedValue(undefined),
    stopSync: vi.fn(),
    registerMCPServerWithProxy: vi.fn().mockResolvedValue(undefined),
    getMCPProxyServers: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../services/MCPToolIndexingService.js', () => ({
  MCPToolIndexingService: vi.fn().mockImplementation(() => ({
    indexAllMCPTools: indexAllMCPToolsMock,
  })),
}));

vi.mock('../../../services/CredentialAuditService.js', () => ({
  credentialAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Inject a fake user (admin) on every request
  app.addHook('preHandler', async (request: any) => {
    request.user = { id: 'admin-1', email: 'admin@test.local', isAdmin: true };
  });

  // Attach prisma to fastify so the reindex route can do `fastify.prisma`
  // (admin-mcp-tools.ts uses this pattern)
  const { prisma } = await import('../../../utils/prisma.js');
  (app as any).prisma = prisma;

  const mcpManagementRoutes = (await import('../mcp-management.js')).default;
  await app.register(mcpManagementRoutes);

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/mcp/servers — reindex on add', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the index mock to succeed by default
    indexAllMCPToolsMock.mockResolvedValue(undefined);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('R1: successful create triggers indexAllMCPTools fire-and-forget', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/mcp/servers',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'test-server',
        name: 'Test Server',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@mcp/test'],
        env: {},
      }),
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.success).toBe(true);

    // Give the fire-and-forget a tick to run
    await new Promise((r) => setTimeout(r, 10));

    expect(indexAllMCPToolsMock).toHaveBeenCalledWith(true);
  });

  it('R2: indexAllMCPTools failure does NOT fail the HTTP response', async () => {
    indexAllMCPToolsMock.mockRejectedValue(new Error('milvus offline'));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/mcp/servers',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'test-server',
        name: 'Test Server',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@mcp/test'],
        env: {},
      }),
    });

    // Response must be 200 regardless of reindex failure
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.success).toBe(true);
  });
});

describe('POST /api/admin/mcp/servers/manifest — Claude Desktop format', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    indexAllMCPToolsMock.mockResolvedValue(undefined);
    // Make prisma.create echo back the data that was passed in so result.name
    // reflects the actual server name the handler persists.
    const { prisma } = await import('../../../utils/prisma.js');
    (prisma.mCPServerConfig.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data }),
    );
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('R3a: Claude Desktop format → 200 with imported:1 and persist+register called', async () => {
    const { prisma } = await import('../../../utils/prisma.js');
    const { MCPSyncService } = await import('../../../services/MCPSyncService.js');

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/mcp/servers/manifest',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mcpServers: {
          test: {
            command: 'echo',
            args: ['hi'],
          },
        },
      }),
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.success).toBe(true);
    expect(body.imported).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].name).toBe('test');
    expect(body.results[0].status).toBe('registered');

    // prisma.mCPServerConfig.create must have been called
    expect((prisma.mCPServerConfig.create as any).mock.calls.length).toBeGreaterThan(0);
    const createArg = (prisma.mCPServerConfig.create as any).mock.calls[0][0].data;
    expect(createArg.command).toBe('echo');
    expect(createArg.args).toEqual(['hi']);

    // MCPSyncService.registerMCPServerWithProxy must have been called
    const mcpSyncInstance = (MCPSyncService as any).mock.results[0].value;
    expect(mcpSyncInstance.registerMCPServerWithProxy).toHaveBeenCalledTimes(1);

    // Give fire-and-forget reindex a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(indexAllMCPToolsMock).toHaveBeenCalledWith(true);
  });

  it('R3b: array format → 200 with imported:1', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/mcp/servers/manifest',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        servers: [
          {
            name: 'array-server',
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { MY_KEY: 'val' },
          },
        ],
      }),
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.success).toBe(true);
    expect(body.imported).toBe(1);
    expect(body.results[0].name).toBe('array-server');
    expect(body.results[0].status).toBe('registered');
  });

  it('R3c: invalid format → 400', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/mcp/servers/manifest',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notAManifest: true }),
    });

    expect(resp.statusCode).toBe(400);
    const body = JSON.parse(resp.body);
    expect(body.success).toBe(false);
  });

  it('R3d: reindex failure does NOT fail manifest import response', async () => {
    indexAllMCPToolsMock.mockRejectedValue(new Error('milvus offline'));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/admin/mcp/servers/manifest',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mcpServers: {
          test: { command: 'echo', args: ['hi'] },
        },
      }),
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.success).toBe(true);
    expect(body.imported).toBe(1);
  });
});
