/**
 * Architecture gate (S6): no `dangerouslySetInnerHTML` may render
 * UNTRUSTED tool / model / user output without first routing it through
 * a sandboxed iframe.
 *
 * The allow-list below enumerates every component permitted to use the
 * raw `dangerouslySetInnerHTML` primitive. Every entry is justified —
 * either:
 *   1. The component is a sandboxed-iframe renderer (srcdoc + sandbox)
 *      where escaping happens at the iframe boundary, OR
 *   2. The component injects sanitized output (DOMPurify, Shiki tokenized,
 *      katex-rendered, sanitized SVG, repo-static SVG), OR
 *   3. The component injects a small static `<style>` string (CSS-only,
 *      no executable JS).
 *
 * Adding a path here REQUIRES SECURITY REVIEW. The default reaction to
 * a new entry should be "no — route via SafeHtmlIframe instead."
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S6
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '../..');

// Components allow-listed to use `dangerouslySetInnerHTML`. Each entry
// is justified in the comment beside it. New entries require security
// review and a justification comment.
const ALLOWLIST: ReadonlySet<string> = new Set<string>(
  [
    // Sanitized SVG pipeline (DOMPurify upstream)
    'features/chat/components/MessageContent/SvgDiagram.tsx',           // sanitizeSVG()
    // Shiki / highlight.js — tokenizer outputs already-escaped HTML
    'features/chat/components/MessageContent/ShikiCodeBlock.tsx',
    'features/chat/components/MessageContent/EnhancedShikiCodeBlock.tsx',
    'features/chat/components/MessageContent/CodeBlock.tsx',
    'shared/components/CodeBlock/EnhancedCodeBlock.tsx',
    'shared/components/CanvasPanel.tsx',                                // shiki-rendered code
    // KaTeX-rendered formulas (caller-side sanitized)
    'features/chat/components/MessageContent/FormulaExport.tsx',
    // Static repo SVG icons (build-time bundled, not user input)
    'features/admin/components/Shared/ProviderIcons.tsx',
    // Static <style> strings (CSS keyframes, no executable JS)
    'components/MaintenancePage.tsx',
  ].map((rel) => resolve(SRC_ROOT, rel)),
);

function walkAllSource(dir: string): string[] {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', '__tests__'].includes(entry.name)) continue;
      out.push(...walkAllSource(p));
    } else if (
      (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Strip line + block comments so a banned identifier inside a code-doc
 * comment is not flagged as a violation.
 */
function stripComments(src: string): string {
  // Block comments
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

describe('arch: no dangerouslySetInnerHTML outside allow-list (S6)', () => {
  it('only allow-listed components may use dangerouslySetInnerHTML', () => {
    const violations: string[] = [];
    for (const file of walkAllSource(SRC_ROOT)) {
      if (ALLOWLIST.has(file)) continue;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const codeOnly = stripComments(content);
      if (/dangerouslySetInnerHTML/.test(codeOnly)) {
        violations.push(relative(SRC_ROOT, file));
      }
    }
    if (violations.length > 0) {
      const detail = violations.map((v) => `  - ${v}`).join('\n');
      const msg =
        `dangerouslySetInnerHTML found in non-allow-listed file(s).\n\n` +
        `Untrusted tool / model / user output MUST NOT be passed to\n` +
        `dangerouslySetInnerHTML directly. Use one of:\n` +
        `  - SharedMarkdownRenderer (markdown, DOMPurify-sanitized)\n` +
        `  - SafeHtmlIframe / WidgetRenderer (HTML, sandboxed iframe)\n` +
        `  - <pre>{string}</pre> (text/json escape via React)\n\n` +
        `If the use is genuinely safe (sanitized output, repo-static SVG,\n` +
        `CSS-only <style>), add the path to ALLOWLIST in this file with\n` +
        `a justification comment AND security review.\n\n` +
        `Violations:\n${detail}`;
      expect.fail(msg);
    }
    expect(violations).toEqual([]);
  });
});
