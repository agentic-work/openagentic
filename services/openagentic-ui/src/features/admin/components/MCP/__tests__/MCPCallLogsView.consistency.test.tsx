/**
 * MCPCallLogsView — chrome consistency tests (Pilot Task D)
 *
 * Asserts that this Archetype D (Log / audit stream) page conforms to the
 * universal admin-page chrome by rendering the new <PageHeader> primitive
 * at the top, with the expected title, and without any hex literals
 * leaking into inline styles emitted by PageHeader/header chrome.
 *
 * Mirrors the three assertions from Pilots A and B — same shape will run
 * on every Archetype D migration. Pilot D scope is the page-level chrome
 * only; per-row migration to <LogRow> is bulk-scope and intentionally not
 * exercised here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports that use them
// ---------------------------------------------------------------------------

// MCPCallLogsView uses raw fetch + useAuth().getAuthHeaders() rather than
// the apiRequest helper. Mock useAuth so the component can mount, and stub
// global fetch for /api/admin/mcp-logs and /api/admin/mcp-logs/stats.
vi.mock('../../../../../app/providers/AuthContext', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
  }),
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import { MCPCallLogsView } from '../MCPCallLogsView';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATS_FIXTURE = {
  totalCalls: 0,
  recentCalls24h: 0,
  successfulCalls: 0,
  failedCalls: 0,
  successRate: '0',
  avgExecutionTime: 0,
  topTools: [],
  topServers: [],
  topUsers: [],
};

const LOGS_FIXTURE = {
  logs: [],
  pagination: { totalPages: 1, page: 1, limit: 50 },
};

const LOGS_FIXTURE_WITH_ROWS = {
  logs: [
    {
      id: 'log-1',
      toolName: 'list_tools',
      serverId: 'openagentic-kubernetes',
      method: 'tools/list',
      userId: 'u-1',
      userName: 'Alice Admin',
      userEmail: 'alice@example.com',
      status: 'success',
      executionTime: 120,
      requestSize: 256,
      responseSize: 1024,
      input: { foo: 'bar' },
      output: { ok: true },
      timestamp: '2026-04-26T12:00:00Z',
      modelUsed: 'claude-sonnet-4-6',
      modelProvider: 'vertex-ai',
    },
    {
      id: 'log-2',
      toolName: 'kubectl_get',
      serverId: 'openagentic-kubernetes',
      method: 'tools/call',
      status: 'error',
      executionTime: 300,
      input: {},
      error: 'Connection refused',
      timestamp: '2026-04-26T12:01:00Z',
    },
  ],
  pagination: { totalPages: 1, page: 1, limit: 50 },
};

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function setupFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/admin/mcp-logs/stats')) {
      return mkResponse(STATS_FIXTURE);
    }
    if (url.includes('/admin/mcp-logs')) {
      return mkResponse(LOGS_FIXTURE);
    }
    return mkResponse({});
  });
  // @ts-expect-error - test override
  global.fetch = fetchMock;
  return fetchMock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPCallLogsView — chrome consistency (Pilot D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<MCPCallLogsView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Call Logs/i', async () => {
    render(<MCPCallLogsView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Call Logs/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<MCPCallLogsView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });

  it('renders log rows via the unified LogRow primitive', async () => {
    // Override fetch to return rows.
    const fetchWithRows = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/admin/mcp-logs/stats')) return mkResponse(STATS_FIXTURE);
      if (url.includes('/admin/mcp-logs')) return mkResponse(LOGS_FIXTURE_WITH_ROWS);
      return mkResponse({});
    });
    // @ts-expect-error - test override
    global.fetch = fetchWithRows;

    const { container } = render(<MCPCallLogsView theme="dark" />);
    await waitFor(() => {
      const logRows = container.querySelectorAll('[data-severity]');
      expect(logRows.length).toBeGreaterThan(0);
    });
  });
});
