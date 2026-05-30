/**
 * Tests for Phase F.5 citation detection.
 */

import { describe, it, expect } from 'vitest';
import { detectCitation, isFootnoteHref } from '../citations';

describe('isFootnoteHref', () => {
  it('recognizes the GFM footnote-anchor convention', () => {
    expect(isFootnoteHref('#user-content-fn-1')).toBe(true);
    expect(isFootnoteHref('#user-content-fn-12')).toBe(true);
    expect(isFootnoteHref('#user-content-fnref-3')).toBe(true);
  });

  it('rejects non-footnote anchors', () => {
    expect(isFootnoteHref('#section-one')).toBe(false);
    expect(isFootnoteHref('https://example.com')).toBe(false);
    expect(isFootnoteHref(null)).toBe(false);
    expect(isFootnoteHref(undefined)).toBe(false);
    expect(isFootnoteHref('')).toBe(false);
  });
});

describe('detectCitation', () => {
  it('returns null for empty text', () => {
    expect(detectCitation('', '#user-content-fn-1')).toBeNull();
    expect(detectCitation('   ', 'https://x.com')).toBeNull();
  });

  it('treats a GFM-footnote link as a citation (numeric label extracted)', () => {
    const out = detectCitation('1', '#user-content-fn-1', 'Source A');
    expect(out).not.toBeNull();
    expect(out!.isFootnote).toBe(true);
    expect(out!.label).toBe('1');
    expect(out!.title).toBe('Source A');
  });

  it('treats a GFM footnote as a citation even when the link text has brackets', () => {
    const out = detectCitation('[2]', '#user-content-fn-2');
    expect(out).not.toBeNull();
    expect(out!.isFootnote).toBe(true);
    expect(out!.label).toBe('2');
  });

  it('treats inline `[1](url)` as an inline citation', () => {
    const out = detectCitation('1', 'https://example.com');
    expect(out).not.toBeNull();
    expect(out!.isFootnote).toBe(false);
    expect(out!.label).toBe('1');
    expect(out!.href).toBe('https://example.com');
  });

  it('accepts caret form `^1`', () => {
    const out = detectCitation('^3', 'https://example.com');
    expect(out).not.toBeNull();
    expect(out!.label).toBe('3');
  });

  it('does not treat plain-word links as citations', () => {
    expect(detectCitation('click here', 'https://example.com')).toBeNull();
    expect(detectCitation('Kubernetes docs', 'https://k8s.io')).toBeNull();
  });

  it('rejects oversized numbers (guard against noise like "[2026-04-19]")', () => {
    expect(detectCitation('2026', 'https://example.com')).toBeNull();
    expect(detectCitation('12345', 'https://example.com')).toBeNull();
  });

  it('accepts up to 3-digit citation numbers', () => {
    expect(detectCitation('99', 'https://x.com')?.label).toBe('99');
    expect(detectCitation('100', 'https://x.com')?.label).toBe('100');
  });

  it('inline citation requires an href (footnote path does not)', () => {
    expect(detectCitation('1', null)).toBeNull();
    // Footnote anchor is treated as a citation even with only an href
    expect(detectCitation('1', '#user-content-fn-1')?.isFootnote).toBe(true);
  });

  it('passes title through when provided', () => {
    expect(detectCitation('1', 'https://x.com', 'source A')!.title).toBe('source A');
  });
});
