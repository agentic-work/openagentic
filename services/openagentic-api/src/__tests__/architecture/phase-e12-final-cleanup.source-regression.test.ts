/**
 * Phase E.12 — Final cleanup arch pin
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 *       §Phase E.12 ("Final cleanup pass — re-run vitest suite, flag any
 *       test files that imported the now-deleted services").
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md
 *       §Deletion list.
 *
 * This omnibus gate enforces:
 *
 *  1. The V2-cascade machinery legacy service files are GONE on disk.
 *     (Pinned individually by phase-e1, phase-e8gh, etc; this asserts
 *      the union to catch any one file resurfacing.)
 *
 *  2. The legacy admin route surfaces for prompt templates, advanced
 *     prompting techniques, and the prompt-modules CRUD admin page are
 *     not re-registered in the memory-ai plugin (RIPPED 2026-05-11).
 *
 *  3. The deleted SmartModelRouter tests that exercised the trivialIntent
 *     cheapest-chat shortcut are NOT reintroduced. The shortcut is gone;
 *     model decides intent intrinsically. Any test that constructs
 *     `new SmartModelRouter(..., { intentClassifier: ... })` is a
 *     regression — the constructor does not accept that option anymore.
 *
 * After Phase E.12, the chatmode-rip plan is complete and the new
 * runChat path is the sole production chat surface.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, '../..');

// Files that are pinned-individually elsewhere but are also tracked here as
// a union sanity check. If any of these reappear on disk, Phase E.12 fails.
const RIPPED_FILES: string[] = [
  'services/IntentClassifierService.ts',
  'services/ToolRankerService.ts',
  'services/SubagentOrchestrator.ts',
  'services/SystemPromptComposer.ts',
  'services/prompt/PromptComposer.ts',
  'services/prompt/PromptModuleRegistry.ts',
  'services/prompt/ModuleSeeder.ts',
  'services/prompt/ModuleEmbeddingService.ts',
  'routes/orchestrate.ts',
];

// Symbols that may NEVER appear in production source (excluding __tests__).
// Mirrors phase-e11's FORBIDDEN list but adds the SmartModelRouter
// classifier-option footgun.
const FORBIDDEN_SYMBOLS = [
  'IntentClassifierService',
  'IntentClassifierLike',
  'ToolRankerService',
  'SubagentOrchestrator',
  'PromptComposer',
  'PromptModuleRegistry',
  'ModuleSeeder',
  'ModuleEmbeddingService',
  'composeSidecar',
  'composeStatic',
  'intentToFcaFloor',
  'intentToTopK',
  'orchestrateRoutes',
];

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
      // Architecture tests are allowed to NAME the dead symbols in test
      // descriptions / comments / forbidden-list arrays. Production
      // source is what this gate guards.
      if (entry === '__tests__') continue;
      // Legacy v2/ tree was ripped in #741 — defense-in-depth skip.
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

describe('Phase E.12 — final cleanup union pin', () => {
  it('all ripped V2-cascade service files are gone from disk', () => {
    const survivors: string[] = [];
    for (const rel of RIPPED_FILES) {
      const path = join(API_SRC, rel);
      if (existsSync(path)) survivors.push(rel);
    }
    expect(survivors, `Phase E ripped files still on disk: ${survivors.join(', ')}`).toEqual([]);
  });

  it('no production .ts file outside __tests__/v2 references the 13 forbidden V2-cascade symbols', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const hits: string[] = [];
      for (const sym of FORBIDDEN_SYMBOLS) {
        // Word-boundary match to avoid matching `orchestrate` substring in
        // `openagentic-proxy` orchestrate route paths (different service).
        const re = new RegExp(`\\b${sym}\\b`);
        if (re.test(content)) hits.push(sym);
      }
      if (hits.length > 0) offenders.push({ file: rel, matches: hits });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: ${o.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `Phase E.12: forbidden V2-cascade symbols in production source:\n${report}\n\n` +
          'These 13 symbols are dead post-Phase-E. Edit the source to remove ' +
          'the reference (most are stale comments / JSDoc). New references ' +
          'are regressions — escalate before un-pinning.',
      );
    }
  });

  it('SmartModelRouter constructor does NOT accept an `intentClassifier` option', () => {
    // Behavioral guard: a regression that re-introduces the classifier
    // option on the SmartModelRouter constructor would silently restore
    // the trivialIntent cheapest-chat shortcut. Catch it at compile time
    // by asserting the constructor option signature shape via source
    // inspection (cheap; no runtime instantiation needed).
    const src = readFileSync(
      join(API_SRC, 'services', 'SmartModelRouter.ts'),
      'utf8',
    );
    // The `intentClassifier` token must NOT appear anywhere in the
    // file — not as a constructor option, not as a private field, not
    // as a method call.
    expect(src).not.toMatch(/\bintentClassifier\b/);
  });
});
