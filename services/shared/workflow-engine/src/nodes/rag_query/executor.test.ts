/**
 * rag_query node — executor tests.
 *
 * Covers:
 *   1. happy path — POSTs to /api/v1/vector/search, returns shaped result
 *   2. missing query → throws
 *   3. query templated against input
 *   4. collection templated
 *   5. internal-auth headers injected
 *   6. abort signal forwarded
 *   7. filters: object passed through
 *   8. filters: JSON string parsed (with templating)
 *   9. defaults — collection='default', topK=5, scoreThreshold=0.5
 *  10. API 500 → throws
 *  11. response shape: { results: [...] } and bare-array
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-rq-1',
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

const rqNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_rq',
  type: 'rag_query',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('rag_query/executor', () => {
  it('happy path — POSTs to /api/v1/vector/search, returns shaped result', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [{ id: 1, text: 'a', score: 0.9 }] },
    } as any);

    const out: any = await execute(
      rqNode({ collection: 'docs', query: 'how to deploy', topK: 3 }),
      null,
      makeCtx(),
    );

    expect(out.query).toBe('how to deploy');
    expect(out.collection).toBe('docs');
    expect(out.resultCount).toBe(1);
    expect(out.results).toEqual([{ id: 1, text: 'a', score: 0.9 }]);

    expect(postSpy.mock.calls[0][0]).toBe('http://test-api/api/v1/vector/search');
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.query).toBe('how to deploy');
    expect(sent.topK).toBe(3);
  });

  it('throws when query missing', async () => {
    await expect(execute(rqNode({ collection: 'd' }), null, makeCtx())).rejects.toThrow(
      /query/i,
    );
  });

  it('query templated against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [] },
    } as any);

    await execute(
      rqNode({ collection: 'd', query: 'lookup {{topic}}' }),
      { topic: 'ssl certs' },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.query).toBe('lookup ssl certs');
  });

  it('collection templated against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [] },
    } as any);

    await execute(
      rqNode({ collection: '{{tenant}}-docs', query: 'q' }),
      { tenant: 'acme' },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.collection).toBe('acme-docs');
  });

  it('internal-auth headers injected', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [] },
    } as any);

    await execute(rqNode({ query: 'q' }), null, makeCtx());

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.headers['X-Internal-Secret']).toBe('shh');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [] },
    } as any);

    await execute(rqNode({ query: 'q' }), null, makeCtx({ signal: ctrl.signal }));

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('filters: object passed through', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [] },
    } as any);

    await execute(
      rqNode({ query: 'q', filters: { tenant: 'acme', tier: 'gold' } }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.filters).toEqual({ tenant: 'acme', tier: 'gold' });
  });

  it('filters: JSON string parsed (with templating)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [] },
    } as any);

    await execute(
      rqNode({ query: 'q', filters: '{"tenant":"{{t}}"}' }),
      { t: 'acme' },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.filters).toEqual({ tenant: 'acme' });
  });

  it('defaults — collection=default, topK=5, scoreThreshold=0.5', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results: [] },
    } as any);

    await execute(rqNode({ query: 'q' }), null, makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.collection).toBe('default');
    expect(sent.topK).toBe(5);
    expect(sent.scoreThreshold).toBe(0.5);
  });

  it('API 500 → throws', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      data: { error: 'Milvus down' },
      statusText: 'Internal Server Error',
    } as any);

    await expect(execute(rqNode({ query: 'q' }), null, makeCtx())).rejects.toThrow(
      /RAG query failed|Milvus down/,
    );
  });

  it('response shape: bare array (data is the array)', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: [{ id: 'a' }, { id: 'b' }],
    } as any);

    const out: any = await execute(rqNode({ query: 'q' }), null, makeCtx());
    expect(out.resultCount).toBe(2);
    expect(out.results).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
