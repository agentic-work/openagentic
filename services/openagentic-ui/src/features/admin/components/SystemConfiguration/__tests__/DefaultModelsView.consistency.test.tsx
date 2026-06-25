/**
 * DefaultModelsView — chrome consistency tests (Bulk Batch A)
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

import DefaultModelsView from '../DefaultModelsView';
import { AdminQueryProvider } from '../../../hooks/useAdminQuery';

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequest.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  mockApiRequestJson.mockImplementation((endpoint: string) => {
    if (typeof endpoint === 'string' && endpoint.includes('/llm-providers/registry')) {
      return Promise.resolve([]);
    }
    if (typeof endpoint === 'string' && endpoint.includes('/system-configuration/default-models')) {
      return Promise.resolve({
        defaults: { chat: '', code: '', embedding: '', vision: '', imageGeneration: '' },
      });
    }
    if (typeof endpoint === 'string' && endpoint.includes('/router-tuning')) {
      return Promise.resolve({ tuning: {} });
    }
    return Promise.resolve({});
  });
});

describe('DefaultModelsView — chrome consistency', () => {
  it('renders the universal PageHeader primitive at the top', async () => {
    render(
      <AdminQueryProvider>
        <DefaultModelsView />
      </AdminQueryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Default Models|Tenant Default/i', async () => {
    render(
      <AdminQueryProvider>
        <DefaultModelsView />
      </AdminQueryProvider>,
    );
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Default Models|Tenant Default/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(
      <AdminQueryProvider>
        <DefaultModelsView />
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
