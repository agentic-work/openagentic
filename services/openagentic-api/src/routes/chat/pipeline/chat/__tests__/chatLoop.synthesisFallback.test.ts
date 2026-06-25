/**
 * V3 chatLoop synthesis fallback (Plan §Tests #12).
 *
 * Direct port of V2 commit 6b6889b4's contract. When end_turn arrives
 * with NO text AFTER prior tool_results came back, V3 must force ONE
 * more bounded provider turn with a system reminder. Without this, the
 * UI shows tool cards + an empty assistant bubble (the gpt-oss:20b
 * weather-probe smoking gun from 2026-05-08).
 *
 * Mirrors all 4 cases pinned in V2 at
 * src/routes/chat/pipeline/v2/__tests__/runChatTurnV2.synthesisFallback.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

function makeCtx() {
  const emitted: Array<{ op: string; payload: any }> = [];
  return {
    ctx: {
      emit: (op: string, payload: any) => emitted.push({ op, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's',
      userId: 'u',
    } as any,
    emitted,
  };
}

describe('V3 chatLoop — synthesis fallback (port of V2 6b6889b4)', () => {
  it('forces one more turn when end_turn arrives with no text after tool_results', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;

    // Four-step provider (chip-gen adds +1 call after synthesis text):
    //   turn 1: tool_use (wttr_fetch) → stop_reason=tool_use
    //   turn 2: empty content + end_turn (the bug)
    //   turn 3: synthesis text + end_turn (the fix)
    //   turn 4: F1-6 follow-up chip generation (tool_choice='none')
    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 't1',
            name: 'wttr_fetch',
            input: { city: 'seattle' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        return (async function* () {
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      if (call === 3) {
        return (async function* () {
          yield { type: 'text_delta', text: 'It is ☁ +55°F in Seattle.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      // Chip-gen turn (F1-6) — return a JSON array of 3 follow-ups.
      return (async function* () {
        yield { type: 'text_delta', text: '["next city","forecast","alerts"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async () => ({
      ok: true,
      output: { temp: 55, sky: '☁' },
    }));

    const result = await chatLoop(
      ctx,
      {
        userMessage: "what's the weather in seattle",
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'wttr_fetch' } }],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    expect(result.ok).toBe(true);
    // turn 1 (tool) + turn 2 (empty end_turn) + turn 3 (synthesis) +
    // turn 4 (F1-6 chip-gen) = 4 calls.
    expect(call).toBe(4);
    // A1 (2026-05-12) — opcode-0 dual-emit ripped; assert named
    // `assistant_message_delta` frame carries the synthesis text.
    const text = emitted
      .filter(e => e.op === 'assistant_message_delta')
      .map(e => e.payload?.text ?? '')
      .join('');
    expect(text).toContain('Seattle');
  });

  it('does NOT force synthesis when end_turn comes WITH text', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'text_delta', text: 'hello' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      // Chip-gen turn (F1-6) — chatLoop fires this after every clean end_turn
      // with non-empty assistant text. Not a synthesis retry.
      return (async function* () {
        yield { type: 'text_delta', text: '["a","b","c"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: vi.fn() as any },
    );
    // 1 main turn + 1 F1-6 chip-gen call = 2. Critically: NO synthesis retry.
    expect(call).toBe(2);
  });

  it('does NOT force synthesis when end_turn arrives empty BUT no prior tool_results exist', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    function streamProvider() {
      call++;
      return (async function* () {
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: vi.fn() as any },
    );
    expect(call).toBe(1); // Empty turn 1 with no tool_results = no synthesis target.
  });

  it('caps synthesis retry at exactly one extra turn (no infinite loop)', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'tool_use_complete', id: 't1', name: 'foo', input: {} };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      // All subsequent turns are pathologically empty.
      return (async function* () {
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }
    const dispatch = vi.fn(async () => ({ ok: true, output: 'x' }));

    await chatLoop(
      ctx,
      {
        userMessage: 'do it',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // tool_use (1) + empty end_turn (2) + ONE synthesis retry (3) = 3 calls max.
    // Critically: NOT 5 (maxTurns), NOT infinite — `synthesisRetried` flag stops it.
    expect(call).toBe(3);
  });

  it('forces tool_choice="none" on the synthesis-retry turn', async () => {
    // The synthesis-retry turn's contract is "the model must produce text
    // now, no more tools." Achieving that purely with English in the user
    // message ("Do not call more tools") is unreliable across providers
    // and models — the only protocol-level guarantee is tool_choice='none',
    // which makes the provider literally unable to return a tool_use.
    //
    // The fix is model-agnostic by construction: the platform doesn't
    // know which model is configured, and it doesn't need to. The
    // semantic is "force text output on this single retry call" — true
    // for every model. tool_choice='none' is the only mechanism that
    // upholds that semantic without a per-model branch.
    //
    // RED before chatLoop sets nextTurnToolChoice='none' on the retry.
    const { ctx } = makeCtx();
    let call = 0;
    const requests: Array<any> = [];
    function streamProvider(req: any) {
      call++;
      requests.push(req);
      if (call === 1) {
        return (async function* () {
          yield { type: 'tool_use_complete', id: 't1', name: 'wttr_fetch', input: {} };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        return (async function* () {
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      if (call === 3) {
        return (async function* () {
          yield { type: 'text_delta', text: 'OK.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      // Chip-gen turn (F1-6) — also tool_choice='none', but for a different
      // reason (no tools to call from). Asserted below alongside turn 3.
      return (async function* () {
        yield { type: 'text_delta', text: '["a","b","c"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }
    const dispatch = vi.fn(async () => ({ ok: true, output: 'x' }));

    await chatLoop(
      ctx,
      {
        userMessage: 'say hello',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'wttr_fetch' } }],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // 4 calls: 3 chatLoop turns + 1 F1-6 chip-gen call.
    expect(call).toBe(4);
    // Turn 1 (initial) + Turn 2 (the "empty end_turn" detection turn) get
    // 'auto' so the model is free to call tools. Turn 3 is the synthesis
    // retry — must be 'none' so the model is forced to text.
    expect(requests[0].tool_choice).toBe('auto');
    expect(requests[1].tool_choice).toBe('auto');
    expect(requests[2].tool_choice).toBe('none');
    // Turn 4 — F1-6 chip-gen call is also tool_choice='none'.
    expect(requests[3].tool_choice).toBe('none');
  });
});
