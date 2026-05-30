/**
 * RagCitationChip — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RagCitationChip } from '../RagCitationChip';

describe('RagCitationChip', () => {
  it('renders source label and score', () => {
    render(<RagCitationChip source="handbook.md" score={0.87} />);
    const chip = screen.getByTestId('rag-citation-chip');
    expect(chip.textContent).toContain('handbook.md');
    expect(chip.textContent).toMatch(/87%/);
  });

  it('truncates very long sources', () => {
    const longSource = 'a'.repeat(200);
    render(<RagCitationChip source={longSource} />);
    const chip = screen.getByTestId('rag-citation-chip');
    expect(chip.textContent?.length ?? 0).toBeLessThan(longSource.length);
  });

  it('renders as anchor when url provided', () => {
    render(<RagCitationChip source="doc.md" url="https://example.com/doc.md" />);
    const chip = screen.getByTestId('rag-citation-chip') as HTMLAnchorElement;
    expect(chip.tagName).toBe('A');
    expect(chip.href).toBe('https://example.com/doc.md');
  });

  it('exposes chunkId on data attribute', () => {
    render(<RagCitationChip source="doc.md" chunkId="chunk-7" />);
    expect(
      screen.getByTestId('rag-citation-chip').getAttribute('data-chunk-id')
    ).toBe('chunk-7');
  });
});
