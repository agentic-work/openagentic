/**
 * AgentExecutionDashboard — chrome consistency tests (Bulk Batch D)
 *
 * Asserts the universal admin-page chrome: PageHeader at the top with the
 * expected title, and no hex literals leaking into inline style attributes
 * emitted by header chrome.
 *
 * Mirrors the three assertions from Pilot D. Recharts is stubbed because
 * jsdom can't render SVG / ResizeObserver. fetch is stubbed for the
 * stats / live / cost-report / metrics endpoints this dashboard polls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports that use them
// ---------------------------------------------------------------------------

// Stub recharts — jsdom can't render SVG / ResizeObserver, and the
// chrome-consistency test doesn't care about chart internals.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import { AgentExecutionDashboard } from '../AgentExecutionDashboard';

// ---------------------------------------------------------------------------
// Fetch fixtures
// ---------------------------------------------------------------------------

const STATS_FIXTURE = {
  activeAgents: 0,
  totalToday: 0,
  totalWeek: 0,
  successRate: 0,
  failedToday: 0,
  costTodayCents: 0,
  tokensToday: 0,
  avgLatencyMs: 0,
};

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('/admin/agents/executions/stats')) return mkResponse(STATS_FIXTURE);
  if (url.includes('/admin/agents/executions/live')) return mkResponse({ executions: [] });
  if (url.includes('/admin/agents/cost-report')) return mkResponse({ report: [] });
  if (url.includes('/admin/agents/metrics/timeseries')) return mkResponse({ timeSeries: [] });
  if (url.includes('/admin/agents/metrics/by-agent')) return mkResponse({ agents: [] });
  if (url.includes('/admin/agents/executions')) return mkResponse({ executions: [] });
  return mkResponse({});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentExecutionDashboard — chrome consistency (Bulk Batch D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<AgentExecutionDashboard theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Agent Executions/i', async () => {
    render(<AgentExecutionDashboard theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Agent Executions/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<AgentExecutionDashboard theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });

  it('renders execution log rows via the unified LogRow primitive', async () => {
    // Override fetch to return rows for the executions endpoint.
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/admin/agents/executions/stats')) return mkResponse(STATS_FIXTURE);
      if (url.includes('/admin/agents/executions/live')) {
        return mkResponse({
          executions: [
            {
              id: 'live-1',
              agent_specs: [{ role: 'planner', agentId: 'agent-1' }],
              orchestration: 'sequential',
              status: 'running',
              created_at: new Date().toISOString(),
              total_cost_cents: '0.50',
              tool_calls_count: 3,
              user_id: 'u-1',
            },
          ],
        });
      }
      if (url.includes('/admin/agents/cost-report')) return mkResponse({ report: [] });
      if (url.includes('/admin/agents/metrics/timeseries')) return mkResponse({ timeSeries: [] });
      if (url.includes('/admin/agents/metrics/by-agent')) return mkResponse({ agents: [] });
      if (url.includes('/admin/agents/executions')) {
        return mkResponse({
          executions: [
            {
              id: 'hist-1',
              agent_specs: [{ role: 'researcher', agentId: 'agent-2' }],
              orchestration: 'parallel',
              status: 'completed',
              total_duration_ms: 1500,
              total_cost_cents: '1.20',
              tool_calls_count: 5,
              total_tokens: 4321,
              created_at: '2026-04-26T12:00:00Z',
              user_id: 'u-1',
              results: [{ model: 'claude-sonnet-4-6' }],
            },
          ],
        });
      }
      return mkResponse({});
    }));

    const { container, getByText } = render(<AgentExecutionDashboard theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    // Switch to the Execution Logs sub-tab
    const logsBtn = getByText('Execution Logs');
    (logsBtn as HTMLButtonElement).click();

    await waitFor(() => {
      const logRows = container.querySelectorAll('[data-severity]');
      expect(logRows.length).toBeGreaterThan(0);
    });
  });
});
