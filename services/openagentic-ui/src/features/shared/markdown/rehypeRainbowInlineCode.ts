/**
 * rehypeRainbowInlineCode — paints inline `<code>` spans with
 * round-robin `cm-rkw1..7` classes so dense thinking-block prose with
 * many backticked tokens reads with the same rainbow palette as the
 * mock-3 design (`mocks/codemode-tui-parity/mock-3-research-fix-deploy.html`).
 *
 * Mounted ONLY on the thinking renderer in `MessageTree` — never on
 * regular assistant prose, where rainbow tinting on every backtick
 * would overwhelm the eye.
 *
 * Behavior:
 *   • Walk the HAST tree.
 *   • For every `<code>` element whose direct parent is NOT a `<pre>`
 *     (i.e. inline backticks, not fenced blocks), append a
 *     `cm-rkw{1..7}` class — cycling 1→2→3→4→5→6→7→1 in document order.
 *   • Existing className(s) are preserved.
 */
import { visit, SKIP } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Element, ElementContent, Root } from 'hast';

const RAINBOW_CLASSES = [
  'cm-rkw1',
  'cm-rkw2',
  'cm-rkw3',
  'cm-rkw4',
  'cm-rkw5',
  'cm-rkw6',
  'cm-rkw7',
] as const;

function isInlineCode(node: Element, parent: Element | Root | undefined): boolean {
  if (node.tagName !== 'code') return false;
  // ReactMarkdown gives us inline code as a bare <code> (no <pre> wrapper),
  // and fenced blocks as <pre><code>. We rainbow-tint only the former.
  if (parent && (parent as Element).type === 'element' && (parent as Element).tagName === 'pre') {
    return false;
  }
  return true;
}

export const rehypeRainbowInlineCode: Plugin<[], Root> = () => {
  return (tree) => {
    let cursor = 0;
    visit(tree, 'element', (node, _index, parent) => {
      const el = node as Element;
      if (!isInlineCode(el, parent as Element | Root | undefined)) return;
      const cls = RAINBOW_CLASSES[cursor % RAINBOW_CLASSES.length];
      cursor += 1;
      const props = (el.properties ??= {});
      const existing = props.className;
      let next: string[];
      if (Array.isArray(existing)) {
        next = [...existing.map(String), cls];
      } else if (typeof existing === 'string' && existing.length > 0) {
        next = [...existing.split(/\s+/).filter(Boolean), cls];
      } else {
        next = [cls];
      }
      props.className = next;
      // Don't descend into <code> children — we don't want to recurse
      // and accidentally tint nested elements (there shouldn't be any
      // for inline code, but SKIP is the safe choice).
      return SKIP;
    });
    // Touch the unused import so the linter doesn't drop it; ElementContent
    // exists here only to make the visitor signature stable across versions.
    void ({} as ElementContent | undefined);
  };
};

export default rehypeRainbowInlineCode;
