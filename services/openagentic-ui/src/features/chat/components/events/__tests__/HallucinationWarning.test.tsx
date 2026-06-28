/**
 * HallucinationWarning — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HallucinationWarning } from '../HallucinationWarning';

describe('HallucinationWarning', () => {
  it('renders default unrevised message', () => {
    render(<HallucinationWarning />);
    const pill = screen.getByTestId('hallucination-warning');
    expect(pill.getAttribute('role')).toBe('alert');
    expect(pill.textContent).toMatch(/Possible inaccuracy/);
  });

  it('swaps label when revised=true', () => {
    render(<HallucinationWarning revised confidence={0.72} />);
    const pill = screen.getByTestId('hallucination-warning');
    expect(pill.textContent).toMatch(/Auto-corrected/);
    expect(pill.textContent).toMatch(/72% confidence/);
    expect(pill.getAttribute('data-revised')).toBe('true');
  });

  it('shows warning + tool counts when provided', () => {
    render(<HallucinationWarning warningCount={4} toolCount={7} />);
    const pill = screen.getByTestId('hallucination-warning');
    expect(pill.textContent).toMatch(/4 flag/);
    expect(pill.textContent).toMatch(/7 tool/);
  });
});
