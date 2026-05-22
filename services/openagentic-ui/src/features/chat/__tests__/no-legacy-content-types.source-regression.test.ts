/**
 * Architecture cage — no UI-local re-declarations of SDK canonical types.
 *
 * REGRESSION pin — Track B Phase 0 of the canonical streaming rip
 * (/home/trent/.claude/plans/sprightly-percolating-brook.md, "One SoT" rule).
 *
 * `openagentic-sdk` is the single source of truth for chatmode types:
 *   - `UIContentBlock`  (render + persist shape)
 *   - `UIStreamFrame` / `UIStreamFrameLoose`  (wire envelope union)
 *   - `CanonicalEvent`  (Anthropic-shape strict subset)
 *
 * Nothing in the UI may declare a parallel `interface` or `type` with
 * these names — if a UI consumer needs a shape variation, it imports the
 * SDK type and narrows / extends it, OR adds the missing field to the
 * SDK first and re-imports.
 *
 * Plan Phase 0.5 also renames the npm alias `@agentic-work/llm-sdk` →
 * `@openagentic/sdk`; that rename is pinned by its own arch test.
 * Today's allow-list accepts BOTH aliases for the duration of Phase 0.5's
 * pending rename.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHAT_ROOT = join(__dirname, '..');

// Match `interface Foo` and `type Foo =` (with optional `export`). The
// 3 names are SDK-owned; any LOCAL declaration is a violation.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /^\s*(export\s+)?interface\s+(UIContentBlock|UIStreamFrame|UIStreamFrameLoose|CanonicalEvent)\b/,
    description:
      'local `interface` re-declaration of SDK canonical type — import from @openagentic/sdk',
  },
  {
    pattern: /^\s*(export\s+)?type\s+(UIContentBlock|UIStreamFrame|UIStreamFrameLoose|CanonicalEvent)\s*[=<]/,
    description:
      'local `type` re-declaration of SDK canonical type — import from @openagentic/sdk',
  },
];

const ALLOW_LIST_SUFFIXES: string[] = [
  '__tests__/no-legacy-content-types.source-regression.test.ts',
];

function isAllowed(rel: string): boolean {
  if (rel.includes('__tests__/') || rel.includes('/test/') || rel.includes('.test.')) {
    return true;
  }
  // The SDK source itself lives outside this tree (in ~/openagentic/openagentic-sdk/);
  // we only walk the UI chat feature here. A path containing 'openagentic-sdk' would
  // be the SDK's own copy and is implicitly out of scope.
  if (rel.includes('openagentic-sdk')) return true;
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

describe('Architecture: no UI-local re-declarations of SDK canonical types', () => {
  it('UIContentBlock / UIStreamFrame / CanonicalEvent may ONLY be declared in openagentic-sdk', () => {
    const violations: Array<{ file: string; line: number; match: string; rule: string }> = [];

    for (const file of walk(CHAT_ROOT)) {
      const rel = relative(CHAT_ROOT, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const { pattern, description } of FORBIDDEN_PATTERNS) {
          if (pattern.test(lines[i])) {
            violations.push({
              file: rel,
              line: i + 1,
              match: lines[i].trim().slice(0, 140),
              rule: description,
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.match}\n    → ${v.rule}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} local SDK-type re-declaration(s). ` +
          `Track B "One SoT" rule: import these from @openagentic/sdk (or ` +
          `@agentic-work/llm-sdk during Phase 0.5 migration):\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
