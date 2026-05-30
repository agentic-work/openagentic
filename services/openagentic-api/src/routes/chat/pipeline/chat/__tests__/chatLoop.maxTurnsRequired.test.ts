/**
 * chatLoop — `input.maxTurns` is REQUIRED.
 *
 * Before this change, chatLoop fell back to a hardcoded
 * `DEFAULT_MAX_TURNS = 12` constant when callers omitted `maxTurns`.
 * That hardcode is the Sev-1 surfaced by the 2026-05-11 multi-cloud
 * capstone (gpt-5.4 hit the 12-cap during 32-tool cascade fanout).
 *
 * Post-rip:
 *   - `chatLoop.ts` no longer defines `DEFAULT_MAX_TURNS`.
 *   - When `input.maxTurns` is missing/invalid, chatLoop throws.
 *   - The SoT for this value is `ChatLoopConfigService.getMaxTurns()`
 *     (admin-editable), threaded by `stream.handler.ts` into the
 *     `RunChatInput` → `ChatLoopInput`.
 *
 * Pinned by this test so a future regression that re-introduces a
 * fallback default fails immediately.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

function makeCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 's',
    userId: 'u',
  } as any;
}

describe('chatLoop — input.maxTurns is required', () => {
  it('throws when maxTurns is missing', async () => {
    const ctx = makeCtx();
    const streamProvider = vi.fn(async function* () {
      yield { type: 'text_delta', text: 'hi' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    });

    await expect(
      chatLoop(
        ctx,
        {
          userMessage: 'hi',
          priorMessages: [],
          systemPrompt: 's',
          tools: [],
          model: 'gpt-5.4',
          // maxTurns intentionally omitted
        } as any,
        { streamProvider: streamProvider as any, dispatch: vi.fn() as any },
      ),
    ).rejects.toThrow(/maxTurns/);
  });

  it('throws when maxTurns is not a positive integer', async () => {
    const ctx = makeCtx();
    const streamProvider = vi.fn(async function* () {
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    });

    for (const bad of [0, -1, 1.5, NaN, 'abc' as any]) {
      await expect(
        chatLoop(
          ctx,
          {
            userMessage: 'hi',
            priorMessages: [],
            systemPrompt: 's',
            tools: [],
            model: 'gpt-5.4',
            maxTurns: bad as any,
          },
          { streamProvider: streamProvider as any, dispatch: vi.fn() as any },
        ),
      ).rejects.toThrow(/maxTurns/);
    }
  });

  it('accepts a valid maxTurns and runs the loop', async () => {
    const ctx = makeCtx();
    const streamProvider = vi.fn(async function* () {
      yield { type: 'text_delta', text: 'ok' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    });

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-5.4',
        maxTurns: 8,
      },
      { streamProvider: streamProvider as any, dispatch: vi.fn() as any },
    );

    expect(result.ok).toBe(true);
    expect(result.turns).toBe(1);
  });
});
