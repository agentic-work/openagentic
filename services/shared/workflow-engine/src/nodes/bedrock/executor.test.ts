/**
 * bedrock node — executor tests (Tier C — streaming via fetch).
 *
 * Behavior pinned:
 *   - streams from /api/v1/chat/completions with provider:'bedrock'
 *   - templated prompt + optional system prompt
 *   - model from node.data.model OR env (no literal model strings)
 *   - returns { content, model, usage, provider:'bedrock' }
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
    executionId: 'exec-bedrock-1',
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

const bedrockNode = (data: Record<string, unknown>) => ({
  id: 'n_bedrock',
  type: 'bedrock',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AWS_BEDROCK_CHAT_MODEL;
  delete process.env.DEFAULT_MODEL;
});

describe('bedrock/executor', () => {
  it('returns { content, model, usage, provider }', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content: 'hi from bedrock',
      model: 'some-model',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const out: any = await execute(
      bedrockNode({ prompt: 'say hi' }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('hi from bedrock');
    expect(out.model).toBe('some-model');
    expect(out.usage.total_tokens).toBe(30);
    expect(out.provider).toBe('bedrock');
  });

  it('forwards system prompt as a system message', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      bedrockNode({ prompt: 'q', systemPrompt: 'you are succinct' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    // Blocker A2: anti-CoT directive spliced into single system message.
    const sys = body.messages.filter((m: any) => m.role === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0].content).toContain('you are succinct');
    expect(sys[0].content).toMatch(/return only the final answer/i);
    const user = body.messages.find((m: any) => m.role === 'user');
    expect(user).toEqual({ role: 'user', content: 'q' });
  });

  it('interpolates template vars in the prompt', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      bedrockNode({ prompt: 'hello {{name}}' }),
      { name: 'world' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    const user = body.messages.find((m: any) => m.role === 'user');
    expect(user.content).toBe('hello world');
  });

  it('sets provider:"bedrock" on the request body', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(bedrockNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.provider).toBe('bedrock');
    expect(body.stream).toBe(true);
  });

  it('uses node.data.model when set', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      bedrockNode({ prompt: 'x', model: 'some-deployment-id' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('some-deployment-id');
  });

  it('falls through to AWS_BEDROCK_CHAT_MODEL env when model is unset (no literal)', async () => {
    process.env.AWS_BEDROCK_CHAT_MODEL = 'env-bedrock-model';
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(bedrockNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('env-bedrock-model');
  });

  it('http error propagates', async () => {
    mockFetchError('5xx');
    await expect(
      execute(bedrockNode({ prompt: 'x' }), null, makeCtx()),
    ).rejects.toThrow(/5xx/);
  });

  it('forwards AbortSignal onto fetch', async () => {
    const ctrl = new AbortController();
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      bedrockNode({ prompt: 'x' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    expect(cap.init?.signal).toBeDefined();
  });

  it('forwards internal-auth headers + execution id', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(bedrockNode({ prompt: 'x' }), null, makeCtx());
    const h = cap.init!.headers as Record<string, string>;
    expect(h['X-Internal-Secret']).toBe('sekret');
    expect(h['X-Workflow-Execution']).toBe('exec-bedrock-1');
  });

  it('runWithAssertions: empty content fails non_empty_content', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '' });
    const plugin = { schema: schema as any, execute };
    const node = bedrockNode({ prompt: 'do nothing' });
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
    mockFetchSSE(cap, { content: 'bedrock output', model: 'bedrock-model-x' });
    const recordCall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ tracing: { recordCall, flush: vi.fn() } as any });
    await execute(bedrockNode({ prompt: 'trace test' }), null, ctx);
    expect(recordCall).toHaveBeenCalledOnce();
    const args = recordCall.mock.calls[0][0];
    expect(args.nodeId).toBe('n_bedrock');
    expect(args.model).toBe('bedrock-model-x');
    expect(args.executionId).toBe('exec-bedrock-1');
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
    await expect(execute(bedrockNode({ prompt: 'x' }), null, ctx)).resolves.toBeDefined();
  });
});
