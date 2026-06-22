/**
 * dedup/executor.test.ts — TDD for the idempotency / de-duplication gate.
 *
 * Contract:
 *  - data: { key (required, templated), scope ('execution'|'global'),
 *            ttlSeconds (default 0 = forever), onDuplicate ('drop'|'error') }
 *  - first sighting of a key → { duplicate:false, firstSeen:true, passthrough:input }
 *  - repeat sighting → drop ({ duplicate:true }) or throw, per onDuplicate
 *  - keys are isolated by (tenant, scope, key); execution scope isolates by executionId
 *  - TTL expiry makes a re-seen key new again
 *  - missing / empty-resolved key → throws (never runs blind)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execute, _resetForTests } from './executor.js';
import type { NodeExecutionContext, WorkflowNode } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-dedup-1',
    tenantId: 'tenant-a',
    apiUrl: 'http://api',
    // Resolve {{input.id}} style templates against the input.
    interpolateTemplate: (t: string, input: unknown) => {
      const m = t.match(/\{\{\s*input\.(\w+)\s*\}\}/);
      if (m && input && typeof input === 'object') {
        const v = (input as Record<string, unknown>)[m[1]];
        return v === undefined || v === null ? '' : String(v);
      }
      return t;
    },
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: 'n_dedup', type: 'dedup', data }) as any;

beforeEach(() => {
  _resetForTests();
});

describe('dedup/executor', () => {
  it('passes through on the first sighting of a key', async () => {
    const ctx = makeCtx();
    const out: any = await execute(mk({ key: '{{input.id}}' }), { id: 'a' }, ctx);
    expect(out.duplicate).toBe(false);
    expect(out.firstSeen).toBe(true);
    expect(out.key).toBe('a');
    expect(out.passthrough).toEqual({ id: 'a' });
  });

  it('drops a repeated key (onDuplicate=drop, the default)', async () => {
    const ctx = makeCtx();
    await execute(mk({ key: '{{input.id}}' }), { id: 'dup' }, ctx);
    const out: any = await execute(mk({ key: '{{input.id}}' }), { id: 'dup' }, ctx);
    expect(out.duplicate).toBe(true);
    expect(out.firstSeen).toBe(false);
    expect(out.key).toBe('dup');
    expect(typeof out.firstSeenAt).toBe('number');
  });

  it('throws on a repeated key when onDuplicate=error', async () => {
    const ctx = makeCtx();
    await execute(mk({ key: '{{input.id}}', onDuplicate: 'error' }), { id: 'x' }, ctx);
    await expect(
      execute(mk({ key: '{{input.id}}', onDuplicate: 'error' }), { id: 'x' }, ctx),
    ).rejects.toThrow(/duplicate key 'x'/i);
  });

  it('treats distinct keys independently', async () => {
    const ctx = makeCtx();
    const a: any = await execute(mk({ key: '{{input.id}}' }), { id: '1' }, ctx);
    const b: any = await execute(mk({ key: '{{input.id}}' }), { id: '2' }, ctx);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
  });

  it('isolates keys by execution scope (different executionIds do not collide)', async () => {
    const ctxA = makeCtx({ executionId: 'exec-A' });
    const ctxB = makeCtx({ executionId: 'exec-B' });
    await execute(mk({ key: 'shared' }), {}, ctxA);
    const out: any = await execute(mk({ key: 'shared' }), {}, ctxB);
    expect(out.duplicate).toBe(false); // different execution → fresh
  });

  it('global scope dedups across executions', async () => {
    const ctxA = makeCtx({ executionId: 'exec-A' });
    const ctxB = makeCtx({ executionId: 'exec-B' });
    await execute(mk({ key: 'g', scope: 'global' }), {}, ctxA);
    const out: any = await execute(mk({ key: 'g', scope: 'global' }), {}, ctxB);
    expect(out.duplicate).toBe(true);
  });

  it('isolates keys by tenant', async () => {
    const ctxA = makeCtx({ tenantId: 'tenant-a' });
    const ctxB = makeCtx({ tenantId: 'tenant-b' });
    await execute(mk({ key: 'k', scope: 'global' }), {}, ctxA);
    const out: any = await execute(mk({ key: 'k', scope: 'global' }), {}, ctxB);
    expect(out.duplicate).toBe(false);
  });

  it('TTL expiry makes a re-seen key new again', async () => {
    const now = 1_000_000;
    const spy = vi.spyOn(Date, 'now');
    try {
      const ctx = makeCtx();
      spy.mockReturnValue(now);
      const first: any = await execute(mk({ key: 'ttlk', ttlSeconds: 10 }), {}, ctx);
      expect(first.duplicate).toBe(false);

      // 5s later → still within window → duplicate
      spy.mockReturnValue(now + 5_000);
      const within: any = await execute(mk({ key: 'ttlk', ttlSeconds: 10 }), {}, ctx);
      expect(within.duplicate).toBe(true);

      // 11s later → window expired → new again
      spy.mockReturnValue(now + 11_000);
      const after: any = await execute(mk({ key: 'ttlk', ttlSeconds: 10 }), {}, ctx);
      expect(after.duplicate).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('throws when key is missing entirely', async () => {
    await expect(execute(mk({}), { id: 'a' }, makeCtx())).rejects.toThrow(/key.*required/i);
  });

  it('throws when the key template resolves to an empty string', async () => {
    await expect(
      execute(mk({ key: '{{input.id}}' }), { id: '' }, makeCtx()),
    ).rejects.toThrow(/empty string/i);
  });
});
