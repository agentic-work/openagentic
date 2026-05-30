/**
 * CostPill — running cost pill in tool/sub-agent headers.
 *
 * Reference: mocks/UX/01-cloud-ops.html line 811
 * (<span class="cost-pill done" aria-label="Total cost $0.058">).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CostPill } from '../CostPill';

describe('CostPill', () => {
  it('renders <span> with cost formatted to 3 decimal places', () => {
    const { container } = render(<CostPill costUsd={0.058} />);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el).toBeInTheDocument();
    expect(el.textContent).toBe('$0.058');
  });

  it('done=true uses muted styling (cm-cost-pill-done class)', () => {
    const { container } = render(<CostPill costUsd={0.058} done />);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.className).toContain('cm-cost-pill');
    expect(el.className).toContain('cm-cost-pill-done');
  });

  it('done=false (default) uses purple-accent running style (cm-cost-pill-running class)', () => {
    const { container } = render(<CostPill costUsd={0.058} />);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.className).toContain('cm-cost-pill');
    expect(el.className).toContain('cm-cost-pill-running');
  });

  it('running style uses purple color #8b5cf6', () => {
    const { container } = render(<CostPill costUsd={0.058} done={false} />);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.style.color).toBe('rgb(139, 92, 246)');
  });

  it('ariaLabel defaults to "Total cost $X.XXX" if not provided', () => {
    const { container } = render(<CostPill costUsd={0.058} />);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.getAttribute('aria-label')).toBe('Total cost $0.058');
  });

  it('custom ariaLabel overrides the default', () => {
    const { container } = render(
      <CostPill costUsd={0.058} ariaLabel="Subagent total $0.058" />,
    );
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.getAttribute('aria-label')).toBe('Subagent total $0.058');
  });

  it('handles costUsd=0 → renders $0.000', () => {
    const { container } = render(<CostPill costUsd={0} />);
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.textContent).toBe('$0.000');
    expect(el.getAttribute('aria-label')).toBe('Total cost $0.000');
  });

  it('respects passthrough className (appends, does not replace)', () => {
    const { container } = render(
      <CostPill costUsd={0.058} className="extra-class" />,
    );
    const el = container.querySelector('span') as HTMLSpanElement;
    expect(el.className).toContain('cm-cost-pill');
    expect(el.className).toContain('extra-class');
  });
});
