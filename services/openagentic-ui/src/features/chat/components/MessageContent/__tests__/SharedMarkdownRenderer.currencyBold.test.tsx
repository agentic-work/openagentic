/**
 * Sev-0 #797 — currency `$N` inside `**...**` must not trigger KaTeX inline math.
 *
 * Smoking gun (Q7 capture, 2026-05-13): assistant emitted
 *   **Migration savings per quarter: $1,361,869**
 * The chatmode markdown pipeline rendered this as vertically-stacked Unicode
 * `∗∗` (U+2217 ASTERISK OPERATOR) glyphs interleaved with KaTeX-styled digits —
 * `remark-math@6` defaults `singleDollarTextMath: true`, so the first `$`
 * pair-matched with the next `$` in the buffer and the `$N` span got handed
 * to KaTeX while the orphan `**` outside the math island got escaped as `∗`.
 *
 * Fix: pass `[remarkMath, { singleDollarTextMath: false }]` to the renderer
 * plugin chain. Block math `$$E=mc^2$$` continues to work; single-$ currency
 * stops being parsed as inline math.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../EnhancedShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../ShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../EnhancedCodeBlock', () => ({ default: () => null }));
vi.mock('../ChartRenderer', () => ({ default: () => null }));

import { SharedMarkdownRenderer } from '../SharedMarkdownRenderer';

describe('SharedMarkdownRenderer — #797 currency-in-bold must not become KaTeX', () => {
  it('renders **$1,361,869** as <strong>$1,361,869</strong> with no KaTeX glyphs', () => {
    const { container } = render(
      <SharedMarkdownRenderer content="**$1,361,869**" />,
    );

    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('$1,361,869');

    // No KaTeX markup — the renderer must NOT have routed this through math.
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('.katex-html')).toBeNull();
    expect(container.querySelector('.katex-mathml')).toBeNull();

    // No Unicode ASTERISK OPERATOR (U+2217) leaking from math-mode `*`.
    expect(container.textContent).not.toContain('∗');
  });

  it('renders a paragraph with three currency-bold values cleanly', () => {
    const content = '**$1,361,869** saved per quarter. **$126,923** migration cost. **$16.2M** 3-yr net benefit.';
    const { container } = render(<SharedMarkdownRenderer content={content} />);

    const strongs = container.querySelectorAll('strong');
    expect(strongs.length).toBe(3);
    expect(strongs[0].textContent).toBe('$1,361,869');
    expect(strongs[1].textContent).toBe('$126,923');
    expect(strongs[2].textContent).toBe('$16.2M');

    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).not.toContain('∗');
  });

  it('block math `$$E=mc^2$$` still renders through KaTeX (regression guard)', () => {
    const { container } = render(
      <SharedMarkdownRenderer content={'Equation:\n\n$$E=mc^2$$\n\nDone.'} />,
    );

    // Block math is the only legitimate KaTeX trigger we keep.
    expect(container.querySelector('.katex-display, .katex')).not.toBeNull();
  });
});
