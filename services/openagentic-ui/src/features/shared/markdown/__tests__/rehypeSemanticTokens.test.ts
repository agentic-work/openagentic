/**
 * rehypeSemanticTokens — TDD coverage for the shared semantic-token
 * rehype plugin used by both chatmode (SharedMarkdownRenderer) and
 * codemode (MessageTree). Walks HAST text nodes, replaces status
 * keywords / file paths / metric values with <span class="sem-…">.
 */
import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { rehypeSemanticTokens } from '../rehypeSemanticTokens';

function render(md: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeSemanticTokens)
      .use(rehypeStringify)
      .processSync(md),
  );
}

describe('rehypeSemanticTokens', () => {
  it('wraps PASS / FAIL status words', () => {
    const out = render('Tests: PASS for unit, FAIL for integration.');
    expect(out).toContain('class="sem-status sem-success">PASS<');
    expect(out).toContain('class="sem-status sem-error">FAIL<');
  });

  it('wraps additional success keywords (OK, ✓, Ready, Healthy)', () => {
    const out = render('All systems OK ✓ Ready Healthy');
    expect(out).toContain('sem-success">OK<');
    expect(out).toContain('sem-success">✓<');
    expect(out).toContain('sem-success">Ready<');
    expect(out).toContain('sem-success">Healthy<');
  });

  it('wraps error keywords (ERROR, ✗, CrashLoopBackOff, Failed)', () => {
    const out = render('Pod state: CrashLoopBackOff. Build Failed. Test ✗ ERROR.');
    expect(out).toContain('sem-error">CrashLoopBackOff<');
    expect(out).toContain('sem-error">Failed<');
    expect(out).toContain('sem-error">✗<');
    expect(out).toContain('sem-error">ERROR<');
  });

  it('wraps warning keywords (WARN, WARNING, ⚠, Pending, Degraded)', () => {
    const out = render('WARN: build slow. Pod is Pending. State Degraded ⚠.');
    expect(out).toContain('sem-warn">WARN<');
    expect(out).toContain('sem-warn">Pending<');
    expect(out).toContain('sem-warn">Degraded<');
    expect(out).toContain('sem-warn">⚠<');
  });

  it('wraps info keywords (NOTE, TODO, FIXME)', () => {
    const out = render('NOTE: this is fine. TODO: refactor. FIXME: leak.');
    expect(out).toContain('sem-info">NOTE<');
    expect(out).toContain('sem-info">TODO<');
    expect(out).toContain('sem-info">FIXME<');
  });

  it('wraps metric values (ms / s / MB / % / tokens)', () => {
    const out = render('Took 42ms; pulled 1.4MB; coverage 99%; used 2400 tokens.');
    expect(out).toContain('sem-metric">42ms<');
    expect(out).toContain('sem-metric">1.4MB<');
    expect(out).toContain('sem-metric">99%<');
    expect(out).toContain('sem-metric">2400 tokens<');
  });

  it('wraps money values ($0.012, $1.4M)', () => {
    const out = render('Cost: $0.012 per turn, $1.4M annualized.');
    expect(out).toContain('sem-money">$0.012<');
    expect(out).toContain('sem-money">$1.4M<');
  });

  it('wraps file:line refs (src/foo.ts:42)', () => {
    const out = render('Crash at src/foo.ts:42 in bar.');
    expect(out).toContain('sem-path">src/foo.ts:42<');
  });

  it('does NOT wrap inside fenced code blocks', () => {
    const out = render('```\nERROR: stack trace\nPASS\n```');
    expect(out).not.toContain('sem-error');
    expect(out).not.toContain('sem-success');
  });

  it('does NOT wrap inside inline code (`ERROR`)', () => {
    const out = render('Use `ERROR` constant.');
    expect(out).not.toContain('sem-error');
  });

  it('does NOT wrap inside link href text labels', () => {
    // Inside an <a>, leave text alone — wrapping would break the link
    // appearance and is redundant with the link itself being highlighted.
    const out = render('See [PASS report](https://example.com).');
    expect(out).not.toContain('sem-success');
  });

  it('respects word boundaries (does NOT match inside other words)', () => {
    const out = render('passport, errored, warningMixin, footnote.');
    expect(out).not.toContain('sem-status');
    expect(out).not.toContain('sem-warn');
  });

  it('handles multiple matches in one paragraph correctly', () => {
    const out = render('Tests: PASS PASS FAIL. Total OK.');
    const passCount = (out.match(/sem-success">PASS</g) || []).length;
    expect(passCount).toBe(2);
    expect(out).toContain('sem-error">FAIL<');
    expect(out).toContain('sem-success">OK<');
  });

  it('preserves surrounding text', () => {
    const out = render('Status: PASS now.');
    expect(out).toContain('Status: ');
    expect(out).toContain('sem-success">PASS<');
    expect(out).toContain(' now.');
  });
});
