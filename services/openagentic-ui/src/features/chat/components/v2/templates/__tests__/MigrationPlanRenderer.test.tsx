import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MigrationPlanRenderer } from '../MigrationPlanRenderer';

const example = {
  title: 'Azure → AWS',
  waves: [
    {
      wave: 'Wave 1',
      start: '2026-05-15',
      end: '2026-06-01',
      items: [
        { id: 'a', name: 'staging-api', status: 'done' as const },
        { id: 'b', name: 'staging-web', status: 'in_progress' as const },
      ],
      blockers: [],
    },
    {
      wave: 'Wave 2',
      items: [{ id: 'c', name: 'admin', status: 'pending' as const }],
      blockers: ['stripe cutover pending'],
    },
  ],
};

describe('MigrationPlanRenderer', () => {
  it('renders waves and items', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<MigrationPlanRenderer {...example} />);
    expect(container.querySelector('[data-testid="migration-plan-renderer"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-wave]').length).toBe(2);
    expect(container.querySelectorAll('[data-item-id]').length).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<MigrationPlanRenderer />);
    expect(container.textContent).toMatch(/no migration plan/);
  });
});
