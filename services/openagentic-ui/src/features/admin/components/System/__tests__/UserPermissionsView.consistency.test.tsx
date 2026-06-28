/**
 * UserPermissionsView — chrome consistency tests (Bulk Batch B1)
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

vi.mock('@/shared/hooks/useConfirm', () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

vi.mock('../../../../../app/providers/AuthContext', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
  }),
}));

import UserPermissionsView from '../UserPermissionsView';

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
    if (typeof url === 'string' && url.includes('/admin/user-management')) {
      return mkResponse({ users: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/permissions/available-llms')) {
      return mkResponse({ providers: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/permissions/available-mcps')) {
      return mkResponse({ servers: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/prompts/templates')) {
      return mkResponse({ templates: [] });
    }
    return mkResponse({});
  });
}

describe('UserPermissionsView — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<UserPermissionsView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Permissions|Users/i', async () => {
    render(<UserPermissionsView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Permissions|Users/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<UserPermissionsView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
