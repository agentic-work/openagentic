/**
 * LargeResultStorageService — Prom counters (#974, 2026-05-20 PM).
 *
 * Pins:
 *  - `large_result_offloads_total{tool, tenant}` increments by 1 on each
 *    successful storeResult() call.
 *  - `large_result_bytes_saved_total{tool, tenant}` increments by the
 *    serialized size in bytes on each successful storeResult().
 *  - Counters are tolerant to double-registration (prom-client default
 *    register stays stable across vitest worker reloads).
 *
 * Plan: T1 RBAC + Prom counters (#974, controller-dispatched 2026-05-20 PM).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register } from 'prom-client';
import {
  LargeResultStorageService,
  largeResultOffloadsTotal,
  largeResultBytesSavedTotal,
} from '../LargeResultStorageService.js';

const redisStore = new Map<string, unknown>();
vi.mock('../../utils/redis-client.js', () => {
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

async function getCounterValue(metric: any, labels: Record<string, string>): Promise<number> {
  const m = await metric.get();
  const found = m.values.find((v: any) => {
    for (const k of Object.keys(labels)) {
      if (v.labels[k] !== labels[k]) return false;
    }
    return true;
  });
  return found?.value ?? 0;
}

describe('LargeResultStorageService — #974 Prom counters', () => {
  let svc: LargeResultStorageService;

  beforeEach(() => {
    redisStore.clear();
    svc = new LargeResultStorageService(makeLogger());
  });

  it('exposes large_result_offloads_total and large_result_bytes_saved_total on the default register', () => {
    expect(register.getSingleMetric('large_result_offloads_total')).toBe(largeResultOffloadsTotal);
    expect(register.getSingleMetric('large_result_bytes_saved_total')).toBe(largeResultBytesSavedTotal);
  });

  it('increments large_result_offloads_total{tool, tenant} on each storeResult call', async () => {
    const tool = 'openagentic_azure_list_subscriptions';
    const tenant = 'tenant-prom-1';

    const before = await getCounterValue(largeResultOffloadsTotal, { tool, tenant });

    await svc.storeResult({
      userId: 'u1',
      tenantId: tenant,
      sessionId: 's1',
      toolName: tool,
      toolCallId: 't1',
      result: { ok: true },
    });
    const afterOne = await getCounterValue(largeResultOffloadsTotal, { tool, tenant });
    expect(afterOne).toBe(before + 1);

    await svc.storeResult({
      userId: 'u1',
      tenantId: tenant,
      sessionId: 's1',
      toolName: tool,
      toolCallId: 't2',
      result: { ok: true },
    });
    const afterTwo = await getCounterValue(largeResultOffloadsTotal, { tool, tenant });
    expect(afterTwo).toBe(before + 2);
  });

  it('increments large_result_bytes_saved_total{tool, tenant} by serialized size on storeResult', async () => {
    const tool = 'openagentic_aws_describe_instance';
    const tenant = 'tenant-prom-2';
    const payload = { region: 'us-east-1', items: Array.from({ length: 100 }, (_, i) => ({ id: i })) };
    const expectedSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');

    const before = await getCounterValue(largeResultBytesSavedTotal, { tool, tenant });
    await svc.storeResult({
      userId: 'u1',
      tenantId: tenant,
      sessionId: 's1',
      toolName: tool,
      toolCallId: 't1',
      result: payload,
    });
    const after = await getCounterValue(largeResultBytesSavedTotal, { tool, tenant });
    expect(after).toBe(before + expectedSize);
  });
});
