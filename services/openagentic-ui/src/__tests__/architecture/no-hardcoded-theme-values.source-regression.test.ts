import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { relative, resolve } from 'path';

/**
 * ONE-SOT NO-HARDCODING GUARD (repo-wide).
 *
 * Generalizes the chat-only `no-hardcoded-colors-in-chat-renderers` regression
 * to ALL of `src/`. The single source of truth for every color / font /
 * shadow / radius value is `src/styles/theme.css` (Tailwind v4 @theme +
 * the LAYER-2 [data-theme] semantic overrides + the LAYER-3 legacy aliases).
 * NOTHING else may hardcode a theme value. This test fails on:
 *
 *   (a) hex / rgb() / rgba() / hsl() color literals assigned to a color-bearing
 *       property in inline styles, CSS-in-JS, or `.css` files;
 *   (b) literal Tailwind PALETTE color utilities in className strings
 *       (bg-white, text-gray-500, border-red-400, …) — these do NOT flip theme;
 *   (c) hardcoded `fontFamily:` literals that do not read a var(--font-*) token;
 *   (d) any `--color-*` / canonical semantic token DEFINED outside theme.css
 *       (the true SOT guard — there may be exactly one definition site).
 *
 * COMPLIANT forms (never flagged): `var(--token)` and `var(--token, fallback)`
 * (reading a token, even with a literal fallback, is the correct pattern).
 *
 * ── ALLOWLIST ──────────────────────────────────────────────────────────────
 * Explicit, reviewed exemptions where raw literals are legitimate:
 *   - theme.css itself (the ONLY file allowed raw theme literals);
 *   - assets/icons/ai-brands/brand-colors.ts (vendor/trademarked brand hexes);
 *   - the shiki / EnhancedCodeBlock syntax-highlight palette;
 *   - styles/themes/*.css + the .code-mode[data-cm-theme] editor themes
 *     (opt-in, user-selectable code-editor palettes — NOT the app theme);
 *   - sandboxed-iframe srcdoc palette injectors (widgetThemePreamble.ts,
 *     iframeThemeStylesheet.ts, AppRenderer.tsx) — the iframe has no parent
 *     CSS vars so it MUST inline a self-contained palette;
 *   - workflow node-TYPE identity colors + the bracket-pair / diagram rainbow
 *     scale (categorical identity palettes, allowlisted per the design spec);
 *   - legit on-accent contrast white (#fff/#ffffff) and `transparent`.
 *
 * ── TEMPORARY_ALLOWLIST ─────────────────────────────────────────────────────
 * Path prefixes that still contain pre-existing hardcoded stragglers from
 * before the ONE-SOT migration. These are NOT legitimate — they are tracked
 * tech-debt to be tokenized feature-by-feature (research §E phases P2/P3).
 * They are listed here (with a TODO) so the guard PASSES now while the
 * remaining scope stays VISIBLE and can only SHRINK (a CI check below asserts
 * nothing new is added and the list never silently grows). When a prefix is
 * fully tokenized, delete its entry — the guard then enforces it forever.
 */

const SRC_ROOT = resolve(__dirname, '../..');
// Package root (one level above src/) — so the guard ALSO scans the theme-unit
// config files that sit outside src/ and previously escaped it.
const PKG_ROOT = resolve(SRC_ROOT, '..');
const THEME_SOT = 'styles/theme.css';

/**
 * Theme-bearing config files at the PACKAGE ROOT (outside src/). These define
 * the Tailwind utility→token bridge and PostCSS pipeline; they MUST read
 * var(--token) only (no raw hex/rgb) and MUST NOT define a radius/shadow/font
 * token (theme.css is the sole definer). Relative keys are prefixed
 * `@root/` so they never collide with a src-relative allowlist entry.
 */
const ROOT_CONFIG_FILES: ReadonlyArray<string> = [
  'tailwind.config.js',
  'postcss.config.js',
];

