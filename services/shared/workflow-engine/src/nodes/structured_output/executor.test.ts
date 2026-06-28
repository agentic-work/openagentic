/**
 * structured_output node — executor tests (Tier C — streaming via fetch).
 *
 * Behavior pinned:
 *   - streams from /api/v1/chat/completions with response_format: { type:'json_object' }
 *   - retries up to maxRetries on JSON parse failure (default 2 → 3 attempts)
 *   - returns { output, model, attempts, raw } on success
 *   - returns { output:null, error, raw, model, attempts } after all retries fail
 *   - NO model literal: defaults to 'auto' (Smart Router) or env DEFAULT_MODEL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';
import {
  mockFetchSSE,
  type FetchCapture,
} from '../../llm/__tests__/mockFetchSSE.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-so-1',
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

const soNode = (data: Record<string, unknown>) => ({
  id: 'n_so',
  type: 'structured_output',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DEFAULT_MODEL;
});

describe('structured_output/executor', () => {
  it('parses JSON content and returns { output, attempts:1, raw }', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{"name":"alice","count":3}' });
    const out: any = await execute(
      soNode({ prompt: 'extract', schema: '{"name":"string","count":"number"}' }),
      null,
      makeCtx(),
    );
    expect(out.output).toEqual({ name: 'alice', count: 3 });
    expect(out.attempts).toBe(1);
    expect(out.raw).toBe('{"name":"alice","count":3}');
  });

  it('strips markdown code fences from raw before parsing', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '```json\n{"x":1}\n```' });
    const out: any = await execute(
      soNode({ prompt: 'p', schema: '{"x":"number"}' }),
      null,
      makeCtx(),
    );
    expect(out.output).toEqual({ x: 1 });
  });

  it('sets response_format json_object and includes schema in system prompt', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{}' });
    await execute(
      soNode({ prompt: 'p', schema: '{"foo":"string"}' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('{"foo":"string"}');
    expect(body.stream).toBe(true);
  });

  it('retries on parse failure up to maxRetries+1 times', async () => {
    // maxRetries=2 → up to 3 attempts; first 2 invalid, 3rd valid
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: 'not json' });
    mockFetchSSE(cap, { content: 'still not json' });
    mockFetchSSE(cap, { content: '{"ok":true}' });

    const out: any = await execute(
      soNode({ prompt: 'p', schema: '{"ok":"boolean"}', maxRetries: 2 }),
      null,
      makeCtx(),
    );
    expect(out.output).toEqual({ ok: true });
    expect(out.attempts).toBe(3);
  });

  it('returns error result when all retries fail', async () => {
    const cap: FetchCapture = {};
    // maxRetries=1 → 2 attempts; both invalid.
    mockFetchSSE(cap, { content: 'never json' });
    mockFetchSSE(cap, { content: 'never json' });

    const out: any = await execute(
      soNode({ prompt: 'p', schema: '{}', maxRetries: 1 }),
      null,
      makeCtx(),
    );
    expect(out.output).toBeNull();
    expect(out.error).toMatch(/parse/i);
    expect(out.attempts).toBe(2);
  });

  it('templates prompt against input', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{"y":1}' });
    await execute(
      soNode({ prompt: 'extract from {{topic}}', schema: '{}' }),
      { topic: 'cats' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.messages[1].content).toBe('extract from cats');
  });

  it('falls back to input.content when prompt is empty', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{"a":1}' });
    await execute(
      soNode({ prompt: '', schema: '{}' }),
      { content: 'fallback prompt' },
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.messages[1].content).toBe('fallback prompt');
  });

  it('uses model="auto" by default — no literal', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{}' });
    await execute(
      soNode({ prompt: 'p', schema: '{}' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('auto');
  });

  it('respects explicit node.data.model', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{}' });
    await execute(
      soNode({ prompt: 'p', schema: '{}', model: 'json-deploy' }),
      null,
      makeCtx(),
    );
    const body = JSON.parse(cap.init!.body as string);
    expect(body.model).toBe('json-deploy');
  });

  it('forwards AbortSignal', async () => {
    const ctrl = new AbortController();
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{}' });
    await execute(
      soNode({ prompt: 'p', schema: '{}' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    expect(cap.init?.signal).toBeDefined();
  });

  // T9: tracing integration -----------------------------------------------

  it('calls ctx.tracing.recordCall after successful parse', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{"x":1}' });
    const recordCall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ tracing: { recordCall, flush: vi.fn() } as any });
    await execute(soNode({ prompt: 'p', schema: '{}' }), null, ctx);
    expect(recordCall).toHaveBeenCalledOnce();
    const args = recordCall.mock.calls[0][0];
    expect(args.nodeId).toBe('n_so');
    expect(args.executionId).toBe('exec-so-1');
  });

  it('does not throw when tracing.recordCall rejects', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, { content: '{"y":2}' });
    const ctx = makeCtx({
      tracing: {
        recordCall: vi.fn().mockRejectedValue(new Error('tracing fail')),
        flush: vi.fn(),
      } as any,
    });
    await expect(execute(soNode({ prompt: 'p', schema: '{}' }), null, ctx)).resolves.toBeDefined();
  });
});

describe('structured_output/executor — robust JSON extraction', () => {
  it('extracts JSON from prose-prefixed output (weak model prose-leakage)', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content:
        'We need to produce JSON. Let me think... Here it is:\n{"summary":"ok","severity":"P0"}\nThat covers all required fields.',
    });
    const out: any = await execute(
      soNode({ prompt: 'p', schema: '{"type":"object"}' }),
      null,
      makeCtx(),
    );
    expect(out.error).toBeUndefined();
    expect(out.output).toEqual({ summary: 'ok', severity: 'P0' });
  });

  it('extracts JSON from prose with embedded nested braces and quoted strings', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content:
        'Analysis complete. Output:\n{"name":"alice","details":{"age":30,"hobbies":["x","y"]},"note":"has a } in it"}\nDone.',
    });
    const out: any = await execute(
      soNode({ prompt: 'p', schema: '{"type":"object"}' }),
      null,
      makeCtx(),
    );
    expect(out.error).toBeUndefined();
    expect(out.output.name).toBe('alice');
    expect(out.output.details.age).toBe(30);
    expect(out.output.note).toBe('has a } in it');
  });

  it('extracts a top-level array from prose', async () => {
    const cap: FetchCapture = {};
    mockFetchSSE(cap, {
      content: 'Here are the items:\n[1, 2, 3, {"k":"v"}]\nEnd.',
    });
    const out: any = await execute(
      soNode({ prompt: 'p', schema: '{"type":"array"}' }),
      null,
      makeCtx(),
    );
    expect(out.error).toBeUndefined();
    expect(out.output).toEqual([1, 2, 3, { k: 'v' }]);
  });
});
