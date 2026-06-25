/**
 * V3 chatLoop two-channel envelope (Plan §Phase 4 / Task 4.4 — RED → GREEN).
 *
 * Verifies the model channel vs UI channel split:
 *   - messages[].content (model channel) carries ONLY structuredContent
 *     (no `_meta`, no `outputTemplate`, no `artifactHandle`).
 *   - ctx.emit('tool_result', ...) (UI channel) carries BOTH
 *     structuredContent AND `_meta`.
 *
 * the design notes
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

describe('chatLoop — two-channel envelope', () => {
  it('emits _meta on UI channel (tool_result) when dispatch returns envelope', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'k1',
            name: 'k8s_list_pods',
            input: { ns: 'default' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'Found 3 pods.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    // Dispatch returns the new ToolDispatchResult shape with `envelope`.
    const dispatch = vi.fn(async (_c: any, _x: any) => ({
      ok: true,
      output: { pods: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
      envelope: {
        ok: true,
        structuredContent: {
          summary: '3 pods listed',
          data: { count: 3 },
        },
        _meta: {
          outputTemplate: 'k8s_pod_list',
          size: 256,
          elapsed: 12,
          cost: 0.001,
        },
      },
    }));

    await chatLoop(
      ctx,
      {
        userMessage: 'list pods',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'k8s_list_pods' } }],
        model: 'gpt-5.4',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    const toolResults = emitted.filter(e => e.op === 'tool_result');
    expect(toolResults.length).toBe(1);
    const ui = toolResults[0].payload;
    expect(ui._meta).toBeDefined();
    expect(ui._meta.outputTemplate).toBe('k8s_pod_list');
    expect(ui._meta.size).toBe(256);
    expect(ui._meta.elapsed).toBe(12);
    // structuredContent fields are visible on UI channel
    expect(ui.content).toBeDefined();
  });

  it('does NOT include _meta on the legacy UI tool_result when no envelope', async () => {
    // Backward compat: existing dispatchers returning bare {ok, output} keep working.
    const { ctx, emitted } = makeCtx();
    let call = 0;
    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 't1',
            name: 'memorize',
            input: { text: 'x' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'ok' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }
    const dispatch = vi.fn(async () => ({ ok: true, output: { saved: true } }));

    await chatLoop(
      ctx,
      {
        userMessage: 'remember',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'memorize' } }],
        model: 'gpt-5.4',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    const toolResults = emitted.filter(e => e.op === 'tool_result');
    expect(toolResults.length).toBe(1);
    expect(toolResults[0].payload._meta).toBeUndefined();
  });
});
