/**
 * vector_store node — executor tests.
 *
 * Covers:
 *   1. happy path — upsert with vectors+texts → POSTs to /api/v1/vector/store
 *   2. operation defaults to 'upsert'
 *   3. delete operation
 *   4. collection templated against input
 *   5. internal-auth headers injected
 *   6. abort signal forwarded
 *   7. fallback path — primary 500 → POSTs to /api/files/embed
 *   8. createIfMissing default true
 *   9. metadata from node.data takes precedence over input.metadata
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-vs-1',
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

const vsNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_vs',
  type: 'vector_store',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('vector_store/executor', () => {
  it('happy path — upsert with vectors+texts → POSTs to /api/v1/vector/store', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { count: 2 },
    } as any);

    const out: any = await execute(
      vsNode({ collection: 'docs', operation: 'upsert' }),
      { vectors: [[0.1, 0.2], [0.3, 0.4]], texts: ['a', 'b'] },
      makeCtx(),
    );

    expect(out.collection).toBe('docs');
    expect(out.operation).toBe('upsert');
    expect(out.stored).toBe(2);

    expect(postSpy.mock.calls[0][0]).toBe('http://test-api/api/v1/vector/store');
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.collection).toBe('docs');
    expect(sent.operation).toBe('upsert');
    expect(sent.vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(sent.texts).toEqual(['a', 'b']);
  });

  it('operation defaults to upsert', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { count: 1 },
    } as any);

    await execute(vsNode({ collection: 'd' }), { vectors: [[0]], texts: ['a'] }, makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.operation).toBe('upsert');
  });

  it('delete operation', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { count: 0 },
    } as any);

    await execute(
      vsNode({ collection: 'd', operation: 'delete' }),
      { vectors: [], texts: [] },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.operation).toBe('delete');
  });

  it('collection templated against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { count: 1 },
    } as any);

    await execute(
      vsNode({ collection: '{{coll}}' }),
      { coll: 'tenant-a-docs', vectors: [[0]], texts: ['x'] },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.collection).toBe('tenant-a-docs');
  });

  it('internal-auth headers injected', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(vsNode({ collection: 'd' }), { vectors: [[0]], texts: ['x'] }, makeCtx());

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.headers['X-Internal-Secret']).toBe('shh');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      vsNode({ collection: 'd' }),
      { vectors: [[0]], texts: ['x'] },
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('fallback path — primary 500 → POSTs to /api/files/embed', async () => {
    const postSpy = vi.spyOn(axios, 'post')
      .mockResolvedValueOnce({ status: 500, data: { error: 'boom' } } as any)
      .mockResolvedValueOnce({ status: 200, data: { chunks: 3 } } as any);

    const out: any = await execute(
      vsNode({ collection: 'd' }),
      { vectors: [], texts: ['a', 'b', 'c'] },
      makeCtx(),
    );

    expect(postSpy.mock.calls[1][0]).toBe('http://test-api/api/files/embed');
    expect(out.stored).toBe(3);
  });

  it('createIfMissing default true', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(vsNode({ collection: 'd' }), { vectors: [[0]], texts: ['x'] }, makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.createIfMissing).toBe(true);
  });

  it('metadata from node.data takes precedence over input.metadata', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      vsNode({ collection: 'd', metadata: { src: 'node' } }),
      { vectors: [[0]], texts: ['x'], metadata: { src: 'input' } },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.metadata).toEqual({ src: 'node' });
  });
});
