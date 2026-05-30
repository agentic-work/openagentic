import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RiskPriorityQueueRenderer } from '../RiskPriorityQueueRenderer';

const example = {
  title: 'Risk queue',
  risks: [
    { id: 'R-001', title: 'crypto gap', impact: 9, probability: 8, status: 'accepted' as const },
    { id: 'R-002', title: 'single AZ', impact: 8, probability: 6, status: 'new' as const },
    { id: 'R-003', title: 'stripe cutover', impact: 9, probability: 5, status: 'accepted' as const },
    { id: 'R-007', title: 'burnout', impact: 4, probability: 9, status: 'accepted' as const },
  ],
};

describe('RiskPriorityQueueRenderer', () => {
  it('renders ranked rows sorted by score', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RiskPriorityQueueRenderer {...example} />);
    expect(container.querySelector('[data-testid="risk-priority-queue-renderer"]')).not.toBeNull();
    const rows = container.querySelectorAll('[data-risk-id]');
    expect(rows.length).toBe(4);
    // Rank 1 = R-001 (9×8 = 72)
    expect(rows[0].getAttribute('data-risk-id')).toBe('R-001');
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<RiskPriorityQueueRenderer />);
    expect(container.textContent).toMatch(/no risks/);
  });
});
