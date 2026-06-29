/**
 * #763 — chatLoop no-progress guard
 *
 * Live failure 2026-05-11 (capstone "show me my azure subs and rgs"):
 *   azure_list_subscriptions called 15× in 30s. Each call returned in
 *   ~280ms (probably empty result), then the model immediately called
 *   it again. No synthesis, no recovery, no answer. Burned all 24
 *   turns then hit max_turns.
 *
 * Guard contract:
 *   - Track every (toolName, argsHash) pair across all turns.
 *   - When ANY pair hits NO_PROGRESS_THRESHOLD (=3), the loop:
 *     a) lets the current turn's dispatch finish (tool_use ↔ tool_result
 *        pairing must stay intact for Anthropic-shape compliance),
 *     b) pushes a user-directive message after the tool_results,
 *     c) forces tool_choice='none' on the next turn,
 *     d) emits an `annotation { kind: 'guard', code: 'no_progress' }`
 *        envelope so the UI can surface the abort.
 *   - The guard fires ONCE per loop (noProgressGuardFired latch).
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';
import type { RunChatDeps } from '../types.js';

/**
 * Build a streamProvider stub whose Nth turn yields the script's Nth
 * entry. Each entry is an array of (text? + tool_use[]) blocks + a
 * stop_reason. After the script runs out, every subsequent turn yields
 * `end_turn` with text='final answer' (so the loop terminates).
 */
function makeStreamProvider(
  script: Array<{
    toolUses?: Array<{ id: string; name: string; input: unknown }>;
    text?: string;
    stop_reason: 'tool_use' | 'end_turn';
  }>,
) {
  let turn = 0;
  return () => {
    const entry = script[turn] ?? {
      text: 'final answer',
      stop_reason: 'end_turn' as const,
    };
    turn += 1;
    return (async function* () {
      if (entry.text) {
        yield { type: 'text_delta' as const, text: entry.text };
      }
      for (const t of entry.toolUses ?? []) {
        yield { type: 'tool_use_start' as const, id: t.id, name: t.name };
        yield {
          type: 'tool_use_delta' as const,
          id: t.id,
          name: t.name,
          inputDelta: JSON.stringify(t.input),
        };
        yield {
          type: 'tool_use_complete' as const,
          id: t.id,
          name: t.name,
          input: t.input,
        };
      }
      yield {
        type: 'message_stop' as const,
        stop_reason: entry.stop_reason,
      } as any;
    })();
  };
}

