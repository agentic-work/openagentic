/**
 * DashboardOverview — chrome consistency tests (Archetype C, Bulk Batch C).
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

vi.mock('../../../../utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestJson: vi.fn(),
  apiEndpoint: (p: string) => p,
}));

vi.mock('../../../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', accentColor: 'blue' }),
}));

vi.mock('../../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', accentColor: 'blue' }),
}));

vi.mock('../LLM/LLMSankeyModal', () => ({
  LLMSankeyModal: () => null,
}));

vi.mock('../../components/LLM/LLMSankeyModal', () => ({
  LLMSankeyModal: () => null,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Area: () => <div data-testid="area" />,
  Line: () => <div data-testid="line" />,
  Bar: () => <div data-testid="bar" />,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

vi.mock('../../primitives-v2', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    BigChart: () => <div data-testid="chart-stub-bigchart" />,
    Sparkline: () => <div data-testid="chart-stub-sparkline" />,
    SparkArea: () => <div data-testid="chart-stub-sparkarea" />,
    StatCard: () => <div data-testid="chart-stub-statcard" />,
  };
});

vi.mock('../../Shared', () => ({
  AdminMetricCard: ({ label }: any) => (
    <div data-testid={`metric-card-${String(label).replace(/\s+/g, '-').toLowerCase()}`} />
  ),
  AdminFilterBar: () => <div data-testid="admin-filter-bar" />,
  InfoTooltip: () => null,
}));

import DashboardOverview from '../DashboardOverview';

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const SUMMARY_FIXTURE = {
  totalUsers: 0, activeUsers: 0,
  totalSessions: 0, sessionChange: 0,
  totalMessages: 0, messageChange: 0,
  totalTokens: 0, totalCost: 0,
  totalImages: 0, totalMcpCalls: 0,
  totalEmbeddings: 0,
  totalCodeTokens: 0, totalCodeCost: 0,
  totalCodeMessages: 0, totalCodeSessions: 0,
  totalWorkflowExecutions: 0, totalWorkflows: 0,
  activeWorkflows: 0, workflowSuccessRate: 0,
  totalAgentExecutions: 0, agentTotalTokens: 0, agentTotalCost: 0,
  totalApiRequests: 0, apiAvgResponseTime: 0,
};

const METRICS_FIXTURE = {
  success: true,
  summary: SUMMARY_FIXTURE,
  timeSeries: [],
  topModels: [],
  serviceStatus: [],
  topUsers: [],
  topMcpTools: [],
};

function setupApiMock() {
  mockApiRequest.mockImplementation((url: string) => {
    if (typeof url === 'string') {
      if (url.includes('/admin/dashboard/metrics')) return mkResponse(METRICS_FIXTURE);
    }
    return mkResponse({});
  });
}

describe('DashboardOverview — chrome consistency (Bulk Batch C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<DashboardOverview theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /dashboard|overview/i', async () => {
    render(<DashboardOverview theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/dashboard|overview/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<DashboardOverview theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
