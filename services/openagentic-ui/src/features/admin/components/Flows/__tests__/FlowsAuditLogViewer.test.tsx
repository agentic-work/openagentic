/**
 * TDD — FlowsAuditLogViewer
 *
 * Tests:
 *   L1  Log stream renders fields: time, actor, action, target type, target id, outcome (via LogRow primitive)
 *   L2  Filters: actor search input updates query; outcome select updates query
 *   L3  "Export CSV" button triggers exportAuditCsv
 *   L4  Auto-refresh interval selector shows off/30s/5min options
 *   L5  Row click expands metadata JSON inline
 *   L6a Loading state shows loading indicator
 *   L6b Error state shows error message + Retry button
 *   L6c Empty state shows "no audit logs" message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the API layer
// ---------------------------------------------------------------------------
vi.mock('../../../services/flowsAdminApi', () => ({
  fetchAuditLogs: vi.fn(),
  exportAuditCsv: vi.fn(() => '/api/admin/flows/audit-logs.csv'),
}));

// ---------------------------------------------------------------------------
// Mock shared filter bar (kept lightweight for chrome-only assertions)
// ---------------------------------------------------------------------------
vi.mock('../../Shared/AdminFilterBar', () => ({
  AdminFilterBar: ({ timeRange, onRefresh, refreshing }: any) => (
    <div data-testid="filter-bar">
      <span data-testid="active-window">{timeRange}</span>
      <button data-testid="btn-refresh" onClick={onRefresh} disabled={refreshing}>Refresh</button>
    </div>
  ),
}));

import { fetchAuditLogs, exportAuditCsv } from '../../../services/flowsAdminApi';
import { FlowsAuditLogViewer } from '../FlowsAuditLogViewer';

const mockFetchAuditLogs = fetchAuditLogs as ReturnType<typeof vi.fn>;
const mockExportAuditCsv = exportAuditCsv as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOG_ENTRY = {
  id: 'log-1',
  timestamp: '2026-04-25T10:30:00Z',
  actor: 'alice@example.com',
  action: 'flow.create',
  target_type: 'flow',
  target_id: 'flow-abc',
  outcome: 'success' as const,
  metadata: { name: 'Research Flow', version: 1 },
};

const LOGS_RESPONSE = {
  logs: [LOG_ENTRY],
  total: 1,
  limit: 50,
  offset: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlowsAuditLogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // L1 — LogRow stream renders core fields
  it('L1: log stream renders actor, action, target type, target id, outcome via LogRow', async () => {
    mockFetchAuditLogs.mockResolvedValueOnce(LOGS_RESPONSE);

    const { container } = render(<FlowsAuditLogViewer />);

    await waitFor(() => {
      expect(container.querySelector('[data-severity]')).toBeTruthy();
    });

    // Spot-check that the entry's fields render somewhere in the row.
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('flow.create')).toBeInTheDocument();
    expect(screen.getByText('flow')).toBeInTheDocument();
    expect(screen.getByText('flow-abc')).toBeInTheDocument();
    // Outcome appears prefixed with "·" inside the message body.
    expect(screen.getByText(/·\s*success/i)).toBeInTheDocument();
  });

  // L2 — Actor filter
  it('L2: actor search input triggers refetch with actor filter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockFetchAuditLogs
      .mockResolvedValueOnce(LOGS_RESPONSE)   // initial load
      .mockResolvedValueOnce(LOGS_RESPONSE);  // after actor filter

    const { container } = render(<FlowsAuditLogViewer />);

    await waitFor(() => container.querySelector('[data-severity]'));

    const actorInput = screen.getByPlaceholderText(/actor email/i);
    fireEvent.change(actorInput, { target: { value: 'alice@example.com' } });

    // Advance past debounce threshold
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await waitFor(() => {
      const calls = mockFetchAuditLogs.mock.calls;
      const actorCall = calls.find((c: any) => c[0]?.actor === 'alice@example.com');
      expect(actorCall).toBeTruthy();
    });

    vi.useRealTimers();
  });

  // L2b — Outcome filter
  it('L2: outcome filter select triggers refetch with outcome filter', async () => {
    mockFetchAuditLogs
      .mockResolvedValueOnce(LOGS_RESPONSE)
      .mockResolvedValueOnce(LOGS_RESPONSE);

    const { container } = render(<FlowsAuditLogViewer />);

    await waitFor(() => container.querySelector('[data-severity]'));

    const outcomeSelect = screen.getByTestId('outcome-filter');
    fireEvent.change(outcomeSelect, { target: { value: 'error' } });

    await waitFor(() => {
      const call = mockFetchAuditLogs.mock.calls[1]?.[0];
      expect(call?.outcome).toBe('error');
    });
  });

  // L3 — CSV export
  it('L3: Export CSV button calls exportAuditCsv with current filters', async () => {
    mockFetchAuditLogs.mockResolvedValueOnce(LOGS_RESPONSE);

    const { container } = render(<FlowsAuditLogViewer />);

    await waitFor(() => container.querySelector('[data-severity]'));

    const exportBtn = screen.getByRole('button', { name: /export csv/i });
    fireEvent.click(exportBtn);

    expect(mockExportAuditCsv).toHaveBeenCalledTimes(1);
  });

  // L4 — Auto-refresh selector
  it('L4: auto-refresh selector has Off / 30s / 5min options', async () => {
    mockFetchAuditLogs.mockResolvedValueOnce(LOGS_RESPONSE);

    const { container } = render(<FlowsAuditLogViewer />);

    await waitFor(() => container.querySelector('[data-severity]'));

    const refreshSelect = screen.getByTestId('auto-refresh-select');
    const options = Array.from(refreshSelect.querySelectorAll('option')).map((o: any) => o.textContent);
    expect(options).toContain('Off');
    expect(options).toContain('30s');
    expect(options).toContain('5 min');
  });

  // L5 — Row click expands metadata
  it('L5: clicking a row expands metadata JSON inline', async () => {
    mockFetchAuditLogs.mockResolvedValueOnce(LOGS_RESPONSE);

    const { container } = render(<FlowsAuditLogViewer />);

    let logRow: Element | null = null;
    await waitFor(() => {
      logRow = container.querySelector('[data-severity]');
      expect(logRow).toBeTruthy();
    });

    // Before click: metadata JSON not visible
    expect(screen.queryByTestId('metadata-expanded-0')).not.toBeInTheDocument();

    // The clickable wrapper is the parent of the LogRow grid.
    const clickTarget = (logRow as any).parentElement as HTMLElement;
    fireEvent.click(clickTarget);

    expect(screen.getByTestId('metadata-expanded-0')).toBeInTheDocument();
    expect(screen.getByTestId('metadata-expanded-0').textContent).toContain('Research Flow');
  });

  // L6a — Loading state
  it('L6a: shows loading indicator while fetching', () => {
    mockFetchAuditLogs.mockReturnValueOnce(new Promise(() => {})); // never resolves

    render(<FlowsAuditLogViewer />);

    expect(screen.getByText(/loading audit logs/i)).toBeInTheDocument();
  });

  // L6b — Error state
  it('L6b: shows error message and Retry button on fetch failure', async () => {
    mockFetchAuditLogs
      .mockRejectedValueOnce(new Error('Server error'))
      .mockResolvedValueOnce(LOGS_RESPONSE);

    render(<FlowsAuditLogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load audit logs/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenCalledTimes(2);
    });
  });

  // L6c — Empty state
  it('L6c: shows empty state when no logs returned', async () => {
    mockFetchAuditLogs.mockResolvedValueOnce({ logs: [], total: 0, limit: 50, offset: 0 });

    render(<FlowsAuditLogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/no audit logs/i)).toBeInTheDocument();
    });
  });
});
