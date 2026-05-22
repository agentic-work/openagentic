/**
 * Sev-1 / Audit L3-6 (was F1-2) — empty `envelope.structuredContent` silently
 * feeds '' to the model on the next turn (empty bubble).
 *
 * Plan: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *       §Phase 2.3.5 — "L3-6 empty envelope.structuredContent fallback".
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

describe('chatLoop — Sev-1 L3-6 empty structuredContent fallback', () => {
  it('falls back to r.result.output when envelope.structuredContent is empty string', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    let modelMessagesOnTurn2: any[] | null = null;

    function streamProvider(req: any) {
      call++;
      if (call === 2) modelMessagesOnTurn2 = req?.messages ?? null;
      if (call === 1) {
        return (async function* () {
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
        yield { type: 'text_delta', text: 'Final answer.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async () => ({
      ok: true,
      output: 'Plain-text fallback payload — 3 pods listed.',
      envelope: {
        ok: true,
        structuredContent: '', // <-- splitter produced empty structuredContent
        _meta: { outputTemplate: 'listing', elapsed_ms: 12 },
      },
    }));

    await chatLoop(
      ctx,
      {
        userMessage: 'list pods',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'k8s_list_pods', description: 'list pods' } }],
        model: 'gpt-oss:20b',
        maxTurns: 3,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    expect(modelMessagesOnTurn2).not.toBeNull();
    const toolMsg = modelMessagesOnTurn2!.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const toolResults = toolMsg!.content;
    expect(Array.isArray(toolResults)).toBe(true);
    expect(toolResults.length).toBeGreaterThan(0);
    expect(
      toolResults[0].content,
      'when envelope.structuredContent is empty string, fall back to r.result.output (no empty bubble)',
    ).not.toBe('');
    expect(toolResults[0].content).toContain('3 pods listed');
  });

  it('preserves envelope.structuredContent when it is NON-empty (regression guard)', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    let modelMessagesOnTurn2: any[] | null = null;

    function streamProvider(req: any) {
      call++;
      if (call === 2) modelMessagesOnTurn2 = req?.messages ?? null;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 't2',
            name: 'k8s_list_pods',
            input: { ns: 'default' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'ok' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async () => ({
      ok: true,
      output: 'fallback text',
      envelope: {
        ok: true,
        structuredContent: { summary: 'structured payload wins' },
        _meta: { outputTemplate: 'listing' },
      },
    }));

    await chatLoop(
      ctx,
      {
        userMessage: 'list pods',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'k8s_list_pods', description: 'list pods' } }],
        model: 'gpt-oss:20b',
        maxTurns: 3,
      } as any,
      { streamProvider, dispatch, hooks: undefined } as any,
    );

    const toolMsg = modelMessagesOnTurn2!.find((m: any) => m.role === 'tool');
    expect(toolMsg!.content[0].content).toEqual({ summary: 'structured payload wins' });
  });
});
