/**
 * vertex node — executor tests (Tier C — streaming via fetch).
 *
 * Behavior pinned:
 *   - streams from /api/v1/chat/completions with provider:'vertex'
 *   - templated prompt + optional system prompt
 *   - model from node.data.model OR env (no literal model strings)
 *   - returns { content, model, usage, provider:'vertex' }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };
import {
  mockFetchSSE,
  mockFetchError,
  type FetchCapture,
} from '../../llm/__tests__/mockFetchSSE.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-vertex-1',
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

const vertexNode = (data: Record<string, unknown>) => ({
  id: 'n_vertex',
  type: 'vertex',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VERTEX_AI_CHAT_MODEL;
  delete process.env.DEFAULT_MODEL;
});

describe('vertex/executor', () => {
  it('returns { content, model, usage, provider:"vertex" }', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content: 'hi from vertex',
      model: 'router-pick-1',
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    });
    const out: any = await execute(
      vertexNode({ prompt: 'go' }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('hi from vertex');
    expect(out.model).toBe('router-pick-1');
    expect(out.provider).toBe('vertex');
  });

  it('forwards system prompt + user prompt', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      vertexNode({ prompt: 'u', systemPrompt: 's' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    // Blocker A2: anti-CoT directive spliced into single system message.
    const sys = body.messages.filter((m: any) => m.role === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0].content).toContain('s');
    expect(sys[0].content).toMatch(/return only the final answer/i);
    const user = body.messages.find((m: any) => m.role === 'user');
    expect(user).toEqual({ role: 'user', content: 'u' });
  });

  it('interpolates template vars', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      vertexNode({ prompt: 'hi {{topic}}' }),
      { topic: 'cats' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    const user = body.messages.find((m: any) => m.role === 'user');
    expect(user.content).toBe('hi cats');
  });

  it('sets provider:"vertex" on the request', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(vertexNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.provider).toBe('vertex');
    expect(body.stream).toBe(true);
  });

  it('uses node.data.model when set', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      vertexNode({ prompt: 'x', model: 'some-deploy-id' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('some-deploy-id');
  });

  it('falls through to VERTEX_AI_CHAT_MODEL env when model is unset (no literal)', async () => {
    process.env.VERTEX_AI_CHAT_MODEL = 'env-vertex-deploy';
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(vertexNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('env-vertex-deploy');
  });

  it('http error propagates', async () => {
    mockFetchError('boom');
    await expect(
      execute(vertexNode({ prompt: 'x' }), null, makeCtx()),
    ).rejects.toThrow(/boom/);
  });

  it('forwards AbortSignal onto fetch', async () => {
    const ctrl = new AbortController();
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      vertexNode({ prompt: 'x' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    // streamLLMCompletion wraps the caller signal in a timeout
    // controller; we just verify a signal was forwarded.
    expect(cap.init?.signal).toBeDefined();
  });

  it('runWithAssertions: empty content fails non_empty_content', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '' });
    const plugin = { schema: schema as any, execute };
    const node = vertexNode({ prompt: 'go' });
    let caught: unknown;
    try {
      await runWithAssertions(plugin, node as any, null, makeCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe('non_empty_content');
  });

  // T9: tracing integration -----------------------------------------------

  it('calls ctx.tracing.recordCall with model after API responds', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'vertex output', model: 'vertex-model-y' });
    const recordCall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ tracing: { recordCall, flush: vi.fn() } as any });
    await execute(vertexNode({ prompt: 'trace test' }), null, ctx);
    expect(recordCall).toHaveBeenCalledOnce();
    const args = recordCall.mock.calls[0][0];
    expect(args.nodeId).toBe('n_vertex');
    expect(args.model).toBe('vertex-model-y');
    expect(args.executionId).toBe('exec-vertex-1');
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
    await expect(execute(vertexNode({ prompt: 'x' }), null, ctx)).resolves.toBeDefined();
  });
});
