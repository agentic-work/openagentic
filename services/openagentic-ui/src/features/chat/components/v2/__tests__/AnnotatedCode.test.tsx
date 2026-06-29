/**
 * Phase 24 — AnnotatedCode (mocks 03, 07).
 *
 * Mock 03 anatomy:
 *   <pre class="cm-code">
 *     <span class="cm-ln">line 1</span>
 *     <span class="cm-ln cm-ann">line 2 — flagged</span>
 *     <span class="cm-ln">line 3</span>
 *   </pre>
 *
 * Renders pre-tokenized lines with the cm-ann class on lines listed
 * in `annotatedLines`. Caller is responsible for the highlighting
 * (Shiki/etc.) — this primitive just adds the annotation overlay.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnnotatedCode } from '../AnnotatedCode';

const sample = [
  'package handlers',
  'import "context"',
  'err := db.Query(ctx, sql, args)',
  'if err != nil { return err }',
];

describe('AnnotatedCode (mocks 03, 07)', () => {
  it('renders pre.cm-code with one cm-ln per line', () => {
    const { container } = render(<AnnotatedCode lines={sample} annotatedLines={[]} />);
    const pre = container.querySelector('pre.cm-code');
    expect(pre).not.toBeNull();
    expect(pre!.querySelectorAll('.cm-ln').length).toBe(4);
  });

  it('adds cm-ann class to lines in annotatedLines (1-based)', () => {
    const { container } = render(
      <AnnotatedCode lines={sample} annotatedLines={[3]} />,
    );
    const lines = container.querySelectorAll('.cm-ln');
    expect(lines[0]).not.toHaveClass('cm-ann');
    expect(lines[2]).toHaveClass('cm-ann');
    expect(lines[3]).not.toHaveClass('cm-ann');
  });

  it('handles multiple annotated lines', () => {
    const { container } = render(
      <AnnotatedCode lines={sample} annotatedLines={[1, 3, 4]} />,
    );
    const annotated = container.querySelectorAll('.cm-ln.cm-ann');
    expect(annotated.length).toBe(3);
  });

  it('renders aria-label with the supplied filename', () => {
    const { container } = render(
      <AnnotatedCode lines={sample} annotatedLines={[]} ariaLabel="handlers/user.go" />,
    );
    expect(container.querySelector('pre.cm-code')).toHaveAttribute(
      'aria-label',
      'handlers/user.go',
    );
  });

  it('renders nothing when lines empty', () => {
    const { container } = render(<AnnotatedCode lines={[]} annotatedLines={[]} />);
    expect(container.querySelector('pre.cm-code')).toBeNull();
  });
});
