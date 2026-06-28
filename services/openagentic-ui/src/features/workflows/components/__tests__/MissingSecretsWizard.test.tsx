/**
 * MissingSecretsWizard — collects values for {{secret:NAME}} references
 * that don't exist yet, and saves them to WorkflowSecret in one shot.
 *
 * Behaviour under test:
 *  - hidden when isOpen=false
 *  - one row per missing secret, label shows the name + which nodes use it
 *  - inputs are masked (type=password)
 *  - Cancel button calls onCancel
 *  - Save & Run button is disabled until every required field has a value,
 *    and on click calls onSubmit({ NAME: value, … })
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MissingSecretsWizard } from '../MissingSecretsWizard';

const sample = [
  { name: 'STRIPE_KEY', nodeIds: ['n1', 'n3'] },
  { name: 'PAGERDUTY_ROUTING_KEY', nodeIds: ['n2'] },
];

describe('MissingSecretsWizard', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MissingSecretsWizard
        isOpen={false}
        missing={sample}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per missing secret with masked input', () => {
    render(
      <MissingSecretsWizard
        isOpen={true}
        missing={sample}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('STRIPE_KEY')).toBeTruthy();
    expect(screen.getByText('PAGERDUTY_ROUTING_KEY')).toBeTruthy();
    const stripeInput = screen.getByLabelText('STRIPE_KEY') as HTMLInputElement;
    expect(stripeInput.type).toBe('password');
  });

  it('disables Save until every field has a value, then submits all values', () => {
    const onSubmit = vi.fn();
    render(
      <MissingSecretsWizard
        isOpen={true}
        missing={sample}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const saveBtn = screen.getByRole('button', { name: /save & run/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('STRIPE_KEY'), { target: { value: 'sk_live_abc' } });
    expect(saveBtn.disabled).toBe(true); // still missing PD

    fireEvent.change(screen.getByLabelText('PAGERDUTY_ROUTING_KEY'), { target: { value: 'pd_xyz' } });
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    expect(onSubmit).toHaveBeenCalledWith({
      STRIPE_KEY: 'sk_live_abc',
      PAGERDUTY_ROUTING_KEY: 'pd_xyz',
    });
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <MissingSecretsWizard
        isOpen={true}
        missing={sample}
        onSubmit={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
