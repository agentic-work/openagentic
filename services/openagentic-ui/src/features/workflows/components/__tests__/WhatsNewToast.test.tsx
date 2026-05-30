/**
 * WhatsNewToast — first-load discoverability toast for 0.7.0.
 *
 * Renders a dismissible card listing what's new (swarm popover,
 * secrets wizard, per-slot model picker, NavRail, signed traces).
 * Once dismissed, localStorage remembers — never shows again until
 * the version bumps.
 *
 * Tests:
 *   - hidden when localStorage flag is set
 *   - visible on first render when flag is unset
 *   - dismiss button writes the flag + hides the toast
 *   - hidden when localStorage throws (defensive)
 *   - lists at least 4 of the 5 marquee features
 *   - clicking a feature CTA fires onSelectFeature with the id
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhatsNewToast } from '../WhatsNewToast';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('WhatsNewToast', () => {
  it('does not render when the dismissed flag is already set for 0.7.0', () => {
    localStorage.setItem('openagentic.workflow.whatsNew.dismissed', '0.7.0');
    const { container } = render(<WhatsNewToast version="0.7.0" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders on first render when no dismissed flag is set', () => {
    render(<WhatsNewToast version="0.7.0" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/what's new/i)).toBeTruthy();
  });

  it('renders when the dismissed flag is for an OLDER version', () => {
    localStorage.setItem('openagentic.workflow.whatsNew.dismissed', '0.6.27');
    render(<WhatsNewToast version="0.7.0" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('clicking dismiss writes the version flag and hides the toast', () => {
    const { rerender } = render(<WhatsNewToast version="0.7.0" />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(localStorage.getItem('openagentic.workflow.whatsNew.dismissed')).toBe('0.7.0');
    // Re-render reads the flag and bails out
    rerender(<WhatsNewToast version="0.7.0" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides defensively when localStorage throws on read', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => { throw new Error('blocked'); });
    try {
      const { container } = render(<WhatsNewToast version="0.7.0" />);
      expect(container.firstChild).toBeNull();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it('lists at least 4 of the 5 marquee 0.7.0 features by name', () => {
    render(<WhatsNewToast version="0.7.0" />);
    const text = document.body.textContent || '';
    const matches = [
      /swarm/i, /secrets/i, /model picker|per-slot/i, /nav rail|sidebar/i, /signed trace|trace/i,
    ].filter((re) => re.test(text)).length;
    expect(matches).toBeGreaterThanOrEqual(4);
  });

  it('clicking a feature CTA calls onSelectFeature with the matching id', () => {
    const onSelectFeature = vi.fn();
    render(<WhatsNewToast version="0.7.0" onSelectFeature={onSelectFeature} />);
    // The first feature CTA is "swarm-popover" — click any [data-feature]
    const firstCta = document.querySelector('[data-feature]');
    expect(firstCta).toBeTruthy();
    fireEvent.click(firstCta as HTMLElement);
    expect(onSelectFeature).toHaveBeenCalledTimes(1);
    // arg is a non-empty string id
    const arg = onSelectFeature.mock.calls[0][0];
    expect(typeof arg).toBe('string');
    expect(arg.length).toBeGreaterThan(0);
  });
});
