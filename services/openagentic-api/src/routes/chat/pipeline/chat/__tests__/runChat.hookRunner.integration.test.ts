/**
 * Phase D.1 (2026-05-11) — runChat MUST thread `deps.hooks` (from
 * buildChatV2Deps) into the chatLoop's loopDeps, NOT call `getHookRunner()`
 * inline.
 *
 * Today's gap (pre-D.1):
 *   runChat.ts:802-811 calls `getHookRunner()` inline; the returned runner
 *   is the process singleton. `deps.hooks` (the one the factory wired
 *   per opts.hooks ?? getHookRunner()) is IGNORED. This breaks:
 *     - test injection (opts.hooks override never reaches chatLoop)
 *     - the "consistent invocation" contract — when the singleton is
 *       absent (probe / test paths), runChat silently falls back to
 *       `undefined`, but if the factory wired a custom runner via opts.hooks
 *       (e.g. a per-tenant runner), runChat still ignores it.
 *
 * After D.1:
 *   runChat takes `deps.hooks` first; only when that is missing does it
 *   fall through to `getHookRunner()`. The loop sees the factory-wired
 *   runner, so DLP/HITL/audit fire consistently per the deps contract.
 *
 * Test strategy: build deps via `buildChatV2Deps` with a CUSTOM `opts.hooks`
 * stub; invoke `runChat`; assert chatLoop's hook-call passes through to the
 * stub (not the singleton). The stub records `run('before_tool_call', ...)`
 * + `run('after_tool_call', ...)` invocations.
 *
 * the design notes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { runChat } from '../runChat.js';
import { buildChatV2Deps, type BuildChatV2DepsOptions } from '../../../../../services/buildChatV2Deps.js';
import { initializeHookRunner, type HookRunner } from '../../../../../pipeline/hooks.js';

function makeCtx(sessionId = 'sess-D1-1') {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId,
    userId: 'user-D1',
    user: { isAdmin: false, id: 'user-D1', email: 'u@test' },
  };
}

/**
 * Streaming provider stub that emits a single tool_use_complete then
 * end_turn so the chatLoop's wrappedDispatch fires `before_tool_call` and
 * `after_tool_call` per the Phase 3 cross-cut contract.
 */
function makeProviderManagerWithToolCallThenEndTurn() {
  let phase: 'tool_call' | 'end_turn' = 'tool_call';
  return {
    getStreamFormatForModel: () => 'openai',
    createCompletion: vi.fn(async () => {
      const currentPhase = phase;
      // Flip so the NEXT call (turn 2) yields the synthesis end_turn.
      phase = 'end_turn';
      if (currentPhase === 'tool_call') {
        async function* gen() {
          yield {
            id: 'cmpl-1',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'tu-1',
                      function: { name: 'list_things', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          };
          yield {
            id: 'cmpl-1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          };
        }
        return gen();
      }
      async function* genEnd() {
        yield {
          id: 'cmpl-2',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'done' } }],
        };
        yield {
          id: 'cmpl-2',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        };
      }
      return genEnd();
    }),
  };
}

