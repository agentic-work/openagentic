/**
 * LargeResultStorageService — RBAC (#974, 2026-05-20 PM).
 *
 * Pins:
 *  - storeResult embeds `tenantId:userId:resultId` in the Redis key
 *    (no longer the random `large_result:result_<ts>_<rand9>` shape).
 *  - getResultAsync(resultId, { userId, tenantId }) rejects when the
 *    caller's namespace does not match the stored owner.
 *  - getResultAsync(resultId, { ..., allowedMcpServers }) rejects when
 *    the stored tool's MCP server is not in the caller's allow-list.
 *  - getResultAsync(resultId) without auth preserves legacy behavior
 *    (returns the result — used by sub-agent trace store reads).
 *  - inferMcpServerFromToolName extracts the server prefix from `openagentic_*`
 *    and bare `<server>_<verb>_<noun>` tool slugs.
 *
 * Plan: T1 RBAC + Prom counters (#974, controller-dispatched 2026-05-20 PM).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LargeResultStorageService,
  inferMcpServerFromToolName,
} from '../LargeResultStorageService.js';

// ─── Redis client stub ──────────────────────────────────────────────────────
// Hoist so the module-level `getRedisClient` import inside
// LargeResultStorageService picks up our mock. We use a Map-backed in-memory
// store and let `keys(pattern)` glob-match.
const redisStore = new Map<string, unknown>();
let lastSetCall: { key: string; value: unknown; ttl: number } | null = null;

vi.mock('../../utils/redis-client.js', () => {
  return {
    getRedisClient: () => ({
      set: async (key: string, value: unknown, ttl: number) => {
        redisStore.set(key, value);
        lastSetCall = { key, value, ttl };
      },
      get: async (key: string) => redisStore.get(key) ?? null,
      keys: async (pattern: string) => {
        // Convert glob to RegExp. Only `*` is supported by our usage.
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

describe('inferMcpServerFromToolName', () => {
  it('extracts the server segment from openagentic_<server>_<verb>_<noun>', () => {
    expect(inferMcpServerFromToolName('openagentic_azure_list_subscriptions')).toBe('azure');
    expect(inferMcpServerFromToolName('openagentic_aws_describe_instance')).toBe('aws');
    expect(inferMcpServerFromToolName('openagentic_gcp_get_project')).toBe('gcp');
  });

  it('falls back to first underscore-segment for legacy `<server>_<verb>` slugs', () => {
    expect(inferMcpServerFromToolName('azure_list_subscriptions')).toBe('azure');
    expect(inferMcpServerFromToolName('k8s_get_pod')).toBe('k8s');
  });

  it('returns null for empty / no-prefix inputs', () => {
    expect(inferMcpServerFromToolName('')).toBeNull();
    expect(inferMcpServerFromToolName('singleword')).toBeNull();
  });
});

describe('LargeResultStorageService — #974 RBAC', () => {
  let svc: LargeResultStorageService;

  beforeEach(() => {
    redisStore.clear();
    lastSetCall = null;
    svc = new LargeResultStorageService(makeLogger());
  });

  it('storeResult embeds tenantId+userId in the Redis key namespace', async () => {
    const info = await svc.storeResult({
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      sessionId: 'sess-1',
      toolName: 'azure_list_subscriptions',
      toolCallId: 'toolu_abc',
      result: { subs: [{ id: 's-1' }] },
    });

    expect(info.resultId).toMatch(/^result_/);
    // Key format: large_result:${tenantId}:${userId}:${resultId}
    expect(lastSetCall).not.toBeNull();
    expect(lastSetCall!.key).toBe(`large_result:tenant-1:user-alpha:${info.resultId}`);
  });

  it('storeResult falls back to "" tenantId when omitted (back-compat)', async () => {
    const info = await svc.storeResult({
      userId: 'system',
      sessionId: 'sess-x',
      toolName: '__subagent_trace__',
      toolCallId: 'trace_abc',
      result: { ok: true },
      // tenantId intentionally absent
    });
    expect(lastSetCall!.key).toBe(`large_result::system:${info.resultId}`);
  });

  it('getResultAsync(resultId, auth) returns the result when caller owns it', async () => {
    const info = await svc.storeResult({
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      sessionId: 'sess-1',
      toolName: 'azure_list_subscriptions',
      toolCallId: 'toolu_abc',
      result: { subs: [{ id: 's-1' }] },
    });

    const out = await svc.getResultAsync(info.resultId, {
      userId: 'user-alpha',
      tenantId: 'tenant-1',
    });
    expect(out).not.toBeNull();
    expect(out!.result).toEqual({ subs: [{ id: 's-1' }] });
    expect(out!.toolName).toBe('azure_list_subscriptions');
  });

  it('getResultAsync rejects with null when caller userId does not match owner', async () => {
    const info = await svc.storeResult({
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      sessionId: 'sess-1',
      toolName: 'azure_list_subscriptions',
      toolCallId: 'toolu_abc',
      result: { sensitive: 'data-only-alpha-can-see' },
    });

    // user-beta has a STOLEN handle — same tenant, different user.
    const out = await svc.getResultAsync(info.resultId, {
      userId: 'user-beta',
      tenantId: 'tenant-1',
    });
    expect(out).toBeNull();
  });

  it('getResultAsync rejects when caller tenantId does not match owner', async () => {
    const info = await svc.storeResult({
      userId: 'shared-name',
      tenantId: 'tenant-1',
      sessionId: 'sess-1',
      toolName: 'azure_list_subscriptions',
      toolCallId: 'toolu_abc',
      result: { tenant1_secret: true },
    });

    // Caller has same userId by coincidence but different tenant.
    const out = await svc.getResultAsync(info.resultId, {
      userId: 'shared-name',
      tenantId: 'tenant-2',
    });
    expect(out).toBeNull();
  });

  it('getResultAsync rejects when allowedMcpServers omits the originating tool server', async () => {
    const info = await svc.storeResult({
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      sessionId: 'sess-1',
      toolName: 'openagentic_azure_list_subscriptions',
      toolCallId: 'toolu_abc',
      result: { ok: true },
    });

    const out = await svc.getResultAsync(info.resultId, {
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      allowedMcpServers: ['aws', 'gcp'], // missing azure
    });
    expect(out).toBeNull();
  });

  it('getResultAsync admits when allowedMcpServers includes the originating tool server', async () => {
    const info = await svc.storeResult({
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      sessionId: 'sess-1',
      toolName: 'openagentic_azure_list_subscriptions',
      toolCallId: 'toolu_abc',
      result: { ok: true },
    });

    const out = await svc.getResultAsync(info.resultId, {
      userId: 'user-alpha',
      tenantId: 'tenant-1',
      allowedMcpServers: ['azure', 'aws'],
    });
    expect(out).not.toBeNull();
  });

  it('getResultAsync(resultId) without auth preserves legacy behavior (returns result)', async () => {
    const info = await svc.storeResult({
      userId: 'system',
      tenantId: '',
      sessionId: 'sess-x',
      toolName: '__subagent_trace__',
      toolCallId: 'trace_abc',
      result: { trace: 'subagent-blob' },
    });

    // Legacy callsite (TraceStore reader) doesn't pass auth — should still work.
    const out = await svc.getResultAsync(info.resultId);
    expect(out).not.toBeNull();
    expect(out!.result).toEqual({ trace: 'subagent-blob' });
  });
});
