/**
 * Bug A — anti-bias gate too loose (2026-05-24).
 *
 * Live failure: user prompt "use memory_search to recall my Azure security audit"
 * caused the model to emit a compose_visual artifact when memory_search
 * returned []. The current gate at chatLoop.ts:1438 has a
 * `conversationHasNumericGrounding(messages)` bypass — ANY prior tool_result
 * with a number in it satisfies the gate, even when the user did NOT ask
 * for a visualization. memory_search results contain dollar amounts which
 * tripped the bypass.
 *
 * Per [[feedback_artifacts_must_be_explicitly_requested]]: drop the bypass.
 * Require `userAsked || conceptual` — no numeric-grounding escape valve.
 *
 * Contract after fix:
 *   - compose_visual / compose_app dispatch with prior numeric tool_result
 *     BUT no user-ask AND non-conceptual template → BLOCKED.
 *   - User-asked OR conceptual template → still allowed (regression guard).
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

describe('chatLoop — anti-bias gate TIGHTENED (Bug A, 2026-05-24)', () => {
  it('compose_visual with prior numeric tool_result BUT no user-ask AND non-conceptual template → BLOCKED', async () => {
    // This is the memory_search regression case: user asked to RECALL
    // memories (not to render a chart). memory_search returned an item
    // with a numeric value. Pre-fix, the conversationHasNumericGrounding
    // bypass let compose_visual through. Post-fix, gate fires because
    // user did NOT explicitly ask for a chart.
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv-bad',
            name: 'compose_visual',
            input: { template: 'sankey', data: { nodes: [], links: [] } },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Sorry — I should not have rendered that.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'compose_visual') {
        return { ok: true, output: { rendered: true } };
      }
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        // Non-artifact-verb user prompt — RECALL not RENDER.
        userMessage: 'use memory_search to recall my Azure security audit',
        // Prior tool_result HAS numeric values (cost figures) — pre-fix this
        // tripped the numeric-grounding bypass. Post-fix this is irrelevant.
        priorMessages: [
          { role: 'user', content: 'remember my Azure audit findings' },
          { role: 'assistant', content: 'Noted.' },
          {
            role: 'tool',
            content: [
              {
                tool_use_id: 'mem1',
                content: { findings: 'audit complete', est_monthly_savings: 12345.67 },
                is_error: false,
              },
            ],
          },
        ],
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'compose_visual', description: 'chart' } },
        ],
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: new Set(['compose_visual']),
      } as any,
      { streamProvider: streamProvider as any, dispatch: dispatch as any } as any,
    );

    // Gate MUST fire — no compose_visual dispatch even though there is
    // a numeric tool_result upstream. The user didn't ask for a chart;
    // numeric grounding alone no longer justifies emission.
    const composeVisualDispatches = dispatch.mock.calls.filter(
      ([, call]) => (call as any).name === 'compose_visual',
    );
    expect(composeVisualDispatches.length).toBe(0);

    // Synthetic error tool_result emitted in the gate's place.
    const toolResults = emitted.filter(e => e.op === 'tool_result');
    const gatedResult = toolResults.find(
      e => e.payload.name === 'compose_visual' && e.payload.is_error === true,
    );
    expect(gatedResult).toBeDefined();
  });

  it('compose_visual with user-ask AND prior numeric data → STILL ALLOWED (regression guard)', async () => {
    // Regression case: legitimate user-asked chart with numeric grounding
    // must continue to work. Gate fires ONLY on (no user-ask AND non-conceptual).
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv-ok',
            name: 'compose_visual',
            input: { template: 'sankey', data: { nodes: [], links: [] } },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Here is the chart.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'compose_visual') {
        return { ok: true, output: { rendered: true, kind: 'sankey' } };
      }
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        // Explicit artifact verb — "render a chart".
        userMessage: 'render a chart of my cloud bill breakdown',
        priorMessages: [
          {
            role: 'tool',
            content: [
              {
                tool_use_id: 'prior1',
                content: { total: 12345.67, top: [{ s: 'EC2', c: 4500 }] },
                is_error: false,
              },
            ],
          },
        ],
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'compose_visual', description: 'chart' } },
        ],
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: new Set(['compose_visual']),
      } as any,
      { streamProvider: streamProvider as any, dispatch: dispatch as any } as any,
    );

    const composeVisualDispatches = dispatch.mock.calls.filter(
      ([, call]) => (call as any).name === 'compose_visual',
    );
    expect(composeVisualDispatches.length).toBe(1);
    const errToolResults = emitted.filter(
      e =>
        e.op === 'tool_result' &&
        e.payload.name === 'compose_visual' &&
        e.payload.is_error === true,
    );
    expect(errToolResults.length).toBe(0);
  });
});
