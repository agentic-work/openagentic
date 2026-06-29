/**
 * Z.8b — ChipsRow toggle gate regression pin (2026-05-19).
 *
 * Confirms:
 * - ChipsRow renders chips when store enabled=true
 * - ChipsRow renders nothing when store enabled=false
 * - Flipping store from true → false hides chips on re-render
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { useFollowupChipsStore } from '@/stores/useFollowupChipsStore';
import { ChipsRow } from '../ChipsRow';

const chips = [
  { label: 'drill into prod-west-rg →', prompt: 'show me prod-west-rg detail' },
  { label: 'show cost breakdown →', prompt: 'show cost breakdown for this' },
];

describe('ChipsRow — followup chips store gate', () => {
  beforeEach(() => {
    useFollowupChipsStore.setState({ enabled: true });
  });

  it('renders chips when store enabled=true', () => {
    render(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(screen.getByTestId('followup-row')).toBeInTheDocument();
    expect(screen.getAllByTestId('followup-chip')).toHaveLength(2);
  });

  it('renders nothing when store enabled=false', () => {
    useFollowupChipsStore.setState({ enabled: false });
    const { container } = render(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('followup-row')).toBeNull();
  });

  it('chips disappear when store flips from true to false', () => {
    const { rerender } = render(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(screen.getByTestId('followup-row')).toBeInTheDocument();

    useFollowupChipsStore.setState({ enabled: false });
    rerender(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(screen.queryByTestId('followup-row')).toBeNull();
  });

  it('chips reappear when store flips from false to true', () => {
    useFollowupChipsStore.setState({ enabled: false });
    const { rerender } = render(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(screen.queryByTestId('followup-row')).toBeNull();

    useFollowupChipsStore.setState({ enabled: true });
    rerender(<ChipsRow chips={chips} onSubmit={() => {}} />);
    expect(screen.getByTestId('followup-row')).toBeInTheDocument();
  });
});
