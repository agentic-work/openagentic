/**
 * LLMPerformanceMetrics — chrome consistency tests (Pilot Task C)
 *
 * Asserts that this Archetype C (Metrics dashboard) page conforms to the
 * universal admin-page chrome by rendering the new <PageHeader> primitive
 * at the top, with the expected title, and without any hex literals
 * leaking into inline styles emitted by chrome (PageHeader, surrounds).
 *
 * Mirrors the three assertions from Pilots A & B. Charts and recharts are
 * stubbed out — jsdom can't render SVG/ResizeObserver, and the chrome test
 * only cares about the page header, not the chart internals.
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
  apiRequestJson: vi.fn(),
  apiEndpoint: (p: string) => p,
}));

// Stub recharts — jsdom can't render SVG / ResizeObserver, and the
// chrome-consistency test doesn't care about chart innards.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  Line: () => <div data-testid="line" />,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Cell: () => null,
}));

// Stub primitives-v2 chart components in case they're swapped in later. The
// chrome test only cares about the page header — keep chart-stubbing isolated.
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

// Stub heavy AdminMetricCard so its inline styles don't pollute the no-hex
// regex with chart/sparkline color tokens (those use stroke= / fill= props,
// but stubbing avoids re-rendering recharts inside it).
vi.mock('../../Shared/AdminMetricCard', () => ({
  AdminMetricCard: ({ label }: any) => (
    <div data-testid={`metric-card-${String(label).replace(/\s+/g, '-').toLowerCase()}`} />
  ),
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import LLMPerformanceMetrics from '../LLMPerformanceMetrics';

// ---------------------------------------------------------------------------
// Fixtures — minimal shapes so the loading guard releases and the main JSX
// renders. We don't care about chart correctness here.
// ---------------------------------------------------------------------------

const OVERVIEW_FIXTURE = {
  overview: {
    totalQueries: 0,
    uniqueUsers: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    avgResponseTime: 0,
    toolCalls: 0,
    successRate: 0,
  },
  modelBreakdown: [],
};

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function setupApiMock() {
  mockApiRequest.mockImplementation((url: string) => {
    if (typeof url === 'string') {
      if (url.includes('/admin/metrics/llm/overview')) return mkResponse(OVERVIEW_FIXTURE);
      if (url.includes('/admin/metrics/llm/users')) return mkResponse({ users: [] });
      if (url.includes('/admin/metrics/llm/tools')) return mkResponse({ tools: [] });
      if (url.includes('/admin/metrics/llm/trends')) return mkResponse({ trends: [] });
      if (url.includes('/admin/metrics/llm/providers')) return mkResponse({ providers: [], totalCost: '0.00' });
      if (url.includes('/admin/metrics/llm/performance-trends')) return mkResponse({ trends: [] });
      if (url.includes('/admin/metrics/llm/performance')) return mkResponse({ kpis: null });
      if (url.includes('/api/metrics')) return mkResponse({});
    }
    return mkResponse({});
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLMPerformanceMetrics — chrome consistency (Pilot C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<LLMPerformanceMetrics theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /performance/i', async () => {
    render(<LLMPerformanceMetrics theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/performance/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<LLMPerformanceMetrics theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
