/**
 * WarningPill — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WarningPill } from '../WarningPill';

describe('WarningPill', () => {
  it('defaults to warn level', () => {
    render(<WarningPill message="rate limit approaching" />);
    const pill = screen.getByTestId('warning-pill');
    expect(pill.getAttribute('data-level')).toBe('warn');
    expect(pill.textContent).toContain('rate limit approaching');
  });

  it('renders error level with role=alert', () => {
    render(<WarningPill level="error" message="out of budget" />);
    const pill = screen.getByTestId('warning-pill');
    expect(pill.getAttribute('data-level')).toBe('error');
    expect(pill.getAttribute('role')).toBe('alert');
  });

  it('includes source + actionable when provided', () => {
    render(
      <WarningPill
        level="info"
        source="auth.stage"
        message="token refreshed"
        actionable="Re-run if needed"
      />
    );
    const pill = screen.getByTestId('warning-pill');
    expect(pill.textContent).toContain('auth.stage');
    expect(pill.textContent).toContain('Re-run if needed');
  });
});
