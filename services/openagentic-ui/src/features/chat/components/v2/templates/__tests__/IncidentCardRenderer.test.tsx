import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IncidentCardRenderer } from '../IncidentCardRenderer';

const example = {
  id: 'INC-4827',
  title: 'payment-gateway 5xx storm',
  severity: 'high' as const,
  opened_at: '2026-05-13T14:22Z',
  owner: 'trent@x',
  status: 'investigating' as const,
  impact: '12% checkouts failing',
  summary: 'pool exhaustion',
  related_alerts: [
    { id: 'A-9301', name: 'p99-latency', fired_at: '14:22Z' },
    { id: 'A-9302', name: 'error-rate', fired_at: '14:24Z' },
  ],
};

describe('IncidentCardRenderer', () => {
  it('renders id, title, severity pill', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, getByText } = render(<IncidentCardRenderer {...example} />);
    expect(container.querySelector('[data-testid="incident-card-renderer"]')).not.toBeNull();
    expect(getByText('INC-4827')).toBeTruthy();
    expect(getByText('payment-gateway 5xx storm')).toBeTruthy();
    expect(container.querySelector('[data-testid="incident-severity-pill"]')).not.toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<IncidentCardRenderer />);
    expect(container.textContent).toMatch(/no incident data/);
  });
});
