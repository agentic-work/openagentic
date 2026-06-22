/**
 * Phase 16 — SubAgentCard prefers `output` (real return content) over
 * the legacy `returnValue` stats-string.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SubAgentCard } from '../SubAgentCard';

describe('SubAgentCard output prefers real return content (Phase 16)', () => {
  it('renders output text in cm-sa-return when both output and returnValue present', () => {
    const { container } = render(
      <SubAgentCard
        name="Cloud Operations"
        role="cloud_operations"
        variant="c"
        status="ok"
        stats={{ turns: 7, tokens: 5485, wallMs: 32400 }}
        output="Found 6 resource groups across 2 subscriptions"
        returnValue="7 turns, 5485 tok"
      />,
    );
    const ret = container.querySelector('.cm-sa-return');
    expect(ret).not.toBeNull();
    expect(ret).toHaveTextContent('Found 6 resource groups across 2 subscriptions');
    // Stats-string should NOT appear in the return strip when output is present.
    expect(ret).not.toHaveTextContent('5485 tok');
  });

  it('falls back to returnValue when output is missing', () => {
    const { container } = render(
      <SubAgentCard
        name="x"
        role="x"
        variant="c"
        status="ok"
        returnValue="3 turns, 280 tok"
      />,
    );
    expect(container.querySelector('.cm-sa-return')).toHaveTextContent('3 turns, 280 tok');
  });

  it('renders nothing in cm-sa-return when neither output nor returnValue is set', () => {
    const { container } = render(
      <SubAgentCard name="x" role="x" variant="c" status="ok" />,
    );
    expect(container.querySelector('.cm-sa-return')).toBeNull();
  });

  it('does not render output when status is not ok (error path)', () => {
    const { container } = render(
      <SubAgentCard
        name="x"
        role="x"
        variant="c"
        status="error"
        error="rate-limit"
        output="should not show this"
      />,
    );
    expect(container.querySelector('.cm-sa-return')).toBeNull();
    expect(container.querySelector('.cm-sa-error')).not.toBeNull();
  });
});
