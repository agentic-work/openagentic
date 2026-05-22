/**
 * EffectivenessView — chrome consistency tests (Archetype C, Bulk Batch C).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const mockApiRequestJson = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: vi.fn(),
  apiRequestJson: (...args: unknown[]) => mockApiRequestJson(...args),
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

vi.mock('../../Shared/AdminButton', () => ({
  AdminButton: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import { EffectivenessView } from '../EffectivenessView';

const DATA_FIXTURE = {
  totalModules: 0,
  enabledModules: 0,
  averageTokenCost: 0,
  totalTokenBudgetUsed: 0,
  moduleUsage: [],
  recentCompositions: 0,
  positiveOutcomes: 0,
  negativeOutcomes: 0,
  pendingOutcomes: 0,
};

describe('EffectivenessView — chrome consistency (Bulk Batch C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequestJson.mockResolvedValue(DATA_FIXTURE);
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<EffectivenessView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /effectiveness/i', async () => {
    render(<EffectivenessView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/effectiveness/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<EffectivenessView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
