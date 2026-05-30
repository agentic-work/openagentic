/**
 * Sev-1 / Audit L3-4 (was F0-5) — `tool_use_complete` never fires on wire.
 *
 * Plan: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *       §Phase 2.3.3 — "L3-4 wire tool_use_complete emit".
 *
 * Without this emit, if dispatch crashes between tool_use_complete and
 * tool_result, the UI tool-card spinner sits orphaned forever.
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

describe('chatLoop — Sev-1 L3-4 tool_use_complete wire emit', () => {
  it('emits a terminal frame when the stream yields tool_use_complete', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;

    function streamProvider() {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'tool_use_start', id: 't1', name: 'k8s_list_pods' };
          yield {
            type: 'tool_use_delta',
            id: 't1',
            name: 'k8s_list_pods',
            inputDelta: '{"ns":"default"}',
          };
          yield {
            type: 'tool_use_complete',
            id: 't1',
            name: 'k8s_list_pods',
            input: { ns: 'default' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'done' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async () => ({ ok: true, output: 'pods listed' }));

    await chatLoop(
      ctx,
      {
        userMessage: 'list pods',
        priorMessages: [],
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'k8s_list_pods', description: 'list pods' } },
        ],
        model: 'gpt-oss:20b',
        maxTurns: 3,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    const terminalEmit = emitted.find((e) => e.op === 'tool_call_complete');
    expect(
      terminalEmit,
      'must emit named tool_call_complete frame so UI can terminate the spinner (A1: opcode-2 dual-emit ripped)',
    ).toBeDefined();
  });
});
