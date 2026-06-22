/**
 * Phase 4 of universal-anatomy parity — citation chips parsed inline in prose.
 *
 * Mock anatomy: mocks/UX/01:1139 + 04, 05, 06, 07, 09 use `<sup class="citation">`
 * inline references. We accept `[cite:N]` and `[cite:N,M,...]` markers in
 * the assistant prose and replace each with a `<CitationChip index={N}>`.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// Stub ShikiCodeBlock + ChartRenderer to keep this test focused on the
// citation marker substitution. SharedMarkdownRenderer pulls in heavy
// deps that aren't relevant here.
vi.mock('../EnhancedShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../ShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../EnhancedCodeBlock', () => ({ default: () => null }));
vi.mock('../ChartRenderer', () => ({ default: () => null }));

import { SharedMarkdownRenderer } from '../SharedMarkdownRenderer';

describe('SharedMarkdownRenderer — [cite:N] markers (mock 01:1139)', () => {
  it('replaces a single [cite:1] marker with a sup.cm-citation', () => {
    const { container } = render(
      <SharedMarkdownRenderer content="See [cite:1] for context." />,
    );
    const cite = container.querySelector('sup.cm-citation');
    expect(cite).not.toBeNull();
    expect(cite).toHaveTextContent('1');
    // The surrounding text remains.
    expect(container.textContent).toMatch(/See/);
    expect(container.textContent).toMatch(/for context/);
  });

  it('replaces multiple [cite:N] markers in one paragraph', () => {
    const { container } = render(
      <SharedMarkdownRenderer content="A [cite:1] B [cite:2] C [cite:3]" />,
    );
    const cites = container.querySelectorAll('sup.cm-citation');
    expect(cites.length).toBe(3);
    expect(cites[0]).toHaveTextContent('1');
    expect(cites[1]).toHaveTextContent('2');
    expect(cites[2]).toHaveTextContent('3');
  });

  it('does not transform inline code containing the literal [cite:N]', () => {
    const { container } = render(
      <SharedMarkdownRenderer content="Use the syntax `[cite:1]` to cite." />,
    );
    // Inline code path is mocked to render null, but the surrounding
    // prose must NOT have a sup.cm-citation generated from the codespan.
    expect(container.querySelectorAll('sup.cm-citation').length).toBe(0);
  });
});
