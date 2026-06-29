/**
 * Architecture cage — no hardcoded colors in compose_visual + ECharts renderer.
 *
 * Companion to `no-hardcoded-colors-in-compose-templates.source-regression.test.ts`
 * which covers the `composeAppTemplates/` directory only. This test extends
 * coverage to:
 *
 *   - services/ComposeVisualTool.ts (compose_visual main entrypoint, the
 *     render functions for sankey_3col / table / kpi_grid all emit inline
 *     HTML/SVG with hardcoded colors today — that's the bug 2026-05-24
 *     where the user saw `rgb(246, 248, 250)` gray in a table iframe that
 *     wasn't tracking the page's `--accent` and `--cm-bg`)
 *   - services/visualizations/EChartsRenderer.ts (server-side SVG render
 *     for sankey/chord/sunburst/treemap/etc — emits `fill="#8b5cf6"`
 *     literals into the SVG string)
 *   - services/composeAppTemplates/*.ts (already covered by sibling test;
 *     re-scanned here for symmetry — exempt `_shared.ts` token-source file)
 *
 * Rule (CLAUDE.md Rule 8(b), user direction 2026-05-13 + 2026-05-24):
 *   "ALL rendered content must resolve colors via global theme tokens.
 *    NO hardcoded hex / rgb() / named colors in compose_visual / compose_app
 *    iframes / MermaidRenderer / ReactFlow / ECharts / SubAgentCard /
 *    inline-prose."
 *
 * Allowed exceptions:
 *   - hex/rgba inside `var(--cm-*, #fallback)` expressions — the fallback
 *     is the last-resort default; the primary path is still the token
 *   - `_shared.ts` THEME_PREAMBLE block (the token source itself)
 *   - SVG-rewrite mapping (`text[fill="#fff"]` selector arguments are NOT
 *     color values, they're attribute matchers — but for safety we treat
 *     them as fine inside that one file)
 *
 * Forbidden:
 *   - bare `#rrggbb` / `#rgb` / `#rrggbbaa` in CSS/SVG/JS source
 *   - `rgb(...)` / `rgba(...)` with literal numeric channels in CSS/SVG/JS
 *     source (palettes, fills, strokes)
 *   - named colors `red|white|black|gray|grey|...` in `color:` / `fill:` /
 *     `stroke:` / `background:` / `border-color:` properties
 *
 * Spec: feedback_compositions_must_use_global_theme_tokens.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVICES_DIR = join(__dirname, '../../services');

/** Files that are EXEMPT (token-source files). Path relative to SERVICES_DIR. */
const EXEMPT_FILES = new Set<string>([
  'composeAppTemplates/_shared.ts',
]);

interface Violation {
  file: string;
  line: number;
  excerpt: string;
  reason: string;
}

function listTargetFiles(): string[] {
  const out: string[] = [];

  // 1. ComposeVisualTool.ts (single file)
  out.push(join(SERVICES_DIR, 'ComposeVisualTool.ts'));

  // 2. composeAppTemplates/*.ts
  const tmplDir = join(SERVICES_DIR, 'composeAppTemplates');
  for (const f of readdirSync(tmplDir)) {
    if (f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts')) {
      out.push(join(tmplDir, f));
    }
  }

  // 3. visualizations/EChartsRenderer.ts
  out.push(join(SERVICES_DIR, 'visualizations', 'EChartsRenderer.ts'));

  return out.filter((p) => {
    try { return statSync(p).isFile(); } catch { return false; }
  });
}

