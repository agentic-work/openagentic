/**
 * TestHarnessView — chrome consistency tests (Bulk Batch B2)
 *
 * Asserts the universal admin-page chrome: PageHeader at top, H1 title,
 * and no hex literals in inline styles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../useTestHarness', () => ({
  useTestHarness: () => ({
    results: [],
    logEntries: [],
    running: false,
    summary: null,
    startTests: vi.fn(),
    stopTests: vi.fn(),
    clearResults: vi.fn(),
  }),
}));

vi.mock('../TestPanel', () => ({
  default: () => <div data-testid="stub-test-panel" />,
}));

vi.mock('../TestLogStream', () => ({
  default: () => <div data-testid="stub-test-log-stream" />,
}));

import TestHarnessView from '../TestHarnessView';

describe('TestHarnessView — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<TestHarnessView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Test|Harness/i', async () => {
    render(<TestHarnessView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Test|Harness/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<TestHarnessView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
