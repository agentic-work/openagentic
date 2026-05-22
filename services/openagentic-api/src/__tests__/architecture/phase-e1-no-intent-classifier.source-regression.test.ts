/**
 * Phase E.1 arch gate — no IntentClassifierService production references
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 *       §Phase E task E.1 ("Delete IntentClassifierService").
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md
 *       §Layer-2 ("Tool layering — model-driven discovery") + §Deletion list
 *       row "IntentClassifierService.ts | ~400 LOC | pre-LLM classifier".
 *
 * STATE = `it.skip` until Phase E.1 lands.
 *
 * After E.1 deletes the service + all its callers:
 *   1. Un-`.skip` these test cases.
 *   2. They should be GREEN immediately (count = 0 production references).
 *   3. Any future re-introduction trips the gate — build fails, regression
 *      blocked permanently.
 *
 * Why pre-write this in `.skip` form: future-Claude (or any agent) lands
 * Phase E.1, runs the suite, and discovers the test SHOULD pass. Removing
 * `.skip` becomes part of the E.1 commit, not a separate arch-test task.
 */
import { describe, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, '../..');

function collectTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      // Test directories — vitest fixtures + historical regression tests
      // reference removed services by name (e.g. v2 pipeline cascade tests
      // pin behavior of the old IC integration). E.1 only governs
      // production source.
      if (entry === '__tests__') continue;
      // v2 chat pipeline — slated for deletion in B-vrip step 6. Files
      // there still mention the classifier but are dead code.
      if (entry === 'v2') continue;
      out.push(...collectTs(full));
    } else if (
      stat.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

const RIP_TARGETS = [
  // class / service identifiers
  'IntentClassifierService',
  // contract / type aliases that surface the service
  'IntentClassifierLike',
  // function name on the service
  'classifyIntent',
];

// Files allowed to keep references during the rip transition. After
// Phase E.1 lands these should be EMPTY (the service file itself is
// gone, the test file references nothing because the service is gone).
const ALLOWLIST = new Set<string>([
  // Service file itself — gone after E.1.
  'src/services/IntentClassifierService.ts',
  // Service-level test file — gone after E.1.
  'src/services/__tests__/IntentClassifierService.test.ts',
  // This file documents the rip — refers to the name in test descriptions.
  'src/__tests__/architecture/phase-e1-no-intent-classifier.source-regression.test.ts',
]);

describe('Phase E.1 — no production references to IntentClassifierService', () => {
  it('no .ts file outside the allowlist mentions IntentClassifierService (E.1 GREEN gate)', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (ALLOWLIST.has(rel)) continue;
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const hits: string[] = [];
      for (const sym of RIP_TARGETS) {
        if (content.includes(sym)) hits.push(sym);
      }
      if (hits.length > 0) offenders.push({ file: rel, matches: hits });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: ${o.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `IntentClassifierService references found after Phase E.1 rip:\n${report}\n\n` +
          'Either un-allowlist a legitimate caller and complete the rip there, ' +
          'or expand the deletion before un-skipping this test.',
      );
    }
  });

  it('IntentClassifierService.ts file no longer exists', () => {
    const path = join(API_SRC, 'services/IntentClassifierService.ts');
    let exists = false;
    try {
      statSync(path);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      throw new Error(
        'services/IntentClassifierService.ts still exists. Phase E.1 deletes it. ' +
          'Run `git rm services/openagentic-api/src/services/IntentClassifierService.ts` ' +
          'and the service-level test file, then re-run.',
      );
    }
  });
});
