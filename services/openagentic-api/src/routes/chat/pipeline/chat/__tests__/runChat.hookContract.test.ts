/**
 * Phase D.3 (2026-05-11) — HookRunner contract validation.
 *
 * Once D.1 wires `deps.hooks` through to chatLoop, the built-in hooks
 * registered against the singleton (DLP scanner, HITL gate, audit logger)
 * MUST fire for every tool dispatch. This test pins the contract by
 * registering the SAME built-in hooks against a per-test singleton and
 * driving the chatLoop end-to-end via `runChat`.
 *
 * AC-8: prove the wire-up — no need to deploy. Two assertions:
 *
 *   1. DLP scanner (after_tool_call observer) and audit (after_tool_call
 *      observer) both fire for every chat turn that calls a tool. Stub
 *      one of the registered observers with a sentinel sink + verify it
 *      records the dispatched tool.
 *
 *   2. HITL gate (before_tool_call modifying) emits `mcp_approval_required`
 *      for a destructive tool name (e.g. azure_delete_resource). Without
 *      D.1 the hook never runs; with D.1 it runs and the emit-channel
 *      captures the approval frame.
 *
 * the design notes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { runChat } from '../runChat.js';
import { buildChatV2Deps } from '../../../../../services/buildChatV2Deps.js';
import {
  HookRunner,
  initializeHookRunner,
  type HookContext,
  type ModifyingHookFn,
  type VoidHookFn,
} from '../../../../../pipeline/hooks.js';

function makeCtx(sessionId = 'sess-D3') {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId,
    userId: 'user-D3',
    user: { isAdmin: false, id: 'user-D3', email: 'u@test' },
  };
}

/**
 * Streaming provider stub: one tool call (caller picks the name), then
 * end_turn after tool_results.
 */
