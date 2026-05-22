/**
 * SharedKBView — chrome consistency tests (Bulk Batch B2)
 *
 * Asserts the universal admin-page chrome: PageHeader at top, H1 title,
 * and no hex literals in inline styles.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { SharedKBView } from '../SharedKBView';

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const fetchMock = vi.fn((url: string | URL) => {
  const u = typeof url === 'string' ? url : url.toString();
  if (u.includes('/api/admin/shared-kb/sources')) return mkResponse({ sources: [] });
  if (u.includes('/api/admin/shared-kb')) return mkResponse({});
  return mkResponse({});
});

describe('SharedKBView — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<SharedKBView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Knowledge|Shared/i', async () => {
    render(<SharedKBView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Knowledge|Shared/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<SharedKBView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
