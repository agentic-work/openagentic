/**
 * Architecture cage — no hardcoded router floors or regex triggers in
 * SmartModelRouter / PromptClassifier.
 *
 * Background: 2026-05-22 mock-01 Auto-Routing dropped to gpt-oss:20b
 * for a T3 Azure enterprise prompt. Investigation surfaced three SoT
 * violations layered together (#1046):
 *
 *   1. SmartModelRouter.ts: T3_FCA_FLOOR, T3_CONTEXT_FLOOR,
 *      MIN_FUNCTION_CALLING_ACCURACY_SIMPLE/COMPLEX are hardcoded.
 *   2. SmartModelRouter.ts: EXPLICIT_MOST_CAPABLE_RE is a hardcoded
 *      regex that re-introduces the lexical safety-net #805 ripped.
 *   3. PromptClassifier.ts: per-taskType `requiresToolUseReliability`
 *      literals embed business policy in source.
 *
 * All three must move to RouterTuning DB rows (single SoT, admin-tunable
 * via /admin#router-tuning). Defaults stay in the migration seed, never
 * in TypeScript source.
 *
 * Allowed locations:
 *   - prisma/schema.prisma / prisma/migrations/**  (DB schema + seed)
 *   - services/RouterTuningService.ts              (defensive defaults when DB row missing)
 *   - services/__tests__/SmartModelRouter*.test.ts (tests can set values inline)
 *   - services/router/__tests__/*.test.ts          (tests can set values inline)
 *   - __tests__/architecture/no-hardcoded-router-floors.source-regression.test.ts (this file)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

/**
 * Forbidden patterns — all expressions of router-tuning policy hardcoded
 * in production .ts source. Wide enough to catch synonyms (snake/camel,
 * with/without underscores) but narrow enough to ignore unrelated
 * identifiers (e.g. test fixture literals named foo_FCA_FLOOR_test).
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\bT3_FCA_FLOOR\s*[:=]\s*[\d.]+/,
    description: 'hardcoded T3_FCA_FLOOR — use tuning.fcaT3Floor',
  },
  {
    pattern: /\bT3_CONTEXT_FLOOR\s*[:=]\s*[\d_]+/,
    description: 'hardcoded T3_CONTEXT_FLOOR — use tuning.contextT3Floor',
  },
  {
    pattern: /\bMIN_FUNCTION_CALLING_ACCURACY_(SIMPLE|COMPLEX)\s*[:=]\s*[\d.]+/,
    description: 'hardcoded MIN_FUNCTION_CALLING_ACCURACY_* — use tuning.fcaSimpleToolFloor / tuning.fcaComplexFloor',
  },
  {
    pattern: /\bEXPLICIT_MOST_CAPABLE_RE\s*=/,
    description: 'hardcoded EXPLICIT_MOST_CAPABLE_RE regex — structural classifier only, no lexical safety-net (per #805)',
  },
  {
    pattern: /requiresToolUseReliability\s*:\s*0\.\d+/,
    description: 'hardcoded requiresToolUseReliability per taskType — use tuning.capabilityProfileFloors[taskType]',
  },
];

const ALLOW_LIST_SUFFIXES: string[] = [
  'services/RouterTuningService.ts',
  'services/__tests__/RouterTuningService.test.ts',
  '__tests__/architecture/no-hardcoded-router-floors.source-regression.test.ts',
];

function isAllowed(rel: string): boolean {
  // Universal allow-list — tests + fixtures may set tuning inline.
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

describe('Architecture: no hardcoded SmartModelRouter floors or regex triggers', () => {
  it('no production .ts file embeds router-tuning literals', () => {
    const violations: Array<{ file: string; line: number; match: string; rule: string }> = [];

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
        `Found ${violations.length} hardcoded router-tuning literal(s). ` +
          `Move all floors + the EXPLICIT_MOST_CAPABLE_RE regex to RouterTuning DB:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
