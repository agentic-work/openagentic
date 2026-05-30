/**
 * CostPill — v0.6.7 chat-polish streaming updates test
 *
 * Target: as cost_delta events arrive, runningCost prop updates and the
 * pill pulses (key changes) and renders the new value.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CostPill } from '../CostPill';

describe('CostPill (v0.6.7 running cost)', () => {
  it('renders ~$X.XX with tilde when streaming without authoritative usage', () => {
    render(
      <CostPill
        model="claude-sonnet-4-6"
        outputText={'a'.repeat(4000)} // ~1000 tokens
        isStreaming={true}
      />
    );
    const pill = screen.getByTestId('cost-pill');
    expect(pill.textContent?.startsWith('~$')).toBe(true);
  });

  it('prefers runningCost over local estimate during streaming', () => {
    render(
      <CostPill
        model="claude-sonnet-4-6"
        outputText={'a'.repeat(40)}
        isStreaming={true}
        runningCost={0.00234}
      />
    );
    const pill = screen.getByTestId('cost-pill');
    // 3 sig figs for cost < 0.01 → ~$0.00234
    expect(pill.textContent).toMatch(/~\$0\.00234/);
    expect(pill.getAttribute('data-running-cost')).toBe('0.0023');
  });

  it('formats running cost up to 3 significant figures for small values', () => {
    render(
      <CostPill
        model="claude-sonnet-4-6"
        isStreaming={true}
        runningCost={0.00987}
      />
    );
    expect(screen.getByTestId('cost-pill').textContent).toMatch(/~\$0\.00987/);
  });

  it('pulse key increments when runningCost changes', () => {
    const { rerender } = render(
      <CostPill
        model="claude-sonnet-4-6"
        outputText={'a'.repeat(40)}
        isStreaming={true}
        runningCost={0.001}
      />
    );
    const initialKey = screen.getByTestId('cost-pill').getAttribute('data-pulse-key');

    rerender(
      <CostPill
        model="claude-sonnet-4-6"
        outputText={'a'.repeat(40)}
        isStreaming={true}
        runningCost={0.003}
      />
    );
    const nextKey = screen.getByTestId('cost-pill').getAttribute('data-pulse-key');
    expect(Number(nextKey)).toBeGreaterThan(Number(initialKey));
  });

  it('authoritative usage wins over runningCost (no tilde after stream ends)', () => {
    // Use large token counts so the dollar display isn't filtered out by the
    // ~$0.00 empty-render guard. Claude Sonnet 4.6 = $3 in / $15 out per 1M.
    render(
      <CostPill
        model="claude-sonnet-4-6"
        outputText={'a'.repeat(40)}
        isStreaming={false}
        runningCost={0.00234}
        usage={{ promptTokens: 10_000, completionTokens: 20_000, totalTokens: 30_000 }}
      />
    );
    const pill = screen.getByTestId('cost-pill');
    // No tilde because hasAuthoritative=true
    expect(pill.textContent?.startsWith('~')).toBe(false);
    expect(pill.textContent?.startsWith('$')).toBe(true);
  });
});
