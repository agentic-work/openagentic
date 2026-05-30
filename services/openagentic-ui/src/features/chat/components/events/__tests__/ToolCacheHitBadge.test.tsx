/**
 * ToolCacheHitBadge — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolCacheHitBadge } from '../ToolCacheHitBadge';

describe('ToolCacheHitBadge', () => {
  it('renders the base label', () => {
    render(<ToolCacheHitBadge name="aws_list_instances" />);
    expect(screen.getByTestId('tool-cache-hit-badge').textContent).toMatch(
      /served from cache/
    );
  });

  it('shows similarity when provided (semantic cache)', () => {
    render(<ToolCacheHitBadge name="aws_list_instances" similarity={0.92} />);
    const badge = screen.getByTestId('tool-cache-hit-badge');
    expect(badge.textContent).toMatch(/92% match/);
    expect(badge.getAttribute('data-similarity')).toBe('0.92');
  });
});
