/**
 * Architecture cage — no server-side `contentBlocksAccumulator.ts`.
 *
 * REGRESSION pin — Track B Phase 0 of the canonical streaming rip (Phase 7).
 *
 * `services/openagentic-api/src/routes/chat/handlers/contentBlocksAccumulator.ts`
 * is a 370-line near-copy of the UI's `applyCanonicalFrame` reducer
 * (services/openagentic-ui/src/features/chat/hooks/streamReducer/applyCanonicalFrame.ts)
 * — but it's missing `tool_round` nesting and accepts `'content_delta'` +
 * `'stream'` frames the UI reducer doesn't. Result: the persisted shape
 * (server's `ServerContentBlock[]`) drifts from the live shape (UI's
 * `UIContentBlock[]`) on every assistant turn.
 *
 * Phase 7 of the rip exports `applyCanonicalFrame` from `openagentic-sdk/src/lib/ui-stream/`
 * and the server imports the SDK reducer. The legacy accumulator file is
 * deleted. ONE reducer, ONE shape, persistence ≡ render.
 *
 * Pinned: file must NOT exist at the canonical path. Allow-listed: tests
 * that reference the file for migration history.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

const FORBIDDEN_FILE = join(SRC, 'routes/chat/handlers/contentBlocksAccumulator.ts');

const FORBIDDEN_IMPORT_PATTERN =
  /from\s+['"][^'"]*contentBlocksAccumulator['"]|require\s*\(\s*['"][^'"]*contentBlocksAccumulator['"]/;

const ALLOW_LIST_SUFFIXES: string[] = [
  '__tests__/architecture/no-server-content-blocks-accumulator.source-regression.test.ts',
];

function isAllowed(rel: string): boolean {
  if (rel.includes('__tests__/') || rel.includes('/test/')) return true;
  return ALLOW_LIST_SUFFIXES.some((suffix) => rel.endsWith(suffix));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no server-side contentBlocksAccumulator', () => {
  it('contentBlocksAccumulator.ts must not exist (use SDK applyCanonicalFrame)', () => {
    expect(
      existsSync(FORBIDDEN_FILE),
      `${FORBIDDEN_FILE} must be deleted. Track B Phase 7 of the canonical rip ` +
        `replaces it with the SDK's exported applyCanonicalFrame reducer so server and ` +
        `UI use ONE reducer → ONE UIContentBlock[] shape → persistence ≡ render.`,
    ).toBe(false);
  });

  it('no production file imports contentBlocksAccumulator', () => {
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;
      // Skip the file itself if still present.
      if (rel.endsWith('routes/chat/handlers/contentBlocksAccumulator.ts')) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (FORBIDDEN_IMPORT_PATTERN.test(lines[i])) {
          violations.push({ file: rel, line: i + 1, match: lines[i].trim().slice(0, 140) });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.match}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} import(s) of contentBlocksAccumulator. ` +
          `Import applyCanonicalFrame from @openagentic/sdk instead:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
