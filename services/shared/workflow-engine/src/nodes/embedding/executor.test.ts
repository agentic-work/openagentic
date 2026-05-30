/**
 * embedding node — executor tests.
 *
 * Generates embeddings via /api/v1/embeddings (with vector/embed fallback).
 *
 * Covers:
 *   1. happy path — single text input → array of one vector
 *   2. input.chunks array → maps to texts list
 *   3. plain array input → texts list
 *   4. respects batchSize (only sends first N)
 *   5. model templated against input
 *   6. internal-auth headers injected
 *   7. abort signal forwarded
 *   8. fallback path — primary 500 → tries /vector/embed
 *   9. response parsed: data[].embedding shape
 *  10. response parsed: { embeddings: [...] } shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-emb-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'shh' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const embNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_emb',
  type: 'embedding',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('embedding/executor', () => {
  it('happy path — single string input → one vector', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [0.1, 0.2, 0.3] }] },
    } as any);

    const out: any = await execute(
      embNode({ model: 'env-model' }),
      'hello world',
      makeCtx(),
    );

    expect(out.vectors).toEqual([[0.1, 0.2, 0.3]]);
    expect(out.count).toBe(1);
    expect(out.dimensions).toBe(3);

    expect(postSpy.mock.calls[0][0]).toBe('http://test-api/api/v1/embeddings');
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.input).toEqual(['hello world']);
    expect(sent.model).toBe('env-model');
  });

  it('input.chunks array → maps to texts list', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [0.1] }, { embedding: [0.2] }] },
    } as any);

    await execute(
      embNode({ model: 'm' }),
      { chunks: [{ content: 'a' }, { content: 'b' }] },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.input).toEqual(['a', 'b']);
  });

  it('plain array input → texts list', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [0] }, { embedding: [1] }] },
    } as any);

    await execute(embNode({ model: 'm' }), ['x', 'y'], makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.input).toEqual(['x', 'y']);
  });

  it('respects batchSize (only sends first N)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [0] }] },
    } as any);

    await execute(embNode({ model: 'm', batchSize: 1 }), ['a', 'b', 'c'], makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.input).toEqual(['a']);
  });

  it('model templated against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [0] }] },
    } as any);

    // Pass model="{{provider}}-v2" and input.provider=foo via a custom ctx
    // that resolves {{provider}} from the input object.
    const ctx = makeCtx({
      interpolateTemplate: (t, i) =>
        typeof t === 'string'
          ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String((i as any)?.[k.trim()] ?? ''))
          : t,
    });
    await execute(
      embNode({ model: '{{provider}}-v2' }),
      { provider: 'foo', chunks: ['hello'] },
      ctx,
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.model).toBe('foo-v2');
  });

  it('internal-auth headers injected', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [0] }] },
    } as any);

    await execute(embNode({ model: 'm' }), 'x', makeCtx());

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.headers['X-Internal-Secret']).toBe('shh');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [0] }] },
    } as any);

    await execute(embNode({ model: 'm' }), 'x', makeCtx({ signal: ctrl.signal }));

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('fallback path — primary 500 → tries /vector/embed', async () => {
    const postSpy = vi.spyOn(axios, 'post')
      .mockResolvedValueOnce({ status: 500, data: { error: 'boom' } } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: { embeddings: [[0.5, 0.5]], dimensions: 2 },
      } as any);

    const out: any = await execute(embNode({ model: 'm' }), 'x', makeCtx());

    expect(postSpy.mock.calls[0][0]).toBe('http://test-api/api/v1/embeddings');
    expect(postSpy.mock.calls[1][0]).toBe('http://test-api/api/v1/vector/embed');
    expect(out.vectors).toEqual([[0.5, 0.5]]);
    expect(out.dimensions).toBe(2);
  });

  it('response parsed — data[].embedding', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { data: [{ embedding: [1, 2, 3] }] },
    } as any);
    const out: any = await execute(embNode({ model: 'm' }), 'x', makeCtx());
    expect(out.vectors).toEqual([[1, 2, 3]]);
  });

  it('response parsed — { embeddings: [...] }', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { embeddings: [[7, 8]] },
    } as any);
    const out: any = await execute(embNode({ model: 'm' }), 'x', makeCtx());
    expect(out.vectors).toEqual([[7, 8]]);
  });
});
