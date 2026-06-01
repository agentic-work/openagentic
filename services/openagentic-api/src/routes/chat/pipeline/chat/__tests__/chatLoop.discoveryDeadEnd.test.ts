/**
 * #51 (2026-06-01) — discovery dead-end loop guard.
 *
 * LIVE BUG (open-dev, gpt-oss:20b): "show me my azure subscriptions" →
 * tool_search × 6 in ~14s with VARYING queries ("azure", "azure
 * subscription list tool", "azure list subscriptions"…), each returning
 * the SAME 14 non-azure tools and ZERO usable azure tool. The existing
 * discovery guard (chatLoop.ts) only fires when every query is IDENTICAL
 * (`sigSet.size === 1`) — a Q1-fix-6 carve-out that protects Sonnet's
 * legit azure/aws/gcp fan-out. The azure spin VARIES the query, so
 * `sigSet.size > 1` and that guard never fires. The loop ran until
 * max_turns and leaked the raw tool args as the answer.
 *
 * Fix: a parallel, orthogonal counter keyed on "no NEW usable tool was
 * discovered." When N consecutive tool_search calls add ZERO new tool defs
 * (acceptDiscovered returns 0), the loop forces a tool_choice='none'
 * synthesis turn with a directive telling the model the capability is NOT
 * connected (needs credentials/Azure OBO), name what IS connected, and
 * stop — so the turn ends cleanly with a helpful answer, never a leaked-
 * args spin. Resets on any tool_search that adds ≥1 new tool (legit
 * fan-out is unaffected — pinned by chatLoop.noProgressArgsDistinct).
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

function makeCtx() {
  const emitted: Array<{ op: any; payload: any }> = [];
  return {
    ctx: {
      emit: (op: any, payload: any) => emitted.push({ op, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's',
      userId: 'u',
    } as any,
    emitted,
  };
}

describe('chatLoop — discovery dead-end guard (no-new-tool streak, #51)', () => {
  it('ends with a user-facing answer after 2 tool_search calls that add zero new tools (distinct queries)', async () => {
    const { ctx } = makeCtx();
    let turn = 0;
    // The azure spin: distinct queries, never converging.
    const queries = ['azure subscriptions list', 'azure list subscriptions'];
    let forcedSynthesisText: string | null = null;

    function streamProvider(_args: any) {
      turn++;
      if (turn <= 2) {
        const q = queries[turn - 1];
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: `t${turn}`,
            name: 'tool_search',
            input: { query: q },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      // Turn 3 is the forced synthesis turn — the loop set tool_choice='none'
      // and pushed a directive. Produce the user-facing answer.
      return (async function* () {
        forcedSynthesisText =
          'Azure is not connected in this session — it needs an Azure login (OBO). Connected: web, aws_knowledge.';
        yield { type: 'text_delta', text: forcedSynthesisText };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    // Every tool_search returns NO new usable tool (azure isn't in the catalog).
    const dispatch = vi.fn(async (_c: any, x: any) => ({
      ok: true,
      output: `tool_search('${x.input.query}'): no connected tool matches`,
      discoveredTools: [], // <-- zero new tools every time
    }));

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'show me my azure subscriptions',
        priorMessages: [],
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'tool_search', description: 'discover' } },
        ],
        model: 'gpt-oss:20b',
        maxTurns: 10,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    // The loop ended cleanly via synthesis, NOT max_turns.
    expect(result.ok).toBe(true);
    expect(result.turns).toBeLessThan(10);

    // The dead-end guard fired (warn-log audit trail).
    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length, 'dead-end guard must fire on varying-query no-new-tool spin').toBeGreaterThanOrEqual(1);

    // The forced synthesis turn actually ran (model produced user-facing prose).
    expect(forcedSynthesisText).toBeTruthy();
  });

  it('pushes a directive that says NOT available/connected + Do NOT search again', async () => {
    const { ctx } = makeCtx();
    let turn = 0;
    const queries = ['azure subscriptions', 'list azure subs'];
    let lastUserDirective = '';

    function streamProvider(args: any) {
      turn++;
      // Capture the messages array the loop hands to the provider on turn 3
      // (the forced synthesis turn) — the directive is the last user message.
      const msgs = args?.messages ?? args?.priorMessages ?? [];
      const lastUser = [...msgs].reverse().find((m: any) => m.role === 'user');
      if (turn === 3 && lastUser && typeof lastUser.content === 'string') {
        lastUserDirective = lastUser.content;
      }
      if (turn <= 2) {
        const q = queries[turn - 1];
        return (async function* () {
          yield { type: 'tool_use_complete', id: `t${turn}`, name: 'tool_search', input: { query: q } };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Azure is not connected.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async () => ({ ok: true, output: 'no match', discoveredTools: [] }));

    await chatLoop(
      ctx,
      {
        userMessage: 'show me my azure subscriptions',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'tool_search', description: 'discover' } }],
        model: 'gpt-oss:20b',
        maxTurns: 10,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    expect(lastUserDirective).toMatch(/not (available|connected)/i);
    expect(lastUserDirective).toMatch(/do not search again/i);
    // The directive references the searched capability so the model names it.
    expect(lastUserDirective.toLowerCase()).toMatch(/azure|capability/);
  });

  it('does NOT fire when tool_search keeps discovering NEW tools (streak resets)', async () => {
    const { ctx } = makeCtx();
    let turn = 0;

    function streamProvider() {
      turn++;
      if (turn <= 3) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: `t${turn}`,
            name: 'tool_search',
            input: { query: `query ${turn}` },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'done' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    // Each call discovers a DISTINCT new tool → streak resets each time.
    const dispatch = vi.fn(async (_c: any, _x: any) => ({
      ok: true,
      output: 'found tools',
      discoveredTools: [
        { type: 'function', function: { name: `discovered_tool_${turn}`, description: 'd' } },
      ],
    }));

    await chatLoop(
      ctx,
      {
        userMessage: 'do many things',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'tool_search', description: 'discover' } }],
        model: 'gpt-oss:20b',
        maxTurns: 10,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length, 'progress (new tools) must NOT trip the dead-end guard').toBe(0);
  });
});
