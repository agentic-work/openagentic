/**
 * Q1-fix-6 (2026-05-12) — no-progress guard must compare ARGS, not just
 * name+count.
 *
 * Bug captured 3/3 reproductions on 0.7.1-ede3228f:
 *   Sonnet 4.5 fans out 3 DISTINCT tool_search calls (azure / aws / gcp
 *   queries) in turn 1. Guard fired and logged
 *     "tool 'tool_search' called 3× with identical args"
 *   even though the args were all distinct. Consequence: tool_choice =
 *   'none' on turn 2 + user-role directive ("do not call this tool
 *   again"), so the model produced narration and never invoked
 *   azure_cost_* / aws_cost_* / gcp_* tools. No $ data, no artifact.
 *
 * Contract:
 *   - 3 calls with DIFFERENT args (legitimate fan-out) → guard does NOT fire.
 *   - 3 calls with IDENTICAL args (real stuck loop) → guard fires.
 *   - 2 distinct + 1 duplicate (3 calls, 2 unique sigs) → does NOT fire.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

function makeCtx() {
  return {
    ctx: {
      emit: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's',
      userId: 'u',
    } as any,
  };
}

function buildStreamProvider(
  perTurn: Array<Array<{ name: string; input: unknown }>>,
) {
  let turn = 0;
  return () => {
    turn++;
    const calls = perTurn[turn - 1];
    if (!calls) {
      return (async function* () {
        yield { type: 'text_delta', text: 'done' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }
    return (async function* () {
      for (let i = 0; i < calls.length; i++) {
        yield {
          type: 'tool_use_complete',
          id: `t${turn}-${i}`,
          name: calls[i].name,
          input: calls[i].input,
        };
      }
      yield { type: 'message_stop', stop_reason: 'tool_use' };
    })();
  };
}

const dispatch = vi.fn(async (_c: any, _x: any) => ({
  ok: true,
  output: 'stub',
}));

describe('chatLoop Q1-fix-6 — no-progress guard distinctness', () => {
  it('legit fan-out: 3× tool_search with DIFFERENT args does NOT trigger guard', async () => {
    const { ctx } = makeCtx();
    const streamProvider = buildStreamProvider([
      [
        { name: 'tool_search', input: { query: 'azure cost analysis billing month over month spend by service', k: 5 } },
        { name: 'tool_search', input: { query: 'aws cost billing analysis month over month by service', k: 5 } },
        { name: 'tool_search', input: { query: 'gcp cost billing analysis month over month by service', k: 5 } },
      ],
    ]);

    await chatLoop(
      ctx,
      {
        userMessage: 'show me tri-cloud cost spike',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'tool_search', description: 'discover' } }],
        model: 'claude-sonnet-4-5',
        maxTurns: 10,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length, 'legit fan-out must not trigger guard').toBe(0);
  });

  it('real stuck loop: 3× tool_search with IDENTICAL args DOES trigger guard', async () => {
    const { ctx } = makeCtx();
    const streamProvider = buildStreamProvider([
      [{ name: 'tool_search', input: { query: 'azure cost', k: 5 } }],
      [{ name: 'tool_search', input: { query: 'azure cost', k: 5 } }],
      [{ name: 'tool_search', input: { query: 'azure cost', k: 5 } }],
    ]);

    await chatLoop(
      ctx,
      {
        userMessage: 'azure cost',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'tool_search', description: 'discover' } }],
        model: 'claude-sonnet-4-5',
        maxTurns: 10,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length, 'identical-args stuck loop must trigger guard').toBe(1);
    expect(String(warnCalls[0][1])).toContain('tool_search');
  });

  it('edge case: 2 distinct + 1 duplicate (3 calls, 2 unique sigs) does NOT trigger', async () => {
    const { ctx } = makeCtx();
    // 3 tool_search calls in a single turn: A, B, A. nameCount=3 but
    // sigSet.size=2 — partial repetition is not all-stuck.
    const streamProvider = buildStreamProvider([
      [
        { name: 'tool_search', input: { query: 'azure cost' } },
        { name: 'tool_search', input: { query: 'aws cost' } },
        { name: 'tool_search', input: { query: 'azure cost' } },
      ],
    ]);

    await chatLoop(
      ctx,
      {
        userMessage: 'mixed',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'tool_search', description: 'discover' } }],
        model: 'claude-sonnet-4-5',
        maxTurns: 10,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length, 'partial-repetition must not trigger guard').toBe(0);
  });
});
