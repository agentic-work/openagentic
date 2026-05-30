/**
 * ClusterHealthView — chrome consistency tests (Archetype C · Metrics dashboard)
 *
 * Asserts that the new cluster-health admin page conforms to the universal
 * admin-page chrome by rendering <PageHeader> at the top, with the expected
 * title, and without any hex literals leaking into inline styles.
 *
 * Mirrors the assertion shape used by MCPKubernetesView.consistency.test.tsx.
 * The view talks to the admin prom proxy via the useProm hook
 * (services/.../hooks/useProm.ts), which itself uses raw `fetch`. We stub
 * global fetch so every prom query returns an empty `result` array. That
 * exercises the EmptyState/loading paths AND keeps the chrome assertions
 * stable across happy-path/empty-data renders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Fetch mock — every /api/admin/prom/* POST returns a successful empty result.
// ---------------------------------------------------------------------------

function mkPromResponse(result: unknown[] = []) {
  return Promise.resolve(
    new Response(
      JSON.stringify({ status: 'success', data: { resultType: 'vector', result } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
}

function setupFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/admin/prom/')) {
      return mkPromResponse([]);
    }
    return mkPromResponse([]);
  });
  // @ts-expect-error - test override
  global.fetch = fetchMock;
  return fetchMock;
}

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import ClusterHealthView from '../ClusterHealthView';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClusterHealthView — chrome consistency (Archetype C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(wrap(<ClusterHealthView />));
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Cluster Health/i', async () => {
    render(wrap(<ClusterHealthView />));
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Cluster Health/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(wrap(<ClusterHealthView />));
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap((m) => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map((m) => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
