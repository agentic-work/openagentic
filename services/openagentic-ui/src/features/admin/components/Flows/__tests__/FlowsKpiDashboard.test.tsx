/**
 * TDD — FlowsKpiDashboard
 *
 * Tests:
 *   K1  Summary tiles render Total Executions, Success Rate, Avg Cost, p95 Latency
 *   K2  Time-window selector: clicking 7d changes active pill
 *   K3  Line chart for executions over time is present
 *   K4  Line chart for cost over time is present
 *   K5  Bar chart for top failing nodes is present
 *   K6  Bar chart for top expensive flows is present
 *   K7  Clicking a flow row triggers onFlowSelect callback
 *   K8  Loading state renders skeleton placeholders
 *   K9  Error state shows friendly message and Retry button that re-fetches
 *  K10  Empty state shown when total_executions === 0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the API layer
// ---------------------------------------------------------------------------
vi.mock('../../../services/flowsAdminApi', () => ({
  fetchKpis: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock recharts — jsdom can't render SVG properly
// ---------------------------------------------------------------------------
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  Area: () => <div data-testid="area" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

// ---------------------------------------------------------------------------
// Mock shared components
// ---------------------------------------------------------------------------
vi.mock('../../Shared/AdminMetricCard', () => ({
  AdminMetricCard: ({ label, value, loading, trend }: any) => (
    <div data-testid={`metric-card-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      {loading ? <span data-testid="metric-loading">loading</span> : <span>{value}</span>}
      {trend && <span data-testid="metric-trend">{trend.direction}</span>}
    </div>
  ),
}));

vi.mock('../../Shared/AdminFilterBar', () => ({
  AdminFilterBar: ({ timeRange, onTimeRangeChange, onRefresh, refreshing }: any) => (
    <div data-testid="filter-bar">
      <span data-testid="active-window">{timeRange}</span>
      <button data-testid="btn-7d" onClick={() => onTimeRangeChange('7d')}>7d</button>
      <button data-testid="btn-refresh" onClick={onRefresh} disabled={refreshing}>Refresh</button>
    </div>
  ),
}));

import { fetchKpis } from '../../../services/flowsAdminApi';
import { FlowsKpiDashboard } from '../FlowsKpiDashboard';

const mockFetchKpis = fetchKpis as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KPI_FIXTURE = {
  window: '24h',
  total_executions: 5000,
  success_rate: 96.4,
  latency_p50_ms: 110,
  latency_p95_ms: 480,
  latency_p99_ms: 1100,
  total_cost_usd: 12.5,
  avg_cost_per_execution_usd: 0.0025,
  top_failing_nodes: [
    { nodeId: 'n1', nodeType: 'LLM', failureCount: 42 },
    { nodeId: 'n2', nodeType: 'HTTP', failureCount: 18 },
  ],
  top_expensive_flows: [
    { flowId: 'f1', flowName: 'Research Flow', totalCostUsd: 5.21 },
    { flowId: 'f2', flowName: 'Summarizer', totalCostUsd: 3.0 },
  ],
  executions_over_time: [100, 150, 200, 180],
  cost_over_time: [0.5, 0.75, 1.0, 0.9],
  time_labels: ['00:00', '06:00', '12:00', '18:00'],
  delta: {
    total_executions: 12,
    success_rate: -2,
    avg_cost_per_execution_usd: 5,
    latency_p95_ms: -8,
  },
};

const EMPTY_KPI_FIXTURE = {
  ...KPI_FIXTURE,
  total_executions: 0,
  success_rate: 0,
  top_failing_nodes: [],
  top_expensive_flows: [],
  executions_over_time: [],
  cost_over_time: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlowsKpiDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // K1 — Summary tiles
  it('K1: renders summary metric tiles with values from API', async () => {
    mockFetchKpis.mockResolvedValueOnce(KPI_FIXTURE);

    render(<FlowsKpiDashboard />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('metric-card-total-executions')).toBeInTheDocument();
    });

    expect(screen.getByTestId('metric-card-success-rate-%')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-avg-cost/exec-(usd)')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-p95-latency-(ms)')).toBeInTheDocument();
  });

  // K2 — Time-window selector
  it('K2: clicking 7d pill calls fetchKpis with window=7d', async () => {
    mockFetchKpis
      .mockResolvedValueOnce(KPI_FIXTURE)   // initial 24h load
      .mockResolvedValueOnce(KPI_FIXTURE);  // after selecting 7d

    const { unmount } = render(<FlowsKpiDashboard />);

    await waitFor(() => screen.getByTestId('filter-bar'));

    fireEvent.click(screen.getByTestId('btn-7d'));

    await waitFor(() => {
      expect(mockFetchKpis).toHaveBeenCalledWith('7d');
    });

    // Wait for second fetch to settle, then unmount cleanly
    await waitFor(() => expect(mockFetchKpis).toHaveBeenCalledTimes(2));
    unmount();
  });

  // K3 — Executions line chart
  it('K3: renders an area chart for executions over time', async () => {
    mockFetchKpis.mockResolvedValueOnce(KPI_FIXTURE);

    render(<FlowsKpiDashboard />);

    await waitFor(() => {
      const charts = screen.getAllByTestId('area-chart');
      expect(charts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // K4 — Cost line chart
  it('K4: renders a second area chart for cost over time', async () => {
    mockFetchKpis.mockResolvedValueOnce(KPI_FIXTURE);

    render(<FlowsKpiDashboard />);

    await waitFor(() => {
      const charts = screen.getAllByTestId('area-chart');
      expect(charts.length).toBeGreaterThanOrEqual(2);
    });
  });

  // K5 — Top failing nodes bar chart
  it('K5: renders a bar chart for top failing nodes', async () => {
    mockFetchKpis.mockResolvedValueOnce(KPI_FIXTURE);

    render(<FlowsKpiDashboard />);

    await waitFor(() => {
      expect(screen.getAllByTestId('bar-chart').length).toBeGreaterThanOrEqual(1);
    });
  });

  // K6 — Top expensive flows bar chart
  it('K6: renders a bar chart for top expensive flows', async () => {
    mockFetchKpis.mockResolvedValueOnce(KPI_FIXTURE);

    render(<FlowsKpiDashboard />);

    await waitFor(() => {
      expect(screen.getAllByTestId('bar-chart').length).toBeGreaterThanOrEqual(2);
    });
  });

  // K7 — Flow row click
  it('K7: clicking an expensive flow row calls onFlowSelect with flowId', async () => {
    mockFetchKpis.mockResolvedValueOnce(KPI_FIXTURE);
    const onFlowSelect = vi.fn();

    render(<FlowsKpiDashboard onFlowSelect={onFlowSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Research Flow')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Research Flow'));

    expect(onFlowSelect).toHaveBeenCalledWith('f1');
  });

  // K8 — Loading state
  it('K8: shows skeleton metric tiles while fetching', () => {
    // Never resolves — stays loading
    mockFetchKpis.mockReturnValueOnce(new Promise(() => {}));

    render(<FlowsKpiDashboard />);

    // In loading state, AdminMetricCard gets loading=true
    const skeletons = screen.getAllByTestId('metric-loading');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
  });

  // K9 — Error state + Retry
  it('K9: shows error message and Retry button that refetches on click', async () => {
    mockFetchKpis
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(KPI_FIXTURE);

    render(<FlowsKpiDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockFetchKpis).toHaveBeenCalledTimes(2);
    });
  });

  // K10 — Empty state
  it('K10: shows empty-state message when total_executions is 0', async () => {
    mockFetchKpis.mockResolvedValueOnce(EMPTY_KPI_FIXTURE);

    render(<FlowsKpiDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/no executions in the last/i)).toBeInTheDocument();
    });
  });
});
