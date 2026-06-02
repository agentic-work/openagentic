/**
 * F2-followup (2026-05-12) — chatLoop must call deps.recordCompletionMetrics
 * once per streaming-chat turn with TTFT + usage + finish_reason populated.
 * Without this seam the admin LLM Performance pane's SLO strip stays empty
 * on /metrics (gen_ai_server_time_to_first_token_seconds + TPOT +
 * operation_duration + token_usage + finish_reasons all 0).
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';
import type { ChatTurnMetricsArgs } from '../types.js';

function makeCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 's-metrics',
    userId: 'u-metrics',
  } as any;
}

describe('chatLoop — F2-followup streaming metrics', () => {
  it('calls deps.recordCompletionMetrics with TTFT + usage + stopReason on successful turn', async () => {
    const ctx = makeCtx();
    const calls: ChatTurnMetricsArgs[] = [];
    const recordCompletionMetrics = vi.fn(async (args: ChatTurnMetricsArgs) => {
      calls.push(args);
    });

    // Fake stream yields text first (drives TTFT marker), then usage
    // (from message_delta.usage), then end_turn.
    async function* fakeStream() {
      yield { type: 'text_delta', text: 'hello' };
      yield { type: 'usage', input: 42, output: 7, cacheRead: 3 };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
    const streamProvider = vi.fn(async function* () {
      yield* fakeStream();
    });

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: vi.fn() as any,
        recordCompletionMetrics: recordCompletionMetrics as any,
      },
    );

    expect(result.ok).toBe(true);
    expect(recordCompletionMetrics).toHaveBeenCalledTimes(1);

    const [args] = calls;
    expect(args.model).toBe('gpt-oss:20b');
    expect(args.stopReason).toBe('end_turn');
    expect(args.usage).toEqual({
      input: 42,
      output: 7,
      cacheRead: 3,
      cacheWrite: undefined,
      reasoning: undefined,
    });
    expect(args.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
    expect(args.userId).toBe('u-metrics');
    expect(args.sessionId).toBe('s-metrics');
    expect(args.startedAt).toBeInstanceOf(Date);
  });

  it('records turn with undefined TTFT + undefined usage when provider emits neither', async () => {
    const ctx = makeCtx();
    const recordCompletionMetrics = vi.fn(async () => undefined);
    async function* fakeStream() {
      // No text deltas, no usage — just an immediate end_turn.
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
    const streamProvider = vi.fn(async function* () {
      yield* fakeStream();
    });
    await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: vi.fn() as any,
        recordCompletionMetrics: recordCompletionMetrics as any,
      },
    );
    expect(recordCompletionMetrics).toHaveBeenCalledTimes(1);
    const args = recordCompletionMetrics.mock.calls[0]![0] as ChatTurnMetricsArgs;
    expect(args.timeToFirstTokenMs).toBeUndefined();
    expect(args.usage).toBeUndefined();
    expect(args.stopReason).toBe('end_turn');
  });

  it('records an ERROR metric when the provider stream throws mid-turn', async () => {
    // F2-followup (2026-06-01) — the streaming chat path had no error seam,
    // so a provider stream that throws never incremented gen_ai_errors_total
    // (the dashboard "Error rate by class" panel was empty for live chat).
    // chatLoop must now route ONE error record through recordCompletionMetrics
    // with errorClass set, then rethrow the original error.
    const ctx = makeCtx();
    const calls: ChatTurnMetricsArgs[] = [];
    const recordCompletionMetrics = vi.fn(async (args: ChatTurnMetricsArgs) => {
      calls.push(args);
    });

    async function* throwingStream() {
      yield { type: 'text_delta', text: 'partial' } as any;
      throw Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    }
    const streamProvider = vi.fn(async function* () {
      yield* throwingStream();
    });

    await expect(
      chatLoop(
        ctx,
        {
          userMessage: 'hi',
          priorMessages: [],
          systemPrompt: 'sys',
          tools: [],
          model: 'gpt-oss:20b',
          maxTurns: 5,
        },
        {
          streamProvider: streamProvider as any,
          dispatch: vi.fn() as any,
          recordCompletionMetrics: recordCompletionMetrics as any,
        },
      ),
    ).rejects.toThrow('Connect Timeout Error');

    // Exactly one metrics emit — the error one. The success-path emit must
    // NOT also fire (no double-count).
    expect(recordCompletionMetrics).toHaveBeenCalledTimes(1);
    const [args] = calls;
    expect(args.model).toBe('gpt-oss:20b');
    expect(args.errorClass).toBeDefined();
    // 'timeout' from the message classifier ('Connect Timeout Error').
    expect(args.errorClass).toBe('timeout');
    expect(args.errorMessage).toContain('Connect Timeout Error');
    expect(args.startedAt).toBeInstanceOf(Date);
    expect(args.userId).toBe('u-metrics');
    expect(args.sessionId).toBe('s-metrics');
  });

  it('records turn even when stop_reason is tool_use (dispatch path)', async () => {
    const ctx = makeCtx();
    const recordCompletionMetrics = vi.fn(async () => undefined);
    async function* fakeStream() {
      yield { type: 'tool_use_complete', id: 't1', name: 'echo', input: { x: 1 } };
      yield { type: 'usage', input: 10, output: 5 };
      yield { type: 'message_stop', stop_reason: 'tool_use' };
    }
    const streamProvider = vi.fn(async function* () {
      yield* fakeStream();
    });
    const dispatch = vi.fn(async () => ({ ok: true, output: 'done' }));

    await chatLoop(
      ctx,
      {
        userMessage: 'hi',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [],
        model: 'gpt-oss:20b',
        maxTurns: 2,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: dispatch as any,
        recordCompletionMetrics: recordCompletionMetrics as any,
      },
    );

    expect(recordCompletionMetrics).toHaveBeenCalled();
    const firstCall = recordCompletionMetrics.mock.calls[0]![0] as ChatTurnMetricsArgs;
    expect(firstCall.stopReason).toBe('tool_use');
    expect(firstCall.usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
    });
  });
});
