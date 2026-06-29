/**
 * Phase 17 — PassChip primitive (mock 04 sub-agent multi-pass).
 *
 * Mock 04 anatomy:
 *   <span class="cm-pass-chip cm-pass-2">pass 2</span>
 *
 * Pass 1 is implicit and never rendered. Pass ≥2 renders a pill with
 * a tone variant per pass index (2 → amber, 3+ → orange/red shifts).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PassChip } from '../PassChip';

describe('PassChip (mock 04)', () => {
  it('renders cm-pass-chip with cm-pass-{n} variant + "pass N" text', () => {
    const { container } = render(<PassChip pass={2} />);
    const chip = container.querySelector('.cm-pass-chip');
    expect(chip).not.toBeNull();
    expect(chip).toHaveClass('cm-pass-2');
    expect(chip).toHaveTextContent('pass 2');
  });

  it('renders cm-pass-3 for the 3rd pass', () => {
    const { container } = render(<PassChip pass={3} />);
    expect(container.querySelector('.cm-pass-chip')).toHaveClass('cm-pass-3');
  });

  it('renders nothing for pass=1 (implicit / no-op)', () => {
    const { container } = render(<PassChip pass={1} />);
    expect(container.querySelector('.cm-pass-chip')).toBeNull();
  });

  it('renders nothing for pass=0 or negative', () => {
    const { container, rerender } = render(<PassChip pass={0} />);
    expect(container.querySelector('.cm-pass-chip')).toBeNull();
    rerender(<PassChip pass={-1} />);
    expect(container.querySelector('.cm-pass-chip')).toBeNull();
  });
});
