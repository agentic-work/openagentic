/**
 * CodeModeMcpView — chrome consistency tests (Bulk Batch B1)
 *
 * Asserts the universal admin-page chrome: PageHeader at top, H1 title,
 * and no hex literals in inline styles.
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

import CodeModeMcpView from '../CodeModeMcpView';

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
    if (typeof url === 'string' && url.includes('/admin/codemode/mcp-servers')) {
      return mkResponse({
        servers: [],
        policy: { allowManagedMcpServersOnly: false, allowlist: [], blocklist: [] },
      });
    }
    return mkResponse({});
  });
}

describe('CodeModeMcpView — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<CodeModeMcpView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /MCP|Code Mode/i', async () => {
    render(<CodeModeMcpView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/MCP|Code Mode/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<CodeModeMcpView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
