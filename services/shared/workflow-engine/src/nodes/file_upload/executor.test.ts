/**
 * file_upload node — executor tests.
 *
 * POSTs content to /api/files/embed for chunking + ingestion.
 *
 * Covers:
 *   1. happy path — sends content/collection/fileName/chunkSize/chunkOverlap
 *   2. content from input.content when node has no content
 *   3. content from raw input string
 *   4. no content → throws
 *   5. content templated against input
 *   6. metadata parsed from JSON string
 *   7. abort signal forwarded
 *   8. API error → throws with descriptive message
 *   9. internal auth headers injected
 *  10. defaults: collection='default', chunkSize=512, chunkOverlap=50
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-fu-1',
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

const fuNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_fu',
  type: 'file_upload',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('file_upload/executor', () => {
  it('happy path — sends content/collection/fileName/chunk params', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { chunkCount: 3, chunks: 3 },
    } as any);

    const out: any = await execute(
      fuNode({
        collection: 'docs',
        content: 'long content body for embedding',
        fileName: 'README.md',
        chunkSize: 1024,
        chunkOverlap: 100,
      }),
      null,
      makeCtx(),
    );
    expect(out.collection).toBe('docs');
    expect(out.fileName).toBe('README.md');
    expect(out.chunkCount).toBe(3);
    expect(out.status).toBe('embedded');

    expect(postSpy.mock.calls[0][0]).toBe('http://test-api/api/files/embed');
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.collection).toBe('docs');
    expect(sent.content).toBe('long content body for embedding');
    expect(sent.fileName).toBe('README.md');
    expect(sent.chunkSize).toBe(1024);
    expect(sent.chunkOverlap).toBe(100);
  });

  it('content from input.content when node has no content', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      fuNode({ collection: 'docs' }),
      { content: 'upstream content body' },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.content).toBe('upstream content body');
  });

  it('content from raw input string', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(fuNode({}), 'raw string body', makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.content).toBe('raw string body');
  });

  it('throws when no content available', async () => {
    await expect(execute(fuNode({}), null, makeCtx())).rejects.toThrow(/content/i);
  });

  it('content templated against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      fuNode({ content: 'doc {{id}} body lorem ipsum' }),
      { id: 42 },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.content).toBe('doc 42 body lorem ipsum');
  });

  it('metadata parsed from JSON string', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      fuNode({
        content: 'long enough content here',
        metadata: '{"author":"alice","tags":["a","b"]}',
      }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.metadata).toEqual({ author: 'alice', tags: ['a', 'b'] });
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      fuNode({ content: 'long enough content' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('API 500 → throws with descriptive message', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      data: { error: 'Milvus down' },
      statusText: 'Internal Server Error',
    } as any);

    await expect(
      execute(fuNode({ content: 'long enough content' }), null, makeCtx()),
    ).rejects.toThrow(/file upload|embed|Milvus down/i);
  });

  it('internal auth headers injected', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      fuNode({ content: 'long enough content' }),
      null,
      makeCtx(),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.headers['X-Internal-Secret']).toBe('shh');
  });

  it('defaults — collection=default, chunkSize=512, chunkOverlap=50', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      fuNode({ content: 'long enough content' }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.collection).toBe('default');
    expect(sent.chunkSize).toBe(512);
    expect(sent.chunkOverlap).toBe(50);
  });
});
