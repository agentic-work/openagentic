/**
 * Grounding sources surfacing — user feedback 2026-05-18 PM:
 *   "when a request is grounded- the verified pill needs to show the
 *    actual links/real refs used to pull the data."
 *
 * Schema (server-side runChat.ts addendum):
 *   The model's final message ends with the verdict line followed by a
 *   `<grounding-sources>` JSON block carrying the URLs the web_search
 *   tool returned, in the order the model relied on them:
 *
 *     Grounding: verified by web (3 sources)
 *     <grounding-sources>[
 *       {"url":"https://datatracker.ietf.org/doc/html/rfc6749","title":"RFC 6749"},
 *       {"url":"https://oauth.net/2/","title":"OAuth 2.0 — oauth.net"},
 *       {"url":"https://en.wikipedia.org/wiki/OAuth","title":"OAuth — Wikipedia"}
 *     ]</grounding-sources>
 *
 * Parser:
 *   - Returns `sourcesList: Array<{url, title}>` on the verdict object.
 *   - Strips both the verdict line AND the sources block from the
 *     rendered prose so neither leaks into the message body.
 *
 * Chip:
 *   - When sourcesList is non-empty, renders a clickable list below
 *     the verdict label — one link per source, theme-token colors
 *     (CLAUDE.md rule 8b), opens in a new tab with rel=noopener.
 *   - Title shown as link text, URL as title attr + hover tooltip.
 *   - When sourcesList is empty/absent, behaves as before (legacy chip).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import {
  parseGroundingVerdict,
  GroundingVerdictChip,
  InlineGroundingChip,
} from '../GroundingVerdictChip';

describe('GroundingVerdictChip — sourcesList parser (2026-05-18 PM)', () => {
  const SAMPLE = `Final answer body about RFC 6749.

Grounding: verified by web (3 sources)
<grounding-sources>[
  {"url":"https://datatracker.ietf.org/doc/html/rfc6749","title":"RFC 6749"},
  {"url":"https://oauth.net/2/","title":"OAuth 2.0 — oauth.net"},
  {"url":"https://en.wikipedia.org/wiki/OAuth","title":"OAuth — Wikipedia"}
]</grounding-sources>`;

  it('extracts sourcesList from the <grounding-sources> JSON block', () => {
    const v = parseGroundingVerdict(SAMPLE);
    expect(v).not.toBeNull();
    expect(v!.status).toBe('verified');
    expect(v!.sources).toBe(3);
    expect(v!.sourcesList).toBeDefined();
    expect(v!.sourcesList).toHaveLength(3);
    expect(v!.sourcesList![0]).toEqual({
      url: 'https://datatracker.ietf.org/doc/html/rfc6749',
      title: 'RFC 6749',
    });
    expect(v!.sourcesList![1].url).toBe('https://oauth.net/2/');
    expect(v!.sourcesList![2].title).toContain('Wikipedia');
  });

  it('returns sourcesList undefined when no <grounding-sources> block is present (legacy)', () => {
    const v = parseGroundingVerdict('Body.\n\nGrounding: verified by web (5 sources)');
    expect(v).not.toBeNull();
    expect(v!.sources).toBe(5);
    expect(v!.sourcesList).toBeUndefined();
  });

  it('returns sourcesList undefined on malformed JSON inside the block (defensive)', () => {
    const v = parseGroundingVerdict(
      'Body.\n\nGrounding: verified by web (2 sources)\n<grounding-sources>not-json-at-all</grounding-sources>',
    );
    expect(v).not.toBeNull();
    expect(v!.status).toBe('verified');
    expect(v!.sourcesList).toBeUndefined();
  });

  it('filters out non-string url entries (defensive)', () => {
    const v = parseGroundingVerdict(
      'x\n\nGrounding: verified by web (1 sources)\n<grounding-sources>[{"url":"https://ok.example/","title":"OK"},{"url":42,"title":"bad"}]</grounding-sources>',
    );
    expect(v!.sourcesList).toEqual([{ url: 'https://ok.example/', title: 'OK' }]);
  });

  it('drops items with non-http(s) urls (XSS / data:/javascript: defence)', () => {
    const v = parseGroundingVerdict(
      'x\n\nGrounding: verified by web (1 sources)\n<grounding-sources>[{"url":"javascript:alert(1)","title":"bad"},{"url":"https://good.example/","title":"good"}]</grounding-sources>',
    );
    expect(v!.sourcesList).toEqual([{ url: 'https://good.example/', title: 'good' }]);
  });
});

describe('GroundingVerdictChip — sources list render', () => {
  it('renders one anchor per source with target=_blank + rel=noopener', () => {
    render(
      <GroundingVerdictChip
        verdict={{
          status: 'verified',
          sources: 2,
          raw: 'Grounding: verified by web (2 sources)',
          sourcesList: [
            { url: 'https://datatracker.ietf.org/doc/html/rfc6749', title: 'RFC 6749' },
            { url: 'https://oauth.net/2/', title: 'oauth.net' },
          ],
        }}
      />,
    );
    const list = screen.getByTestId('grounding-sources-list');
    expect(list).toBeTruthy();
    const anchors = list.querySelectorAll('a');
    expect(anchors.length).toBe(2);

    expect(anchors[0].getAttribute('href')).toBe('https://datatracker.ietf.org/doc/html/rfc6749');
    expect(anchors[0].getAttribute('target')).toBe('_blank');
    expect(anchors[0].getAttribute('rel') || '').toContain('noopener');
    expect(anchors[0].textContent).toContain('RFC 6749');

    expect(anchors[1].getAttribute('href')).toBe('https://oauth.net/2/');
    expect(anchors[1].textContent).toContain('oauth.net');
  });

  it('does not render the sources-list container when sourcesList is empty/absent (legacy chip)', () => {
    render(
      <GroundingVerdictChip
        verdict={{ status: 'verified', sources: 5, raw: 'Grounding: verified by web (5 sources)' }}
      />,
    );
    expect(screen.queryByTestId('grounding-sources-list')).toBeNull();
  });

  it('source links use theme tokens, no hex/rgb literals', () => {
    render(
      <GroundingVerdictChip
        verdict={{
          status: 'verified',
          sources: 1,
          raw: 'r',
          sourcesList: [{ url: 'https://x.example/', title: 'X' }],
        }}
      />,
    );
    const list = screen.getByTestId('grounding-sources-list');
    const anchor = list.querySelector('a') as HTMLElement;
    const styleAttr = anchor.getAttribute('style') || '';
    // Color tokens via var(--cm-*) / var(--accent) / var(--text-*).
    expect(styleAttr).toMatch(/var\(--cm-|var\(--text-|var\(--accent/);
    // No hex / rgb literals.
    expect(styleAttr).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(styleAttr).not.toMatch(/\brgb\(/);
  });
});

describe('InlineGroundingChip — surfaces sourcesList from message text end-to-end', () => {
  it('parses + renders sources when the assistant text contains both verdict and sources block', () => {
    const text =
      'Body.\n\nGrounding: verified by web (2 sources)\n<grounding-sources>[{"url":"https://a.example/","title":"A"},{"url":"https://b.example/","title":"B"}]</grounding-sources>';
    render(<InlineGroundingChip assistantText={text} />);
    expect(screen.getByTestId('grounding-verdict-chip')).toBeTruthy();
    expect(screen.getByTestId('grounding-sources-list')).toBeTruthy();
    expect(screen.getAllByRole('link').length).toBe(2);
  });
});
