/**
 * NetworkSecurityView — chrome consistency tests (Bulk Batch A)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const mockApiRequestJson = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: vi.fn(),
  apiRequestJson: (...args: unknown[]) => mockApiRequestJson(...args),
  apiEndpoint: (p: string) => p,
}));

import NetworkSecurityView from '../NetworkSecurityView';

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequestJson.mockImplementation((url: string) => {
    if (url.includes('/admin/network/status')) return Promise.resolve({ available: false, services: [] });
    if (url.includes('/admin/network/policies')) return Promise.resolve({ policies: [] });
    if (url.includes('/admin/network/protected')) return Promise.resolve({ connections: [] });
    if (url.includes('/admin/network/services')) return Promise.resolve({ services: [] });
    return Promise.resolve({});
  });
});

describe('NetworkSecurityView — chrome consistency', () => {
  it('renders the universal PageHeader primitive at the top', async () => {
    render(<NetworkSecurityView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Network Security/i', async () => {
    render(<NetworkSecurityView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Network Security/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<NetworkSecurityView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
