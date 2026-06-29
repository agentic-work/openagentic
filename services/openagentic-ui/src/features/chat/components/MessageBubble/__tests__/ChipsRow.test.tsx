/**
 * RED contract for ChipsRow — end-of-message follow-up chip row (G1).
 *
 * Mocks at end-state-{01,07,08,13}.html show every assistant final
 * message ending with up to 3 imperative-verb chips. Clicking a chip
 * fills the composer with the chip's prompt and auto-submits.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ChipsRow } from '../ChipsRow';

const chips = [
  { label: 'drill into prod-west-rg →', prompt: 'show me prod-west-rg detail' },
  { label: 'apply nat-endpoint terraform plan →', prompt: 'apply the nat-endpoint terraform' },
  { label: 'make slide ⎘', prompt: 'render an exec slide from this' },
];

describe('ChipsRow — follow-up chip row (G1)', () => {
  it('renders one [data-testid="followup-row"] container with all chips', () => {
    render(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(screen.getByTestId('followup-row')).toBeInTheDocument();
    expect(screen.getAllByTestId('followup-chip')).toHaveLength(3);
  });

  it('renders chip labels verbatim', () => {
    render(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(screen.getByText('drill into prod-west-rg →')).toBeInTheDocument();
    expect(screen.getByText('apply nat-endpoint terraform plan →')).toBeInTheDocument();
    expect(screen.getByText('make slide ⎘')).toBeInTheDocument();
  });

  it('clicking a chip calls onSubmit with that chip\'s prompt', () => {
    const onSubmit = vi.fn();
    render(<ChipsRow chips={chips} onSubmit={onSubmit} />);
    const buttons = screen.getAllByTestId('followup-chip');
    fireEvent.click(buttons[0]);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('show me prod-west-rg detail');
  });

  it('renders nothing when chips array is empty', () => {
    const { container } = render(<ChipsRow chips={[]} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('does NOT call onSubmit on mount', () => {
    const onSubmit = vi.fn();
    render(<ChipsRow chips={chips} onSubmit={onSubmit} />);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
