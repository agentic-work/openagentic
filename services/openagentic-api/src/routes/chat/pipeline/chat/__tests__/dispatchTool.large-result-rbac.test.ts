/**
 * dispatchTool — read_large_result RBAC (#974, 2026-05-20 PM).
 *
 * Pins:
 *  - dispatchReadLargeResult threads `ctx.user.{id,tenantId,allowedMcpServers}`
 *    through to `LargeResultStorageService.getResultAsync(handle, auth)`.
 *  - When the storage layer rejects (returns null), the dispatch arm returns
 *    `{ ok:false, error }` rather than leaking a "handle not found" without
 *    distinguishing RBAC denial vs. real absence. The error message
 *    contains "not found or not authorized" — never leaks ownership.
 *  - When the caller is the owner, the result flows through verbatim.
 *
 * Plan: T1 RBAC + Prom counters (#974, controller-dispatched 2026-05-20 PM).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';
import {
  LargeResultStorageService,
  setLargeResultStorageServiceInstance,
} from '../../../../../services/LargeResultStorageService.js';

// Mock Redis so we have a fully in-memory store.
const redisStore = new Map<string, unknown>();
vi.mock('../../../../../utils/redis-client.js', () => {
  return {
    getRedisClient: () => ({
      set: async (key: string, value: unknown) => {
        redisStore.set(key, value);
      },
      get: async (key: string) => redisStore.get(key) ?? null,
      keys: async (pattern: string) => {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
        return Array.from(redisStore.keys()).filter((k) => re.test(k));
      },
    }),
  };
});

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
  } as any;
}

function makeRunCtx(user: any) {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-1',
    userId: user.id,
    user,
    toolUseId: 'toolu_abc',
  } as any;
}

function makeV2Deps() {
  return {
    executeComposeVisual: vi.fn(),
    executeComposeApp: vi.fn(),
    executeRenderArtifact: vi.fn(),
    executeTask: vi.fn(),
    executeRequestClarification: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    executeMemorize: vi.fn(),
    executeMcpTool: vi.fn(),
    listSubagentTypes: vi.fn().mockResolvedValue([]),
    runSubagent: vi.fn(),
  } as any;
}

describe('dispatchTool — read_large_result RBAC (#974)', () => {
  let svc: LargeResultStorageService;
  let storedId: string;

  beforeEach(async () => {
    redisStore.clear();
    svc = new LargeResultStorageService(makeLogger());
    setLargeResultStorageServiceInstance(svc);
    // Seed a stored result owned by user-alpha / tenant-1.
    const info = await svc.storeResult({
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      sessionId: 'sess-source',
      toolName: 'openagentic_azure_list_subscriptions',
      toolCallId: 'tu_source',
      result: { subscriptions: [{ id: 's-1', name: 'production' }] },
    });
    storedId = info.resultId;
  });

  afterEach(() => {
    // Cleanup: reset singleton so other tests get a fresh instance.
    setLargeResultStorageServiceInstance(new LargeResultStorageService(makeLogger()));
  });

  it('owner read — same userId+tenantId returns the stored result', async () => {
    const dispatch = makeDispatch({ v2Deps: makeV2Deps(), enrichedTools: {} });
    const ctx = makeRunCtx({
      id: 'user-alpha',
      tenantId: 'tenant-1',
      allowedMcpServers: ['azure'],
    });

    const result = await dispatch(ctx, {
      name: 'read_large_result',
      input: { handle: storedId, offset: 0, limit: 10 },
    });

    expect(result.ok).toBe(true);
    expect((result.output as any)?.subscriptions?.[0]?.id).toBe('s-1');
  });

  it('cross-user read — same tenant, different userId returns ok:false with "not authorized" error', async () => {
    const dispatch = makeDispatch({ v2Deps: makeV2Deps(), enrichedTools: {} });
    // user-beta tries to read user-alpha's handle.
    const ctx = makeRunCtx({
      id: 'user-beta',
      tenantId: 'tenant-1',
      allowedMcpServers: ['azure'],
    });

    const result = await dispatch(ctx, {
      name: 'read_large_result',
      input: { handle: storedId },
    });

    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/not found or not authorized/i);
  });

  it('cross-tenant read — different tenantId returns ok:false', async () => {
    const dispatch = makeDispatch({ v2Deps: makeV2Deps(), enrichedTools: {} });
    const ctx = makeRunCtx({
      id: 'user-alpha',
      tenantId: 'tenant-2', // different tenant
      allowedMcpServers: ['azure'],
    });

    const result = await dispatch(ctx, {
      name: 'read_large_result',
      input: { handle: storedId },
    });

    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/not found or not authorized/i);
  });

  it('owner read with allowedMcpServers excluding the originating server returns ok:false', async () => {
    const dispatch = makeDispatch({ v2Deps: makeV2Deps(), enrichedTools: {} });
    // Caller IS the owner but their allowed-MCP-servers list excludes azure
    // (e.g. dynamic admin downgrade after the result was originally stored).
    const ctx = makeRunCtx({
      id: 'user-alpha',
      tenantId: 'tenant-1',
      allowedMcpServers: ['aws', 'gcp'],
    });

    const result = await dispatch(ctx, {
      name: 'read_large_result',
      input: { handle: storedId },
    });

    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/not found or not authorized/i);
  });
});
