/**
 * P1 #940 — GroundingVerdictChip parser + render contract pin (2026-05-18).
 *
 * The chip parses an assistant message text for a "Grounding: ..."
 * verdict line emitted under the grounding T1 system-prompt addendum
 * (runChat.ts), and renders an inline chip showing the verdict + source
 * count. When no verdict line is present, the chip renders nothing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import {
  parseGroundingVerdict,
  GroundingVerdictChip,
  InlineGroundingChip,
} from '../GroundingVerdictChip';

describe('GroundingVerdictChip — parser', () => {
  it('parses "verified by web (5 sources)" → status=verified, sources=5', () => {
    const v = parseGroundingVerdict(
      'Final answer body here.\n\nGrounding: verified by web (5 sources)',
    );
    expect(v).toEqual(
      expect.objectContaining({ status: 'verified', sources: 5 }),
    );
  });

  it('parses "mixed (4 sources, 2 counterpoints)"', () => {
    const v = parseGroundingVerdict(
      'Body...\n\nGrounding: mixed (4 sources, 2 counterpoints)',
    );
    expect(v).toEqual(
      expect.objectContaining({
        status: 'mixed',
        sources: 4,
        counterpoints: 2,
      }),
    );
  });

  it('parses "refuted (3 sources)"', () => {
    const v = parseGroundingVerdict('text\n\nGrounding: refuted (3 sources)');
    expect(v?.status).toBe('refuted');
    expect(v?.sources).toBe(3);
  });

  it('parses "insufficient (no authoritative source found)" without numeric sources', () => {
    const v = parseGroundingVerdict(
      'foo\n\nGrounding: insufficient (no authoritative source found)',
    );
    expect(v?.status).toBe('insufficient');
    expect(v?.sources).toBeUndefined();
  });

  it('returns null when no verdict line is present', () => {
    expect(parseGroundingVerdict('Regular reply without grounding')).toBeNull();
    expect(parseGroundingVerdict('')).toBeNull();
    expect(parseGroundingVerdict(null)).toBeNull();
    expect(parseGroundingVerdict(undefined)).toBeNull();
  });
});

describe('GroundingVerdictChip — render', () => {
  it('renders the chip with verdict label + sources count', () => {
    render(
      <GroundingVerdictChip
        verdict={{ status: 'verified', sources: 5, raw: 'Grounding: verified by web (5 sources)' }}
      />,
    );
    const chip = screen.getByTestId('grounding-verdict-chip');
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('data-verdict')).toBe('verified');
    expect(chip.textContent).toContain('Verified by web');
    expect(chip.textContent).toContain('5 sources');
  });

  it('renders MIXED with both sources + counterpoints', () => {
    render(
      <GroundingVerdictChip
        verdict={{
          status: 'mixed',
          sources: 4,
          counterpoints: 2,
          raw: 'Grounding: mixed (4 sources, 2 counterpoints)',
        }}
      />,
    );
    const chip = screen.getByTestId('grounding-verdict-chip');
    expect(chip.getAttribute('data-verdict')).toBe('mixed');
    expect(chip.textContent).toContain('Mixed verdict');
    expect(chip.textContent).toContain('4 sources');
    expect(chip.textContent).toContain('2 counterpoints');
  });

  it('InlineGroundingChip renders nothing when no verdict line is present', () => {
    const { container } = render(
      <InlineGroundingChip assistantText="No verdict here." />,
    );
    expect(container.querySelector('[data-testid="grounding-verdict-chip"]')).toBeNull();
  });

  it('InlineGroundingChip renders chip when verdict line is present', () => {
    const text = `body\n\nGrounding: verified by web (2 sources)`;
    render(<InlineGroundingChip assistantText={text} />);
    expect(screen.getByTestId('grounding-verdict-chip')).toBeTruthy();
  });

  it('chip styling references theme tokens (no hex/rgb literals in inline color/bg)', () => {
    render(
      <GroundingVerdictChip
        verdict={{ status: 'verified', sources: 1, raw: 'r' }}
      />,
    );
    const chip = screen.getByTestId('grounding-verdict-chip') as HTMLElement;
    // Inline style values must reference `var(--cm-*)` / `var(--text-*)`.
    // We don't introspect the computed style (jsdom doesn't resolve
    // var()), we introspect the inline attribute string itself.
    const styleAttr = chip.getAttribute('style') || '';
    expect(styleAttr).toMatch(/var\(--cm-|var\(--text-|color-mix\(/);
    expect(styleAttr).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(styleAttr).not.toMatch(/\brgb\(/);
  });
});
