/**
 * Phase 1 of universal-anatomy parity — cost-pill delta-flash.
 *
 * Mock anatomy: mocks/UX/01:226 `.cost-pill .delta` + chatmode-v2.css
 *   .delta { color: ok; font-size: 10px; opacity: 0; animation: flashDelta 2.4s }
 *
 * When `runningCost` increments, render a transient cm-delta span that
 * flashes the +$Δ then fades. Goes away after the animation.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TopbarCostPill } from '../TopbarCostPill';

describe('TopbarCostPill delta-flash (mock 01:226)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a cm-delta span when override increments', () => {
    const { container, rerender } = render(<TopbarCostPill override={0.0142} live />);
    expect(container.querySelector('.cm-delta')).toBeNull();

    rerender(<TopbarCostPill override={0.0190} live />);
    const delta = container.querySelector('.cm-delta');
    expect(delta).not.toBeNull();
    // Shows the increment, formatted as a positive delta.
    expect(delta!.textContent).toMatch(/\+\$0\.00/);
  });

  it('removes the cm-delta after the flash animation completes', () => {
    const { container, rerender } = render(<TopbarCostPill override={0.01} live />);
    rerender(<TopbarCostPill override={0.02} live />);
    expect(container.querySelector('.cm-delta')).not.toBeNull();
    // Animation lasts ~2.4s — advance past it. Wrap in act() so React
    // commits the setState that fires from the setTimeout callback.
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(container.querySelector('.cm-delta')).toBeNull();
  });

  it('does not render delta when cost decreases or stays flat', () => {
    const { container, rerender } = render(<TopbarCostPill override={0.05} live />);
    rerender(<TopbarCostPill override={0.05} live />);
    expect(container.querySelector('.cm-delta')).toBeNull();
    rerender(<TopbarCostPill override={0.04} live />);
    expect(container.querySelector('.cm-delta')).toBeNull();
  });
});
