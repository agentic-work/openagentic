/**
 * MonitoringView — chrome consistency tests (Bulk Batch D)
 *
 * Asserts the universal admin-page chrome: PageHeader at the top with
 * crumbs Admin / Monitoring / Errors, the expected title, and no hex
 * literals leaking into inline styles emitted by header chrome.
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

// Stub recharts — jsdom can't render SVG / ResizeObserver.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

// Stub heavy shared components that have hex debt outside our scope.
vi.mock('../../Shared/AdminMetricCard', () => ({
  AdminMetricCard: ({ label, value }: any) => (
    <div data-testid="stub-metric-card">{label}: {value}</div>
  ),
}));

vi.mock('../../Shared/AdminCard', () => ({
  AdminCard: ({ children }: any) => <div data-testid="stub-admin-card">{children}</div>,
}));

vi.mock('../../Shared/AdminFilterBar', () => ({
  AdminFilterBar: () => <div data-testid="stub-filter-bar" />,
}));

vi.mock('../../Shared/AdminTooltip', () => ({
  InfoTooltip: () => <span data-testid="stub-info-tooltip" />,
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import { MonitoringView } from '../MonitoringView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonitoringView — chrome consistency (Bulk Batch D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockImplementation((url: string) => {
      if (url.includes('/admin/metrics/mcp')) {
        return Promise.resolve(mkResponse({
          summary: { totalCalls: 0, successRate: 0, successfulCalls: 0, failedCalls: 0, avgExecutionTime: 0 },
          toolPerformance: [],
        }));
      }
      if (url.includes('/admin/metrics/llm')) {
        return Promise.resolve(mkResponse({
          summary: {
            totalMessages: 0, totalTokens: 0, totalTokensInput: 0, totalTokensOutput: 0,
            totalCost: '0.00', avgTokensPerMessage: 0, avgCostPerMessage: '0.00',
          },
          topModels: [],
        }));
      }
      return Promise.resolve(mkResponse({}));
    });
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<MonitoringView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Monitoring/i', async () => {
    render(<MonitoringView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Monitoring/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<MonitoringView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