/** Legit, permanent exemptions — raw literals here are correct by design. */
const ALLOWLIST: ReadonlyArray<string> = [
  // The one SOT — the only file allowed raw theme literals.
  'styles/theme.css',
  // Vendor / trademarked brand colors (provider logos).
  'assets/icons/ai-brands/brand-colors.ts',
  // Syntax-highlight palette (shiki github-dark token colors).
  'features/chat/components/MessageContent/EnhancedCodeBlock.css',
  // Opt-in, user-selectable code-EDITOR themes (scoped .code-mode[data-cm-theme]).
  'styles/themes/catppuccin-mocha.css',
  'styles/themes/dracula.css',
  'styles/themes/tokyo-night.css',
  'styles/themes/terminal-green.css',
  // Sandboxed-iframe srcdoc palette injectors (no parent vars → must inline).
  'features/chat/components/v2/widgetThemePreamble.ts',
  'features/chat/components/v2/AppRenderer.tsx',
  'features/workflows/utils/iframeThemeStylesheet.ts',
  // Chart token bridge: reads CSS vars, maps token NAMES (string literals are
  // token names, not raw colors).
  'lib/charts/hooks/useThemeTokens.ts',
  // Token-REMAPPING shim: catches literal Tailwind utilities used in admin
  // components (`.text-white`, `.bg-gray-700`, …) as SELECTORS and forces them
  // to read tokens (color: var(--fg-0)). This REDUCES hardcoding; the palette
  // names here are selectors, not applied colors.
  'styles/admin-v3-overrides.css',
];

/**
 * Pre-existing hardcoded stragglers, tracked tech-debt (NOT legitimate).
 * TODO(theme-sot): tokenize these feature-by-feature, then delete the entry.
 * Each prefix is a directory still carrying inline hex/rgb, literal Tailwind
 * palette utilities, or bare fontFamily literals from before the migration.
 */
const TEMPORARY_ALLOWLIST: ReadonlyArray<{ prefix: string; reason: string }> = [
  // Largest surfaces per the migration audit (research §B): node editor +
  // canvas paint per-node-type and status hexes inline in many components.
  { prefix: 'features/workflows/', reason: 'node/canvas inline hex + per-node-type colors (40 files) — P3 codemod pending' },
  // Chat renderers still carry literal Tailwind palette utilities (text-gray-500,
  // bg-white, …) + bare fontFamily literals the old chat guard never covered.
  { prefix: 'features/chat/', reason: 'Tailwind palette utilities (~32 files) + bare fontFamily literals (~79) — P2/P3 pending' },
  // Docs pages embed inline palettes (e.g. GitHub-dark export blocks).
  { prefix: 'features/docs/', reason: 'doc-page inline hex palettes (18 files) — P3 pending' },
  // Admin v2/v3 components still inline a few status hexes + fonts.
  { prefix: 'features/admin/', reason: 'admin inline status hexes + fonts (~15 files) — P3 pending' },
  // Diagram renderers (mermaid/drawio/cytoscape) carry palette literals.
  { prefix: 'components/diagrams/', reason: 'diagram-engine palettes — allowlist candidate, pending review' },
  // index.css carries the legacy .code-mode editor-theme blocks (allowlisted in
  // spirit, but inlined in index.css) + the categorical --cm-rainbow scale.
  { prefix: 'index.css', reason: 'inlined .code-mode editor themes + --cm-rainbow categorical scale (editor/diagram palettes)' },
  // One-off pages/components with a single straggler each.
  { prefix: 'pages/PrimitivesShowcase.tsx', reason: 'showcase swatches demonstrate raw values intentionally — P3 review' },
  { prefix: 'components/MaintenancePage.tsx', reason: 'standalone maintenance splash — single inline palette, P3' },
  { prefix: 'components/VersionBadge.tsx', reason: 'single inline font literal — P3' },
  { prefix: 'features/about/', reason: 'about page inline accents — P3' },
  { prefix: 'features/agents/', reason: 'agent cards inline status hexes — P3' },
  { prefix: 'features/auth/', reason: 'login mixes compliant var(--*) with a few literal utilities — P3' },
  { prefix: 'features/settings/', reason: 'settings swatch previews — P3' },
  { prefix: 'features/setup/', reason: 'setup wizard inline accents — P3' },
  { prefix: 'features/files/', reason: 'file preview type colors — P3' },
  { prefix: 'types/filePreview.ts', reason: 'file-type categorical color map — allowlist candidate, P3' },
  { prefix: 'utils/theme.ts', reason: 'theme util default fallbacks — P3 review' },
  { prefix: 'assets/icons/', reason: 'icon SVG fills (mostly on-accent/categorical) — P3 review' },
  { prefix: 'shared/components/', reason: 'one residual font literal — P3' },
  // NOTE: the former `contexts/ThemeContext.jsx` entry was REMOVED — the
  // duplicate `themes={dark,light}` JS palette is deleted; <Chat> reads the CSS
  // var SOT directly now, so ThemeContext.jsx is fully tokenized and the guard
  // enforces it forever.
];

// ── Detection ────────────────────────────────────────────────────────────────

