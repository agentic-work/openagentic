/**
 * SystemSettingsView — chrome consistency tests (Bulk Batch A)
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

vi.mock('../../../../../app/providers/AuthContext', () => ({
  useAuth: () => ({
    getAccessToken: () => Promise.resolve('test-token'),
    getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
    user: null,
  }),
}));

import SystemSettingsView from '../SystemSettingsView';

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
  mockApiRequest.mockImplementation(() => mkResponse({ settings: {} }));
});

describe('SystemSettingsView — chrome consistency', () => {
  it('renders the universal PageHeader primitive at the top', async () => {
    render(<SystemSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /System Settings/i', async () => {
    render(<SystemSettingsView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/System Settings/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<SystemSettingsView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
