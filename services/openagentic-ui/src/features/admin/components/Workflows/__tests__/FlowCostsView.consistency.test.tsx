/**
 * FlowCostsView — chrome consistency tests (Archetype C, Bulk Batch C).
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

import FlowCostsView from '../FlowCostsView';

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const COST_DATA_FIXTURE = {
  success: true,
  period: '30d',
  groupBy: 'workflow',
  summary: {
    totalCost: 0,
    totalExecutions: 0,
    totalTokens: 0,
    avgCostPerExecution: 0,
  },
  results: [],
};

function setupApiMock() {
  mockApiRequest.mockImplementation((url: string) => {
    if (typeof url === 'string') {
      if (url.includes('/api/admin/workflows/cost')) return mkResponse(COST_DATA_FIXTURE);
    }
    return mkResponse({});
  });
}

describe('FlowCostsView — chrome consistency (Bulk Batch C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<FlowCostsView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /flow costs/i', async () => {
    render(<FlowCostsView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/flow costs/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<FlowCostsView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
