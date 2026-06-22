/**
 * http_request node — executor tests.
 *
 * Covers:
 *   1. happy path — GET returns shaped result
 *   2. POST with templated body
 *   3. missing url — throws
 *   4. headers templated against input
 *   5. internal-auth auto-injected for in-cluster URLs
 *   6. abort signal forwarded
 *   7. responseType=text
 *   8. outputAssertion via runWithAssertions: HTTP 500 fails status_2xx
 *   9. acceptAllStatuses bypasses the assertion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-1',
    apiUrl: 'http://test-api',
    // Default templater: replace {{x}} with input.x; pass through otherwise.
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'shh' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const httpNode = (data: Record<string, unknown>) => ({
  id: 'n_http',
  type: 'http_request',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('http_request/executor', () => {
  it('GET — returns { status, statusText, data, headers }', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: { hello: 'world' },
      headers: { 'content-type': 'application/json' },
    } as any);

    const out: any = await execute(
      httpNode({ url: 'https://api.example.com/x', method: 'GET' }),
      null,
      makeCtx(),
    );
    expect(out.status).toBe(200);
    expect(out.statusText).toBe('OK');
    expect(out.data).toEqual({ hello: 'world' });
    expect(out.headers['content-type']).toBe('application/json');
  });

  it('POST — interpolates body templates and sends as JSON', async () => {
    const reqSpy = vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 201,
      statusText: 'Created',
      data: { id: 7 },
      headers: {},
    } as any);

    await execute(
      httpNode({
        url: 'https://api.example.com/users',
        method: 'POST',
        body: '{"name":"{{name}}"}',
        headers: { 'Content-Type': 'application/json' },
      }),
      { name: 'alice' },
      makeCtx(),
    );

    const sentConfig: any = reqSpy.mock.calls[0][0];
    expect(sentConfig.method).toBe('post');
    expect(sentConfig.data).toEqual({ name: 'alice' });
    expect(sentConfig.headers['Content-Type']).toBe('application/json');
  });

  it('throws when url is missing (per-required-field error case)', async () => {
    await expect(
      execute(httpNode({ method: 'GET' }), null, makeCtx()),
    ).rejects.toThrow(/requires a url/i);
  });

  it('interpolates headers against input', async () => {
    const reqSpy = vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: '',
      headers: {},
    } as any);

    await execute(
      httpNode({
        url: 'https://api.example.com/x',
        method: 'GET',
        headers: { Authorization: 'Bearer {{token}}' },
      }),
      { token: 'tok123' },
      makeCtx(),
    );

    const sentConfig: any = reqSpy.mock.calls[0][0];
    expect(sentConfig.headers.Authorization).toBe('Bearer tok123');
  });

  it('auto-injects internal auth for in-cluster API calls', async () => {
    const reqSpy = vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: '',
      headers: {},
    } as any);

    await execute(
      httpNode({
        url: 'http://openagentic-api:8000/health',
        method: 'GET',
      }),
      null,
      makeCtx(),
    );

    const sentConfig: any = reqSpy.mock.calls[0][0];
    expect(sentConfig.headers['X-Internal-Secret']).toBe('shh');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const reqSpy = vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: '',
      headers: {},
    } as any);

    await execute(
      httpNode({ url: 'https://api.example.com/x', method: 'GET' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const sentConfig: any = reqSpy.mock.calls[0][0];
    expect(sentConfig.signal).toBe(ctrl.signal);
  });

  it('responseType=text — stringifies non-string response data', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: { x: 1 },
      headers: {},
    } as any);

    const out: any = await execute(
      httpNode({
        url: 'https://api.example.com/x',
        method: 'GET',
        responseType: 'text',
      }),
      null,
      makeCtx(),
    );
    expect(typeof out.data).toBe('string');
    expect(out.data).toBe('{"x":1}');
  });

  // outputAssertion ----------------------------------------------------------

  it('runWithAssertions: HTTP 500 fails the status_2xx assertion (closes "fake success")', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 500,
      statusText: 'Internal Server Error',
      data: 'boom',
      headers: {},
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = httpNode({ url: 'https://api.example.com/fail', method: 'GET' });

    await expect(
      runWithAssertions(plugin, node as any, null, makeCtx()),
    ).rejects.toBeInstanceOf(OutputAssertionError);

    try {
      vi.spyOn(axios, 'request').mockResolvedValueOnce({
        status: 500,
        statusText: 'Internal Server Error',
        data: 'boom',
        headers: {},
      } as any);
      await runWithAssertions(plugin, node as any, null, makeCtx());
    } catch (err) {
      const e = err as OutputAssertionError;
      expect(e.reason).toBe('output_failed_assertion');
      expect(e.failedAssertion).toBe('status_2xx');
      expect((e.nodeOutput as any).status).toBe(500);
    }
  });

  it('runWithAssertions: acceptAllStatuses=true bypasses the assertion', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 404,
      statusText: 'Not Found',
      data: { error: 'gone' },
      headers: {},
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = httpNode({
      url: 'https://api.example.com/maybe',
      method: 'GET',
      acceptAllStatuses: true,
    });

    const out: any = await runWithAssertions(plugin, node as any, null, makeCtx());
    expect(out.status).toBe(404);
    expect(out.acceptedAllStatuses).toBe(true);
  });

  it('runWithAssertions: 200 OK passes the assertion', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: { ok: true },
      headers: {},
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = httpNode({ url: 'https://api.example.com/ok', method: 'GET' });
    const out: any = await runWithAssertions(plugin, node as any, null, makeCtx());
    expect(out.status).toBe(200);
  });
});
