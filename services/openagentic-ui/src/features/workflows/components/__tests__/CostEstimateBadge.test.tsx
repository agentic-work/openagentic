/**
 * CostEstimateBadge — TDD-driven, written one test at a time.
 *
 * Iron law: failing test first, watched fail, minimal impl, watch pass.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div> },
}));

vi.mock('@/shared/icons', () => ({
  AlertCircle: () => <span data-testid="ico-alert">!</span>,
}));

afterEach(() => cleanup());

import { CostEstimateBadge } from '../CostEstimateBadge';

describe('CostEstimateBadge — TDD', () => {
  it('RED 1: renders nothing when totalUsd is 0', () => {
    const { container } = render(
      <CostEstimateBadge
        estimate={{
          totalUsd: 0,
          perNode: [],
          ratesLoaded: true,
          hasFallbackRates: false,
          hasUnknownIterations: false,
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('RED 2: renders "$0.18" when totalUsd is 0.18', () => {
    render(
      <CostEstimateBadge
        estimate={{
          totalUsd: 0.18,
          perNode: [{ nodeId: 'a', estimatedUsd: 0.18, agentCount: 1 }],
          ratesLoaded: true,
          hasFallbackRates: false,
          hasUnknownIterations: false,
        }}
      />,
    );
    const badge = screen.getByTestId('cost-estimate-badge');
    expect(badge).toHaveTextContent('$0.18');
  });

  it('RED 3: renders "≥" prefix when hasUnknownIterations', () => {
    render(
      <CostEstimateBadge
        estimate={{
          totalUsd: 0.5,
          perNode: [{ nodeId: 'a', estimatedUsd: 0.5, agentCount: 1 }],
          ratesLoaded: true,
          hasFallbackRates: false,
          hasUnknownIterations: true,
        }}
      />,
    );
    const badge = screen.getByTestId('cost-estimate-badge');
    expect(badge).toHaveTextContent('≥');
    expect(badge).toHaveTextContent('$0.50');
  });

  it('RED 4: renders nothing when ratesLoaded is false (avoids flash of "$0")', () => {
    const { container } = render(
      <CostEstimateBadge
        estimate={{
          totalUsd: 0.5,
          perNode: [{ nodeId: 'a', estimatedUsd: 0.5, agentCount: 1 }],
          ratesLoaded: false,
          hasFallbackRates: false,
          hasUnknownIterations: false,
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
