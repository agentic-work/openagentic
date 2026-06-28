/**
 * #942 (2026-05-20) — verdict claim surfacing on the grounding chip.
 *
 * Bug: the chip mounts (status pill + sources list) but the actual
 * verdict CLAIM TEXT is blank / missing. Expected shape — the chip
 * surfaces the model's one-sentence verdict claim verbatim. When neither
 * a wire-frame verdict nor a parseable "Verdict: <claim>" line in the
 * assistant body is present, the chip renders NOTHING (no empty chip).
 *
 * The model is instructed by the runChat.ts grounding-mode addendum to
 * emit, on a line of its own immediately above the `Grounding: ...`
 * status line, a one-sentence claim prefixed with `Verdict:`. The parser
 * extracts that text and surfaces it through `verdict.verdict` so the
 * chip can render it below the status label.
 *
 * Contracts pinned here:
 *   (a) When the assistant body contains a `Verdict: <claim>` line above
 *       the status line, `parseGroundingVerdict` returns a non-empty
 *       `verdict` string AND the chip renders it inside a
 *       `data-testid="grounding-verdict-claim"` element.
 *   (b) When the assistant body contains a `Verdict: <claim>` line but
 *       no `Grounding: ...` status line (fallback path), the chip still
 *       renders the claim text (status defaults to `insufficient`).
 *   (c) When neither a `Verdict:` line NOR a `Grounding:` line is
 *       present, `InlineGroundingChip` renders nothing (no empty pill).
 *   (d) `stripGroundingArtifacts` removes the `Verdict:` line as well as
 *       the `Grounding:` status line and `<grounding-sources>` block, so
 *       none of those leak into the rendered prose body.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import {
  parseGroundingVerdict,
  GroundingVerdictChip,
  InlineGroundingChip,
  stripGroundingArtifacts,
} from '../GroundingVerdictChip';

describe('#942 — GroundingVerdictChip verdict claim surfacing', () => {
  describe('parser', () => {
    it('(a) extracts a `Verdict: <claim>` line that sits above the status line', () => {
      const text =
        'Body about OAuth 2.0.\n\nVerdict: OAuth 2.0 is defined by RFC 6749 and remains the current authorization framework.\nGrounding: verified by web (3 sources)';
      const v = parseGroundingVerdict(text);
      expect(v).not.toBeNull();
      expect(v!.status).toBe('verified');
      expect(v!.verdict).toBe(
        'OAuth 2.0 is defined by RFC 6749 and remains the current authorization framework.',
      );
    });

    it('(b) returns a chip with verdict text even when no `Grounding:` status line is present (fallback path)', () => {
      // The chip should still render — status falls back to `insufficient`
      // because no status line was parsed, but the claim text IS present.
      const text =
        'Body.\n\nVerdict: The CVE was patched in v1.2.3, released 2026-04-18.';
      const v = parseGroundingVerdict(text);
      expect(v).not.toBeNull();
      expect(v!.verdict).toBe('The CVE was patched in v1.2.3, released 2026-04-18.');
      expect(v!.status).toBe('insufficient');
    });

    it('(c) returns null when neither a `Verdict:` nor a `Grounding:` line is present', () => {
      expect(parseGroundingVerdict('Just a plain answer, no grounding markers.')).toBeNull();
    });

    it('(d) ignores empty `Verdict:` lines (whitespace-only claim → null on fallback path)', () => {
      // A bare "Verdict:" with no claim must NOT be treated as a valid
      // verdict on the fallback path — render-nothing is the contract.
      expect(parseGroundingVerdict('Body.\n\nVerdict:   \n')).toBeNull();
    });

    it('preserves prior contract — `Grounding:` line alone still parses (no verdict claim)', () => {
      const v = parseGroundingVerdict('Body.\n\nGrounding: verified by web (2 sources)');
      expect(v).not.toBeNull();
      expect(v!.status).toBe('verified');
      expect(v!.verdict).toBeUndefined();
    });
  });

  describe('render', () => {
    it('(a) renders the verdict claim text in the chip when present', () => {
      const text =
        'Body.\n\nVerdict: OAuth 2.0 is the current framework (RFC 6749).\nGrounding: verified by web (2 sources)';
      render(<InlineGroundingChip assistantText={text} />);
      const claim = screen.getByTestId('grounding-verdict-claim');
      expect(claim).toBeTruthy();
      expect(claim.textContent).toContain('OAuth 2.0 is the current framework (RFC 6749).');
    });

    it('(b) renders chip with claim text even when no status line is present', () => {
      const text = 'Body.\n\nVerdict: Patched in v1.2.3 on 2026-04-18.';
      render(<InlineGroundingChip assistantText={text} />);
      const claim = screen.getByTestId('grounding-verdict-claim');
      expect(claim.textContent).toContain('Patched in v1.2.3 on 2026-04-18.');
    });

    it('(c) renders NOTHING when neither verdict nor status line is present', () => {
      const { container } = render(
        <InlineGroundingChip assistantText="No verdict and no grounding line." />,
      );
      expect(container.querySelector('[data-testid="grounding-verdict-chip"]')).toBeNull();
      expect(container.querySelector('[data-testid="grounding-verdict-claim"]')).toBeNull();
    });

    it('does NOT render an empty `grounding-verdict-claim` element when the verdict field is absent (legacy)', () => {
      // Legacy turns — `Grounding:` line only, no `Verdict:` line.
      // The chip still mounts (status pill), but the claim element must
      // NOT appear (no blank text node).
      render(
        <GroundingVerdictChip
          verdict={{ status: 'verified', sources: 2, raw: 'Grounding: verified by web (2 sources)' }}
        />,
      );
      expect(screen.queryByTestId('grounding-verdict-claim')).toBeNull();
    });

    it('claim element styling references theme tokens (no hex/rgb literals)', () => {
      const text =
        'Body.\n\nVerdict: x.\nGrounding: verified by web (1 sources)';
      render(<InlineGroundingChip assistantText={text} />);
      const claim = screen.getByTestId('grounding-verdict-claim') as HTMLElement;
      const styleAttr = claim.getAttribute('style') || '';
      // Color tokens via var(--cm-*) / var(--text-*) only.
      if (styleAttr.includes('color') || styleAttr.includes('background')) {
        expect(styleAttr).toMatch(/var\(--cm-|var\(--text-|var\(--accent/);
      }
      expect(styleAttr).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      expect(styleAttr).not.toMatch(/\brgb\(/);
    });
  });

  describe('stripGroundingArtifacts', () => {
    it('(d) strips the `Verdict:` line as well as the `Grounding:` status line and sources block', () => {
      const text =
        'Body line 1.\nBody line 2.\n\nVerdict: A one-sentence claim.\nGrounding: verified by web (2 sources)\n<grounding-sources>[{"url":"https://a.example/","title":"A"}]</grounding-sources>';
      const stripped = stripGroundingArtifacts(text);
      expect(stripped).not.toMatch(/^Verdict:/m);
      expect(stripped).not.toMatch(/^Grounding:/m);
      expect(stripped).not.toMatch(/<grounding-sources>/);
      expect(stripped).toContain('Body line 1.');
      expect(stripped).toContain('Body line 2.');
    });

    it('strips a fallback-path `Verdict:` line even when no `Grounding:` status line is present', () => {
      const stripped = stripGroundingArtifacts(
        'Prose body.\n\nVerdict: A claim that should not leak into prose.',
      );
      expect(stripped).not.toMatch(/^Verdict:/m);
      expect(stripped).toContain('Prose body.');
    });
  });
});
