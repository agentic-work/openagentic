/**
 * openagentic_chat node — executor tests (Tier C — streaming via fetch).
 *
 * This executor preserves shared behavior:
 *   - Smart Router model='auto' default (no literal model strings)
 *   - modelOverride respected
 *   - sliderOverride forwarded
 *   - enableThinking + thinkingBudget forwarded
 *   - auto-input-context injection when prompt has no template vars
 *   - returns { content, model, usage, provider:'openagentic' }
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
    executionId: 'exec-awc-1',
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

const awcNode = (data: Record<string, unknown>) => ({
  id: 'n_awc',
  type: 'openagentic_chat',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openagentic_chat/executor', () => {
  it('returns { content, model, usage, provider:"openagentic" }', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content: 'hi from awc',
      model: 'router-pick-x',
      usage: { total_tokens: 30 },
    });
    const out: any = await execute(awcNode({ prompt: 'hi' }), null, makeCtx());
    expect(out.content).toBe('hi from awc');
    expect(out.model).toBe('router-pick-x');
    expect(out.provider).toBe('openagentic');
  });

  it('defaults to model="auto" (Smart Router) — no literal', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(awcNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('auto');
  });

  it('respects modelOverride', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      awcNode({ prompt: 'x', modelOverride: 'specific-deploy' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('specific-deploy');
  });

  it('forwards sliderOverride when set', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      awcNode({ prompt: 'x', sliderOverride: 60 }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.sliderPosition).toBe(60);
  });

  it('forwards enableThinking + thinkingBudget when set', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      awcNode({ prompt: 'x', enableThinking: true, thinkingBudget: 5000 }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.enableThinking).toBe(true);
    expect(body.thinkingBudget).toBe(5000);
  });

  it('does NOT include enableThinking when not set', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(awcNode({ prompt: 'x' }), null, makeCtx());
    const body = JSON.parse(cap.init!.body as string);
    expect(body.enableThinking).toBeUndefined();
    expect(body.thinkingBudget).toBeUndefined();
  });

  it('auto-appends input when prompt has NO template vars', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      awcNode({ prompt: 'summarize' }),
      { topic: 'cats' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    const userMsg = body.messages[body.messages.length - 1].content;
    expect(userMsg).toContain('summarize');
    expect(userMsg).toContain('--- Input Data ---');
    expect(userMsg).toContain('cats');
  });

  it('does NOT auto-append input when prompt HAS template vars', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      awcNode({ prompt: 'hello {{topic}}' }),
      { topic: 'cats' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    const userMsg = body.messages[body.messages.length - 1].content;
    expect(userMsg).toBe('hello cats');
    expect(userMsg).not.toContain('--- Input Data ---');
  });

  it('forwards system prompt as system message', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(
      awcNode({ prompt: 'u', systemPrompt: 'be terse' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    // Blocker A2: anti-CoT directive spliced into the single system message.
    const sys = body.messages.filter((m: any) => m.role === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0].content).toContain('be terse');
    expect(sys[0].content).toMatch(/return only the final answer/i);
  });

  it('forwards AbortSignal + headers', async () => {
    const ctrl = new AbortController();
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'x' });
    await execute(awcNode({ prompt: 'x' }), null, makeCtx({ signal: ctrl.signal }));
    expect(cap.init?.signal).toBeDefined();
    const h = cap.init!.headers as Record<string, string>;
    expect(h['X-Internal-Secret']).toBe('sekret');
    expect(h['X-Workflow-Execution']).toBe('exec-awc-1');
  });

  it('runWithAssertions: empty content fails non_empty_content', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '' });
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(plugin, awcNode({ prompt: 'go' }) as any, null, makeCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
  });

  // Refusal-detection: closes the "fake success" gap — when the LLM returns
  // a refusal sentence, the node MUST fail loudly with
  // output_failed_assertion instead of letting downstream merge/synth steps
  // treat the refusal as legitimate content. Same regex pattern as the
  // agent_* family for consistency.
  describe('runWithAssertions: refusal-detection (closes fake-success gap)', () => {
    const refusals = [
      "I couldn't find information about that topic.",
      "I could not locate any relevant data.",
      "I cannot help with that request.",
      "I can't access that resource right now.",
      "I do not have information on this subject.",
      "I don't have access to that database.",
      "I am unable to retrieve those records.",
      "I wasn't able to complete the search.",
      "I was not able to verify that fact.",
      "Sorry, I cannot answer that.",
      "Sorry, but the data is unavailable.",
      "I'm sorry, the lookup returned nothing.",
      "I apologize, no results matched.",
      "Unfortunately, I cannot find anything.",
      "Unfortunately, no records exist for that query.",
      "No information available for that topic.",
      "No data found matching your criteria.",
      "No results found in the index.",
      "No content available at this time.",
    ];

    for (const refusal of refusals) {
      it(`fails on refusal: "${refusal.slice(0, 50)}..."`, async () => {
        const cap: FetchCapture = {};
        mockFetchSSE(cap, { content: refusal });
        const plugin = { schema: schema as any, execute };
        let caught: any;
        try {
          await runWithAssertions(plugin, awcNode({ prompt: 'go' }) as any, null, makeCtx());
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(OutputAssertionError);
        expect(caught.failedAssertion).toBe('agent_substantive_output');
      });
    }

    it('passes on substantive content', async () => {
      const cap: FetchCapture = {};
      mockFetchSSE(cap, {
        content:
          'Photosynthesis is the biochemical process by which plants convert sunlight, water, and carbon dioxide into glucose and oxygen.',
      });
      const plugin = { schema: schema as any, execute };
      const out: any = await runWithAssertions(plugin, awcNode({ prompt: 'go' }) as any, null, makeCtx());
      expect(out.content).toContain('Photosynthesis');
    });
  });

  // T9: tracing integration -----------------------------------------------

  it('calls ctx.tracing.recordCall with model and executionId after API responds', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'traced output', model: 'awc-traced-model' });
    const recordCall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ tracing: { recordCall, flush: vi.fn() } as any });
    await execute(awcNode({ prompt: 'x' }), null, ctx);
    expect(recordCall).toHaveBeenCalledOnce();
    const args = recordCall.mock.calls[0][0];
    expect(args.nodeId).toBe('n_awc');
    expect(args.model).toBe('awc-traced-model');
    expect(args.executionId).toBe('exec-awc-1');
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
    await expect(execute(awcNode({ prompt: 'x' }), null, ctx)).resolves.toBeDefined();
  });
});
