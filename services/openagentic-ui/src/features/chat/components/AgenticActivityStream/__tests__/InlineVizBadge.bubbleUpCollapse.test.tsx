/**
 * Regression: clicking action buttons or the ellipsis menu inside the
 * expanded WidgetRenderer must NOT bubble up to the badge wrapper and
 * collapse the card. Fix moved `onClick={toggle}` from the OUTER wrapper
 * onto the PILL only.
 *
 * Issue: "the diagrams pop out, or if you click on any of the zoom in/out,
 * etc buttons in the diagram is just minimizes the card" — user direction
 * 2026-05-19.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { InlineVizBadge } from '../InlineVizBadge';

beforeEach(() => {
  // The badge persists expanded state per block.id in sessionStorage.
  // Clean it between tests so each test starts with default-expanded.
  try { window.sessionStorage.clear(); } catch {}
});

const baseBlock = {
  id: 'viz-test-1',
  type: 'viz_render' as const,
  template: 'arch_diagram',
  kind: 'arch_diagram',
  title: 'Test diagram',
  content: '<svg width="100" height="100"><rect width="100" height="100"/></svg>',
  isComplete: true,
};

describe('InlineVizBadge — bubble-up collapse fix', () => {
  it('pill click toggles expansion (badge is interactive)', () => {
    render(<InlineVizBadge block={baseBlock as any} />);
    const badge = screen.getByTestId('viz-render-badge');
    // Default expanded (per #879 default-expanded behavior)
    expect(badge.getAttribute('data-expanded')).toBe('true');

    // The toggle button is the pill — not the outer wrapper.
    const pill = badge.querySelector('[role="button"]');
    expect(pill).not.toBeNull();
    fireEvent.click(pill!);
    expect(badge.getAttribute('data-expanded')).toBe('false');
  });

  it('clicks inside the expanded content area do NOT collapse the badge', () => {
    render(<InlineVizBadge block={baseBlock as any} />);
    const badge = screen.getByTestId('viz-render-badge');
    expect(badge.getAttribute('data-expanded')).toBe('true');

    // Simulate a click on a synthetic action button injected inside the
    // expanded area (mimicking the in-iframe action overlay / ellipsis
    // menu / zoom buttons).
    const expandedArea = badge.querySelector('[data-testid="viz-render-expanded"]');
    expect(expandedArea).not.toBeNull();
    const fakeBtn = document.createElement('button');
    fakeBtn.setAttribute('aria-label', 'zoom in (mock)');
    expandedArea!.appendChild(fakeBtn);

    fireEvent.click(fakeBtn);

    // The badge MUST stay expanded — toggle is on the pill only.
    expect(badge.getAttribute('data-expanded')).toBe('true');
  });

  it('pop-out button click does NOT collapse the badge (stopPropagation guard)', () => {
    const diagramBlock = {
      ...baseBlock,
      template: 'arch_diagram', // arch_diagram is in DIAGRAM_TEMPLATES → pop-out button shows
    };
    render(<InlineVizBadge block={diagramBlock as any} />);
    const badge = screen.getByTestId('viz-render-badge');
    expect(badge.getAttribute('data-expanded')).toBe('true');

    const popout = screen.queryByTestId('viz-render-popout');
    if (popout) {
      fireEvent.click(popout);
      // Pop-out is a stub right now — it should NOT collapse the badge.
      expect(badge.getAttribute('data-expanded')).toBe('true');
    }
  });

  it('outer wrapper is NOT a button (no onClick on it)', () => {
    render(<InlineVizBadge block={baseBlock as any} />);
    const badge = screen.getByTestId('viz-render-badge');
    // The outer wrapper should not carry the role=button — that's now on the pill.
    expect(badge.getAttribute('role')).toBeNull();
    expect(badge.getAttribute('aria-expanded')).toBeNull();
  });
});
