/**
 * V3 chatLoop follow-up chip-row emission (Sev-0 F1-6, 2026-05-17).
 *
 * Contract: when chatLoop finishes a turn on `end_turn`, it emits exactly
 * one `follow_up` frame carrying 3 chip strings AFTER the final synthesis
 * text has been streamed and BEFORE `assistant_message_stop`. All 17
 * northstar mocks (`mocks/UX/AI/Chatmode/end-state-{01..17}.html`) render
 * a `.followups` row with 3 `.chip` buttons in this slot — without this
 * frame chatmode cannot match the mock.
 *
 * Chip generation reuses the same model + deps.streamProvider as the main
 * loop with `tool_choice: 'none'` and a short prompt. NO hardcoded model id
 * (CLAUDE.md rule 7) — pulled straight from `input.model`.
 *
 * Position invariant (CLAUDE.md rule 8a — streaming interleave): the
 * `follow_up` emit lands BETWEEN the last `assistant_message_delta` and
 * `assistant_message_stop`. Never coalesced before tool cards.
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

describe('chatLoop — follow_up frame on end_turn (Sev-0 F1-6)', () => {
  it('emits one follow_up frame with 3 string items between final text and assistant_message_stop', async () => {
    const { ctx, emitted } = makeCtx();

    // Two streamProvider calls:
    //   call 1 — main assistant turn: streams synthesis text + end_turn.
    //   call 2 — follow-up chip generation: streams a JSON array of 3 strings.
    let call = 0;
    function streamProvider(req: any) {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'text_delta', text: 'Final synthesis here.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      // Chip-generation call: tool_choice should be 'none', model reused.
      expect(req.tool_choice).toBe('none');
      expect(req.model).toBe('gpt-oss:20b');
      return (async function* () {
        yield {
          type: 'text_delta',
          text: '["drill into prod-west","apply terraform plan","open RCA template"]',
        };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'what broke?',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: vi.fn() as any,
      },
    );

    expect(result.ok).toBe(true);

    // Exactly one follow_up frame.
    const followUps = emitted.filter((e) => e.op === 'follow_up');
    expect(followUps).toHaveLength(1);
    const payload = followUps[0].payload;
    expect(payload.type).toBe('follow_up');
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items).toHaveLength(3);
    expect(payload.items).toEqual([
      'drill into prod-west',
      'apply terraform plan',
      'open RCA template',
    ]);

    // Position invariant — follow_up sits between last assistant_message_delta
    // and assistant_message_stop (CLAUDE.md rule 8a).
    const lastDeltaIdx = (() => {
      let idx = -1;
      emitted.forEach((e, i) => {
        if (e.op === 'assistant_message_delta') idx = i;
      });
      return idx;
    })();
    const followUpIdx = emitted.findIndex((e) => e.op === 'follow_up');
    const stopIdx = emitted.findIndex((e) => e.op === 'assistant_message_stop');
    expect(lastDeltaIdx).toBeGreaterThanOrEqual(0);
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(followUpIdx).toBeGreaterThan(lastDeltaIdx);
    expect(followUpIdx).toBeLessThan(stopIdx);
  });

  it('emits follow_up with [] when chip-gen model output is unparseable (does NOT crash the turn)', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;
    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'text_delta', text: 'answer' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'I cannot suggest anything sorry' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const result = await chatLoop(
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

    expect(result.ok).toBe(true);
    const followUps = emitted.filter((e) => e.op === 'follow_up');
    expect(followUps).toHaveLength(1);
    expect(followUps[0].payload.items).toEqual([]);
    // Still ends with assistant_message_stop AFTER the empty follow_up.
    const followUpIdx = emitted.findIndex((e) => e.op === 'follow_up');
    const stopIdx = emitted.findIndex((e) => e.op === 'assistant_message_stop');
    expect(followUpIdx).toBeLessThan(stopIdx);
  });

  it('emits follow_up with [] (does not crash) when chip-gen streamProvider throws', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;
    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'text_delta', text: 'answer' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      // Chip-gen call throws.
      return (async function* () {
        throw new Error('chip-gen provider failure');
        // eslint-disable-next-line no-unreachable
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const result = await chatLoop(
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

    expect(result.ok).toBe(true);
    const followUps = emitted.filter((e) => e.op === 'follow_up');
    expect(followUps).toHaveLength(1);
    expect(followUps[0].payload.items).toEqual([]);
  });

  it('does NOT emit follow_up on max_tokens (only fires on clean end_turn)', async () => {
    const { ctx, emitted } = makeCtx();
    function streamProvider() {
      return (async function* () {
        yield { type: 'text_delta', text: 'partial' };
        yield { type: 'message_stop', stop_reason: 'max_tokens' };
      })();
    }
    const result = await chatLoop(
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
    expect(result.ok).toBe(false);
    expect(emitted.find((e) => e.op === 'follow_up')).toBeUndefined();
  });
});
