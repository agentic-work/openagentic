/**
 * V3 chatLoop single-tool with artifact emission (Plan §Tests #2).
 *
 * The model emits ONE tool_use block (compose_visual). Dispatcher returns
 * an artifact alongside the tool_result. chatLoop must:
 *   - emit `tool_result` with the dispatch output
 *   - feed the tool_result back; model emits text + end_turn
 *
 * A1 (2026-05-12) — opcode-{0,2,3,4,e} dual-emits ripped; UI consumes
 * named frames only. Visual artifacts surface via the named
 * `visual_render` / `app_render` / `artifact_render` frames emitted by
 * their respective tool handlers, NOT a chatLoop-level artifact frame.
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

describe('chatLoop — single meta-tool with artifact', () => {
  it('emits tool_result for compose_visual (artifact surfaces via named visual_render frame from the tool itself)', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv1',
            name: 'compose_visual',
            input: { template: 'sankey', data: { nodes: 3, edges: 2 } },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Here is the cost breakdown.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'compose_visual') {
        return {
          ok: true,
          output: { rendered: true, kind: 'sankey' },
          artifact: {
            kind: 'visual',
            payload: { template: 'sankey', svg: '<svg>...</svg>' },
          },
        };
      }
      return { ok: false, error: 'unknown tool' };
    });

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'show me a sankey',
        // Sev-0 #871 anti-bias gate (2026-05-17) — compose_visual requires
        // prior numeric tool_result in the conversation. Inject a synthetic
        // prior tool_result so this legacy single-tool test stays GREEN; the
        // contract this test covers (tool_result emit + artifact named-frame
        // surface) is orthogonal to the anti-bias gate.
        priorMessages: [
          { role: 'user', content: 'data fetched earlier' },
          {
            role: 'tool',
            content: [
              {
                tool_use_id: 'prior',
                content: { total: 1234.5 },
                is_error: false,
              },
            ],
          },
        ],
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
    expect(result.turns).toBe(2); // tool_use turn + synthesis turn

    // Named tool_result frame emitted exactly once with name=compose_visual.
    const toolResults = emitted.filter(e => e.op === 'tool_result');
    expect(toolResults.length).toBe(1);
    expect(toolResults[0].payload.name).toBe('compose_visual');
    expect(toolResults[0].payload.is_error).toBe(false);
    expect(toolResults[0].payload.tool_use_id).toBe('cv1');

    // A1 (2026-05-12) — opcode-4 ARTIFACT dual-emit ripped; chatLoop no
    // longer emits an `op === '4'` frame even when result.artifact is
    // present. Visual artifacts surface via the named visual_render /
    // app_render / artifact_render frames emitted by their tool
    // handlers (ComposeVisualTool, etc.) directly.
    const op4 = emitted.filter(e => e.op === '4');
    expect(op4.length).toBe(0);

    // Final text from synthesis turn emitted via named
    // assistant_message_delta frame (opcode-0 dual-emit ripped).
    const text = emitted
      .filter(e => e.op === 'assistant_message_delta')
      .map(e => e.payload?.text ?? '')
      .join('');
    expect(text).toContain('cost breakdown');

    // Named assistant_message_stop frame closes the turn.
    const stop = emitted.find(e => e.op === 'assistant_message_stop');
    expect(stop?.payload.reason).toBe('end_turn');
  });

  it('does NOT emit opcode 4 when dispatch result has no artifact', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'm1',
            name: 'memorize',
            input: { text: 'remember this' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Saved.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async () => ({ ok: true, output: { saved: true } }));

    await chatLoop(
      ctx,
      {
        userMessage: 'remember this',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'memorize' } }],
        model: 'gpt-5.4',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    expect(emitted.filter(e => e.op === 'tool_result').length).toBe(1);
    // A1 — opcode-4 ARTIFACT dual-emit ripped; this assertion is now
    // about the absence of the opcode-4 frame too.
    expect(emitted.filter(e => e.op === '4').length).toBe(0);
  });

  it('emits isError:true when dispatch fails', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;
    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'tool_use_complete', id: 'x1', name: 'failing_tool', input: {} };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Sorry, that failed.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }
    const dispatch = vi.fn(async () => ({ ok: false, error: 'kaboom' }));

    await chatLoop(
      ctx,
      {
        userMessage: 'try',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'failing_tool' } }],
        model: 'gpt-5.4',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    const tr = emitted.filter(e => e.op === 'tool_result');
    expect(tr.length).toBe(1);
    expect(tr[0].payload.is_error).toBe(true);
    expect(tr[0].payload.content).toBe('kaboom');
  });
});
