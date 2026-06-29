import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComplianceDashboardRenderer } from '../ComplianceDashboardRenderer';

const example = {
  title: 'NIST 800-53 readiness',
  framework: 'NIST 800-53 Rev 5',
  families: [
    {
      family: 'AC — Access Control',
      controls: [
        { id: 'AC-2', name: 'Account Management', status: 'met' as const },
        { id: 'AC-3', name: 'Access Enforcement', status: 'met' as const },
        { id: 'AC-6', name: 'Least Privilege', status: 'partial' as const },
      ],
    },
    {
      family: 'SC — System & Communications',
      controls: [
        { id: 'SC-7', name: 'Boundary Protection', status: 'met' as const },
        { id: 'SC-13', name: 'Crypto Protection', status: 'gap' as const },
      ],
    },
  ],
};

describe('ComplianceDashboardRenderer', () => {
  it('renders families and control rows', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<ComplianceDashboardRenderer {...example} />);
    expect(container.querySelector('[data-testid="compliance-dashboard-renderer"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-family]').length).toBe(2);
    expect(container.querySelectorAll('[data-control-id]').length).toBe(5);
    expect(container.querySelector('[data-testid="compliance-overall-pct"]')).not.toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<ComplianceDashboardRenderer />);
    expect(container.textContent).toMatch(/no compliance data/);
  });
});
