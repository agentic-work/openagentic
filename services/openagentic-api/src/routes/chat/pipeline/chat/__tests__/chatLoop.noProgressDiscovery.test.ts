/**
 * Live capture 2026-05-12 (probe #1, gpt-oss:20b):
 *   tool_search × 6 with VARYING query strings, azure_list_subscriptions
 *   × 3 → loop hit max_turns without firing the no-progress guard.
 *
 * Original fix: track DISCOVERY_PRIMITIVES by NAME ONLY.
 *
 * Q1-fix-6 (2026-05-12) revision: the name-only counter overcorrected.
 * Sonnet 4.5 legitimately fans out 3 parallel tool_search calls in one
 * turn (azure/aws/gcp) with DISTINCT queries — the guard was tripping
 * and forcing tool_choice='none', preventing the cascade from ever
 * reaching real cloud tools. The discovery branch now also requires
 * `sigSet.size === 1` (all calls had identical args) to trigger. The
 * regression test below still pins the identical-args case firing.
 *
 * #51 (2026-06-01) revision: the discovery dead-end guard is now keyed on
 * NO-NEW-TOOL progress, not arg-distinctness. "Legitimate fan-out" means
 * the search DISCOVERS tools (makes progress). Distinct queries that each
 * discover a NEW tool across turns are legit and must NOT trip. Distinct
 * queries that discover NOTHING across turns ARE the azure spin — those
 * now trip (see chatLoop.discoveryDeadEnd.test.ts). The case below was
 * updated to make each turn DISCOVER a new tool so it stays a genuine
 * fan-out under the #51 semantics.
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

describe('chatLoop — no-progress guard for discovery primitives (distinctness-aware)', () => {
  it('Q1-fix-6 / #51: does NOT fire on 3× tool_search when each DISCOVERS a new tool (legitimate fan-out)', async () => {
    // Sonnet 4.5 emits distinct tool_search calls (azure/aws/gcp) that each
    // discover a NEW tool. The guard must let these pass — progress resets
    // the #51 dead-end streak every turn.
    const { ctx, emitted } = makeCtx();
    let turn = 0;
    const queries = ['azure list', 'azure resource', 'azure subscriptions'];

    function streamProvider() {
      turn++;
      if (turn <= 3) {
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
      return (async function* () {
        yield { type: 'text_delta', text: 'final synthesis' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    // Each distinct query discovers a DISTINCT new tool → genuine progress,
    // streak resets each turn, guard stays silent.
    const dispatch = vi.fn(async (_c: any, x: any) => ({
      ok: true,
      output: `${x.input.query}: found a tool`,
      discoveredTools: [
        {
          type: 'function',
          function: { name: `discovered_${x.input.query.replace(/\s+/g, '_')}`, description: 'd' },
        },
      ],
    }));

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'find azure resources',
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

    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(
      warnCalls.length,
      'distinct-args fan-out must NOT trigger the guard',
    ).toBe(0);
    expect(result.ok).toBe(true);
  });

  it('regression: non-discovery tool with identical args still trips the original guard', async () => {
    const { ctx, emitted } = makeCtx();
    let turn = 0;
    function streamProvider() {
      turn++;
      if (turn <= 3) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: `t${turn}`,
            name: 'azure_list_subscriptions',
            input: {},
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'ok' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }
    const dispatch = vi.fn(async () => ({ ok: true, output: '0 subscriptions' }));
    await chatLoop(
      ctx,
      {
        userMessage: 'list subs',
        priorMessages: [],
        systemPrompt: 's',
        tools: [
          {
            type: 'function',
            function: { name: 'azure_list_subscriptions', description: 'list' },
          },
        ],
        model: 'gpt-oss:20b',
        maxTurns: 10,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );
    // A1 — guard audit trail moved to warn-log only.
    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length, 'identical-args guard still fires').toBeGreaterThanOrEqual(1);
    expect(String(warnCalls[0][1])).toContain('azure_list_subscriptions');
  });
});
