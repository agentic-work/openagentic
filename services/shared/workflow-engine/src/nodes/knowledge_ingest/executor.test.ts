/**
 * knowledge_ingest node — executor tests.
 *
 * Covers:
 *   1. happy path — POSTs content + collection + metadata, returns API result
 *   2. content too short (< 10 chars) → returns success: false (no API call)
 *   3. no content available → returns success: false
 *   4. content read from input.output.content
 *   5. metadata includes source, workflow_node id
 *   6. abort signal forwarded
 *   7. API error → returns success: false with error message
 *   8. internal-auth headers injected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-ki-1',
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

const kiNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_ki',
  type: 'knowledge_ingest',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('knowledge_ingest/executor', () => {
  it('happy path — POSTs content/collection/metadata, returns API result', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { success: true, chunksIngested: 5 },
    } as any);

    const longContent = 'This is enough content to ingest into vector store.';
    const out: any = await execute(
      kiNode({ collection: 'docs', source: 'manual', content: longContent }),
      null,
      makeCtx(),
    );

    expect(out.success).toBe(true);
    expect(out.chunksIngested).toBe(5);

    expect(postSpy.mock.calls[0][0]).toBe('http://test-api/api/chat/knowledge/ingest');
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.content).toBe(longContent);
    expect(sent.collection).toBe('docs');
    expect(sent.metadata.source).toBe('manual');
    expect(sent.metadata.workflow_node).toBe('n_ki');
  });

  it('content too short (< 10 chars) → success: false, no API call', async () => {
    const postSpy = vi.spyOn(axios, 'post');
    const out: any = await execute(
      kiNode({ collection: 'c', content: 'short' }),
      null,
      makeCtx(),
    );
    expect(out.success).toBe(false);
    expect(out.chunksIngested).toBe(0);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('no content from any source → success: false', async () => {
    const out: any = await execute(kiNode({}), null, makeCtx());
    expect(out.success).toBe(false);
    expect(out.chunksIngested).toBe(0);
  });

  it('reads content from input.output.content when node.data has none', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { success: true, chunksIngested: 1 },
    } as any);

    const upstream = { output: { content: 'Some long-enough upstream output here.' } };
    await execute(kiNode({}), upstream, makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.content).toBe('Some long-enough upstream output here.');
  });

  it('uses default collection "shared" when unset', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { success: true },
    } as any);

    await execute(
      kiNode({ content: 'long enough content here for ingestion' }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.collection).toBe('shared');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { success: true },
    } as any);

    await execute(
      kiNode({ content: 'long enough content for ingestion test' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('API throws — returns success: false with error message', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('connection refused'));

    const out: any = await execute(
      kiNode({ content: 'long enough content for ingestion test' }),
      null,
      makeCtx(),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/connection refused/);
    expect(out.chunksIngested).toBe(0);
  });

  it('internal auth headers are injected', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { success: true },
    } as any);

    await execute(
      kiNode({ content: 'long enough content for ingestion test' }),
      null,
      makeCtx(),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.headers['X-Internal-Secret']).toBe('shh');
  });
});
