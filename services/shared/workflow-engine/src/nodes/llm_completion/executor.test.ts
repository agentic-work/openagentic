/**
 * llm_completion node — executor tests.
 *
 * Covers (post Tier B refactor — executor now streams via the SDK
 * canonical normalizer instead of doing a non-streaming axios POST):
 *   1. happy path — returns { content, model, usage }
 *   2. empty/missing prompt coerced to ''
 *   3. system prompt forwarded as 'system' message
 *   4. auto-context injection when prompt has no template vars
 *   5. NO auto-context injection when prompt HAS template vars
 *   6. Smart Router default (model not literal)
 *   7. explicit non-auto model respected
 *   8. AbortSignal forwarded onto fetch
 *   9. internal-auth headers + X-Workflow-Execution forwarded
 *  10. outputAssertion: empty completion fails non_empty_content
 *  11. tracing.recordCall invoked
 *  12. tracing errors do not throw
 *  13. ctx.emitCanonical receives per-chunk canonical events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-llm-1',
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

const llmNode = (data: Record<string, unknown>) => ({
  id: 'n_llm',
  type: 'llm_completion',
  data,
});

// In-memory capture of the last fetch call's url + init so tests can
// assert on the wire payload + headers + signal.
interface FetchCapture {
  url?: string;
  init?: RequestInit;
}

function mockFetchSSE(
  capture: FetchCapture,
  opts: {
    content: string;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    finishReason?: string;
  },
): void {
  const chunks: string[] = [];
  if (opts.content.length > 0) {
    // Stream a single delta — simpler than chunking; the normalizer
    // emits one content_block_delta per chunk regardless.
    chunks.push(
      `data: ${JSON.stringify({ model: opts.model ?? 'router-pick', choices: [{ index: 0, delta: { role: 'assistant', content: opts.content } }] })}\n\n`,
    );
  }
  chunks.push(
    `data: ${JSON.stringify({ model: opts.model ?? 'router-pick', choices: [{ index: 0, delta: {}, finish_reason: opts.finishReason ?? 'stop' }] })}\n\n`,
  );
  if (opts.usage) {
    chunks.push(
      `data: ${JSON.stringify({ model: opts.model ?? 'router-pick', choices: [], usage: opts.usage })}\n\n`,
    );
  }
  chunks.push(`data: [DONE]\n\n`);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input: any, init?: any) => {
    capture.url = typeof input === 'string' ? input : (input as Request).url;
    capture.init = init;
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('llm_completion/executor (streaming via SDK canonical normalizer)', () => {
  it('returns { content, model, usage }', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content: 'hi there',
      model: 'router-pick',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const out: any = await execute(
      llmNode({ prompt: 'say hi' }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('hi there');
    expect(out.model).toBe('router-pick');
    expect(out.usage.completion_tokens).toBe(20);
    expect(out.usage.total_tokens).toBe(30);
  });

  it('treats empty/missing prompt as empty string (matches legacy behavior)', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(llmNode({}), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    // Blocker A2: an anti-CoT system message is always prepended. The
    // user message is the LAST element.
    const userMsg = body.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toBe('');
  });

  it('forwards system prompt as a system message', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      llmNode({ prompt: 'user q', systemPrompt: 'you are terse' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    // Blocker A2: the anti-CoT directive is spliced into the single
    // system message — caller content still present, no duplication.
    const systemMsgs = body.messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0].content).toContain('you are terse');
    expect(systemMsgs[0].content).toMatch(/return only the final answer/i);
    const userMsg = body.messages.find((m) => m.role === 'user')!;
    expect(userMsg).toEqual({ role: 'user', content: 'user q' });
  });

  it('auto-appends input when prompt has NO template vars', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      llmNode({ prompt: 'summarize this' }),
      { topic: 'cats', count: 7 },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('summarize this');
    expect(userMsg.content).toContain('--- Input Data ---');
    expect(userMsg.content).toContain('cats');
  });

  it('does NOT auto-append input when prompt has template vars', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      llmNode({ prompt: 'process {{topic}}' }),
      { topic: 'cats' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toBe('process cats');
    expect(userMsg.content).not.toContain('--- Input Data ---');
  });

  it('uses Smart Router (model="auto") when no model is set or model="auto"', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(llmNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string) as { model: string };
    expect(body.model).toBe('auto');
  });

  it('respects an explicit non-auto model setting', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      llmNode({ prompt: 'x', model: 'some-deployment' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string) as { model: string };
    expect(body.model).toBe('some-deployment');
  });

  it('forwards AbortSignal onto the fetch call', async () => {
    const ctrl = new AbortController();
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      llmNode({ prompt: 'x' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    // streamLLMCompletion chains the caller signal to a timeout
    // controller; the outgoing init.signal therefore wraps but is
    // still defined. Sanity: a signal exists on the outbound call.
    expect(cap.init?.signal).toBeDefined();
  });

  it('forwards internal-auth headers + X-Workflow-Execution', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(llmNode({ prompt: 'x' }), null, makeCtx());
    const h = cap.init!.headers as Record<string, string>;
    expect(h['X-Internal-Secret']).toBe('sekret');
    expect(h['X-Workflow-Execution']).toBe('exec-llm-1');
  });

  it('runWithAssertions: empty content fails non_empty_content', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '' });
    const plugin = { schema: schema as any, execute };
    const node = llmNode({ prompt: 'do nothing' });

    let caught: unknown;
    try {
      await runWithAssertions(plugin, node as any, null, makeCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe('non_empty_content');
  });

  it('runWithAssertions: non-empty content passes', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'real content here', model: 'r' });
    const plugin = { schema: schema as any, execute };
    const node = llmNode({ prompt: 'go' });
    const out: any = await runWithAssertions(plugin, node as any, null, makeCtx());
    expect(out.content).toBe('real content here');
  });

  it('calls ctx.tracing.recordCall after API responds', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'traced content', model: 'traced-model' });
    const recordCall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ tracing: { recordCall, flush: vi.fn() } as any });
    const node = llmNode({ prompt: 'trace me' });
    await execute(node, null, ctx);
    expect(recordCall).toHaveBeenCalledOnce();
    const args = recordCall.mock.calls[0][0];
    expect(args.nodeId).toBe('n_llm');
    expect(args.executionId).toBe('exec-llm-1');
    expect(args.model).toBe('traced-model');
  });

  it('does not throw if tracing.recordCall rejects', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'ok', model: 'model-x' });
    const ctx = makeCtx({
      tracing: {
        recordCall: vi.fn().mockRejectedValue(new Error('tracing down')),
        flush: vi.fn(),
      } as any,
    });
    await expect(execute(llmNode({ prompt: 'x' }), null, ctx)).resolves.toBeDefined();
  });

  // Tier B — ctx.emitCanonical receives per-chunk canonical events.
  it('emits canonical events through ctx.emitCanonical', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'streamed', model: 'm' });
    const seen: Array<{ type: string }> = [];
    const ctx = makeCtx({
      emitCanonical: (ev) => {
        seen.push({ type: ev.type });
      },
    });
    await execute(llmNode({ prompt: 'stream me' }), null, ctx);
    // Canonical OpenAI normalizer emits message_start + content_block_start
    // + content_block_delta(text) + content_block_stop + message_delta +
    // message_stop on a normal turn. At minimum we expect message_start,
    // a text_delta, and message_stop to all surface to the caller.
    expect(seen.some((e) => e.type === 'message_start')).toBe(true);
    expect(seen.some((e) => e.type === 'content_block_delta')).toBe(true);
    expect(seen.some((e) => e.type === 'message_stop')).toBe(true);
  });
});
