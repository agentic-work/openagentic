/**
 * SynthManagementView — chrome consistency tests (Bulk Batch A)
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

import { SynthManagementView } from '../SynthManagementView';

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
  mockApiRequest.mockImplementation((url: string) => {
    if (url.includes('/admin/synth/config')) return mkResponse({ config: { enabled: false, visibleToLLM: true } });
    if (url.includes('/admin/synth/capabilities')) return mkResponse({ capabilities: [] });
    if (url.includes('/admin/synth/stats')) return mkResponse({ stats: {} });
    return mkResponse({ models: [] });
  });
});

describe('SynthManagementView — chrome consistency', () => {
  it('renders the universal PageHeader primitive at the top', async () => {
    render(<SynthManagementView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Synth|Tool Synthesis/i', async () => {
    render(<SynthManagementView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Synth|Tool Synthesis/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<SynthManagementView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
