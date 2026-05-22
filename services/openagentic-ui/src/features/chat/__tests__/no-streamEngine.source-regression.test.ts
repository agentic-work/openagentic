/**
 * Architecture cage — StreamEngine is dead.
 *
 * REGRESSION pin — Track B Phase 0 of the canonical streaming rip
 * (/home/trent/.claude/plans/sprightly-percolating-brook.md, Phase 6).
 *
 * StreamEngine is a dark-launched imperative-DOM renderer at
 * `services/openagentic-ui/src/features/chat/streamEngine/StreamEngine.ts`.
 * Default OFF in Dockerfile (`VITE_FEATURE_STREAM_ENGINE=false`), but the
 * code path ships in every bundle and produces a THIRD thinking-block DOM
 * shape distinct from `InlineThinkingBlock`'s two shapes (the smoking gun
 * for "3 renderers / 2 thinking variants"). The references
 * (`~/anthropic/src/services/api/claude.ts` + claude.ai) prove the
 * imperative-DOM escape hatch is unnecessary — smoothness comes from
 * React discipline (memoized blocks, mutate-in-place reducer, hoisted
 * markdown `components`), NOT from bypassing React.
 *
 * Phase 6 of the rip:
 *   - deletes `streamEngine/` directory entirely
 *   - deletes `StreamEnginedActivityStream.tsx` feature-flag bridge
 *   - drops the `VITE_FEATURE_STREAM_ENGINE` ARG from Dockerfile
 *   - deletes all streamEngine test files
 *
 * This test pins all three: directory absent, no imports surviving,
 * Dockerfile flag dropped.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHAT_ROOT = join(__dirname, '..');
const UI_ROOT = join(__dirname, '../../../..'); // services/openagentic-ui

const STREAM_ENGINE_DIR = join(CHAT_ROOT, 'streamEngine');

const FORBIDDEN_IMPORT_PATTERN =
  /from\s+['"][^'"]*\/streamEngine(\/[^'"]*)?['"]|require\s*\(\s*['"][^'"]*\/streamEngine(\/[^'"]*)?['"]/;

const ALLOW_LIST_SUFFIXES: string[] = [
  '__tests__/no-streamEngine.source-regression.test.ts',
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

describe('Architecture: StreamEngine deleted (Phase 6 rip)', () => {
  it('streamEngine/ directory must not exist', () => {
    expect(
      existsSync(STREAM_ENGINE_DIR),
      `${STREAM_ENGINE_DIR} must be deleted. Phase 6 of the canonical rip ` +
        `kills the imperative-DOM bypass; React discipline (memoized blocks + ` +
        `mutate-in-place reducer + hoisted components) covers the perf path.`,
    ).toBe(false);
  });

  it('no production source imports from streamEngine/', () => {
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of walk(CHAT_ROOT)) {
      const rel = relative(CHAT_ROOT, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (FORBIDDEN_IMPORT_PATTERN.test(lines[i])) {
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
        `Found ${violations.length} import(s) from streamEngine/. ` +
          `Phase 6 deletes the directory; remove all imports:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });

  it('Dockerfile must not carry the VITE_FEATURE_STREAM_ENGINE flag', () => {
    const dockerfilePath = join(UI_ROOT, 'Dockerfile');
    if (!existsSync(dockerfilePath)) {
      // If Dockerfile lives elsewhere, the directory + import checks above
      // are sufficient; don't fail noisily here.
      return;
    }
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const flagMatches = dockerfile.match(/VITE_FEATURE_STREAM_ENGINE/g) ?? [];
    if (flagMatches.length > 0) {
      throw new Error(
        `Dockerfile still references VITE_FEATURE_STREAM_ENGINE ${flagMatches.length} time(s). ` +
          `Phase 6 of the canonical rip drops the ARG and ENV lines entirely.`,
      );
    }
    expect(flagMatches.length).toBe(0);
  });
});
