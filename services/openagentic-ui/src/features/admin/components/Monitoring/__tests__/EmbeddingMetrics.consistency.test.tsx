/**
 * EmbeddingMetrics — chrome consistency tests (Archetype C, Bulk Batch C).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({ getAccessToken: async () => 'fake-token' }),
}));

vi.mock('../../../../../app/providers/AuthContext', () => ({
  useAuth: () => ({ getAccessToken: async () => 'fake-token' }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
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

import EmbeddingMetrics from '../EmbeddingMetrics';

const SUMMARY_FIXTURE = {
  totalRequests: 0,
  totalTokens: 0,
  totalCost: 0,
  avgLatencyMs: 0,
};

const EMBEDDINGS_FIXTURE = {
  summary: SUMMARY_FIXTURE,
  byProvider: [],
  byModel: [],
  dailyTrend: [],
};

let originalFetch: typeof fetch;

describe('EmbeddingMetrics — chrome consistency (Bulk Batch C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, embeddings: EMBEDDINGS_FIXTURE }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<EmbeddingMetrics theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /embedding/i', async () => {
    render(<EmbeddingMetrics theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/embedding/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<EmbeddingMetrics theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