function makeCtx() {
  const emitted: Array<{ frame: string; payload: unknown }> = [];
  return {
    emit: vi.fn((frame: string, payload: unknown) => {
      emitted.push({ frame, payload });
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    sessionId: 'sess-test',
    userId: 'user-test',
    user: { id: 'user-test' },
    emitted,
  };
}

function makeDeps(streamProvider: any): RunChatDeps {
  return {
    streamProvider,
    // chatLoop calls `deps.dispatch(ctx, { name, input })` for every tool
    // block — stub returns a tiny ok envelope so tool_results pair up
    // cleanly with each tool_use.
    dispatch: vi.fn(async (_ctx: any, call: { name: string; input: unknown }) => ({
      ok: true,
      output: `stub:${call.name}`,
    })),
    executeMcpTool: vi.fn(async () => ({ ok: true, output: '[]' })),
    executeComposeVisual: vi.fn(),
    executeComposeApp: vi.fn(),
    executeRenderArtifact: vi.fn(),
    executeTask: vi.fn(),
    executeRequestClarification: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    executeMemorize: vi.fn(),
    listSubagentTypes: vi.fn(async () => []),
    runSubagent: vi.fn(),
  } as any;
}

describe('chatLoop #763 no-progress guard', () => {
  it('fires after 3 identical (name, args) calls — forces synthesis turn', async () => {
    // 4 consecutive identical azure_list_subscriptions calls.
    // The model would loop forever without the guard; the guard should
    // fire AT THE END of turn 3 (count hits 3), set tool_choice='none'
    // for turn 4, and the loop should reach end_turn cleanly.
    const stream = makeStreamProvider([
      // turn 1
      {
        toolUses: [
          { id: 't1', name: 'azure_list_subscriptions', input: {} },
        ],
        stop_reason: 'tool_use',
      },
      // turn 2
      {
        toolUses: [
          { id: 't2', name: 'azure_list_subscriptions', input: {} },
        ],
        stop_reason: 'tool_use',
      },
      // turn 3 — GUARD FIRES at end of this turn
      {
        toolUses: [
          { id: 't3', name: 'azure_list_subscriptions', input: {} },
        ],
        stop_reason: 'tool_use',
      },
      // turn 4 — model must produce text (tool_choice='none' enforced)
      { text: 'No subscriptions found.', stop_reason: 'end_turn' },
    ]);

    const ctx = makeCtx();
    const deps = makeDeps(stream);

    const result = await chatLoop(
      ctx as any,
      {
        systemPrompt: 'be helpful',
        userMessage: 'show me my azure subs',
        priorMessages: [],
        tools: [{ function: { name: 'azure_list_subscriptions' } }],
        model: 'test-model',
        maxTurns: 10,
        concurrencySafeNames: new Set(['azure_list_subscriptions']),
        maxConcurrency: 5,
      } as any,
      deps,
    );

    expect(result.ok).toBe(true);
    expect(result.turns).toBe(4);
    // A1 (2026-05-12) — the opcode-e guard annotation emit was ripped
    // because the UI never grew a matching reducer arm. The audit trail
    // for the guard firing is the structured warn log (one call,
    // contains "no-progress guard" + tool name + count).
    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0][1])).toContain('azure_list_subscriptions');
    expect((warnCalls[0][0] as any).count).toBe(3);
  });

  it('does NOT fire when calls have different args', async () => {
    const stream = makeStreamProvider([
      {
        toolUses: [{ id: 't1', name: 'azure_list_rgs', input: { sub: 'A' } }],
        stop_reason: 'tool_use',
      },
      {
        toolUses: [{ id: 't2', name: 'azure_list_rgs', input: { sub: 'B' } }],
        stop_reason: 'tool_use',
      },
      {
        toolUses: [{ id: 't3', name: 'azure_list_rgs', input: { sub: 'C' } }],
        stop_reason: 'tool_use',
      },
      { text: 'Listed RGs across 3 subs.', stop_reason: 'end_turn' },
    ]);
    const ctx = makeCtx();
    const result = await chatLoop(
      ctx as any,
      {
        systemPrompt: '',
        userMessage: 'list rgs across subs',
        priorMessages: [],
        tools: [{ function: { name: 'azure_list_rgs' } }],
        model: 'test-model',
        maxTurns: 10,
        concurrencySafeNames: new Set(['azure_list_rgs']),
        maxConcurrency: 5,
      } as any,
      makeDeps(stream),
    );
    expect(result.ok).toBe(true);
    // A1 — guard emit ripped; assert the warn-log audit trail did NOT
    // fire either (the guard didn't trip).
    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length).toBe(0);
  });

  it('only fires once per loop (latched)', async () => {
    // 5 consecutive identical calls. Guard hits at turn 3; turn 4 must be
    // tool_choice='none' synthesis; but if the model still tries the
    // same call (e.g. provider ignores tool_choice='none'), the guard
    // does NOT re-fire — the latch protects against double-firing.
    const stream = makeStreamProvider([
      { toolUses: [{ id: 't1', name: 'x', input: {} }], stop_reason: 'tool_use' },
      { toolUses: [{ id: 't2', name: 'x', input: {} }], stop_reason: 'tool_use' },
      { toolUses: [{ id: 't3', name: 'x', input: {} }], stop_reason: 'tool_use' },
      { toolUses: [{ id: 't4', name: 'x', input: {} }], stop_reason: 'tool_use' },
      { text: 'finally done', stop_reason: 'end_turn' },
    ]);
    const ctx = makeCtx();
    const result = await chatLoop(
      ctx as any,
      {
        systemPrompt: '',
        userMessage: 'foo',
        priorMessages: [],
        tools: [{ function: { name: 'x' } }],
        model: 'test-model',
        maxTurns: 10,
        concurrencySafeNames: new Set(['x']),
        maxConcurrency: 5,
      } as any,
      makeDeps(stream),
    );
    expect(result.ok).toBe(true);
    // A1 — guard emit ripped; warn-log fires exactly once even when the
    // model loops on the same call across turn 4 (latch holds).
    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length).toBe(1);
  });
});
