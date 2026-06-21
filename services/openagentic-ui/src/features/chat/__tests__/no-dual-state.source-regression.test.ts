/**
 * Architecture cage — no `assistantMessage` / `currentMessage` dual-state
 * outside the canonical reducer.
 *
 * REGRESSION pin — Track B Phase 0 of the canonical streaming rip
 * (Phases 3+4).
 *
 * Smoking gun in useChatStream.ts:
 *   - `let assistantMessage = ''` at line ~2575, appended in 6 sites
 *     (`2659, 3779, 4803, 5177, 5246, 6043`) — pre-dates ContentBlocks.
 *   - `setCurrentMessage(...)` called in 10 sites — second writer.
 *   - `useState<string>('')` for `currentMessage` at line 1684 — third state.
 *
 * These run IN PARALLEL with `applyCanonicalFrame`'s `contentBlocks[]`
 * reducer. THREE writers, slightly-different shapes, drift is the default
 * — the root cause of "live stream ≠ settled ≠ reloaded."
 *
 * Phase 3 of the rip rips all three. Phase 4 funnels every write through
 * the reducer. This test pins them all dead.
 *
 * Allow-list: the reducer file itself (applyCanonicalFrame.ts) — that's
 * the ONE writer that may touch ContentBlocks. The deriveFlatMessage
 * helper may produce a flat string from ContentBlocks for title-gen /
 * copy-to-clipboard callers. Everything else is forbidden.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Climb out of features/chat/__tests__ → features/chat
const CHAT_ROOT = join(__dirname, '..');

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\blet\s+assistantMessage\s*=/,
    description:
      "`let assistantMessage = ''` flat-string accumulator — replaced by " +
      'applyCanonicalFrame reducer ContentBlock[] in Track B Phase 3',
  },
  {
    pattern: /\bassistantMessage\s*\+=/,
    description:
      '`assistantMessage += delta` flat-string concat — replaced by ' +
      'applyCanonicalFrame `appendDelta` in Track B Phase 3',
  },
  {
    pattern: /\bsetCurrentMessage\s*\(/,
    description:
      '`setCurrentMessage(...)` second-writer state setter — ripped in ' +
      'Track B Phase 3; readers consume `contentBlocks` instead',
  },
  {
    pattern: /useState[^(]*\(\s*['"]['"]\s*\).*\bcurrentMessage\b|currentMessage,\s*setCurrentMessage|\[\s*currentMessage\s*,\s*setCurrentMessage\s*\]/,
    description:
      '`useState` declaration for currentMessage — Phase 3 rips this; ' +
      'streaming-bubble text reads contentBlocks',
  },
];

// File-relative allow-list. The canonical reducer + the flat-string
// helper for title-gen/copy are allowed to use these names internally.
// Tests are universally allowed.
const ALLOW_LIST_SUFFIXES: string[] = [
  'hooks/streamReducer/applyCanonicalFrame.ts',
  'hooks/streamReducer/deriveFlatMessage.ts',
  '__tests__/no-dual-state.source-regression.test.ts',
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
    } else if (
      entry.endsWith('.ts') ||
      entry.endsWith('.tsx')
    ) {
      if (entry.endsWith('.d.ts')) continue;
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no `assistantMessage` / `currentMessage` dual-state outside reducer', () => {
  it('only applyCanonicalFrame + deriveFlatMessage may declare or mutate the flat-string concat state', () => {
    const violations: Array<{ file: string; line: number; match: string; rule: string }> = [];

    for (const file of walk(CHAT_ROOT)) {
      const rel = relative(CHAT_ROOT, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Skip pure comment lines so explanatory comments don't trigger.
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
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
        `Found ${violations.length} dual-state site(s). ` +
          `Track B Phases 3+4 of the canonical rip funnel all writes through ` +
          `applyCanonicalFrame; readers consume contentBlocks:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
