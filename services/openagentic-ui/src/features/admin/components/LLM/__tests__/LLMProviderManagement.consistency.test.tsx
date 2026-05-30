/**
 * LLMProviderManagement — chrome consistency tests (Bulk Batch B1)
 *
 * Asserts the universal admin-page chrome on the routed entry: PageHeader
 * at top, H1 title, and no hex literals in inline styles. The decomposed
 * implementation under LLMProviderManagement/ is stubbed — this test
 * validates the routed wrapper, not the inner CRUD surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../LLMProviderManagement/index', () => ({
  LLMProviderManagement: () => <div data-testid="stub-llm-provider-inner" />,
  default: () => <div data-testid="stub-llm-provider-inner" />,
}));

import { LLMProviderManagement } from '../LLMProviderManagement';

describe('LLMProviderManagement — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<LLMProviderManagement theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Providers?/i', async () => {
    render(<LLMProviderManagement theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Providers?/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<LLMProviderManagement theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
