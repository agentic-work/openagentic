/**
 * Architecture gate — RIP the viz-tier ladder.
 *
 * Plan: /home/trent/.claude/plans/sprightly-percolating-brook.md
 *
 * After the rip, NO source file under
 *   services/openagentic-api/src/
 *   services/openagentic-ui/src/
 * may reference any of the ripped tier-system identifiers. This test
 * walks both trees, scans every .ts / .tsx file for the forbidden
 * tokens, and reports `filePath:lineNumber: matchedToken` for every hit.
 *
 * Excluded paths:
 *   - any `__tests__/` directory (tests reference these symbols on purpose)
 *   - node_modules / dist
 *   - this file itself
 *
 * RED today: dozens of source files still contain TIER_THRESHOLDS,
 * resolveTierProfile, vizTier, TierBadge, HandoffChip, etc. The output
 * is the contract — the controller turns the long list GREEN by
 * deleting / modifying the cited files per the plan's MODIFIES + RIPS
 * tables.
 *
 * Pattern reference:
 *   src/__tests__/architecture/no-naked-mcp-array.source-regression.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');
// API_SRC = services/openagentic-api/src — climb up 2 to services/ then into UI.
const UI_SRC = join(API_SRC, '../../openagentic-ui/src');

/**
 * Forbidden tokens. Plain case-sensitive substring match — not regex.
 *
 * `vizTier` is camelCase ONLY — the kebab-case `viz-capabilities` slug
 * stays in source as the universal replacement module name; we don't
 * want to false-positive on it.
 *
 * 2026-05-09 (Phase 10) — handoff-related tokens (`buildModelHandoffOffer`,
 * `model_handoff_offer`, `ModelHandoffOfferEvent`, `HandoffOfferDetector`)
 * are NO LONGER forbidden. Per spec §11.3, the handoff_offer event is being
 * re-introduced as a CAPABILITY-SCORE (FCA) driven affordance — distinct
 * from the ripped tier ladder. The handoff is now intent-keyed, model-
 * agnostic. The TIER ladder stays dead (everything below is preserved).
 */
const FORBIDDEN_TOKENS: ReadonlyArray<string> = [
  'TIER_THRESHOLDS',
  'resolveTierProfile',
  'vizTier',
  'TIER3_ONLY_TOOL_NAMES',
  'NON_VIZ_FAMILIES',
  'viz-tier-1-',
  'viz-tier-2-',
  'viz-tier-3-',
  'enforceTierStripOnAssistantMessage',
  'TierBadge',
  'HandoffChip',
  'TierProfileResolver',
  // Phase 0 strengthening — wire-types rip (tier ladder pieces)
  'TierHintEvent',
  'buildTierHint',
  'tier_hint',
  'tierStrip',
];

const EXCLUDED_DIR_FRAGMENTS: ReadonlyArray<string> = [
  '/__tests__/',
  '/node_modules/',
  '/dist/',
  '/.worktrees/',
  '/coverage/',
];

const SELF_PATH = __filename;

function walkSource(root: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // Directory doesn't exist on this checkout — skip silently.
  }
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Cheap excluded-fragment short-circuit — don't recurse into __tests__.
      const withSlash = full + '/';
      if (EXCLUDED_DIR_FRAGMENTS.some((frag) => withSlash.includes(frag))) continue;
      walkSource(full, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!(name.endsWith('.ts') || name.endsWith('.tsx'))) continue;
    if (full === SELF_PATH) continue;
    // Skip d.ts type-stub files — they're noise.
    if (name.endsWith('.d.ts')) continue;
    // Skip any file that lives under an excluded fragment.
    if (EXCLUDED_DIR_FRAGMENTS.some((frag) => full.includes(frag))) continue;
    out.push(full);
  }
}

interface Hit {
  filePath: string;
  lineNumber: number;
  token: string;
  preview: string;
}

