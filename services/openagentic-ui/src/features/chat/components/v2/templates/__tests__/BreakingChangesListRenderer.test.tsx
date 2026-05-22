import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BreakingChangesListRenderer } from '../BreakingChangesListRenderer';

const example = {
  title: 'Breaking changes',
  changes: [
    { package: 'fastify', version: '4.x → 5.0', change_summary: 'ESM-only', severity: 'critical' as const, migration_hint: 'use import' },
    { package: 'vitest', version: '1 → 2', change_summary: 'globals removed', severity: 'major' as const },
    { package: 'zod', version: '3.22 → 3.23', change_summary: 'stricter regex', severity: 'minor' as const },
  ],
};

describe('BreakingChangesListRenderer', () => {
  it('renders one li per change with severity pill', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<BreakingChangesListRenderer {...example} />);
    expect(container.querySelector('[data-testid="breaking-changes-list-renderer"]')).not.toBeNull();
    const items = container.querySelectorAll('li[data-package]');
    expect(items.length).toBe(3);
    const pills = container.querySelectorAll('[data-testid="breaking-severity-pill"]');
    expect(pills.length).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<BreakingChangesListRenderer />);
    expect(container.textContent).toMatch(/no breaking changes/);
  });
});
