/**
 * azure_ai node — executor tests (Tier C — streaming via fetch).
 *
 * Behavior pinned:
 *   - streams from /api/v1/chat/completions with provider:'azure_openai'
 *   - templated prompt + optional system prompt
 *   - model resolution: node.data.model OR node.data.deploymentName OR env
 *     (no literal model strings)
 *   - returns { content, model, usage, provider:'azure_openai' }
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
    executionId: 'exec-azure-1',
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

const azureNode = (data: Record<string, unknown>) => ({
  id: 'n_az',
  type: 'azure_ai',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AIF_MODEL;
  delete process.env.DEFAULT_MODEL;
});

describe('azure_ai/executor', () => {
  it('returns { content, model, usage, provider:"azure_openai" }', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content: 'hi from azure',
      model: 'azure-deploy-x',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const out: any = await execute(
      azureNode({ prompt: 'q' }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('hi from azure');
    expect(out.model).toBe('azure-deploy-x');
    expect(out.provider).toBe('azure_openai');
  });

  it('forwards system + user messages', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      azureNode({ prompt: 'u', systemPrompt: 's' }),
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
      azureNode({ prompt: 'topic={{t}}' }),
      { t: 'cats' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    const user = body.messages.find((m: any) => m.role === 'user');
    expect(user.content).toBe('topic=cats');
  });

  it('sets provider:"azure_openai"', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(azureNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.provider).toBe('azure_openai');
    expect(body.stream).toBe(true);
  });

  it('uses node.data.model when set', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      azureNode({ prompt: 'x', model: 'azure-deploy-x1' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('azure-deploy-x1');
  });

  it('falls back to deploymentName when model is unset', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      azureNode({ prompt: 'x', deploymentName: 'my-azure-deploy' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('my-azure-deploy');
  });

  it('falls through to AIF_MODEL env when both model and deploymentName are unset', async () => {
    process.env.AIF_MODEL = 'env-azure-deploy';
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(azureNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('env-azure-deploy');
  });

  it('http error propagates', async () => {
    mockFetchError('rate limited');
    await expect(
      execute(azureNode({ prompt: 'x' }), null, makeCtx()),
    ).rejects.toThrow(/rate limited/);
  });

  it('forwards AbortSignal', async () => {
    const ctrl = new AbortController();
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      azureNode({ prompt: 'x' }),
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
      await runWithAssertions(plugin, azureNode({ prompt: 'go' }) as any, null, makeCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
  });

  // T9: tracing integration -----------------------------------------------

  it('calls ctx.tracing.recordCall with model after API responds', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'azure output', model: 'azure-model-z' });
    const recordCall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ tracing: { recordCall, flush: vi.fn() } as any });
    await execute(azureNode({ prompt: 'trace test' }), null, ctx);
    expect(recordCall).toHaveBeenCalledOnce();
    const args = recordCall.mock.calls[0][0];
    expect(args.nodeId).toBe('n_az');
    expect(args.model).toBe('azure-model-z');
    expect(args.executionId).toBe('exec-azure-1');
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
    await expect(execute(azureNode({ prompt: 'x' }), null, ctx)).resolves.toBeDefined();
  });
});
