import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RemediationPlanRenderer } from '../RemediationPlanRenderer';

const example = {
  title: 'Remediation — SC-13',
  phases: [
    {
      phase: 'Phase 1',
      actions: [
        { action: 'Inventory crypto', owner: 'sec', eta: '2026-05-15', status: 'done' as const },
        { action: 'Identify non-FIPS', owner: 'sec', eta: '2026-05-17', status: 'done' as const },
      ],
    },
    {
      phase: 'Phase 2',
      actions: [
        { action: 'Swap libs', owner: 'platform', eta: '2026-05-22', status: 'in_progress' as const },
        { action: 'FIPS endpoint', owner: 'platform', eta: '2026-05-24', status: 'todo' as const },
      ],
    },
  ],
};

describe('RemediationPlanRenderer', () => {
  it('renders progress bar and action rows', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RemediationPlanRenderer {...example} />);
    expect(container.querySelector('[data-testid="remediation-plan-renderer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="remediation-progress-bar"]')).not.toBeNull();
    const li = container.querySelectorAll('li[data-status]');
    expect(li.length).toBe(4);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<RemediationPlanRenderer />);
    expect(container.textContent).toMatch(/no remediation plan/);
  });
});