function scanFile(filePath: string): Hit[] {
  const hits: Hit[] = [];
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return hits;
  }
  // Quick reject — if no forbidden token appears at all, skip the line walk.
  if (!FORBIDDEN_TOKENS.some((tok) => text.includes(tok))) return hits;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const tok of FORBIDDEN_TOKENS) {
      if (line.includes(tok)) {
        hits.push({
          filePath,
          lineNumber: i + 1,
          token: tok,
          preview: line.trim().slice(0, 160),
        });
      }
    }
  }
  return hits;
}

describe('Architecture: no viz-tier ladder remains in source', () => {
  it('zero forbidden tier-system tokens in services/openagentic-api/src + services/openagentic-ui/src', () => {
    const files: string[] = [];
    walkSource(API_SRC, files);
    walkSource(UI_SRC, files);

    const allHits: Hit[] = [];
    for (const f of files) {
      const fileHits = scanFile(f);
      if (fileHits.length > 0) allHits.push(...fileHits);
    }

    if (allHits.length === 0) return;

    // Format the failure as one occurrence per line. Sort for stable output.
    allHits.sort((a, b) => {
      if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
      return a.lineNumber - b.lineNumber;
    });
    const formatted = allHits
      .map((h) => `  ${h.filePath}:${h.lineNumber}: ${h.token}    ${h.preview}`)
      .join('\n');

    throw new Error(
      `Found ${allHits.length} forbidden viz-tier ladder reference(s) across ` +
        `${new Set(allHits.map((h) => h.filePath)).size} file(s). ` +
        `Plan: /home/trent/.claude/plans/sprightly-percolating-brook.md.\n\n` +
        `Forbidden tokens: ${FORBIDDEN_TOKENS.join(', ')}\n\n` +
        formatted,
    );
  });
});

describe('no-tier-gates fixture sweep', () => {
  // Phase 0 ripped the tier ladder; the agentic-events test fixtures must
  // not reseed `tier_required` on compose_app or any other event.
  const API_FIXTURE = join(
    API_SRC,
    'services/agentic-events/__tests__/types.test.ts',
  );
  const UI_FIXTURE = join(
    UI_SRC,
    'types/agentic-events/__tests__/types.test.ts',
  );

  it('compose_app fixture in agentic-events tests does not reference tier_required (api)', () => {
    const src = readFileSync(API_FIXTURE, 'utf8');
    expect(src).not.toMatch(/tier_required\s*:\s*\d/);
    expect(src).not.toMatch(/tier_required\s*:\s*['"]\w+['"]/);
    expect(src).not.toMatch(/\btier_required\b/);
  });

  it('compose_app fixture in agentic-events tests does not reference tier_required (ui mirror, if present)', () => {
    if (!statSyncSafe(UI_FIXTURE)) return; // mirror is optional
    const src = readFileSync(UI_FIXTURE, 'utf8');
    expect(src).not.toMatch(/tier_required\s*:\s*\d/);
    expect(src).not.toMatch(/tier_required\s*:\s*['"]\w+['"]/);
    expect(src).not.toMatch(/\btier_required\b/);
  });

  // #634 — the production ComposeAppEvent type must not declare tier_required.
  // Phase 0 ripped the tier ladder from runtime + emitters; the wire schema
  // hasn't carried this field for two months. Keeping it in the TS interface
  // is dead surface that future code might reseed by accident.
  const API_TYPES = join(API_SRC, 'services/agentic-events/types.ts');
  const UI_TYPES = join(UI_SRC, 'types/agentic-events/types.ts');

  it('production agentic-events type (api) does not declare tier_required on ComposeAppEvent (#634)', () => {
    const src = readFileSync(API_TYPES, 'utf8');
    expect(src).not.toMatch(/\btier_required\b/);
  });

  it('production agentic-events type (ui) does not declare tier_required on ComposeAppEvent (#634)', () => {
    if (!statSyncSafe(UI_TYPES)) return;
    const src = readFileSync(UI_TYPES, 'utf8');
    expect(src).not.toMatch(/\btier_required\b/);
  });
});

function statSyncSafe(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
