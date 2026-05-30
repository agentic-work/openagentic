/**
 * Phase 8 — V3 chatLoop mid-loop compaction trigger (TDD RED first).
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §4.4
 *
 * After tool_results land at the end of a loop iteration, chatLoop must check
 * usage. When `usagePercentage >= 85` (HARD threshold), it awaits
 * `compactContext()` so the next provider call sees a smaller buffer.
 *
 * The mid-loop check is awaited (NOT fire-and-forget) — the spec says
 * "between rounds" so the next round must see compacted state.
 *
 * Compaction failure is non-fatal — the loop still continues to the next turn.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

interface Emit {
  op: string;
  payload: any;
}

function makeCtx(sessionId = 'sess-midloop') {
  const emitted: Emit[] = [];
  return {
    ctx: {
      emit: (op: string, payload: any) => emitted.push({ op, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId,
      userId: 'u',
    } as any,
    emitted,
  };
}

/**
 * Build a stream provider that on call N yields:
 *   - Turn 1: a tool_use block then `tool_use` stop (forces dispatch + mid-loop check)
 *   - Turn 2: a text_delta then end_turn (closes the loop)
 *
 * The loop's mid-loop compaction check happens AFTER tool_results are pushed
 * at the end of turn 1, BEFORE turn 2's provider call.
 */
function makeTwoTurnProvider() {
  let turn = 0;
  return vi.fn(async function* () {
    turn += 1;
    if (turn === 1) {
      yield { type: 'tool_use_start', id: 'tu-1', name: 'noop_read' };
      yield {
        type: 'tool_use_complete',
        id: 'tu-1',
        name: 'noop_read',
        input: { x: 1 },
      };
      yield { type: 'message_stop', stop_reason: 'tool_use' };
    } else {
      yield { type: 'text_delta', text: 'done' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
  });
}

describe('chatLoop — mid-loop compaction trigger', () => {
  it('triggers compaction when usagePercentage >= 85% after tool_results land', async () => {
    const { ctx } = makeCtx('sess-1');

    // Mid-loop check after turn 1's tool dispatch: 87% → compaction fires.
    const ctxMgmt = {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 'sess-1',
        currentTokens: 8700,
        maxTokens: 10000,
        usagePercentage: 87,
        messagesCount: 50,
        needsCompaction: true,
        compactionLevel: 'medium',
      }),
      compactContext: vi.fn().mockResolvedValue({
        sessionId: 'sess-1',
        messagesRemoved: 10,
        messagesSummarized: 4,
        tokensFreed: 4000,
        newTokenCount: 4700,
        compactionLevel: 'medium',
        timestamp: new Date(),
      }),
    };

    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { result: 'ok' } });
    const safeNames = new Set<string>(['noop_read']);

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'do thing',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ function: { name: 'noop_read' } }],
        model: 'm',
        maxTurns: 5,
        concurrencySafeNames: safeNames,
      },
      {
        streamProvider: makeTwoTurnProvider() as any,
        dispatch: dispatch as any,
        contextMgmt: ctxMgmt,
      } as any,
    );

    expect(result.ok).toBe(true);
    expect(result.turns).toBeGreaterThanOrEqual(2);
    expect(ctxMgmt.getContextUsage).toHaveBeenCalled();
    // Mid-loop hard-threshold breach → compactContext fires.
    expect(ctxMgmt.compactContext).toHaveBeenCalledWith('sess-1', 'm');
  });

  it('does NOT trigger when usagePercentage stays just below 85% (84% boundary)', async () => {
    const { ctx } = makeCtx('sess-84');
    const ctxMgmt = {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 'sess-84',
        currentTokens: 8400,
        maxTokens: 10000,
        usagePercentage: 84,
        messagesCount: 40,
        needsCompaction: false,
        compactionLevel: 'none',
      }),
      compactContext: vi.fn(),
    };
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { result: 'ok' } });
    const safeNames = new Set<string>(['noop_read']);

    await chatLoop(
      ctx,
      {
        userMessage: 'x',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ function: { name: 'noop_read' } }],
        model: 'm',
        maxTurns: 5,
        concurrencySafeNames: safeNames,
      },
      {
        streamProvider: makeTwoTurnProvider() as any,
        dispatch: dispatch as any,
        contextMgmt: ctxMgmt,
      } as any,
    );

    // Mid-loop check observed usage but did not compact.
    expect(ctxMgmt.getContextUsage).toHaveBeenCalled();
    expect(ctxMgmt.compactContext).not.toHaveBeenCalled();
  });

  it('does NOT trigger when usagePercentage stays below 85%', async () => {
    const { ctx } = makeCtx('sess-low');
    const ctxMgmt = {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 'sess-low',
        currentTokens: 4000,
        maxTokens: 10000,
        usagePercentage: 40,
        messagesCount: 12,
        needsCompaction: false,
        compactionLevel: 'none',
      }),
      compactContext: vi.fn(),
    };
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { result: 'ok' } });
    const safeNames = new Set<string>(['noop_read']);

    await chatLoop(
      ctx,
      {
        userMessage: 'do thing',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ function: { name: 'noop_read' } }],
        model: 'm',
        maxTurns: 5,
        concurrencySafeNames: safeNames,
      },
      {
        streamProvider: makeTwoTurnProvider() as any,
        dispatch: dispatch as any,
        contextMgmt: ctxMgmt,
      } as any,
    );

    // Mid-loop check ran (we observed usage) but no compaction call (under 85%).
    expect(ctxMgmt.compactContext).not.toHaveBeenCalled();
  });

  it('compaction failure mid-loop does NOT abort the loop', async () => {
    const { ctx } = makeCtx('sess-fail');
    const ctxMgmt = {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 'sess-fail',
        currentTokens: 8700,
        maxTokens: 10000,
        usagePercentage: 87,
        messagesCount: 80,
        needsCompaction: true,
        compactionLevel: 'medium',
      }),
      compactContext: vi.fn().mockRejectedValue(new Error('compaction blew up')),
    };
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { result: 'ok' } });
    const safeNames = new Set<string>(['noop_read']);

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'do thing',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ function: { name: 'noop_read' } }],
        model: 'm',
        maxTurns: 5,
        concurrencySafeNames: safeNames,
      },
      {
        streamProvider: makeTwoTurnProvider() as any,
        dispatch: dispatch as any,
        contextMgmt: ctxMgmt,
      } as any,
    );

    expect(result.ok).toBe(true); // Loop still completes despite compaction error.
    expect(ctxMgmt.compactContext).toHaveBeenCalled();
    // Warn log fired so the operator sees the degradation.
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('skips mid-loop check entirely when contextMgmt is omitted (back-compat)', async () => {
    // Existing chatLoop tests pass deps without contextMgmt — they must keep working.
    const { ctx } = makeCtx('sess-bc');
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { result: 'ok' } });
    const safeNames = new Set<string>(['noop_read']);

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'do thing',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ function: { name: 'noop_read' } }],
        model: 'm',
        maxTurns: 5,
        concurrencySafeNames: safeNames,
      },
      {
        streamProvider: makeTwoTurnProvider() as any,
        dispatch: dispatch as any,
      } as any,
    );

    expect(result.ok).toBe(true);
  });
});
