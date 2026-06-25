/**
 * arch — no SKIP_* escape valves in build/CI scripts (CLAUDE.md Rule 6 + 7c).
 *
 * 2026-05-23: the user direction is "all code must pass these — period —
 * no fucking around". `SKIP_ARCH_TESTS`, `SKIP_GITLEAKS`, and
 * `SKIP_REAL_MODEL_HARNESS` env-var bypasses were RIPPED from
 * `scripts/pre-commit.sh` and `scripts/build.sh`.
 *
 * This test prevents re-introduction. Any future commit that adds one of
 * these env-var references to scripts/, .github/workflows/, or CI config
 * files will RED this arch test and the pre-commit hook will refuse the
 * commit. Same enforcement as Rule 6 itself.
 *
 * What is NOT flagged:
 *   - References inside this test file (it has to name them).
 *   - References inside CLAUDE.md (it has to document the rip).
 *   - References inside docs/audits/* or reports/* (historical record).
 *   - References inside scripts/harness/README.md (documents the gate).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

const BANNED_ENV_VARS = [
  'SKIP_ARCH_TESTS',
  'SKIP_GITLEAKS',
  'SKIP_REAL_MODEL_HARNESS',
];

// Directories that MUST NOT reference the banned env vars.
const FORBIDDEN_DIRS = [
  'scripts',
  '.github/workflows',
];

// Files inside FORBIDDEN_DIRS that ARE allowed to reference the env vars
// (because their purpose is to document or test the rip itself).
const ALLOWLISTED_FILES = new Set<string>([
  // None today. This stays empty until there's a documented exception.
]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Build per-var regex that detects actual USAGE (not bare mentions in
 * comments/docs). Catches:
 *   ${VAR}           bash expansion
 *   $VAR             bash short form
 *   VAR=1 / VAR=true assignment
 *   "${VAR:-0}"      bash with-default
 *   if [ "$VAR" ...  conditional check
 *   env:\n  VAR:     YAML env block (CI workflows)
 *   "VAR" in process.env / process.env.VAR  (JS/TS)
 *
 * Does NOT match:
 *   Plain mention inside a `# comment` or `// comment` line
 *   Plain mention inside a markdown paragraph
 *   The string inside this test file's BANNED_ENV_VARS array (allowlist)
 */
function buildUsagePatterns(varName: string): RegExp[] {
  const v = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\$\\{?${v}(?:[:\\-+}]|$)`), // ${VAR}, $VAR
    new RegExp(`\\b${v}\\s*=\\s*[^\\s]`), // VAR=1, VAR=true (assignment)
    new RegExp(`["\\']${v}["\\']\\s*:`), // YAML: "VAR":  or  'VAR':
    new RegExp(`^\\s*${v}\\s*:`, 'm'), // YAML: VAR: at line-start
    new RegExp(`process\\.env\\.${v}\\b`), // process.env.VAR
    new RegExp(`process\\.env\\[["\\']${v}["\\']\\]`), // process.env["VAR"]
  ];
}

function lineIsComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  );
}

describe('arch — no SKIP_* escape valves in build/CI scripts (Rule 6 + 7c)', () => {
  it('scripts/ and .github/workflows/ MUST NOT functionally reference banned SKIP_* env vars', () => {
    const violations: string[] = [];

    for (const dir of FORBIDDEN_DIRS) {
      const absDir = join(REPO_ROOT, dir);
      const files = walk(absDir);
      for (const file of files) {
        const rel = relative(REPO_ROOT, file);
        if (ALLOWLISTED_FILES.has(rel)) continue;
        if (/\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot)$/i.test(file)) {
          continue;
        }
        let body: string;
        try {
          body = readFileSync(file, 'utf8');
        } catch {
          continue;
        }

        const lines = body.split('\n');
        for (const v of BANNED_ENV_VARS) {
          const patterns = buildUsagePatterns(v);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (lineIsComment(line)) continue; // doc-only comment is OK
            for (const re of patterns) {
              if (re.test(line)) {
                violations.push(
                  `${rel}:${i + 1} — functional reference to banned env var ${v}: ` +
                    line.trim().slice(0, 120),
                );
                break;
              }
            }
          }
        }
      }
    }

    expect(
      violations,
      `CLAUDE.md Rule 6 + 7c: SKIP_* bypasses are RIPPED. ` +
        `Found ${violations.length} functional re-introduction(s):\n` +
        violations.map((v) => `  - ${v}`).join('\n') +
        `\nFix: remove the bypass code. If a test/build genuinely cannot pass, fix the code, not the bypass.`,
    ).toEqual([]);
  });
});
