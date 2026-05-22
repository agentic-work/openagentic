/**
 * nodeSchemasApi — TDD tests (A1)
 * RED first: this file is written before nodeSchemasApi.ts exists.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock @/utils/api so the test works without a real server
vi.mock('@/utils/api', () => ({
  getWorkflowsApiUrl: () => 'http://localhost:3002/api',
  getApiUrl: () => '',
  workflowEndpoint: (p: string) => `/api${p}`,
}));

// Dynamically import to ensure fresh module state per test block
const importApi = () =>
  import('../nodeSchemasApi').then(m => m.nodeSchemasApi);

const mockSchema = {
  type: 'http_request',
  category: 'action',
  label: 'HTTP Request',
  description: 'Make HTTP calls',
  icon: 'globe',
  ports: { inputs: [], outputs: [] },
  settings: [{ name: 'url', label: 'URL', type: 'string', required: true }],
  ai: { shortDescription: 'HTTP call.', whenToUse: 'Calling APIs.' },
  outputAssertions: [],
};

describe('nodeSchemasApi.fetchSchemas', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.resetModules();
  });

  test('success — returns schemas and aiPromptFragment from endpoint', async () => {
    const payload = {
      schemas: [mockSchema],
      aiPromptFragment: '### Action\n- **http_request** — HTTP call.',
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const api = await importApi();
    const result = await api.fetchSchemas();

    expect(result.schemas).toHaveLength(1);
    expect(result.schemas[0].type).toBe('http_request');
    expect(result.aiPromptFragment).toContain('http_request');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('node-schemas');
  });

  // Regression caught by Playwright walk on the dev environment (2026-04-26): when
  // getApiUrl() returns '/api' (the production runtime config), the URL
  // builder concatenated a second '/api' producing /api/api/workflows/
  // internal/node-schemas — a 404 — so the registry was empty in the UI
  // even though the api proxy was healthy. Verifies the URL is built
  // exactly once with /api.
  test('does NOT double-prefix /api when getApiUrl returns /api', async () => {
    vi.resetModules();
    vi.doMock('@/utils/api', () => ({
      getWorkflowsApiUrl: () => '',          // fall through to api proxy
      getApiUrl: () => '/api',                // production-style runtime config
      workflowEndpoint: (p: string) => `/api${p}`,
    }));
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ schemas: [], aiPromptFragment: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const api = await importApi();
    await api.fetchSchemas();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).not.toContain('/api/api/');
    expect(url).toBe('/api/workflows/internal/node-schemas');
    vi.doUnmock('@/utils/api');
  });

  test('network error — returns empty schemas and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const api = await importApi();
    const result = await api.fetchSchemas();

    expect(result.schemas).toHaveLength(0);
    expect(result.aiPromptFragment).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[nodeSchemasApi]'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  test('404 response — returns empty schemas and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    const api = await importApi();
    const result = await api.fetchSchemas();

    expect(result.schemas).toHaveLength(0);
    expect(result.aiPromptFragment).toBe('');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('500 response — returns empty schemas and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const api = await importApi();
    const result = await api.fetchSchemas();

    expect(result.schemas).toHaveLength(0);
    expect(result.aiPromptFragment).toBe('');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('empty registry — returns zero schemas, empty fragment', async () => {
    const payload = { schemas: [], aiPromptFragment: '' };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const api = await importApi();
    const result = await api.fetchSchemas();

    expect(result.schemas).toHaveLength(0);
    expect(result.aiPromptFragment).toBe('');
  });
});
