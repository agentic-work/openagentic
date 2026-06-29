/**
 * OllamaManagementView — chrome consistency tests (Bulk Batch B1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const mockApiRequest = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestJson: vi.fn(),
  apiEndpoint: (p: string) => p,
}));

import { OllamaManagementView } from '../OllamaManagementView';

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function setupApiMock() {
  mockApiRequest.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/admin/ollama/hosts')) {
      return mkResponse({ success: true, hosts: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/ollama/models')) {
      return mkResponse({ success: true, models: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/ollama/running')) {
      return mkResponse({ success: true, models: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/ollama/sync/status')) {
      return mkResponse({ success: true, results: [] });
    }
    return mkResponse({ success: true });
  });
}

describe('OllamaManagementView — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<OllamaManagementView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Ollama/i', async () => {
    render(<OllamaManagementView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Ollama/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<OllamaManagementView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
