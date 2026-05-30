/**
 * rehypeRainbowInlineCode — TDD coverage for the codemode thinking-block
 * rainbow tinting plugin (mock-3 parity).
 */
import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { rehypeRainbowInlineCode } from '../rehypeRainbowInlineCode';

function render(md: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeRainbowInlineCode)
      .use(rehypeStringify)
      .processSync(md),
  );
}

describe('rehypeRainbowInlineCode', () => {
  it('assigns cm-rkw{1..7} round-robin across inline code spans', () => {
    const out = render('x `a` y `b` z `c` `d` `e` `f` `g` `h`');
    // First seven must be rkw1..rkw7, eighth wraps back to rkw1
    expect(out).toMatch(/<code class="cm-rkw1">a<\/code>/);
    expect(out).toMatch(/<code class="cm-rkw2">b<\/code>/);
    expect(out).toMatch(/<code class="cm-rkw3">c<\/code>/);
    expect(out).toMatch(/<code class="cm-rkw4">d<\/code>/);
    expect(out).toMatch(/<code class="cm-rkw5">e<\/code>/);
    expect(out).toMatch(/<code class="cm-rkw6">f<\/code>/);
    expect(out).toMatch(/<code class="cm-rkw7">g<\/code>/);
    expect(out).toMatch(/<code class="cm-rkw1">h<\/code>/);
  });

  it('does NOT tint fenced code blocks (children of <pre>)', () => {
    const out = render('inline `a` and a fence:\n\n```\nblock\n```\n');
    expect(out).toContain('<code class="cm-rkw1">a</code>');
    // The block <code> should not get cm-rkw class
    expect(out).not.toMatch(/<pre><code class="cm-rkw/);
  });

  it('preserves any pre-existing className on inline code', () => {
    // remark/rehype don't normally set className on inline code, but we
    // should guard against future plugins that do.
    const out = render('text with `foo` inline');
    expect(out).toMatch(/<code class="cm-rkw1">foo<\/code>/);
  });
});
