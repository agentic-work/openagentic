/**
 * Gap #3 — arch cage: no silent fallback to DEFAULT_SERVICE_PROMPTS.
 *
 * Any return of `DEFAULT_SERVICE_PROMPTS[...]` MUST be preceded within
 * the previous 8 source lines by a `logger.warn` or `loggers.services.warn`
 * (or `this.logger.warn`, `log.warn`) call — otherwise the inline constant
 * silently masks DB drift.
 *
 * The fallback STAYS (it's load-bearing for boot before the DB seeds), but
 * every fallback path must scream so drift is visible in production logs.
 *
 * Sites covered (current callers of DEFAULT_SERVICE_PROMPTS):
 *   - services/SlackIntegrationService.ts
 *   - services/AITitleGenerationService.ts
 *   - services/TitleGenerationClient.ts
 *   - services/CodeModeSessionService.ts
 *   - memory/services/MemoryContextService.ts
 *
 * The defining module itself (services/prompt/ServicePromptService.ts) and
 * `__tests__/` files are excluded.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_ROOT = resolve(__dirname, '../../');
const FALLBACK_TOKEN = 'DEFAULT_SERVICE_PROMPTS[';
const WARN_RE = /(loggers?\.\w+\.warn|this\.logger\.warn|\blogger\.warn|\blog\.warn)\s*\(/;
const LOOKBACK_LINES = 8;

const EXCLUDE_SUFFIX = [
  // The defining module — DEFAULT_SERVICE_PROMPTS literal lives here.
  'services/prompt/ServicePromptService.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      walk(full, out);
    } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

describe('arch: no-silent-prompt-fallback (Gap #3)', () => {
  it('every DEFAULT_SERVICE_PROMPTS[...] return is preceded by a logger.warn within 8 lines', () => {
    const files = walk(SRC_ROOT)
      .filter((f) => !EXCLUDE_SUFFIX.some((s) => f.endsWith(s)));

    const violations: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes(FALLBACK_TOKEN)) continue;
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match `return DEFAULT_SERVICE_PROMPTS[...]...` (with or without
        // dereferences like `?.body`).
        if (!/\breturn\s+DEFAULT_SERVICE_PROMPTS\s*\[/.test(line)) continue;

        const startWindow = Math.max(0, i - LOOKBACK_LINES);
        const window = lines.slice(startWindow, i + 1).join('\n');
        if (WARN_RE.test(window)) continue;

        violations.push({
          file: file.replace(SRC_ROOT, ''),
          line: i + 1,
          snippet: line.trim(),
        });
      }
    }

    expect(
      violations.length,
      `Found ${violations.length} silent fallback site(s) — every return of ` +
      `DEFAULT_SERVICE_PROMPTS[...] must be preceded within ${LOOKBACK_LINES} lines by a ` +
      `logger.warn / loggers.services.warn / this.logger.warn / log.warn call so drift is visible:\n` +
      JSON.stringify(violations, null, 2),
    ).toBe(0);
  });
});
