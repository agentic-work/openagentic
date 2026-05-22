/**
 * buildChatV2Deps — Phase D.1: HookRunner singleton injection.
 *
 * Why this test exists: prior to Phase D.1 the chat deps factory did NOT
 * wire `getHookRunner()` into the returned deps struct. The chatLoop calls
 * `deps.hooks?.run(...)` at 7 cross-cut points (on_turn_start /
 * before_streaming / enrich_sse_event / before_tool_call / after_tool_call /
 * on_turn_end / on_pipeline_end), but with `deps.hooks` undefined every one
 * was a no-op. Built-in hooks register DLP / HITL / audit / cost tracking /
 * SSE sequencer — all LIVE-INACTIVE for the chatmode V3 path that consumes
 * `buildChatV2Deps`.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md Phase D.1.
 *
 * Pin: `deps.hooks` MUST be defined (truthy + has `.run`) after factory
 * construction; `runChat.ts` can rely on the deps-carried runner rather
 * than the inline `getHookRunner()` defensive fallback. The opts.hooks
 * override path is preserved for test injection (mock runners) without
 * polluting the process-global singleton.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildChatV2Deps, type BuildChatV2DepsOptions } from '../buildChatV2Deps.js';
import {
  HookRunner,
  initializeHookRunner,
  type HookContext,
  type VoidHookFn,
} from '../../pipeline/hooks.js';
import pino from 'pino';

function makeBaseOpts(): BuildChatV2DepsOptions {
  return {
    providerManager: { createCompletion: vi.fn() },
  };
}

describe('buildChatV2Deps — Phase D.1 HookRunner injection', () => {
  beforeEach(() => {
    // Initialize the singleton so getHookRunner() doesn't throw. Reset
    // between tests to prevent cross-test hook bleed.
    initializeHookRunner(pino({ level: 'silent' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns deps.hooks defined (singleton) when no override supplied', () => {
    const deps = buildChatV2Deps(makeBaseOpts());
    // PRE-PHASE-D.1: this fails — `hooks` is undefined on the deps struct
    // because the factory never reads getHookRunner().
    expect(deps.hooks).toBeDefined();
    expect(typeof deps.hooks?.run).toBe('function');
    expect(typeof deps.hooks?.runModifying).toBe('function');
  });

  it('deps.hooks.run dispatches to a registered hook (singleton wiring is live)', async () => {
    // Register a custom void hook on the singleton; calling deps.hooks.run
    // must invoke it. Without the D.1 wire-up, deps.hooks is undefined and
    // the assertion never fires (the optional-chain skip).
    const calls: Array<{ point: string; data: unknown }> = [];
    const singleton = initializeHookRunner(pino({ level: 'silent' }));
    singleton.register({
      id: 'd1-test:after_tool_call',
      point: 'after_tool_call',
      priority: 10,
      fn: (async (data: unknown, _ctx: HookContext) => {
        calls.push({ point: 'after_tool_call', data });
      }) as VoidHookFn<unknown>,
    });

    const deps = buildChatV2Deps(makeBaseOpts());
    expect(deps.hooks).toBeDefined();

    const hookCtx: HookContext = {
      userId: 'u-1',
      sessionId: 's-1',
      logger: pino({ level: 'silent' }),
      meta: {},
    };
    await deps.hooks!.run('after_tool_call', { toolName: 'probe', arguments: {}, userId: 'u-1' }, hookCtx);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.point).toBe('after_tool_call');
  });

  it('opts.hooks override WINS over the singleton (test-injection precedence)', async () => {
    // Mock runner — emit calls to a sentinel array. Used for unit tests
    // that don't want to touch the process singleton.
    const overrideCalls: string[] = [];
    const mockRunner = {
      run: vi.fn(async (point: string) => {
        overrideCalls.push(point);
      }),
      runModifying: vi.fn(async <T>(_point: string, data: T) => data),
      runSync: vi.fn(<T>(_point: string, data: T) => data),
    };

    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      hooks: mockRunner as unknown as HookRunner,
    });

    expect(deps.hooks).toBe(mockRunner);

    const hookCtx: HookContext = {
      userId: 'u-1',
      logger: pino({ level: 'silent' }),
      meta: {},
    };
    await deps.hooks!.run('on_turn_start', { turn: 0 }, hookCtx);

    expect(mockRunner.run).toHaveBeenCalledTimes(1);
    expect(overrideCalls).toEqual(['on_turn_start']);
  });
});
