import { describe, it, expect } from 'vitest';
import { normalizeLatexDelimiters } from '../normalizeLatexDelimiters';

describe('normalizeLatexDelimiters', () => {
  it('passes plain prose through unchanged', () => {
    const input = 'This is regular text. (See chapter 3.) Nothing to convert.';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('preserves $...$ and $$...$$ as-is', () => {
    const input = 'Inline $E = mc^2$ and block $$\\int_0^1 x\\,dx = 1/2$$';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('rewrites \\(...\\) to $...$', () => {
    const input = 'The function \\(f(x) = x^2\\) is convex.';
    expect(normalizeLatexDelimiters(input)).toBe('The function $f(x) = x^2$ is convex.');
  });

  it('rewrites \\[...\\] to $$...$$', () => {
    const input = 'We claim \\[\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\\]';
    expect(normalizeLatexDelimiters(input)).toBe(
      'We claim $$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$',
    );
  });

  it('rewrites bracket-on-its-own-line block math when content is LaTeX', () => {
    const input = [
      'We want to show',
      '[',
      'a^{p-1} \\equiv 1 \\pmod{p}',
      ']',
      'and the proof goes...',
    ].join('\n');
    expect(normalizeLatexDelimiters(input)).toBe(
      ['We want to show', '$$', 'a^{p-1} \\equiv 1 \\pmod{p}', '$$', 'and the proof goes...'].join('\n'),
    );
  });

  it('does NOT rewrite bracket lines if the body is plain prose', () => {
    const input = ['Here is a list:', '[', 'apples and oranges', ']', 'continued.'].join('\n');
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('rewrites parenthesized LaTeX to $...$ when content has \\command', () => {
    const input = 'Let (p) be prime, with (\\gcd(a, p) = 1).';
    expect(normalizeLatexDelimiters(input)).toBe('Let (p) be prime, with $\\gcd(a, p) = 1$.');
  });

  it('does NOT rewrite plain (p) — single-token parens are ambiguous and pass through', () => {
    // (p) by itself doesn't contain a backslash command → looksLikeLatex returns
    // false. We accept the cost: the model writes "(p)" both for "let p be a
    // variable" prose AND as inline math; without context we err on the side of
    // not breaking real prose. The common case — (\gcd...), (\sum...) — still
    // gets caught.
    const input = 'Let (p) be prime.';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('rewrites bracketed expression with sub/superscript only', () => {
    const input = ['Compute', '[', 'x^{2} + y^{2} = z^{2}', ']', 'as Pythagoras.'].join('\n');
    expect(normalizeLatexDelimiters(input)).toBe(
      ['Compute', '$$', 'x^{2} + y^{2} = z^{2}', '$$', 'as Pythagoras.'].join('\n'),
    );
  });

  it('is idempotent', () => {
    const input = 'See \\(\\zeta(s)\\) and \\[\\int_0^\\infty f\\,dx\\].';
    const once = normalizeLatexDelimiters(input);
    const twice = normalizeLatexDelimiters(once);
    expect(twice).toBe(once);
  });

  it('handles the live gpt-oss-120b sample from the user complaint', () => {
    const input = [
      'Let (p) be a prime and let (a) be an integer with (\\gcd(a,p)=1).',
      'We want to show',
      '[',
      'a^{,p-1}\\equiv 1 \\pmod p .',
      ']',
      'as a consequence.',
    ].join('\n');
    const out = normalizeLatexDelimiters(input);
    // Inline (\gcd(a,p)=1) should become $...$
    expect(out).toContain('$\\gcd(a,p)=1$');
    // Block math should be wrapped in $$
    expect(out).toMatch(/\$\$\na\^\{,p-1\}\\equiv 1 \\pmod p \.\n\$\$/);
  });
});
