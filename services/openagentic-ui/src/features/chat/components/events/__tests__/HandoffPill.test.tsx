/**
 * HandoffPill — Phase G render test.
 *
 * Asserts the pill renders the from/to pair + reason text the way the
 * v0.6.7 UX mockup specifies. Shield icon only appears for destructive
 * escalation.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HandoffPill } from '../HandoffPill';

describe('HandoffPill', () => {
  it('renders from → to with model names', () => {
    render(<HandoffPill fromModel="gpt-oss:20b" toModel="gpt-5.2" />);
    const pill = screen.getByTestId('handoff-pill');
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toContain('gpt-oss:20b');
    expect(pill.textContent).toContain('gpt-5.2');
    expect(pill.getAttribute('data-from-model')).toBe('gpt-oss:20b');
    expect(pill.getAttribute('data-to-model')).toBe('gpt-5.2');
  });

  it('prepends a complexity score when provided', () => {
    render(<HandoffPill fromModel="gpt-oss:20b" toModel="gpt-5.2" complexityScore={73} />);
    expect(screen.getByTestId('handoff-pill').textContent).toMatch(/complexity 73/);
  });

  it('marks destructive escalation in data attribute', () => {
    render(
      <HandoffPill
        fromModel="gpt-oss:20b"
        toModel="gpt-5.2"
        routeEscalatedDestructive
      />
    );
    const pill = screen.getByTestId('handoff-pill');
    expect(pill.getAttribute('data-destructive')).toBe('true');
    expect(pill.textContent).toMatch(/destructive escalation/);
  });

  it('falls back to fromRole / toRole when models absent', () => {
    render(<HandoffPill fromRole="planner" toRole="executor" />);
    const pill = screen.getByTestId('handoff-pill');
    expect(pill.textContent).toContain('planner');
    expect(pill.textContent).toContain('executor');
  });
});
