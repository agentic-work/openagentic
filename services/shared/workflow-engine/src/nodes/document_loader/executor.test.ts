/**
 * document_loader node — executor tests.
 *
 * Covers:
 *   1. happy path — sourceType=url fetches and returns { content, source, contentLength }
 *   2. parseMode=text — strips HTML tags
 *   3. parseMode=html — keeps HTML
 *   4. parseMode=auto — strips HTML when content has <html
 *   5. URL templated against input
 *   6. URL from upstream input string
 *   7. abort signal forwarded
 *   8. non-URL sourceType passes through input content
 *   9. mimeType from response content-type header
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-dl-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const dlNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_dl',
  type: 'document_loader',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('document_loader/executor', () => {
  it('sourceType=url — fetches and returns shaped result', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: 'Just plain text content here.',
      headers: { 'content-type': 'text/plain' },
    } as any);

    const out: any = await execute(
      dlNode({ sourceType: 'url', url: 'https://example.com/doc.txt', parseMode: 'text' }),
      null,
      makeCtx(),
    );

    expect(out.content).toContain('plain text content');
    expect(out.source).toBe('https://example.com/doc.txt');
    expect(out.sourceType).toBe('url');
    expect(out.contentLength).toBeGreaterThan(0);
    expect(out.mimeType).toBe('text/plain');
  });

  it('parseMode=text — strips HTML tags', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: '<html><body><h1>Title</h1><p>Body text</p><script>alert(1)</script></body></html>',
      headers: { 'content-type': 'text/html' },
    } as any);

    const out: any = await execute(
      dlNode({ sourceType: 'url', url: 'https://x', parseMode: 'text' }),
      null,
      makeCtx(),
    );

    expect(out.content).toContain('Title');
    expect(out.content).toContain('Body text');
    expect(out.content).not.toContain('<h1>');
    expect(out.content).not.toContain('alert(1)');
  });

  it('parseMode=html — keeps HTML tags', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: '<html><body><p>Body</p></body></html>',
      headers: { 'content-type': 'text/html' },
    } as any);

    const out: any = await execute(
      dlNode({ sourceType: 'url', url: 'https://x', parseMode: 'html' }),
      null,
      makeCtx(),
    );

    expect(out.content).toContain('<p>Body</p>');
  });

  it('parseMode=auto — strips HTML when content has <html', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: '<html><body>Hi</body></html>',
      headers: { 'content-type': 'text/html' },
    } as any);

    const out: any = await execute(
      dlNode({ sourceType: 'url', url: 'https://x', parseMode: 'auto' }),
      null,
      makeCtx(),
    );

    expect(out.content).not.toContain('<html');
    expect(out.content).toContain('Hi');
  });

  it('URL templated against input', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: 'x',
      headers: {},
    } as any);

    await execute(
      dlNode({ sourceType: 'url', url: 'https://api.example.com/{{id}}.json', parseMode: 'json' }),
      { id: 42 },
      makeCtx(),
    );

    expect(getSpy.mock.calls[0][0]).toBe('https://api.example.com/42.json');
  });

  it('URL from upstream input string when node has no url', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: 'x',
      headers: {},
    } as any);

    await execute(dlNode({ sourceType: 'url' }), 'https://from-input.com/doc', makeCtx());

    expect(getSpy.mock.calls[0][0]).toBe('https://from-input.com/doc');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: 'x',
      headers: {},
    } as any);

    await execute(
      dlNode({ sourceType: 'url', url: 'https://x' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = getSpy.mock.calls[0][1] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('non-URL sourceType passes through input content', async () => {
    const out: any = await execute(
      dlNode({ sourceType: 'string' }),
      'inline content',
      makeCtx(),
    );
    expect(out.content).toBe('inline content');
    expect(out.sourceType).toBe('string');
    expect(out.contentLength).toBe('inline content'.length);
  });

  it('object response is JSON-stringified', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { foo: 'bar', n: 1 },
      headers: { 'content-type': 'application/json' },
    } as any);

    const out: any = await execute(
      dlNode({ sourceType: 'url', url: 'https://x', parseMode: 'json' }),
      null,
      makeCtx(),
    );

    expect(out.content).toContain('"foo"');
    expect(out.content).toContain('"bar"');
  });
});
