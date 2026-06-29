/**
 * ReconnectedPill — Phase I render test (task #154).
 *
 * Asserts the pill renders "Reconnected" text with optional frame
 * count + lastSeq suffixes, and exposes the `at` timestamp as a data
 * attribute so tests / harness code can detect a fresh pulse.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReconnectedPill } from '../ReconnectedPill';

describe('ReconnectedPill', () => {
  it('renders minimal variant', () => {
    render(<ReconnectedPill at={123456} />);
    const pill = screen.getByTestId('reconnected-pill');
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toMatch(/Reconnected/);
    expect(pill.getAttribute('data-at')).toBe('123456');
  });

  it('includes frame count suffix when given', () => {
    render(<ReconnectedPill at={1} framesReplayed={428} />);
    const pill = screen.getByTestId('reconnected-pill');
    expect(pill.textContent).toMatch(/428 frames replayed/);
  });

  it('uses singular "frame" when framesReplayed is 1', () => {
    render(<ReconnectedPill at={1} framesReplayed={1} />);
    expect(screen.getByTestId('reconnected-pill').textContent).toMatch(/1 frame replayed/);
  });

  it('omits frame suffix when framesReplayed is 0 or undefined', () => {
    render(<ReconnectedPill at={1} framesReplayed={0} />);
    const pill = screen.getByTestId('reconnected-pill');
    expect(pill.textContent).not.toMatch(/frame/i);
  });

  it('includes lastSeq suffix when given', () => {
    render(<ReconnectedPill at={1} framesReplayed={5} lastSeq={42} />);
    const pill = screen.getByTestId('reconnected-pill');
    expect(pill.textContent).toMatch(/5 frames replayed · seq 42/);
  });

  it('uses role=status for accessibility', () => {
    render(<ReconnectedPill at={1} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