const COLOR_PROPS = [
  'color', 'background', 'backgroundColor', 'borderColor', 'border',
  'borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'outline',
  'outlineColor', 'fill', 'stroke', 'boxShadow', 'textShadow', 'caretColor',
  'borderTopColor', 'borderBottomColor', 'background-color', 'border-color',
];

const HEX = String.raw`#[0-9a-fA-F]{3,8}\b`;
const FUNC = String.raw`(?:rgba?|hsla?)\(`;
const PROP_GROUP = COLOR_PROPS.join('|');

// inline-style object / CSS-in-JS:  backgroundColor: '#0d1117'   color: rgb(...)
const OBJ_LITERAL = new RegExp(`\\b(?:${PROP_GROUP})\\s*:\\s*['"\`][^'"\`]*(?:${HEX}|${FUNC})`, 'g');
// raw CSS:  background: #0d1117;   color: rgb(...)
const CSS_LITERAL = new RegExp(`\\b(?:${PROP_GROUP})\\s*:\\s*(?:${HEX}|${FUNC})`, 'g');

// literal Tailwind palette color utilities (with optional variant: / opacity/ prefixes).
const TW_PALETTE = String.raw`\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b`;
const TW_RE = new RegExp(TW_PALETTE, 'g');

// bare fontFamily literal (NOT reading a var(--font-*) token).
const FONT_RE = /fontFamily\s*:\s*['"][^'"]+['"]/g;

// on-accent contrast white + transparent are legit anywhere.
const LEGIT_LITERAL = /^(?:#fff|#ffffff|#000|#000000|transparent|inherit|currentColor|none)$/i;

function stripComments(content: string): string[] {
  // Replace CSS/JS block comments with blank lines (preserve line count) and
  // drop // line comments + CSS-line comment leaders at scan time.
  let inBlock = false;
  return content.split('\n').map((line) => {
    let out = line;
    if (inBlock) {
      const end = out.indexOf('*/');
      if (end === -1) return '';
      out = out.slice(end + 2);
      inBlock = false;
    }
    // remove inline /* ... */
    out = out.replace(/\/\*.*?\*\//g, '');
    const open = out.indexOf('/*');
    if (open !== -1) {
      inBlock = true;
      out = out.slice(0, open);
    }
    const trimmed = out.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
    return out;
  });
}

/** Is this a `var(--token, …)` reference (the compliant form)? */
function isTokenRef(line: string): boolean {
  return /var\(\s*--/.test(line);
}

function findViolations(content: string, isCss: boolean): string[] {
  const hits: string[] = [];
  const lines = stripComments(content);
  lines.forEach((line, i) => {
    if (!line.trim()) return;

    // (a) color-prop hex/rgb/hsl literal (skip lines that read a token).
    for (const re of [OBJ_LITERAL, CSS_LITERAL]) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        const tail = line.slice(m.index);
        const valMatch = tail.match(/(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\))/);
        const val = valMatch ? valMatch[1] : '';
        const onAccent = LEGIT_LITERAL.test(val);
        if (!onAccent && !(isTokenRef(tail) && !new RegExp(`(?:${HEX}|${FUNC})`).test(tail.replace(/var\([^)]*\)/g, '')))) {
          hits.push(`L${i + 1} [color-literal]: ${line.trim().slice(0, 150)}`);
        }
      }
    }

    // (b) literal Tailwind palette color utility.
    TW_RE.lastIndex = 0;
    const tw = line.match(TW_RE);
    if (tw) hits.push(`L${i + 1} [tw-palette ${[...new Set(tw)].join(',')}]: ${line.trim().slice(0, 130)}`);

    // (c) bare fontFamily literal not reading a --font-* token.
    FONT_RE.lastIndex = 0;
    const ff = FONT_RE.exec(line);
    if (ff && !/var\(\s*--font/.test(ff[0])) {
      hits.push(`L${i + 1} [fontFamily-literal]: ${ff[0].slice(0, 120)}`);
    }
  });
  return [...new Set(hits)];
}

// ── Allowlist matching ───────────────────────────────────────────────────────

function inList(rel: string, list: ReadonlyArray<string>): boolean {
  return list.some((p) => rel === p || rel.startsWith(p));
}
function inTemp(rel: string): boolean {
  return TEMPORARY_ALLOWLIST.some(({ prefix }) => rel === prefix || rel.startsWith(prefix));
}

