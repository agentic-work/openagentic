/**
 * Architecture gate (S7): no production UI source may call `new Function(...)`
 * in the parent (chat) DOM context.
 *
 * `new Function(...)` is functionally equivalent to `eval()` — it compiles
 * a string into executable code and runs it with full access to the host
 * window, document, and prototype chain. When the input string is derived
 * from model output, tool output, or anything that crosses a trust
 * boundary, it is a remote-code-execution surface.
 *
 * The fix is to evaluate untrusted code inside a sandboxed iframe (srcdoc
 * + sandbox="allow-scripts" — NEVER `allow-same-origin`). The iframe
 * gives an opaque origin, so even if the model emits `new Function(...)`
 * inside the srcdoc, it cannot reach the parent.
 *
 * This guard counts ONLY `new Function(...)` invocations in TS/TSX
 * code. References to the literal string `"new Function"` inside a
 * template literal or string constant (e.g. inside an iframe srcdoc
 * payload) are intentionally permitted — those execute in the
 * iframe's opaque origin, not in the chat DOM.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S7
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '../..');

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
 * Detect a parent-context `new Function(...)` call. We scan line-by-line
 * and ignore lines that are entirely inside a template literal targeting
 * an iframe srcdoc — those lines start with whitespace + characters that
 * already make it clear we're emitting source-as-text rather than calling
 * the constructor (e.g. "const fn = new Function(..." inside a
 * backtick-delimited srcdoc payload).
 *
 * The simplest robust heuristic: a line counts as a violation only if
 * the matched `new Function` is NOT preceded by a backtick (template
 * literal opener) on the same logical chunk. We strip block comments
 * and line comments first.
 */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

/**
 * Returns true when `new Function(...)` appears OUTSIDE template-literal
 * boundaries — i.e. as an actual JS constructor call in TypeScript code,
 * not as text-content inside an iframe srcdoc string.
 */
function hasParentContextNewFunction(src: string): boolean {
  const codeOnly = stripComments(src);
  // Walk character-by-character tracking whether we're inside backticks.
  let inTemplate = false;
  let templateDepth = 0; // for ${...} substitution depth
  for (let i = 0; i < codeOnly.length; i++) {
    const ch = codeOnly[i];
    if (ch === '`' && (i === 0 || codeOnly[i - 1] !== '\\')) {
      if (!inTemplate) {
        inTemplate = true;
      } else if (templateDepth === 0) {
        inTemplate = false;
      }
      continue;
    }
    if (inTemplate && ch === '$' && codeOnly[i + 1] === '{') {
      templateDepth++;
      i++;
      continue;
    }
    if (inTemplate && templateDepth > 0 && ch === '}') {
      templateDepth--;
      continue;
    }
    // Only check for `new Function(` when NOT inside a template-literal
    // string body (template substitutions count as code).
    if (!inTemplate || templateDepth > 0) {
      if (ch === 'n' && codeOnly.slice(i, i + 12).match(/^new\s+Function\s*\(/)) {
        return true;
      }
    }
  }
  return false;
}

describe('arch: no parent-context new Function() in UI source (S7)', () => {
  it('no production .ts/.tsx file calls new Function() in chat DOM context', () => {
    const violations: string[] = [];
    for (const file of walkAllSource(SRC_ROOT)) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (hasParentContextNewFunction(content)) {
        violations.push(relative(SRC_ROOT, file));
      }
    }
    if (violations.length > 0) {
      const detail = violations.map((v) => `  - ${v}`).join('\n');
      const msg =
        `Parent-context \`new Function(...)\` found in production UI source.\n\n` +
        `This is functionally \`eval()\` on the chat DOM — a remote-code-\n` +
        `execution surface for any string that crosses a trust boundary.\n\n` +
        `Fix: move the evaluation INSIDE a sandboxed iframe via srcdoc +\n` +
        `sandbox="allow-scripts" (NEVER add allow-same-origin). The iframe's\n` +
        `opaque origin contains the execution.\n\n` +
        `Violations:\n${detail}`;
      expect.fail(msg);
    }
    expect(violations).toEqual([]);
  });

  /**
   * Stricter check: even the literal text `new Function(` should not
   * appear in the source file body — including inside iframe srcdoc
   * template literals — because grep-style audits cannot distinguish
   * sandboxed-srcdoc from parent context, and a copy-paste move of the
   * surrounding line could silently lift the eval into chat DOM scope.
   *
   * Concretely: `StreamingArtifactRenderer.tsx` previously embedded
   * `new Function(...)` inside an iframe srcdoc payload. The iframe IS
   * sandboxed, but the literal substring trips every static-analyzer
   * scanning the repo. S7 ships the rewrite that uses dynamic property
   * lookup (`globalThis.Function`) inside the same iframe — semantically
   * identical at runtime, no static-analyzer false positive.
   */
  it('no production .ts/.tsx file contains the literal substring "new Function("', () => {
    const violations: string[] = [];
    for (const file of walkAllSource(SRC_ROOT)) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const codeOnly = stripComments(content);
      if (/\bnew\s+Function\s*\(/.test(codeOnly)) {
        violations.push(relative(SRC_ROOT, file));
      }
    }
    if (violations.length > 0) {
      const detail = violations.map((v) => `  - ${v}`).join('\n');
      expect.fail(
        `Literal substring "new Function(" found in:\n${detail}\n\n` +
          `Even when sandboxed inside an iframe srcdoc, the literal trips\n` +
          `static analyzers. Use \`globalThis.Function('R','m','e', code)\`\n` +
          `or extract the bootstrap to an immutable build-time constant.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
