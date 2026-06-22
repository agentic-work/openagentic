/**
 * RouterTuningView — chrome consistency tests (Bulk Batch A)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const mockApiRequest = vi.fn();
const mockApiRequestJson = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestJson: (...args: unknown[]) => mockApiRequestJson(...args),
  apiEndpoint: (p: string) => p,
}));

import RouterTuningView from '../RouterTuningView';
import { AdminQueryProvider } from '../../../hooks/useAdminQuery';

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequest.mockImplementation(() => mkResponse({}));
  mockApiRequestJson.mockImplementation((endpoint: string) => {
    if (typeof endpoint === 'string' && endpoint.includes('/llm-providers/registry')) {
      return Promise.resolve([]);
    }
    return Promise.resolve({});
  });
});

describe('RouterTuningView — chrome consistency', () => {
  it('renders the universal PageHeader primitive at the top', async () => {
    render(
      <AdminQueryProvider>
        <RouterTuningView />
      </AdminQueryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Router|Smart Router/i', async () => {
    render(
      <AdminQueryProvider>
        <RouterTuningView />
      </AdminQueryProvider>,
    );
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Router|Smart Router/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(
      <AdminQueryProvider>
        <RouterTuningView />
      </AdminQueryProvider>,
    );
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
