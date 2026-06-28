/**
 * MCPSyncService.syncMCPServers() — TDD spec (RED first, GREEN after)
 *
 * GAP 1: syncMCPServers() is currently a stub that does nothing.
 * These tests drive the real implementation:
 *
 * S1. DB has servers A + B; proxy reports only A → registers B exactly once.
 * S2. Empty DB → no registerMCPServerWithProxy calls.
 * S3. Proxy unreachable (fetch rejects) → does NOT throw; logs + returns
 *     (fail-open: we can't tell what's running so we don't blindly re-register).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that touch them
// ---------------------------------------------------------------------------

const findManyMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    mCPServerConfig: {
      findMany: findManyMock,
    },
  },
}));

// Silence internal logger during tests
vi.mock('../../utils/logger.js', () => {
  const noop: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

import { MCPSyncService } from '../MCPSyncService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLogger = pino({ level: 'silent' }) as any;

function makeServer(name: string, id?: string) {
  return { id: id ?? name, name, command: 'npx', args: ['-y', `@mcp/${name}`], env: {}, enabled: true, metadata: { transport: 'stdio' } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPSyncService.syncMCPServers()', () => {
  let svc: MCPSyncService;
  let registerSpy: ReturnType<typeof vi.spyOn>;
  let getProxySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    svc = new MCPSyncService(silentLogger);
    registerSpy = vi.spyOn(svc, 'registerMCPServerWithProxy').mockResolvedValue(undefined);
    getProxySpy = vi.spyOn(svc, 'getMCPProxyServers');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('S1: registers only servers present in DB but absent from proxy (skip already-running ones)', async () => {
    const serverA = makeServer('server-a');
    const serverB = makeServer('server-b');

    // DB has A and B; proxy already has A running
    findManyMock.mockResolvedValue([serverA, serverB]);
    getProxySpy.mockResolvedValue([{ name: 'server-a', status: 'running' }]);

    await svc.syncMCPServers();

    // Should have called register exactly once — only for B
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith(serverB);
    // Must NOT re-register A
    expect(registerSpy).not.toHaveBeenCalledWith(serverA);
  });

  it('S2: does nothing when DB is empty', async () => {
    findManyMock.mockResolvedValue([]);
    getProxySpy.mockResolvedValue([]);

    await svc.syncMCPServers();

    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('S3: proxy unreachable → does not throw; does not blindly register', async () => {
    // If we can't reach the proxy we can't tell what's running.
    // Safe behavior: log + return without calling registerMCPServerWithProxy.
    const serverA = makeServer('server-a');
    findManyMock.mockResolvedValue([serverA]);
    getProxySpy.mockRejectedValue(new Error('ECONNREFUSED'));

    // Must not throw
    await expect(svc.syncMCPServers()).resolves.toBeUndefined();

    // Must not blindly register (we don't know proxy state)
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('S4: per-server register errors are caught and do not abort remaining servers', async () => {
    const serverA = makeServer('server-a');
    const serverB = makeServer('server-b');
    const serverC = makeServer('server-c');

    // DB has A, B, C; proxy has none
    findManyMock.mockResolvedValue([serverA, serverB, serverC]);
    getProxySpy.mockResolvedValue([]);

    // B fails to register but A and C should still proceed
    registerSpy.mockImplementation(async (s: any) => {
      if (s.name === 'server-b') throw new Error('spawn failed');
    });

    // Must not throw
    await expect(svc.syncMCPServers()).resolves.toBeUndefined();

    // All three attempted
    expect(registerSpy).toHaveBeenCalledTimes(3);
  });
});
