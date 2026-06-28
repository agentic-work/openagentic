/**
 * CitationChip — v2 chatmode primitive (#502).
 *
 * Numbered superscript chip rendered inline within prose to point at a
 * source. Hover/focus surfaces the source string via title + aria-label.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CitationChip } from '../CitationChip';

describe('CitationChip', () => {
  it('renders a <button> with the index as text content', () => {
    render(<CitationChip index={3} source="Azure subscriptions API" />);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('3');
  });

  it('exposes ARIA label "Citation: {source}"', () => {
    render(<CitationChip index={1} source="Cost Explorer report" />);
    expect(screen.getByLabelText('Citation: Cost Explorer report')).toBeInTheDocument();
  });

  it('sets title attribute to the source', () => {
    render(<CitationChip index={2} source="Resource Graph query" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('title')).toBe('Resource Graph query');
  });

  it('invokes onClick when clicked', () => {
    const onClick = vi.fn();
    render(<CitationChip index={1} source="src" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses type="button" so it never submits a parent form', () => {
    render(<CitationChip index={1} source="src" />);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('passes through a custom className alongside the base class', () => {
    render(<CitationChip index={1} source="src" className="extra-class" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('cm-citation');
    expect(btn.className).toContain('extra-class');
  });
});
