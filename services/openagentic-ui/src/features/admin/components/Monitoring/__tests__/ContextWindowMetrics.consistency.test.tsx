/**
 * ContextWindowMetrics — chrome consistency tests (Archetype C, Bulk Batch C).
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

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Area: () => <div data-testid="area" />,
  Bar: () => <div data-testid="bar" />,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

vi.mock('../../../primitives-v2', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    BigChart: () => <div data-testid="chart-stub-bigchart" />,
    Sparkline: () => <div data-testid="chart-stub-sparkline" />,
    SparkArea: () => <div data-testid="chart-stub-sparkarea" />,
    StatCard: () => <div data-testid="chart-stub-statcard" />,
  };
});

vi.mock('../../Shared/AdminMetricCard', () => ({
  AdminMetricCard: ({ label }: any) => (
    <div data-testid={`metric-card-${String(label).replace(/\s+/g, '-').toLowerCase()}`} />
  ),
}));

vi.mock('../../Shared/AdminFilterBar', () => ({
  AdminFilterBar: () => <div data-testid="admin-filter-bar" />,
}));

import ContextWindowMetrics from '../ContextWindowMetrics';

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const STATS_FIXTURE = {
  averageUtilization: 0,
  maxUtilization: 0,
  totalSessions: 0,
  highUtilizationSessions: 0,
};

const COMPACTION_FIXTURE = {
  totalCompactions: 0,
  totalTokensFreed: 0,
  totalMessagesRemoved: 0,
  totalMessagesSummarized: 0,
  avgTokensFreedPerCompaction: 0,
  avgMessagesRemovedPerCompaction: 0,
  avgCompactionDurationMs: 0,
  failureRate: 0,
  byTrigger: { tokenLimit: 0, manual: 0, scheduled: 0 },
  byStrategy: { drop: 0, summarize: 0 },
  contextPressure: { healthy: 0, approachingLimit: 0, needsCompaction: 0 },
  timeline: [],
};

function setupApiMock() {
  mockApiRequest.mockImplementation((url: string) => {
    if (typeof url === 'string') {
      if (url.includes('/api/admin/context-metrics/compaction')) return mkResponse(COMPACTION_FIXTURE);
      if (url.includes('/api/admin/context-metrics')) return mkResponse({ sessions: [], statistics: STATS_FIXTURE });
    }
    return mkResponse({});
  });
}

describe('ContextWindowMetrics — chrome consistency (Bulk Batch C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<ContextWindowMetrics />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /context window/i', async () => {
    render(<ContextWindowMetrics />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/context window/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<ContextWindowMetrics />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