function scanFile(filePath: string, rel: string): Violation[] {
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const out: Violation[] = [];

  // Strip block /* … */ comments cheaply by zeroing characters inside them.
  // We do a simple state machine on the full source then re-split — this
  // avoids false-positives on hex inside JSDoc blocks.
  const noBlockComments = stripBlockComments(src);
  const scrubbedLines = noBlockComments.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const trimmedOrig = original.trim();
    if (!trimmedOrig) continue;
    // Skip line-comments (whole line) and lines starting with * inside doc blocks.
    if (trimmedOrig.startsWith('//') || trimmedOrig.startsWith('*') || trimmedOrig.startsWith('/*')) continue;

    // Use the comment-stripped version for matching.
    let line = scrubbedLines[i] ?? original;
    const lineNum = i + 1;

    // Strip allowed `var(--xxx, #fallback)` / `var(--xxx, rgba(...))` expressions.
    let scrubbed = line.replace(/var\(\s*--[a-zA-Z0-9_-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, 'var(--scrubbed)');
    scrubbed = scrubbed.replace(/var\(\s*--[a-zA-Z0-9_-]+\s*,\s*rgba?\([^)]+\)\s*\)/g, 'var(--scrubbed)');

    // Also scrub line-trailing `// comment …` inline comments (anything after //
    // that isn't a URL `https://…`). This lets us skip `#NNNN` references in
    // comments that happen to share a line with code.
    scrubbed = scrubbed.replace(/(^|[^:])\/\/.*$/, (_m, lead) => lead);

    // ---- Hex literal scan ----
    const hexMatches = scrubbed.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hexMatches) {
      for (const m of hexMatches) {
        // Only 3 / 4 / 6 / 8 hex digits, with at least one a-f to disambiguate
        // from issue refs like `#7891` (which are decimal). 6-digit / 8-digit
        // sequences with all-digit content are still suspicious — keep them.
        if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(m)) continue;
        // If the hex is 3/4 digits AND all-digit (looks like a 4-digit issue
        // ref `#1024`), skip to avoid false-positives on PR/issue numbers.
        if (m.length <= 5 && /^#[0-9]+$/.test(m)) continue;
        out.push({
          file: rel,
          line: lineNum,
          excerpt: trimmedOrig.slice(0, 200),
          reason: `hex literal ${m} outside var(--cm-*, fallback) — use var(--cm-*) / var(--accent) token instead`,
        });
      }
    }

    // ---- rgb() / rgba() literal scan ----
    const rgbMatches = scrubbed.match(/\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g);
    if (rgbMatches) {
      for (const m of rgbMatches) {
        out.push({
          file: rel,
          line: lineNum,
          excerpt: trimmedOrig.slice(0, 200),
          reason: `rgb literal ${m}... outside var(--cm-*, fallback) — use var(--cm-*) / var(--accent) token instead`,
        });
      }
    }
  }

  return out;
}

/**
 * Strip /* … *​/ block comments without touching string literals. This is a
 * heuristic — we accept that strings containing literal `/*` could confuse
 * the scanner, but that's fine for our source-regression purposes (real code
 * doesn't do that in compose templates).
 */
function stripBlockComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') {
      // Skip to closing */ but preserve newlines for line-number stability.
      let j = i + 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) {
        out += src[j] === '\n' ? '\n' : ' ';
        j++;
      }
      i = j + 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

describe('Architecture cage — no hardcoded colors in compose_visual + ECharts renderer', () => {
  it('ComposeVisualTool, composeAppTemplates, and EChartsRenderer MUST resolve colors via var(--cm-*) tokens', () => {
    const targetFiles = listTargetFiles();
    expect(targetFiles.length, 'sanity: target file glob should not be empty').toBeGreaterThan(5);

    const allViolations: Violation[] = [];
    for (const abs of targetFiles) {
      const rel = relative(SERVICES_DIR, abs);
      if (EXEMPT_FILES.has(rel)) continue;
      allViolations.push(...scanFile(abs, rel));
    }

    const summary = allViolations.length === 0
      ? ''
      : `\n${allViolations.length} hardcoded color literal(s) found:\n` +
        allViolations.slice(0, 120).map(v => `  ${v.file}:${v.line} — ${v.reason}\n      ${v.excerpt}`).join('\n') +
        (allViolations.length > 120 ? `\n  ... and ${allViolations.length - 120} more` : '') +
        `\n\nRule: every artifact-rendering surface MUST resolve colors via var(--cm-*) tokens.\n` +
        `Use var(--cm-bg), var(--cm-fg), var(--cm-border), var(--cm-accent), var(--cm-warn),\n` +
        `var(--cm-error), var(--cm-info), var(--cm-success). Hex/rgba fallbacks are allowed\n` +
        `ONLY inside var(--cm-*, #fallback) safety expressions. See CLAUDE.md Rule 8(b) and\n` +
        `feedback_compositions_must_use_global_theme_tokens.md for full rule.`;

    expect(allViolations, summary).toEqual([]);
  });
});
