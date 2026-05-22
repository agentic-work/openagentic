/**
 * RetryPill — Phase G render test.
 *
 * Asserts the pill reads "Retry N/M: re-executing <name> ..." and
 * exposes data attributes for the attempt / max so a test harness
 * can count retries without DOM-stringy brittleness.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RetryPill } from '../RetryPill';

describe('RetryPill', () => {
  it('renders attempt / max attempt pair', () => {
    render(<RetryPill attempt={2} maxAttempts={3} name="azure_list_vms" />);
    const pill = screen.getByTestId('retry-pill');
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toMatch(/Retry 2\/3/);
    expect(pill.textContent).toContain('azure_list_vms');
    expect(pill.getAttribute('data-attempt')).toBe('2');
    expect(pill.getAttribute('data-max-attempts')).toBe('3');
  });

  it('includes elapsed time when given', () => {
    render(<RetryPill attempt={1} maxAttempts={2} name="foo" elapsedMs={5200} />);
    expect(screen.getByTestId('retry-pill').textContent).toMatch(/5\.2s/);
  });

  it('exposes reason as a tooltip', () => {
    render(
      <RetryPill attempt={1} maxAttempts={2} reason="ETIMEDOUT contacting mcp-proxy" />
    );
    const pill = screen.getByTestId('retry-pill');
    expect(pill.textContent).toMatch(/ETIMEDOUT contacting mcp-proxy/);
  });
});
