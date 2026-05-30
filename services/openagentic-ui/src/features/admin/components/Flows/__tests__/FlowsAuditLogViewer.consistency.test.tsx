/**
 * FlowsAuditLogViewer — chrome consistency tests (Bulk Batch D)
 *
 * Asserts the universal admin-page chrome: PageHeader at the top with
 * crumbs Admin / Flows / Audit Logs, the expected title, and no hex
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

// Mock the API service module — FlowsAuditLogViewer fetches via this layer.
const fetchAuditLogsMock = vi.fn(() =>
  Promise.resolve({ logs: [], total: 0, limit: 50 }),
);

vi.mock('../../../services/flowsAdminApi', () => ({
  fetchAuditLogs: (...args: unknown[]) => fetchAuditLogsMock(...(args as [])),
  exportAuditCsv: vi.fn(() => '/api/admin/flows/audit-logs.csv'),
}));

// Stub heavy shared components — chrome consistency only cares about the
// page header at top.
vi.mock('../../Shared/AdminFilterBar', () => ({
  AdminFilterBar: () => <div data-testid="stub-filter-bar" />,
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import { FlowsAuditLogViewer } from '../FlowsAuditLogViewer';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlowsAuditLogViewer — chrome consistency (Bulk Batch D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<FlowsAuditLogViewer theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Audit Logs/i', async () => {
    render(<FlowsAuditLogViewer theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Audit Logs/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<FlowsAuditLogViewer theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });

  it('renders log rows via the unified LogRow primitive', async () => {
    fetchAuditLogsMock.mockResolvedValueOnce({
      logs: [
        {
          id: 'a-1',
          timestamp: '2026-04-26T12:00:00Z',
          actor: 'admin@example.com',
          action: 'flow.deploy',
          target_type: 'workflow',
          target_id: 'wf-123',
          outcome: 'success',
          metadata: { duration: 1.2 },
        },
        {
          id: 'a-2',
          timestamp: '2026-04-26T12:01:00Z',
          actor: 'system',
          action: 'flow.run',
          target_type: 'workflow',
          target_id: 'wf-456',
          outcome: 'denied',
          metadata: { reason: 'rbac' },
        },
      ],
      total: 2,
      limit: 50,
    } as any);

    const { container } = render(<FlowsAuditLogViewer theme="dark" />);
    await waitFor(() => {
      const logRows = container.querySelectorAll('[data-severity]');
      expect(logRows.length).toBeGreaterThan(0);
    });
  });
});
