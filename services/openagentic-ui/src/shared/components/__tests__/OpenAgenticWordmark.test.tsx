/**
 * OpenAgenticWordmark — animated brand wordmark contract.
 *
 * The wordmark renders the literal `[openagentic]` string with each
 * character of `openagentic` colored from an 11-hue brand palette. The
 * surrounding `[` and `]` brackets are dimmed. Animation (per-char
 * stagger fade-in) is opt-in via the `animate` prop.
 *
 * These specs assert the structural contract — they do NOT pin to
 * exact framer-motion implementation details, just to:
 *   - 11 distinct char colors used
 *   - `[` and `]` bracket wrappers present
 *   - the word `openagentic` is rendered
 *   - monospace font-family is applied
 *   - `animate={false}` still renders the wordmark (no animation
 *     props required to be wired through)
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { OpenAgenticWordmark } from '../OpenAgenticWordmark';

const BRAND_PALETTE = [
  '#ff5ea8',
  '#ff8c42',
  '#ffc43f',
  '#c3ed4a',
  '#5fdd82',
  '#3fd0d4',
  '#58a6ff',
  '#7c7cff',
  '#b25cff',
  '#ff6fd1',
  '#ff5ea8',
];

describe('OpenAgenticWordmark', () => {
  it('renders the full `[openagentic]` text content', () => {
    const { container } = render(<OpenAgenticWordmark />);
    expect(container.textContent).toBe('[openagentic]');
  });

  it('wraps the wordmark in `[` and `]` bracket spans', () => {
    const { container } = render(<OpenAgenticWordmark />);
    const text = container.textContent ?? '';
    expect(text.startsWith('[')).toBe(true);
    expect(text.endsWith(']')).toBe(true);
  });

  it('renders 11 character spans, each with a brand-palette color', () => {
    const { container } = render(<OpenAgenticWordmark data-testid="wm" />);
    // Every 'openagentic' char span must carry an inline color style
    // that matches the brand palette. We collect the inline colors on
    // any descendant span and intersect with the palette.
    const spans = container.querySelectorAll('span');
    const paletteSet = new Set(BRAND_PALETTE.map(c => c.toLowerCase()));
    const colorsInDom: string[] = [];
    spans.forEach(s => {
      const c = (s.getAttribute('style') ?? '').toLowerCase();
      // capture hex color strings present in style
      const m = c.match(/#[0-9a-f]{6}/g);
      if (m) {
        for (const hex of m) if (paletteSet.has(hex)) colorsInDom.push(hex);
      }
    });
    // At least 11 char-color usages (one per char of `openagentic`),
    // and the set of distinct palette colors used must be at least 10
    // (the palette has 10 distinct hues — first and last are both
    // #ff5ea8 by design).
    expect(colorsInDom.length).toBeGreaterThanOrEqual(11);
    const distinct = new Set(colorsInDom);
    expect(distinct.size).toBeGreaterThanOrEqual(10);
  });

  it('uses a monospace font-family on the root', () => {
    const { container } = render(<OpenAgenticWordmark />);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root).not.toBeNull();
    const ff = (root!.getAttribute('style') ?? '').toLowerCase();
    expect(ff).toMatch(/monospace|cm-mono-font|sfmono|menlo/);
  });

  it('still renders the wordmark when animate={false}', () => {
    const { container } = render(<OpenAgenticWordmark animate={false} />);
    expect(container.textContent).toBe('[openagentic]');
  });

  it('honors the className prop', () => {
    const { container } = render(<OpenAgenticWordmark className="custom-cls" />);
    const root = container.firstElementChild as HTMLElement | null;
    expect(root?.className).toContain('custom-cls');
  });
});
