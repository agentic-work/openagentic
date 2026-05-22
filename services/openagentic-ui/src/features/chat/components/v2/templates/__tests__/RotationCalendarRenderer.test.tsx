import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RotationCalendarRenderer } from '../RotationCalendarRenderer';

const example = {
  title: 'Platform on-call',
  rotation_name: 'platform-oncall',
  month: '2026-05',
  shifts: [
    { date: '2026-05-01', primary: 'trent', secondary: 'sam' },
    { date: '2026-05-02', primary: 'trent', secondary: 'sam' },
    { date: '2026-05-03', primary: 'sam', secondary: 'priya' },
    { date: '2026-05-04', primary: 'sam', secondary: 'priya' },
    { date: '2026-05-13', primary: 'sam', secondary: 'priya' },
  ],
};

describe('RotationCalendarRenderer', () => {
  it('renders 31 day cells for May 2026', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RotationCalendarRenderer {...example} />);
    expect(container.querySelector('[data-testid="rotation-calendar-renderer"]')).not.toBeNull();
    const dayCells = container.querySelectorAll('[data-testid="rotation-cell"]');
    expect(dayCells.length).toBe(31);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when month invalid', () => {
    const { container } = render(<RotationCalendarRenderer />);
    expect(container.textContent).toMatch(/invalid rotation month/);
  });
});
