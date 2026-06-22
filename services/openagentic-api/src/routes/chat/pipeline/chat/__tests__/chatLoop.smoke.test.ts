/**
 * V3 chatLoop smoke test (Plan §Tests #1).
 *
 * Single turn, no tools. Provider emits text_delta then end_turn.
 * Asserts the loop emits the named `assistant_message_delta` frame and
 * the named `assistant_message_stop` frame with the right reason.
 *
 * A1 (2026-05-12) — opcode dual-emits ripped; UI consumes named frames
 * only. The legacy opcode-{0,e} assertions are now name-based.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

interface Emit {
  op: string;
  payload: any;
}

function makeCtx() {
  const emitted: Emit[] = [];
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

describe('chatLoop — smoke (single turn, no tools)', () => {
  it('emits assistant_message_delta for text delta and assistant_message_stop on end_turn', async () => {
    const { ctx, emitted } = makeCtx();

    // Async-iterable provider that yields text then stop.
    async function* fakeStream() {
      yield { type: 'text_delta', text: 'hello world' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
    const streamProvider = vi.fn(async function* () {
      yield* fakeStream();
    });
    const dispatch = vi.fn();

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 'you are helpful',
        tools: [],
        model: 'gpt-5.4',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    expect(result.ok).toBe(true);
    expect(result.turns).toBe(1);

    // Named `assistant_message_delta` frame must carry the text.
    const textOps = emitted.filter(e => e.op === 'assistant_message_delta');
    expect(textOps.length).toBeGreaterThan(0);
    expect(textOps.map(e => e.payload?.text ?? '').join('')).toContain('hello world');

    // Named `assistant_message_stop` frame closes the turn.
    const stop = emitted.find(e => e.op === 'assistant_message_stop');
    expect(stop).toBeDefined();
    expect(stop!.payload.reason).toBe('end_turn');

    // No tools dispatched.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('exits cleanly when stop_reason is max_tokens', async () => {
    const { ctx, emitted } = makeCtx();
    async function* fakeStream() {
      yield { type: 'text_delta', text: 'partial' };
      yield { type: 'message_stop', stop_reason: 'max_tokens' };
    }
    const streamProvider = vi.fn(async function* () {
      yield* fakeStream();
    });

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-5.4',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: vi.fn() as any },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/max_tokens/);

    const stop = emitted.find(e => e.op === 'assistant_message_stop');
    expect(stop?.payload.reason).toBe('max_tokens');
  });
});
