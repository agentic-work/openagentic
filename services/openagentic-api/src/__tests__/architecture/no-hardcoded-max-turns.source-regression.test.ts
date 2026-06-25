/**
 * Architecture cage — no hardcoded chat-loop max-turns defaults.
 *
 * Background: 2026-05-11 multi-cloud capstone hit the prior hardcoded
 * `DEFAULT_MAX_TURNS = 12` in `chatLoop.ts` during 32-tool cascade
 * fanout (Sev-1). The cap is now admin-tunable via
 * `ChatLoopConfigService` (SoT: `admin.system_configuration` row
 * keyed `chat_loop`, surfaced at /admin#chat-loop).
 *
 * This cage forbids re-introducing a hardcoded default ANYWHERE outside
 * the service itself + its tests. If you need a number, get it from
 * `ChatLoopConfigService.getMaxTurns()` — never inline a literal.
 *
 * Allowed:
 *   - `services/ChatLoopConfigService.ts`         (the SoT — exports defaults)
 *   - `services/__tests__/ChatLoopConfigService.test.ts`
 *   - `routes/admin/chat-loop-config.ts`          (validation range constants)
 *   - `__tests__/architecture/no-hardcoded-max-turns*` (this file)
 *   - test fixtures under `__tests__/`            (test args, not production code)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

// Match any line declaring/initialising a MAX_TURNS-style constant to an
// integer literal — e.g. `const DEFAULT_MAX_TURNS = 12;` or `MAX_TURNS = 24,`.
// Word-boundary anchored so unrelated identifiers (e.g. `MAX_TURNS_FLOOR`
// inside the SoT) only match when they look like a default-value declaration.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\b(DEFAULT_MAX_TURNS|MAX_TURNS_DEFAULT)\b\s*[:=]\s*\d+/,
    description: "hardcoded MAX_TURNS default (use ChatLoopConfigService.getMaxTurns())",
  },
];

const ALLOW_LIST_SUFFIXES: string[] = [
  'services/ChatLoopConfigService.ts',
  'services/__tests__/ChatLoopConfigService.test.ts',
  'routes/admin/chat-loop-config.ts',
  '__tests__/architecture/no-hardcoded-max-turns.source-regression.test.ts',
];

function isAllowed(rel: string): boolean {
  // Universal allow-list — tests + fixtures may set maxTurns inline.
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

describe('Architecture: no hardcoded chat-loop max-turns defaults', () => {
  it('no production .ts file declares MAX_TURNS as an integer literal', () => {
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const { pattern, description } of FORBIDDEN_PATTERNS) {
          if (pattern.test(lines[i])) {
            violations.push({
              file: rel,
              line: i + 1,
              match: lines[i].trim().slice(0, 120) + ` // ${description}`,
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.match}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} hardcoded MAX_TURNS default(s). ` +
          `Source the value from ChatLoopConfigService.getMaxTurns() instead:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
