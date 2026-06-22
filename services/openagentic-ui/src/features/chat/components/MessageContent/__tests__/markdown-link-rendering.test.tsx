/**
 * Z.6 — Markdown link rendering in SharedMarkdownRenderer
 *
 * Verifies that standard Markdown links like [text](url) render as proper
 * <a> HTML elements and do NOT leak raw `[text](url)` syntax into the DOM.
 *
 * Root-cause investigation: SharedMarkdownRenderer has an `a:` component
 * in the ReactMarkdown `components` prop (lines 1346-1404). The detectCitation
 * function only intercepts bare-digit link text ([1], [2], etc.), leaving
 * regular named links to render normally via the fallback anchor renderer.
 * This test pins that the renderer correctly emits <a> elements.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// Stub heavy visual deps — keep test focused on link rendering.
vi.mock('../EnhancedShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../ShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../EnhancedCodeBlock', () => ({ default: () => null }));
vi.mock('../ChartRenderer', () => ({ default: () => null }));

import { SharedMarkdownRenderer } from '../SharedMarkdownRenderer';

describe('SharedMarkdownRenderer — markdown link rendering (Z.6)', () => {
  it('renders [text](url) as <a href> element, not raw syntax', () => {
    const { container } = render(
      <SharedMarkdownRenderer
        content="See the [official AWS guide](https://example.com) for details."
      />
    );
    // Should have an anchor element
    const a = container.querySelector('a[href="https://example.com"]');
    expect(a).not.toBeNull();
    expect(a?.textContent).toBe('official AWS guide');

    // Should NOT contain raw bracket syntax in text
    const text = container.textContent ?? '';
    expect(text).not.toContain('[official AWS guide]');
    expect(text).not.toContain('(https://example.com)');
  });

  it('link renders with target=_blank and rel=noopener noreferrer', () => {
    const { container } = render(
      <SharedMarkdownRenderer
        content="Read [the docs](https://docs.example.com) here."
      />
    );
    const a = container.querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('citation link [1](url) still renders as a chip (not a plain link)', () => {
    const { container } = render(
      <SharedMarkdownRenderer
        content="See source [1](https://example.com) here."
      />
    );
    // Numeric citation — should be treated as a citation chip (compact inline)
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    // The text content should be "1" (compact chip) not "1https://example.com"
    expect(a?.textContent).toBe('1');
  });

  it('renders multiple links correctly in a paragraph', () => {
    const { container } = render(
      <SharedMarkdownRenderer
        content="Use [AWS](https://aws.amazon.com) and [Azure](https://azure.microsoft.com)."
      />
    );
    const links = container.querySelectorAll('a[href]');
    const hrefs = Array.from(links).map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('https://aws.amazon.com');
    expect(hrefs).toContain('https://azure.microsoft.com');
  });
});
