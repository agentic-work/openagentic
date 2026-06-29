/**
 * rehypeSemanticTokens — claude.ai-grade semantic emphasis for both
 * chatmode and codemode markdown rendering. Walks HAST text nodes and
 * wraps recognized tokens (status keywords, file:line refs, metric
 * values, money) in `<span class="sem-…">` so CSS can paint them in
 * a uniform palette.
 *
 * Important non-goals:
 *   - Don't touch text inside `<code>`, `<pre>`, `<a>` — code/links
 *     own their own styling.
 *   - Don't tint substrings of other words (\b boundaries everywhere).
 *   - Don't depend on any chatmode-specific component — this plugin
 *     mounts via standard rehypePlugins=[…] in BOTH renderers and the
 *     CSS lives next to it (see __tests__/ for vocabulary).
 */
import { visit, SKIP } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Element, Root, RootContent, Text } from 'hast';

const SUCCESS_WORDS = [
  'PASS', 'PASSED', 'OK', 'Pass', 'Passed', 'Ready', 'Running', 'Active',
  'Healthy', 'Succeeded', 'SUCCESS', 'Success',
];
const ERROR_WORDS = [
  'FAIL', 'FAILED', 'Failed', 'Failing', 'ERROR', 'Error',
  'CrashLoopBackOff', 'BackOff', 'Evicted', 'OOMKilled', 'OOMKilling',
  'Unavailable', 'NotReady', 'NodeNotReady',
];
const WARN_WORDS = [
  'WARN', 'WARNING', 'Warn', 'Warning', 'Pending', 'Degraded', 'Throttled',
  'Probe', 'MemoryPressure', 'DiskPressure', 'PIDPressure',
];
const INFO_WORDS = [
  'NOTE', 'Note', 'TODO', 'FIXME', 'INFO', 'DEPRECATED', 'NEW',
];

/** Single-glyph status — checked separately because \b doesn't apply. */
const SUCCESS_GLYPHS = ['✓', '✔'];
const ERROR_GLYPHS = ['✗', '✘'];
const WARN_GLYPHS = ['⚠'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORD_RE = new RegExp(
  `(?<![\\w-])(${[
    ...ERROR_WORDS,
    ...WARN_WORDS,
    ...SUCCESS_WORDS,
    ...INFO_WORDS,
  ].map(escape).join('|')})(?![\\w-])`,
  'g',
);

/** Glyphs match anywhere — they're never inside a word. */
const GLYPH_RE = new RegExp(
  `(${[...ERROR_GLYPHS, ...WARN_GLYPHS, ...SUCCESS_GLYPHS].map(escape).join('|')})`,
  'g',
);

/** file/path:line refs — `src/foo.ts:42`, `a/b/c.tsx:12:34`. */
const PATH_RE = /(?<![\w/])([\w./-]+\.[a-zA-Z]{1,5}:\d+(?::\d+)?)(?![\w/])/g;

/** Money — `$0.012`, `$1.4M`, `$42k`. */
const MONEY_RE = /(?<![\w])(\$\d+(?:\.\d+)?[mkMK]?)(?!\w)/g;

/** Metric values — `42ms`, `1.4MB`, `99%`, `2400 tokens`. */
const METRIC_RE = new RegExp(
  '(?<![\\w])(' +
    '\\d+(?:\\.\\d+)?\\s*(?:ms|µs|ns|kb|mb|gb|tb)\\b' + // time/size suffix
    '|\\d+(?:\\.\\d+)?%' + // percent
    '|\\d+(?:\\.\\d+)?\\s+(?:tokens?|requests?|users?|files?|tasks?|errors?|failures?|tests?|seconds?|minutes?|hours?|days?)' +
    ')(?![\\w])',
  'gi',
);

function classifyWord(w: string): string | null {
  if (ERROR_WORDS.includes(w)) return 'sem-status sem-error';
  if (WARN_WORDS.includes(w)) return 'sem-status sem-warn';
  if (SUCCESS_WORDS.includes(w)) return 'sem-status sem-success';
  if (INFO_WORDS.includes(w)) return 'sem-status sem-info';
  return null;
}

function classifyGlyph(g: string): string | null {
  if (ERROR_GLYPHS.includes(g)) return 'sem-status sem-error';
  if (WARN_GLYPHS.includes(g)) return 'sem-status sem-warn';
  if (SUCCESS_GLYPHS.includes(g)) return 'sem-status sem-success';
  return null;
}

function span(className: string, value: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: className.split(' ') },
    children: [{ type: 'text', value }],
  };
}

interface Match {
  start: number;
  end: number;
  className: string;
}

function scan(text: string): Match[] {
  const out: Match[] = [];
  for (const re of [WORD_RE, GLYPH_RE, PATH_RE, MONEY_RE, METRIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = m[1] ?? m[0];
      let className: string | null;
      if (re === WORD_RE) className = classifyWord(value);
      else if (re === GLYPH_RE) className = classifyGlyph(value);
      else if (re === PATH_RE) className = 'sem-path';
      else if (re === MONEY_RE) className = 'sem-money';
      else className = 'sem-metric';
      if (!className) continue;
      const start = m.index + (m[0].length - value.length);
      out.push({ start, end: start + value.length, className });
    }
  }
  // De-overlap: keep earliest, drop any later match that overlaps.
  out.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Match[] = [];
  let lastEnd = -1;
  for (const m of out) {
    if (m.start < lastEnd) continue;
    kept.push(m);
    lastEnd = m.end;
  }
  return kept;
}

function splitTextNode(node: Text): RootContent[] | null {
  const matches = scan(node.value);
  if (matches.length === 0) return null;
  const out: RootContent[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) {
      out.push({ type: 'text', value: node.value.slice(cursor, m.start) });
    }
    out.push(span(m.className, node.value.slice(m.start, m.end)));
    cursor = m.end;
  }
  if (cursor < node.value.length) {
    out.push({ type: 'text', value: node.value.slice(cursor) });
  }
  return out;
}

const SKIP_TAGS = new Set(['code', 'pre', 'a']);

export const rehypeSemanticTokens: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (
        node.type === 'element' &&
        SKIP_TAGS.has((node as Element).tagName)
      ) {
        return SKIP;
      }
      if (node.type !== 'text' || parent === undefined || index === undefined) {
        return;
      }
      const replacement = splitTextNode(node as Text);
      if (!replacement) return;
      (parent as { children: RootContent[] }).children.splice(
        index,
        1,
        ...replacement,
      );
      return [SKIP, index + replacement.length];
    });
  };
};

export default rehypeSemanticTokens;
