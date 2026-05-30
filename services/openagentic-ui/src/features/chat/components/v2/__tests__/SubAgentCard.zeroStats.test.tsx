/**
 * #320 — SubAgentCard must NOT render zero-valued stat bits.
 *
 * Regression: line 91 used `if (stats?.turns !== undefined)` which is
 * truthy for `turns: 0`, so freshly-spawned/streaming agents rendered
 * "0 turns / 0 tok / 0 ms / $0.00" cards in chatmode. The fix is to
 * gate each bit on a truthy (`> 0`) value — running agents with no
 * stats yet show no stat row, completed agents show their real numbers.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SubAgentCard } from '../SubAgentCard';

describe('#320 — SubAgentCard zero-valued stats', () => {
  it('does NOT render "0 turns" when stats.turns === 0', () => {
    const { container } = render(
      <SubAgentCard
        name="Cloud Operations"
        role="cloud_operations"
        variant="c"
        status="running"
        stats={{ turns: 0, tokens: 0, wallMs: 0, costUsd: 0 }}
      />,
    );
    const stats = container.querySelector('[data-testid="subagent-stats"]');
    expect(stats).toBeNull();
  });

  it('does NOT render "0 tok" when stats.tokens === 0 but turns > 0', () => {
    const { container } = render(
      <SubAgentCard
        name="x"
        role="x"
        variant="c"
        status="ok"
        stats={{ turns: 3, tokens: 0 }}
      />,
    );
    const stats = container.querySelector('[data-testid="subagent-stats"]');
    expect(stats).not.toBeNull();
    expect(stats?.textContent).toContain('3 turn');
    expect(stats?.textContent).not.toContain('0 tok');
  });

  it('renders real non-zero stats normally', () => {
    const { container } = render(
      <SubAgentCard
        name="x"
        role="x"
        variant="c"
        status="ok"
        stats={{ turns: 7, tokens: 5485, wallMs: 32400, costUsd: 0.05 }}
      />,
    );
    const stats = container.querySelector('[data-testid="subagent-stats"]');
    expect(stats).not.toBeNull();
    expect(stats?.textContent).toContain('7 turn');
  });

  it('omits the entire stats span when ALL values are 0/missing (no chrome)', () => {
    const { container } = render(
      <SubAgentCard
        name="x"
        role="x"
        variant="c"
        status="running"
      />,
    );
    expect(container.querySelector('[data-testid="subagent-stats"]')).toBeNull();
  });
});
