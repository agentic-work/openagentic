/**
 * OpenAgenticWordmark — `⌥ openagentic` brand-mark contract.
 *
 * The wordmark renders the macOS option-key glyph (⌥) in signal orange
 * followed by the lowercase word `openagentic` in cream/ink, set in
 * IBM Plex Mono (the warm field-guide identity — matches login +
 * openagentics.io). Animation (per-char stagger fade-in) is opt-in via
 * the `animate` prop.
 *
 * These specs assert the structural contract — they do NOT pin to exact
 * framer-motion implementation details, just to:
 *   - text content is `⌥ openagentic`
 *   - the ⌥ glyph leads and carries the signal-orange color
 *   - the word `openagentic` is rendered
 *   - IBM Plex Mono / monospace font-family is applied on the root
 *   - `animate={false}` still renders the wordmark
 *   - the `className` prop is honored
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

import { OpenAgenticWordmark } from '../OpenAgenticWordmark';

describe('OpenAgenticWordmark', () => {
  it('renders the `⌥ openagentic` text content', () => {
    const { container } = render(<OpenAgenticWordmark />);
    expect(container.textContent).toBe('⌥ openagentic');
  });

  it('leads with the ⌥ option-key glyph', () => {
    const { container } = render(<OpenAgenticWordmark />);
    const text = container.textContent ?? '';
    expect(text.startsWith('⌥')).toBe(true);
    expect(text).toContain('openagentic');
  });

  it('renders the ⌥ glyph in the signal-orange brand color', () => {
    const { container } = render(<OpenAgenticWordmark />);
    const styles = Array.from(container.querySelectorAll('span'))
      .map(s => (s.getAttribute('style') ?? '').toLowerCase());
    const hasSignal = styles.some(s => s.includes('ff5722') || s.includes('--signal'));
    expect(hasSignal).toBe(true);
  });

  it('uses a monospace / IBM Plex Mono font-family on the root', () => {
    const { container } = render(<OpenAgenticWordmark />);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root).not.toBeNull();
    const ff = (root!.getAttribute('style') ?? '').toLowerCase();
    expect(ff).toMatch(/plex mono|monospace|cm-mono-font|sfmono|menlo/);
  });

  it('still renders the wordmark when animate={false}', () => {
    const { container } = render(<OpenAgenticWordmark animate={false} />);
    expect(container.textContent).toBe('⌥ openagentic');
  });

  it('honors the className prop', () => {
    const { container } = render(<OpenAgenticWordmark className="custom-cls" />);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root?.className).toContain('custom-cls');
  });
});
