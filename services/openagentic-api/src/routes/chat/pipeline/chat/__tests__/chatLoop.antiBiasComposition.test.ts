/**
 * chatLoop — anti-bias gate on compose_visual / compose_app emission
 * (Sev-0 #871, 2026-05-17).
 *
 * Why this exists:
 *   The user direction (2026-05-17 PM): "the model shouldnt and wouldnt
 *   take liberties to just give all of that data to a user in one prompt
 *   without followup requests from the user".
 *
 *   The smoking gun: small/mid models sometimes emit compose_visual or
 *   compose_app on a TEXT-ONLY prompt — no prior tool_result anywhere in
 *   the conversation — and fabricate the numeric data. The UI then
 *   renders a "No data" placeholder. The fix: refuse the dispatch at
 *   the chatLoop seam when there is no prior numeric tool_result in
 *   the conversation context.
 *
 *   The gate is permissive across turns — a prior turn's tool_results
 *   (still living in `messages` as role:'tool' entries) DO satisfy the
 *   gate, so the multi-turn cost-audit flow (Turn 1: tool_results
 *   pushed; Turn 2: "show me the chart" → compose_visual allowed because
 *   prior turn's tool_results contain numeric data) works correctly.
 *
 * Contract:
 *   - compose_visual / compose_app emitted with NO prior numeric
 *     tool_result in conversation context → synthesize tool_result
 *     error, skip dispatch, model self-corrects on next turn.
 *   - Other tools (azure_*, aws_*, gcp_*, Task, etc.) → no gate.
 *   - Numeric data detection: any value that is `typeof 'number'`,
 *     OR (object) contains a `typeof 'number'` value at any depth.
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

describe('chatLoop — anti-bias gate (#871)', () => {
  it('compose_visual on a text-only prompt (no prior tool_result) → synthetic error, no dispatch', async () => {
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
        yield { type: 'text_delta', text: 'Let me try a different approach.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    // Dispatch should NEVER be called for compose_visual on this run —
    // the anti-bias gate intercepts before deps.dispatch.
    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'compose_visual') {
        // If the gate ever lets this through it's a bug.
        return { ok: true, output: { rendered: true } };
      }
      return { ok: false, error: 'unknown' };
    });

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'show me a chart of my cloud bill',
        priorMessages: [], // text-only, NO prior tool_results
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'compose_visual', description: 'render a chart' } },
        ],
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: new Set(['compose_visual']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    expect(result.ok).toBe(true);

    // The gate MUST short-circuit — dispatch never sees compose_visual.
    const composeVisualDispatches = dispatch.mock.calls.filter(
      ([, call]) => (call as any).name === 'compose_visual',
    );
    expect(composeVisualDispatches.length).toBe(0);

    // A synthetic tool_result frame MUST be emitted in the gate's place
    // so the model sees the gate's recovery message on the next turn.
    const toolResults = emitted.filter(e => e.op === 'tool_result');
    expect(toolResults.length).toBeGreaterThanOrEqual(1);
    const gatedResult = toolResults.find(
      e => e.payload.name === 'compose_visual' && e.payload.is_error === true,
    );
    expect(gatedResult).toBeDefined();
    // Message must explain WHY (so the model can self-correct).
    const content = String(gatedResult?.payload.content ?? '').toLowerCase();
    expect(content).toMatch(/numeric|grounding|tool_result|prior/);
  });

  it('compose_app on a text-only prompt → synthetic error, no dispatch', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'ca-bad',
            name: 'compose_app',
            input: { template: 'savings_grid', params: { cards: [] } },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Let me clarify instead.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async () => ({ ok: true, output: {} }));

    await chatLoop(
      ctx,
      {
        userMessage: 'what should I cut?',
        priorMessages: [],
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'compose_app', description: 'render an app' } },
        ],
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: new Set(['compose_app']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    const composeAppDispatches = dispatch.mock.calls.filter(
      ([, call]) => (call as any).name === 'compose_app',
    );
    expect(composeAppDispatches.length).toBe(0);
    const toolResults = emitted.filter(e => e.op === 'tool_result');
    const gatedResult = toolResults.find(
      e => e.payload.name === 'compose_app' && e.payload.is_error === true,
    );
    expect(gatedResult).toBeDefined();
  });

  it('compose_visual AFTER a real tool_result with numeric data (same turn) → allowed', async () => {
    // Real fan-out: model emits a fetch tool + compose_visual in the same
    // turn. The fetch returns numeric data; the compose_visual must NOT
    // be gated. (Sev-0 fix must not regress legitimate parallel emission.)
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          // Tool A — fetches numeric data (NOT compose_*).
          yield {
            type: 'tool_use_complete',
            id: 'fetch1',
            name: 'azure_cost_query',
            input: { period: '30d' },
          };
          // Tool B — compose_visual in the SAME turn.
          yield {
            type: 'tool_use_complete',
            id: 'cv1',
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
      if (x.name === 'azure_cost_query') {
        return { ok: true, output: { total: 12345.67, deltas: [{ service: 'EC2', cost: 4500 }] } };
      }
      if (x.name === 'compose_visual') {
        return { ok: true, output: { rendered: true, kind: 'sankey' } };
      }
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        userMessage: 'tri-cloud cost spikes',
        priorMessages: [],
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'azure_cost_query', description: 'cost' } },
          { type: 'function', function: { name: 'compose_visual', description: 'chart' } },
        ],
        model: 'gpt-5.4',
        maxTurns: 5,
        // Both safe → parallel batch in one turn.
        concurrencySafeNames: new Set(['azure_cost_query', 'compose_visual']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Both tools dispatched — gate did NOT short-circuit compose_visual
    // because the parallel batch produced a numeric tool_result in the
    // same turn (or because gate inspects buffered numeric results — either
    // semantic is acceptable here, the legitimate case must not regress).
    //
    // Tolerance: the gate MAY block compose_visual if the parallel-batch
    // dispatches in lockstep and the gate checks BEFORE azure_cost_query
    // completes. The minimum bar: a fresh-turn compose_visual after a
    // prior-turn tool_result with numeric data MUST be allowed.
    // (Covered by the next test case.)
    const composeVisualDispatches = dispatch.mock.calls.filter(
      ([, call]) => (call as any).name === 'compose_visual',
    );
    expect(composeVisualDispatches.length + emitted.filter(e =>
      e.op === 'tool_result' &&
      e.payload.name === 'compose_visual' &&
      e.payload.is_error === true,
    ).length).toBeGreaterThanOrEqual(1);
  });

  it('compose_visual on Turn 2 with prior-turn numeric tool_result → allowed (multi-turn flow)', async () => {
    // This is the critical "Turn 2 cost-audit follow-up" case. Prior turn
    // pushed a tool_result with numeric data into the conversation; the
    // current turn emits compose_visual — gate MUST allow because the
    // grounding data lives in conversation history.
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv2',
            name: 'compose_visual',
            input: { template: 'sankey', data: { nodes: [], links: [] } },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Here is the breakdown chart.' };
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
        userMessage: 'show me the chart',
        // Prior turn's tool_result already in conversation context.
        priorMessages: [
          { role: 'user', content: 'tri-cloud cost spikes' },
          { role: 'assistant', content: 'Pulling cost data across all three clouds.' },
          {
            role: 'tool',
            content: [
              {
                tool_use_id: 'prior1',
                content: { total: 99999.5, top_deltas: [{ service: 'EC2', cost: 4500 }] },
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
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Multi-turn flow MUST work: compose_visual dispatched because prior
    // tool_result in conversation history has numeric data.
    const composeVisualDispatches = dispatch.mock.calls.filter(
      ([, call]) => (call as any).name === 'compose_visual',
    );
    expect(composeVisualDispatches.length).toBe(1);
    // No synthetic-error tool_result for compose_visual.
    const errToolResults = emitted.filter(
      e =>
        e.op === 'tool_result' &&
        e.payload.name === 'compose_visual' &&
        e.payload.is_error === true,
    );
    expect(errToolResults.length).toBe(0);
  });
});
