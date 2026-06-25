/**
 * FlowsKpiDashboard — chrome consistency tests (Archetype C, Bulk Batch C).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../../services/flowsAdminApi', () => ({
  fetchKpis: vi.fn().mockResolvedValue({
    total_executions: 0,
    success_rate: 0,
    avg_cost_per_execution_usd: 0,
    latency_p95_ms: 0,
    delta: {},
    executions_over_time: [],
    cost_over_time: [],
    time_labels: [],
    top_failing_nodes: [],
    top_expensive_flows: [],
  }),
}));

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

import FlowsKpiDashboard from '../FlowsKpiDashboard';

describe('FlowsKpiDashboard — chrome consistency (Bulk Batch C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<FlowsKpiDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /flows|kpi/i', async () => {
    render(<FlowsKpiDashboard />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/flows|kpi/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<FlowsKpiDashboard />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
