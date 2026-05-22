/**
 * Phase E.11 arch gate — no legacy chat-pipeline symbols in production source.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 *       §Phase E task E.11 ("Arch test: no IntentClassifier / ToolRanker /
 *       PromptComposer references").
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md
 *       §Layer-2 + §Deletion list.
 *
 * The 8 forbidden symbols span the full Phase E rip:
 *   - E.1  IntentClassifierService          (pre-LLM intent classifier)
 *   - E.2  ToolRankerService                (per-intent top-K subsetting)
 *   - E.3  PromptComposer / composeSidecar  (dynamic-overlay sidecar)
 *   - E.3  composeStatic                    (7-section static prompt)
 *   - E.4  PromptModuleRegistry             (modular prompt DB)
 *   - E.10 intentToFcaFloor                 (router tuning leftover)
 *   - E.10 intentToTopK                     (router tuning leftover)
 *
 * Walker skips __tests__ (architecture tests document the rip by name) and
 * pipeline/v2/ (deleted in B-vrip step 6 / #741; the `v2` skip below is
 * dead code preserved for defense in depth). Pinned by the same pattern as
 * Phase E.1.
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
      if (entry === '__tests__') continue;
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

const FORBIDDEN = [
  'IntentClassifierService',
  'ToolRankerService',
  'PromptComposer',
  'PromptModuleRegistry',
  'composeSidecar',
  'composeStatic',
  'intentToFcaFloor',
  'intentToTopK',
];

const ALLOWLIST = new Set<string>([
  // Empty — Phase E ripped every legitimate caller. Add a path here only
  // if a future commit reintroduces the symbol on purpose (with rationale).
]);

describe('Phase E.11 — legacy chat-pipeline symbols fully ripped', () => {
  it('no .ts/.tsx file outside __tests__/v2 references the 8 forbidden symbols', () => {
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
      for (const sym of FORBIDDEN) {
        if (content.includes(sym)) hits.push(sym);
      }
      if (hits.length > 0) offenders.push({ file: rel, matches: hits });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: ${o.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `Legacy chat-pipeline symbols found after Phase E rip:\n${report}\n\n` +
          'These 8 symbols are dead post-Phase-E. Edit the source to remove the ' +
          'reference (most are stale comments / JSDoc). If a re-introduction is ' +
          'intentional, add the path to ALLOWLIST with a comment explaining why.',
      );
    }
  });
});
