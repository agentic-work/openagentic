/**
 * Architecture cage — single thinking-block renderer shape.
 *
 * REGRESSION pin — Track B Phase 0 of the canonical streaming rip
 * (<internal-plan>, Phase 5).
 *
 * `InlineThinkingBlock.tsx` ships TWO DOM shapes from the same React
 * component:
 *   - lines ~178-310: `<div class="cm-thinking inline-thinking-natural">`
 *     — natural variant for the LIVE streaming column.
 *   - lines ~313-…: `<div class="inline-thinking-block">` — boxed variant
 *     for SETTLED / RELOAD columns.
 *
 * Same data, two DOM shapes. That's why live ≠ settled ≠ reload for any
 * turn that includes thinking. walkAgenticActivity.ts:104 explicitly
 * matches BOTH classes as proof both ship in production.
 *
 * Phase 5 of the rip deletes the 'boxed' branch; the natural shape becomes
 * the only renderer. This test pins the boxed class dead.
 *
 * Forbidden token: `inline-thinking-block` (the boxed variant CSS class).
 * Allowed: `inline-thinking-natural` (the canonical kept shape).
 *
 * Allow-list: tests + the data-testid attribute (which legitimately uses
 * the legacy name as a test selector and is orthogonal to the DOM class).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHAT_ROOT = join(__dirname, '..');

// Match the CSS class `inline-thinking-block` as a className token (in a
// string literal) or inside a className= attribute. Distinguish from the
// `inline-thinking-natural` substring overlap by requiring word boundary
// on the right (e.g. `inline-thinking-block"` or `inline-thinking-block '`).
const BOXED_CLASS_PATTERN =
  /["']\s*[^"']*\binline-thinking-block\b[^"']*["']|className=\{[^}]*\binline-thinking-block\b/;

const ALLOW_LIST_SUFFIXES: string[] = [
  '__tests__/single-renderer.source-regression.test.ts',
];

function isAllowed(rel: string): boolean {
  if (rel.includes('__tests__/') || rel.includes('/test/') || rel.includes('.test.')) {
    return true;
  }
  return ALLOW_LIST_SUFFIXES.some((suffix) => rel.endsWith(suffix));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      if (entry.endsWith('.d.ts')) continue;
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no boxed `inline-thinking-block` className variant', () => {
  it('only the natural variant may ship — boxed class is dead', () => {
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of walk(CHAT_ROOT)) {
      const rel = relative(CHAT_ROOT, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Skip pure-comment lines.
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        // Skip data-testid attribute usage (test selector, not DOM class).
        if (/data-testid\s*=\s*["']inline-thinking-block["']/.test(lines[i])) continue;
        if (BOXED_CLASS_PATTERN.test(lines[i])) {
          violations.push({
            file: rel,
            line: i + 1,
            match: lines[i].trim().slice(0, 140),
          });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.match}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} use(s) of the boxed \`inline-thinking-block\` className. ` +
          `Track B Phase 5 of the canonical rip keeps ONLY \`inline-thinking-natural\` ` +
          `so live ≡ settled ≡ reload DOM:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