function readSrcFiles(): Array<{ rel: string; content: string; isCss: boolean }> {
  const src = globSync('**/*.{ts,tsx,js,jsx,css}', { cwd: SRC_ROOT, absolute: true })
    .filter((p) => !p.includes('__tests__'))
    .filter((p) => !p.endsWith('.d.ts'))
    .map((p) => ({
      rel: relative(SRC_ROOT, p).split('\\').join('/'),
      content: readFileSync(p, 'utf8'),
      isCss: p.endsWith('.css'),
    }));
  // Also scan the theme-bearing PACKAGE-ROOT config files (tailwind/postcss).
  // They previously escaped this guard because it only globbed src/. Keyed
  // `@root/<name>` so the allowlist/temp matchers never confuse them with a
  // src-relative path.
  const root = ROOT_CONFIG_FILES.map((name) => ({
    rel: `@root/${name}`,
    content: readFileSync(resolve(PKG_ROOT, name), 'utf8'),
    isCss: name.endsWith('.css'),
  }));
  return [...src, ...root];
}

describe('ONE-SOT no-hardcoding guard (theme.css is the sole definer)', () => {
  const files = readSrcFiles();

  it('no hardcoded color / font / Tailwind-palette literals outside theme.css + the allowlists', () => {
    const offenders: string[] = [];
    for (const { rel, content, isCss } of files) {
      if (inList(rel, ALLOWLIST)) continue;
      if (inTemp(rel)) continue;
      const hits = findViolations(content, isCss);
      if (hits.length > 0) {
        offenders.push(`\n${rel} (${hits.length}):\n  ${hits.slice(0, 8).join('\n  ')}`);
      }
    }
    expect(
      offenders,
      'Hardcoded theme values found outside theme.css. Replace each hex/rgb/hsl ' +
        'with var(--color-*) (or color-mix on a token), each literal Tailwind ' +
        'palette utility (bg-white/text-gray-500/…) with a token utility ' +
        '(bg-surface/text-fg-muted/…), and each bare fontFamily with ' +
        'var(--font-*). If a whole area cannot be finished now, add its prefix ' +
        `to TEMPORARY_ALLOWLIST with a TODO.${offenders.join('')}`,
    ).toEqual([]);
  });

  it('theme.css is the ONLY definition site for --color-* / --radius-* / --shadow-* / --font-* tokens (SOT guard)', () => {
    // Single-definition enforcement for the canonical theme namespaces. A
    // duplicate definition in another file silently shadows theme.css (the M3
    // design-tokens.css + index.css copies of --radius-card/-sm/-full did
    // exactly this — they were unlayered + loaded later, so the soft 20px/6px
    // values won over theme.css's brutalist scale). Extending past --color-* to
    // --radius-*/-shadow-*/-font-* makes ALL four namespaces single-site.
    const TOKEN_DEF = /^\s*--(?:color|radius|shadow|font)-[A-Za-z][\w-]*\s*:/;
    const offenders: string[] = [];
    for (const { rel, content } of files) {
      if (rel === THEME_SOT) continue;
      const lines = stripComments(content);
      lines.forEach((line, i) => {
        if (!TOKEN_DEF.test(line)) return;
        // .code-mode[data-cm-theme] editor themes legitimately scope --color-* /
        // --cm-* — they are the allowlisted opt-in editor palette.
        // Find the nearest enclosing selector.
        let sel = '';
        for (let k = i; k >= 0; k--) {
          if (lines[k].includes('{')) { sel = lines[k]; break; }
        }
        if (/\.code-mode/.test(sel)) return;
        // Sandboxed-iframe srcdoc injectors (allowlisted) MUST inline a
        // self-contained --font-*/--color-* set — the iframe has no parent vars.
        if (inList(rel, ALLOWLIST)) return;
        offenders.push(`${rel}:L${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(
      offenders,
      `Canonical --color-* / --radius-* / --shadow-* / --font-* theme tokens must ` +
        `be defined ONLY in ${THEME_SOT}. Move these definitions into theme.css ` +
        `(or, if they are a distinct concern, rename to a non-canonical namespace ` +
        `e.g. --radius-m3-*):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('TEMPORARY_ALLOWLIST entries each carry a documented reason (visible shrinking scope)', () => {
    for (const entry of TEMPORARY_ALLOWLIST) {
      expect(entry.reason, `TEMPORARY_ALLOWLIST prefix ${entry.prefix} needs a reason`).toBeTruthy();
    }
    // Log the temporary scope so the remaining migration surface stays visible.
    // eslint-disable-next-line no-console
    console.warn(
      `[theme-sot] TEMPORARY_ALLOWLIST — ${TEMPORARY_ALLOWLIST.length} prefixes still ` +
        `carrying pre-migration hardcoded stragglers (tokenize + remove):\n` +
        TEMPORARY_ALLOWLIST.map((e) => `  • ${e.prefix}  — ${e.reason}`).join('\n'),
    );
  });
});
