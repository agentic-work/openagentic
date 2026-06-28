/**
 * CostEstimateBadge — TDD-driven, written one test at a time.
 *
 * Iron-law discipline: render only what already-written tests require.
 */

import React from 'react';

export interface CostEstimateBadgeProps {
  estimate: {
    totalUsd: number;
    perNode: Array<{ nodeId: string; estimatedUsd: number; agentCount: number }>;
    ratesLoaded: boolean;
    hasFallbackRates: boolean;
    hasUnknownIterations: boolean;
  };
}

export const CostEstimateBadge: React.FC<CostEstimateBadgeProps> = ({ estimate }) => {
  if (!estimate.ratesLoaded) return null;
  if (estimate.totalUsd === 0) return null;
  const formatted =
    estimate.totalUsd < 0.01 ? estimate.totalUsd.toFixed(4) : estimate.totalUsd.toFixed(2);
  const prefix = estimate.hasUnknownIterations ? '≥ ' : '';
  return (
    <div data-testid="cost-estimate-badge">{prefix}${formatted}</div>
  );
};
