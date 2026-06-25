/**
 * TokenManagementView — chrome consistency tests (Archetype B · Resource list)
 *
 * Mirrors Pilot B / Bulk Batch A consistency assertions: page-header primitive
 * present, H1 matches the page title, no hex literals leaking into inline
 * styles emitted by the chrome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports that use them
// ---------------------------------------------------------------------------

const mockApiRequest = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestJson: vi.fn(),
  apiEndpoint: (p: string) => p,
}));

vi.mock('@/shared/hooks/useConfirm', () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

// SlideInPanel uses framer-motion + portal — stub so jsdom doesn't choke on
// the create-form drawer and so the consistency assertions stay focused on
// the page chrome itself, not the panel internals.
vi.mock('@/shared/components/SlideInPanel', () => ({
  SlideInPanel: ({ isOpen, children }: any) =>
    isOpen ? <div data-testid="stub-slide-in-panel">{children}</div> : null,
  SlideInPanelFooter: ({ children }: any) => <div>{children}</div>,
  SlideInPanelSection: ({ children }: any) => <div>{children}</div>,
  SlideInPanelField: ({ children }: any) => <div>{children}</div>,
  default: ({ isOpen, children }: any) =>
    isOpen ? <div data-testid="stub-slide-in-panel">{children}</div> : null,
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import TokenManagementView from '../TokenManagementView';

// ---------------------------------------------------------------------------
// Fixtures — match the real backend response shapes from
// services/openagentic-api/src/routes/admin-api-tokens.ts
// ---------------------------------------------------------------------------

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
    if (typeof url === 'string' && url.includes('/admin/tokens/users/available')) {
      return mkResponse({ success: true, users: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/tokens/metrics')) {
      return mkResponse({ success: true, overall: {}, tokens: [] });
    }
    if (typeof url === 'string' && url.includes('/admin/tokens')) {
      return mkResponse({ success: true, tokens: [], count: 0 });
    }
    return mkResponse({});
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenManagementView — chrome consistency (Archetype B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<TokenManagementView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /API Token Management/i', async () => {
    render(<TokenManagementView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/API Token Management/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<TokenManagementView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
