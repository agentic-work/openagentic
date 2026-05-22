/**
 * remarkCiteMarker — turn `[cite:N]` and `[cite:N,M,...]` text fragments
 * into `<sup class="cm-citation" data-cite="N">N</sup>` HAST nodes via
 * mdast `data.hName`/`hProperties`/`hChildren` annotations.
 *
 * Mock anatomy: mocks/UX/01-cloud-ops.html:1139 + chatmode-v2.css `.cm-citation`.
 *
 * Doesn't touch text inside `inlineCode` or `code` nodes — citation markers
 * inside backticks remain literal.
 */

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Text, Parent } from 'mdast';

const CITE_RE = /\[cite:(\d+(?:,\s*\d+)*)\]/g;

export const remarkCiteMarker: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parent | null) => {
      if (!parent || typeof index !== 'number') return;
      // Skip if parent is an inline-code or code-block node.
      const parentType = (parent as { type?: string }).type;
      if (parentType === 'inlineCode' || parentType === 'code') return;
      const value = node.value;
      if (!CITE_RE.test(value)) return;
      CITE_RE.lastIndex = 0;

      const out: Array<unknown> = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = CITE_RE.exec(value)) !== null) {
        if (m.index > last) {
          out.push({ type: 'text', value: value.slice(last, m.index) });
        }
        // Split "1,2,3" → one chip per index.
        const indices = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        for (const idx of indices) {
          // Use mdast `data.hName` annotation so mdast→hast emits the
          // <sup> directly, bypassing the need for rehype-raw. Sanitize
          // schema must allow `data-cite` on `sup` (extended below).
          out.push({
            type: 'citeMarker',
            data: {
              hName: 'sup',
              hProperties: {
                className: ['cm-citation'],
                'data-cite': idx,
              },
              hChildren: [{ type: 'text', value: idx }],
            },
          });
        }
        last = m.index + m[0].length;
      }
      if (last < value.length) {
        out.push({ type: 'text', value: value.slice(last) });
      }
      // Replace the original text node with the new sequence.
      // unsafe cast: the mdast types don't have a great union for this.
      parent.children.splice(index, 1, ...(out as unknown as typeof parent.children));
      return [visit.SKIP, index + out.length];
    });
  };
};

export default remarkCiteMarker;
