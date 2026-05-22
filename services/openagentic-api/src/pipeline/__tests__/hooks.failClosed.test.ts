/**
 * HookRunner — default failureMode = fail_closed (Phase 3).
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §7
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md Phase 3
 *
 * Default behaviour: a thrown error from any registered hook propagates.
 * Per-hook override: registrations with `failureMode: 'fail_open'` catch their
 * own errors (logged) so existing V2 hook impls that intentionally tolerate
 * downstream failures keep working.
 */
import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { HookRunner } from '../hooks.js';

const silentLogger = pino({ level: 'silent' });

function makeCtx() {
  return {
    userId: 'u1',
    sessionId: 's1',
    logger: silentLogger,
    meta: {},
  };
}

describe('HookRunner — default failureMode is fail_closed', () => {
  it('throws if a registered void hook throws (default fail_closed)', async () => {
    const runner = new HookRunner(silentLogger);
    runner.register({
      id: 'test:throws',
      point: 'after_tool_call',
      priority: 1,
      fn: async () => {
        throw new Error('boom');
      },
    });
    await expect(runner.runVoid('after_tool_call', {} as any, makeCtx())).rejects.toThrow('boom');
  });

  it('throws if a registered modifying hook throws (default fail_closed)', async () => {
    const runner = new HookRunner(silentLogger);
    runner.register({
      id: 'test:throws-mod',
      point: 'before_tool_call',
      priority: 1,
      fn: async () => {
        throw new Error('mod-boom');
      },
    });
    await expect(runner.runModifying('before_tool_call', { foo: 1 } as any, makeCtx())).rejects.toThrow('mod-boom');
  });

  it('per-hook failureMode "fail_open" catches that hook only (void)', async () => {
    const runner = new HookRunner(silentLogger);
    let secondRan = false;
    runner.register({
      id: 'test:throws-open',
      point: 'after_tool_call',
      priority: 1,
      failureMode: 'fail_open',
      fn: async () => {
        throw new Error('boom');
      },
    });
    runner.register({
      id: 'test:noop',
      point: 'after_tool_call',
      priority: 2,
      fn: async () => {
        secondRan = true;
      },
    });
    await expect(runner.runVoid('after_tool_call', {} as any, makeCtx())).resolves.toBeUndefined();
    expect(secondRan).toBe(true);
  });

  it('per-hook failureMode "fail_open" catches that hook only (modifying)', async () => {
    const runner = new HookRunner(silentLogger);
    runner.register({
      id: 'test:throws-open-mod',
      point: 'before_tool_call',
      priority: 1,
      failureMode: 'fail_open',
      fn: async () => {
        throw new Error('boom');
      },
    });
    runner.register({
      id: 'test:passthrough',
      point: 'before_tool_call',
      priority: 2,
      fn: async (data: any) => ({ ...data, touched: true }),
    });
    const result = await runner.runModifying('before_tool_call', { foo: 1 } as any, makeCtx());
    expect((result as any).touched).toBe(true);
  });
});
