/**
 * reasoning node — executor tests (Tier C — streaming via fetch).
 *
 * Pinned behavior:
 *   - enableThinking:true, sliderPosition:100 (max-quality)
 *   - thinkingBudget defaults to 10000
 *   - modelOverride respected; defaults to 'auto' (Smart Router)
 *   - returns { content, thinking, model, usage, provider:'openagentic' }
 *   - thinking text aggregated from canonical thinking_delta events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };
import {
  mockFetchSSE,
  type FetchCapture,
} from '../../llm/__tests__/mockFetchSSE.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-reason-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'sekret' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const reasoningNode = (data: Record<string, unknown>) => ({
  id: 'n_reason',
  type: 'reasoning',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reasoning/executor', () => {
  it('returns { content, thinking, model, usage, provider:"openagentic" }', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content: 'answer',
      thinking: 'thought-trace',
      model: 'router-pick-x',
      usage: { total_tokens: 50 },
    });
    const out: any = await execute(
      reasoningNode({ prompt: 'why?' }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('answer');
    expect(out.thinking).toBe('thought-trace');
    expect(out.model).toBe('router-pick-x');
    expect(out.provider).toBe('openagentic');
  });

  it('sets enableThinking:true and sliderPosition:100 (max quality)', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(reasoningNode({ prompt: 'q' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.enableThinking).toBe(true);
    expect(body.sliderPosition).toBe(100);
    expect(body.stream).toBe(true);
  });

  it('defaults thinkingBudget to 10000', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(reasoningNode({ prompt: 'q' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.thinkingBudget).toBe(10000);
  });

  it('respects custom thinkingBudget', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(
      reasoningNode({ prompt: 'q', thinkingBudget: 4000 }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.thinkingBudget).toBe(4000);
  });

  it('defaults model to "auto" (Smart Router) — no literal', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(reasoningNode({ prompt: 'q' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('auto');
  });

  it('respects modelOverride', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(
      reasoningNode({ prompt: 'q', modelOverride: 'reasoning-model-x' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('reasoning-model-x');
  });

  it('forwards system prompt', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(
      reasoningNode({ prompt: 'q', systemPrompt: 'think hard' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    // Blocker A2: anti-CoT directive spliced into single system message.
    const sys = body.messages.filter((m: any) => m.role === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0].content).toContain('think hard');
    expect(sys[0].content).toMatch(/return only the final answer/i);
  });

  it('interpolates template vars in prompt', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(
      reasoningNode({ prompt: 'why is {{x}}?' }),
      { x: 'sky blue' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    const user = body.messages.find((m: any) => m.role === 'user');
    expect(user.content).toBe('why is sky blue?');
  });

  it('forwards AbortSignal', async () => {
    const ctrl = new AbortController();
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'a' });
    await execute(
      reasoningNode({ prompt: 'q' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    expect(cap.init?.signal).toBeDefined();
  });

  it('runWithAssertions: empty content fails non_empty_content', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '' });
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(plugin, reasoningNode({ prompt: 'go' }) as any, null, makeCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
  });

  // T9: tracing integration -----------------------------------------------

  it('calls ctx.tracing.recordCall with model after API responds', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'reasoning output', model: 'reasoning-model-q' });
    const recordCall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ tracing: { recordCall, flush: vi.fn() } as any });
    await execute(reasoningNode({ prompt: 'think hard' }), null, ctx);
    expect(recordCall).toHaveBeenCalledOnce();
    const args = recordCall.mock.calls[0][0];
    expect(args.nodeId).toBe('n_reason');
    expect(args.model).toBe('reasoning-model-q');
    expect(args.executionId).toBe('exec-reason-1');
  });

  it('does not throw when tracing.recordCall rejects', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'ok' });
    const ctx = makeCtx({
      tracing: {
        recordCall: vi.fn().mockRejectedValue(new Error('tracing fail')),
        flush: vi.fn(),
      } as any,
    });
    await expect(execute(reasoningNode({ prompt: 'x' }), null, ctx)).resolves.toBeDefined();
  });
});
