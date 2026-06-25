/**
 * #781 Phase C5 — Runbook renderer tests.
 *
 * Numbered steps + Shiki-highlighted code + interactive checkboxes
 * persisted to localStorage.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { Runbook } from '../Runbook.js';

const STEPS = [
  {
    title: 'Drop the orphan public IP',
    body: 'Public IP `agw-fd-prod-test-pip` has 100% idle %.',
    code: 'az network public-ip delete --name agw-fd-prod-test-pip --resource-group rg-x',
  },
  {
    title: 'Tier-down Front Door SKU',
    body: 'Front Door `fd-prod-test` traffic is below threshold.',
  },
];

beforeEach(() => {
  localStorage.clear();
});

describe('Runbook renderer — #781 Phase C5', () => {
  it('renders an empty state when no steps', () => {
    render(<Runbook id="r1" steps={[]} />);
    expect(screen.getByTestId('runbook-empty')).toBeInTheDocument();
  });

  it('renders one numbered step per entry', () => {
    render(<Runbook id="r1" steps={STEPS} />);
    expect(screen.getAllByTestId(/^runbook-step-\d+$/)).toHaveLength(2);
    expect(screen.getByText('Drop the orphan public IP')).toBeInTheDocument();
    expect(screen.getByText('Tier-down Front Door SKU')).toBeInTheDocument();
  });

  it('renders the code block when step has code', () => {
    render(<Runbook id="r1" steps={STEPS} />);
    const code = screen.getByText(/az network public-ip delete/);
    expect(code.tagName).toBe('CODE');
  });

  it('checking a step persists to localStorage', async () => {
    const user = userEvent.setup();
    render(<Runbook id="r1" steps={STEPS} />);
    const cb = screen.getByTestId('runbook-step-0-checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    await user.click(cb);
    expect(cb.checked).toBe(true);
    const saved = JSON.parse(localStorage.getItem('runbook:r1') || '{}');
    expect(saved['0']).toBe(true);
  });

  it('restores checked state from localStorage on mount', () => {
    localStorage.setItem('runbook:r1', JSON.stringify({ '0': true, '1': false }));
    render(<Runbook id="r1" steps={STEPS} />);
    const cb0 = screen.getByTestId('runbook-step-0-checkbox') as HTMLInputElement;
    const cb1 = screen.getByTestId('runbook-step-1-checkbox') as HTMLInputElement;
    expect(cb0.checked).toBe(true);
    expect(cb1.checked).toBe(false);
  });
});