describe('runChat — Phase D.1 hook threading (deps.hooks NOT inline singleton)', () => {
  beforeEach(() => {
    // Initialize the singleton with a sentinel logger so we can tell the
    // singleton apart from the explicit opts.hooks override below.
    initializeHookRunner(pino({ level: 'silent' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('before_tool_call + after_tool_call fire for every tool dispatch via deps.hooks (audit observer contract)', async () => {
    // D.1 second-case: prove HookRunner fires `before_tool_call` AND
    // `after_tool_call` for the tool dispatch path. Without D.1, neither
    // fires because runChat's inline getHookRunner() swallows the deps
    // wire-up.
    const beforeToolCalls: any[] = [];
    const afterToolCalls: any[] = [];
    const overrideRunner: any = {
      run: vi.fn(async (point: string, data: unknown) => {
        if (point === 'after_tool_call') afterToolCalls.push(data);
      }),
      runModifying: vi.fn(async <T>(point: string, data: T) => {
        if (point === 'before_tool_call') beforeToolCalls.push(data);
        return data;
      }),
      runSync: vi.fn(<T>(_point: string, data: T) => data),
    };

    const providerManager = makeProviderManagerWithToolCallThenEndTurn();
    const factoryOpts: BuildChatV2DepsOptions = {
      providerManager: providerManager as any,
      hooks: overrideRunner as unknown as HookRunner,
      executeMcpTool: vi.fn(async () => ({ ok: true, output: '[{"k":"v"}]' })),
    };
    const deps = buildChatV2Deps(factoryOpts);
    expect(deps.hooks).toBe(overrideRunner);

    const ctx = makeCtx('sess-D1-fire');
    const input: any = {
      userMessage: 'list things',
      priorMessages: [],
      model: 'configured-chat-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };
    await runChat(ctx as any, input, deps as any);

    // Exactly ONE before_tool_call per dispatch and ONE after_tool_call.
    // (One tool was dispatched by the provider stub.)
    expect(beforeToolCalls).toHaveLength(1);
    expect(afterToolCalls).toHaveLength(1);
    // before_tool_call carries `toolName` + `arguments` (per the DLP /
    // HITL hook input shape — see pipeline/built-in-hooks.ts:22 ToolCallHookData).
    expect(beforeToolCalls[0]).toMatchObject({
      toolName: 'list_things',
    });
    // after_tool_call carries `result` + `executionTimeMs` (audit / cost
    // sinks read these).
    expect(afterToolCalls[0]).toMatchObject({
      toolName: 'list_things',
    });
    expect(typeof afterToolCalls[0].executionTimeMs).toBe('number');
  });

  it('chatLoop calls deps.hooks (from factory) — opts.hooks override propagates through runChat', async () => {
    // RED before D.1: runChat ignores deps.hooks and uses getHookRunner()
    // inline. The override stub below never sees `before_tool_call` /
    // `after_tool_call` invocations.
    //
    // GREEN after D.1: runChat picks deps.hooks first; the stub records the
    // chatLoop's hook calls.
    const overrideCalls: Array<{ point: string }> = [];
    const overrideRunner: any = {
      run: vi.fn(async (point: string) => {
        overrideCalls.push({ point });
      }),
      runModifying: vi.fn(async <T>(point: string, data: T) => {
        overrideCalls.push({ point });
        return data;
      }),
      runSync: vi.fn(<T>(_point: string, data: T) => data),
    };

    const providerManager = makeProviderManagerWithToolCallThenEndTurn();
    // Use buildChatV2Deps so the factory wires deps.hooks = overrideRunner
    // via the opts.hooks precedence rule.
    const factoryOpts: BuildChatV2DepsOptions = {
      providerManager: providerManager as any,
      hooks: overrideRunner as unknown as HookRunner,
      // Stub MCP tool execution — the wrappedDispatch needs SOMETHING to
      // call after `before_tool_call`.
      executeMcpTool: vi.fn(async () => ({ ok: true, output: '[]' })),
    };
    const deps = buildChatV2Deps(factoryOpts);

    // Confirm the factory wired the override (sanity for the test).
    expect(deps.hooks).toBe(overrideRunner);

    const ctx = makeCtx('sess-D1-thread');
    const input: any = {
      userMessage: 'hello',
      priorMessages: [],
      model: 'configured-chat-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    await runChat(ctx as any, input, deps as any);

    // The chatLoop fires:
    //   on_turn_start (run)
    //   before_streaming (run)
    //   enrich_sse_event (runModifying, per stream chunk)
    //   before_tool_call (runModifying) — gated cross-cut
    //   after_tool_call (run) — observer cross-cut
    //   on_turn_end (run)
    //   on_pipeline_end (run)
    //
    // Before D.1 NONE of these reach the override runner because runChat
    // uses inline getHookRunner() instead. The assertion below is the RED.
    const points = overrideCalls.map(c => c.point);
    expect(points).toContain('on_turn_start');
    expect(points).toContain('before_tool_call');
    expect(points).toContain('after_tool_call');
    expect(points).toContain('on_pipeline_end');
  });
});
