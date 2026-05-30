/**
 * Phase 7 — SavingsGridRenderer parity test.
 * Mirrors server template exampleParams shape (5 rows).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SavingsGridRenderer } from '../SavingsGridRenderer';

const example = {
  title: 'AWS cost — savings opportunities (monthly)',
  currency: 'USD',
  highlight_top_n: 2,
  rows: [
    { resource: 'i-0abc', current_cost: 540, recommended_action: 'right-size', monthly_savings: 320, risk: 'low' as const },
    { resource: 'vol-09cd', current_cost: 102, recommended_action: 'gp2→gp3', monthly_savings: 41, risk: 'low' as const },
    { resource: 'nat-gw', current_cost: 168, recommended_action: 'consolidate', monthly_savings: 84, risk: 'medium' as const },
    { resource: 'rds-staging', current_cost: 240, recommended_action: 'stop nightly', monthly_savings: 80, risk: 'low' as const },
    { resource: 'eks-node', current_cost: 1240, recommended_action: 'autoscale', monthly_savings: 380, risk: 'high' as const },
  ],
};

describe('SavingsGridRenderer', () => {
  it('renders one tbody row per example row', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<SavingsGridRenderer {...example} />);
    expect(container.querySelector('[data-testid="savings-grid-renderer"]')).not.toBeNull();
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(example.rows.length);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('renders placeholder for missing payload', () => {
    const { container } = render(<SavingsGridRenderer />);
    expect(container.textContent).toMatch(/no savings data/);
  });
});