function makeProviderForTool(toolName: string) {
  let phase: 'tool_call' | 'end_turn' = 'tool_call';
  return {
    getStreamFormatForModel: () => 'openai',
    createCompletion: vi.fn(async () => {
      const currentPhase = phase;
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
                      function: { name: toolName, arguments: '{}' },
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
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }],
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

describe('runChat — Phase D.3 HookRunner contract validation', () => {
  beforeEach(() => {
    // Reset the singleton to a NEW runner BEFORE each test so the inline
    // getHookRunner() path picks up a sentinel runner DIFFERENT from the
    // opts.hooks runner the tests inject. Phase D.1's RED state mixes
    // these two; D.1 GREEN keeps them straight.
    initializeHookRunner(pino({ level: 'silent' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Build a fresh, scoped HookRunner (NOT the singleton). Tests inject
   * this via `opts.hooks` so D.1's wire-up is the only path that makes
   * the assertions pass — the inline-singleton fallback in pre-D.1
   * runChat.ts would silently route to a DIFFERENT runner.
   */
  function makeScopedRunner(): HookRunner {
    return new HookRunner(pino({ level: 'silent' }));
  }

  it('audit observer (after_tool_call) records the dispatched tool name + duration', async () => {
    // Register an audit-style observer hook on a SCOPED runner (not the
    // singleton). Before D.1, runChat ignored deps.hooks and used the
    // singleton — so the auditRows array would never receive entries.
    // After D.1, deps.hooks routes through the scoped runner.
    const scoped = makeScopedRunner();
    const auditRows: Array<{ tool: string; durationMs: number; ok: boolean }> = [];
    scoped.register({
      id: 'd3-test:audit:after_tool_call',
      point: 'after_tool_call',
      priority: 50,
      failureMode: 'fail_open',
      fn: (async (data: any, _ctx: HookContext) => {
        auditRows.push({
          tool: data.toolName,
          durationMs: data.executionTimeMs,
          ok: !data.result?.error,
        });
      }) as VoidHookFn<unknown>,
    });

    const providerManager = makeProviderForTool('list_things');
    const deps = buildChatV2Deps({
      providerManager: providerManager as any,
      hooks: scoped,
      executeMcpTool: vi.fn(async () => ({ ok: true, output: '[]' })),
    });
    // Confirm the factory wired the scoped runner (NOT the singleton).
    expect(deps.hooks).toBe(scoped);

    const ctx = makeCtx('sess-D3-audit');
    const input: any = {
      userMessage: 'list things',
      priorMessages: [],
      model: 'configured-chat-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };
    await runChat(ctx as any, input, deps as any);

    // Pre-D.1 RED: auditRows is empty because runChat used the singleton
    // (which has no hooks registered) instead of the scoped runner.
    // Post-D.1 GREEN: auditRows has 1 entry, recorded by the scoped runner.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.tool).toBe('list_things');
    expect(typeof auditRows[0]?.durationMs).toBe('number');
  });

  it('HITL gate (before_tool_call) emits mcp_approval_required for a destructive tool name', async () => {
    // Register a permission-style modifying hook on a SCOPED runner. Mirrors
    // the production `builtin:permissions:before_tool_call` shape (see
    // src/pipeline/built-in-hooks.ts).
    //
    // For the test we synthesize the approval-required emit ourselves —
    // replicating PermissionService.evaluate()'s ask path (emits
    // `mcp_approval_required` with the request id). The point of this
    // test is to prove the hook is INVOKED on a destructive name when
    // wired via deps.hooks, not to replay all of PermissionService.
    const scoped = makeScopedRunner();
    scoped.register({
      id: 'd3-test:permissions:before_tool_call',
      point: 'before_tool_call',
      priority: 10,
      fn: (async (data: any, _ctx: HookContext) => {
        // Mimic PermissionService deny-rule detection for destructive
        // tools. Without touching the real DB-backed service (which would
        // need Prisma), we hard-match destructive prefixes here for the test.
        const isDestructive = /^(?:azure_delete_|aws_delete_|gcp_delete_)/i.test(data.toolName);
        if (!isDestructive) return data;
        // Emit the approval-required frame on the SSE channel the hook
        // data carries. The chatLoop's wrappedDispatch sets `data.emit =
        // ctx.emit` so the hook can publish frames to the live stream.
        const emit = data.emit ?? (() => {});
        emit('mcp_approval_required', {
          requestId: 'req-d3',
          toolName: data.toolName,
          riskLevel: 'high',
        });
        return {
          ...data,
          blocked: true,
          blockReason: `HITL: high-risk tool '${data.toolName}' requires human approval`,
        };
      }) as ModifyingHookFn<unknown>,
    });

    const providerManager = makeProviderForTool('azure_delete_resource');
    // executeMcpTool will NEVER be called — the HITL hook should block
    // before dispatch. Make it throw if anyone tries.
    const executeMcpTool = vi.fn(async () => {
      throw new Error('executeMcpTool MUST NOT be called when HITL blocks');
    });
    const deps = buildChatV2Deps({
      providerManager: providerManager as any,
      hooks: scoped,
      executeMcpTool,
    });
    expect(deps.hooks).toBe(scoped);

    const ctx = makeCtx('sess-D3-hitl');
    const input: any = {
      userMessage: 'delete the prod azure resource',
      priorMessages: [],
      model: 'configured-chat-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };
    await runChat(ctx as any, input, deps as any);

    // Walk the emit recorder for the mcp_approval_required frame. Pre-D.1
    // RED: never present because the HITL hook never ran (runChat used the
    // singleton, not the scoped runner). Post-D.1 GREEN: present.
    const calls = (ctx.emit as any).mock.calls as Array<[string, any]>;
    const approvalFrame = calls.find(c => c[0] === 'mcp_approval_required');
    expect(approvalFrame).toBeDefined();
    expect(approvalFrame![1]).toMatchObject({
      toolName: 'azure_delete_resource',
      riskLevel: 'high',
    });
    // executeMcpTool must not have been called — the block held. Pre-D.1
    // this also fails (or rather throws when the hook runs against the
    // unrelated singleton) so the test setup is asymmetric without D.1.
    expect(executeMcpTool).not.toHaveBeenCalled();
  });
});
