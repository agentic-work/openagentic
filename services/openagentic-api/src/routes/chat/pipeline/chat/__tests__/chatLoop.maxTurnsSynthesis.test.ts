/**
 * #51 (2026-06-01) — max-turns terminal path must NOT leak raw tool args.
 *
 * LIVE BUG (openagentic): when the discovery loop never converged, the loop
 * ran to max_turns and returned `{ok:false, error:'hit max-turns cap…'}`
 * with NO synthesis — the last thing the user saw was the model's raw
 * leaked args ({"k":5,"query":"azure_list"}). Belt-and-suspenders on top of
 * the dead-end guard: before the terminal max_turns return, if a final
 * synthesis was never forced, run ONE tool_choice='none' turn with a
 * directive ("you are out of tool budget; answer from what you have; if
 * the capability isn't available say so") so the turn ALWAYS ends on
 * user-facing prose. Gated by a one-shot flag so it runs at most once.
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

describe('chatLoop — max-turns forced synthesis (#51)', () => {
  it('forces ONE tool_choice=none synthesis turn at max-turns and returns user-facing prose', async () => {
    const ctx = makeCtx();
    let turn = 0;
    const seenToolChoices: any[] = [];
    let synthesisRan = false;
    let synthesisText = '';

    // A pathological model: emits a distinct-arg tool_use every turn and
    // never produces an end_turn on its own. With a small maxTurns this
    // exhausts the budget. We use a non-discovery tool name so the #51
    // dead-end guard (tool_search-keyed) does NOT short-circuit first —
    // this isolates the max-turns synthesis path.
    function streamProvider(args: any) {
      turn++;
      // The follow-up-chip generator reuses streamProvider with a FRESH
      // 1-message array + tool_choice='none' AFTER the synthesis turn. It is
      // NOT a chat turn — exclude it from tool_choice accounting and the
      // synthesis assertions (but still return text so it doesn't error).
      const isLoopTurn = (args?.messages?.length ?? 0) > 1 || turn === 1;
      if (args?.tool_choice === 'none') {
        if (isLoopTurn) {
          // The forced synthesis turn. Produce user-facing prose.
          seenToolChoices.push('none');
          synthesisRan = true;
          synthesisText =
            'I ran out of tool budget. Here is what I can tell you from the data gathered so far.';
          return (async function* () {
            yield { type: 'text_delta', text: synthesisText };
            yield { type: 'message_stop', stop_reason: 'end_turn' };
          })();
        }
        // Follow-up chip generator — return innocuous text, don't count it.
        return (async function* () {
          yield { type: 'text_delta', text: '[]' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      seenToolChoices.push(args?.tool_choice);
      return (async function* () {
        yield {
          type: 'tool_use_complete',
          id: `t${turn}`,
          name: 'some_read_tool',
          input: { page: turn }, // distinct args each turn
        };
        yield { type: 'message_stop', stop_reason: 'tool_use' };
      })();
    }

    const dispatch = vi.fn(async () => ({ ok: true, output: 'partial data' }));

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'do a thing',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'some_read_tool', description: 'read' } }],
        model: 'gpt-oss:20b',
        maxTurns: 3,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    // The forced synthesis turn ran exactly once (tool_choice='none').
    expect(synthesisRan).toBe(true);
    expect(seenToolChoices.filter((c) => c === 'none').length).toBe(1);

    // The loop ended cleanly via the synthesis end_turn path — NOT the
    // bare max-turns `ok:false` leak. (chatLoop delivers the final text
    // via ctx.emit('assistant_message_delta'); the result carries ok/turns.)
    expect(result.ok).toBe(true);

    // The user-facing prose was actually streamed out (no raw-args leak).
    const deltaTexts = (ctx.emit as any).mock.calls
      .filter((c: any[]) => c[0] === 'assistant_message_delta')
      .map((c: any[]) => c[1]?.text ?? '')
      .join('');
    expect(deltaTexts).toMatch(/tool budget|tell you|data gathered/i);
    expect(synthesisText).toMatch(/tool budget/i);
  });
});
