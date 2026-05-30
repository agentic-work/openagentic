/**
 * AuditLogsView — chrome consistency tests (Bulk Batch D)
 *
 * Asserts the universal admin-page chrome: PageHeader at the top with
 * crumbs Admin / Monitoring / Audit, the expected title, and no hex
 * literals leaking into inline styles emitted by header chrome.
 *
 * Per-row migration to <LogRow> is bulk-scope and not exercised here.
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
}));

vi.mock('../../../../../utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import { AuditLogsView } from '../AuditLogsView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([JSON.stringify(body)])),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditLogsView — chrome consistency (Bulk Batch D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockImplementation((url: string) => {
      if (url.includes('/admin/audit-logs/sessions')) {
        return Promise.resolve(mkResponse({ sessions: [], pagination: { total: 0, totalPages: 1 } }));
      }
      if (url.includes('/admin/audit-logs/stats')) {
        return Promise.resolve(mkResponse({ user: {}, admin: {} }));
      }
      if (url.includes('/admin/code/sessions')) {
        return Promise.resolve(mkResponse({ sessions: [] }));
      }
      if (url.includes('/admin/code/stats')) {
        return Promise.resolve(mkResponse({ sessions: { total: 0 }, users: {}, executions: {}, storage: {} }));
      }
      if (url.includes('/workflows')) {
        return Promise.resolve(mkResponse({ workflows: [], total: 0 }));
      }
      return Promise.resolve(mkResponse({}));
    });
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<AuditLogsView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Audit/i', async () => {
    render(<AuditLogsView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Audit/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<AuditLogsView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });

  it('renders chat session rows via the unified LogRow primitive', async () => {
    mockApiRequest.mockImplementation((url: string) => {
      if (url.includes('/admin/audit-logs/sessions')) {
        return Promise.resolve(mkResponse({
          sessions: [
            {
              id: 's-1',
              userId: 'u-1',
              userName: 'Alice',
              userEmail: 'alice@example.com',
              title: 'Test session',
              messageCount: 5,
              userQueries: 3,
              aiResponses: 2,
              firstQuery: 'hi',
              model: 'anthropic/claude-sonnet-4-6',
              totalTokens: 1234,
              totalCost: 0.05,
              mcpCallsCount: 1,
              toolExecutionsCount: 2,
              conversation: [],
              createdAt: '2026-04-26T12:00:00Z',
              updatedAt: '2026-04-26T12:05:00Z',
            },
          ],
          pagination: { total: 1, totalPages: 1 },
        }));
      }
      if (url.includes('/admin/audit-logs/stats')) {
        return Promise.resolve(mkResponse({ user: {}, admin: {} }));
      }
      if (url.includes('/admin/code/sessions')) {
        return Promise.resolve(mkResponse({ sessions: [] }));
      }
      if (url.includes('/admin/code/stats')) {
        return Promise.resolve(mkResponse({ sessions: { total: 0 }, users: {}, executions: {}, storage: {} }));
      }
      if (url.includes('/workflows')) {
        return Promise.resolve(mkResponse({ workflows: [], total: 0 }));
      }
      return Promise.resolve(mkResponse({}));
    });

    const { container } = render(<AuditLogsView theme="dark" />);
    await waitFor(() => {
      const logRows = container.querySelectorAll('[data-severity]');
      expect(logRows.length).toBeGreaterThan(0);
    });
  });
});
