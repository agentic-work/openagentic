#!/usr/bin/env node
// Codemod: replace hex colour literals in admin source with --ap-* CSS vars.
//
// Scope: services/openagentic-ui/src/features/admin/**/*.{ts,tsx}
//        (excludes __tests__, *.stories.tsx, generated/* docs)
//
// Behaviour: walks the admin tree, applies a fixed mapping table to every
// hex literal it finds, and rewrites the file in place. Anything not in
// the mapping is left alone and reported at the end so the human can decide.
//
// Run: node services/openagentic-ui/scripts/codemod-admin-tokens.mjs [--dry]
//
// Three replacement modes (in order):
//   1. `var(--token, #hex)` → `var(--token)` — strip redundant hex fallback
//      (the CSS layer already provides defaults via admin-tokens.css /
//      index.css, so the inline fallback is dead weight). Also triggers
//      ESLint's admin-tokens/no-hardcoded-admin-color rule.
//   2. `'#hex' / "#hex" / `#hex`` standalone literals → `'var(--ap-X)'`.
//   3. Hex embedded inside any string/template literal body → swap inline.
//
// Mappings cover:
//   - Legacy purples / blues / accent → --ap-accent
//   - Greens / teals → --ap-ok (or --ap-ok-soft for alpha)
//   - Ambers / oranges → --ap-warn
//   - Reds → --ap-err
//   - Cyans → --ap-info
//   - Greyscale (#000..#fff family) → --ap-bg-* / --ap-fg-* ladder
//   - Alpha-suffixed semantic hex (#22c55e15 etc.) → soft variants

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'src', 'features', 'admin');
const DRY = process.argv.includes('--dry');

// Mapping: hex literal -> CSS-var token. Keys are lowercase + leading #.
const MAP = {
  // ── Legacy purples / accent blues → single accent token ───────────────
  '#8b5cf6': 'var(--ap-accent)',
  '#a855f7': 'var(--ap-accent)',
  '#7c3aed': 'var(--ap-accent)',
  '#6366f1': 'var(--ap-accent)',
  '#4f46e5': 'var(--ap-accent)',
  '#3b82f6': 'var(--ap-accent)',
  '#2563eb': 'var(--ap-accent)',
  '#1e40af': 'var(--ap-accent)',
  '#0a84ff': 'var(--ap-accent)',
  '#0ea5e9': 'var(--ap-accent)',
  '#5ddcff': 'var(--ap-accent)',
  '#0d6efd': 'var(--ap-accent)',
  '#ec4899': 'var(--ap-accent)',
  '#a78bfa': 'var(--ap-accent)',
  '#818cf8': 'var(--ap-accent)',
  '#c084fc': 'var(--ap-accent)',
  '#c026d3': 'var(--ap-accent)',
  '#d946ef': 'var(--ap-accent)',
  '#6d28d9': 'var(--ap-accent)',
  '#60a5fa': 'var(--ap-accent)',
  '#1e1b4b': 'var(--ap-accent)',
  '#58a6ff': 'var(--ap-accent)',

  // ── Success / green ───────────────────────────────────────────────────
  '#22c55e': 'var(--ap-ok)',
  '#16a34a': 'var(--ap-ok)',
  '#15803d': 'var(--ap-ok)',
  '#2ddc7a': 'var(--ap-ok)',
  '#2dd47a': 'var(--ap-ok)',
  '#00d26a': 'var(--ap-ok)',
  '#10b981': 'var(--ap-ok)',
  '#059669': 'var(--ap-ok)',
  '#34d399': 'var(--ap-ok)',
  '#3fb950': 'var(--ap-ok)',
  '#238636': 'var(--ap-ok)',
  '#5cf08f': 'var(--ap-ok)',

  // ── Warning / amber / orange ──────────────────────────────────────────
  '#f59e0b': 'var(--ap-warn)',
  '#fbbf24': 'var(--ap-warn)',
  '#f97316': 'var(--ap-warn)',
  '#ea580c': 'var(--ap-warn)',
  '#d97706': 'var(--ap-warn)',
  '#fdba74': 'var(--ap-warn)',
  '#fde68a': 'var(--ap-warn-soft)',
  '#fcd34d': 'var(--ap-warn)',
  '#eab308': 'var(--ap-warn)',
  '#d29922': 'var(--ap-warn)',
  '#f6c560': 'var(--ap-warn)',

  // ── Error / red ───────────────────────────────────────────────────────
  '#ef4444': 'var(--ap-err)',
  '#dc2626': 'var(--ap-err)',
  '#b91c1c': 'var(--ap-err)',
  '#ff453a': 'var(--ap-err)',
  '#f5475c': 'var(--ap-err)',
  '#fee2e2': 'var(--ap-err-soft)',
  '#fca5a5': 'var(--ap-err-soft)',
  '#f43f5e': 'var(--ap-err)',
  '#f85149': 'var(--ap-err)',

  // ── Info / cyan ───────────────────────────────────────────────────────
  '#06b6d4': 'var(--ap-info)',
  '#0891b2': 'var(--ap-info)',
  '#5ac8fa': 'var(--ap-info)',
  '#67e8f9': 'var(--ap-info)',
  '#38bdf8': 'var(--ap-info)',

  // ── Pure white / black ────────────────────────────────────────────────
  '#ffffff': 'var(--ap-fg-0)',
  '#fff': 'var(--ap-fg-0)',
  '#000000': 'var(--ap-bg-0)',
  '#000': 'var(--ap-bg-0)',

  // ── Greyscale ladder (chrome / log-viewer backgrounds) ────────────────
  // Dark side: #0a0a0a..#333 → bg-0..bg-3 progressively lighter.
  '#0a0a0a': 'var(--ap-bg-0)',
  '#0d1117': 'var(--ap-bg-0)', // GitHub-dark canvas BG
  '#0f172a': 'var(--ap-bg-0)', // slate-900
  '#111': 'var(--ap-bg-1)',
  '#1a1a1a': 'var(--ap-bg-1)',
  '#1c1c1c': 'var(--ap-bg-1)',
  '#1e293b': 'var(--ap-bg-1)', // slate-800
  '#222': 'var(--ap-bg-2)',
  '#1f1f1f': 'var(--ap-bg-2)',
  '#1f2937': 'var(--ap-bg-2)', // gray-800 (tooltip bg)
  '#333': 'var(--ap-bg-3)',
  '#334155': 'var(--ap-bg-3)', // slate-700
  '#475569': 'var(--ap-bg-3)', // slate-600
  '#24292f': 'var(--ap-bg-2)', // GitHub mid grey
  // Mid greys (text on dark): #555..#888 → fg-3 (muted)
  '#555': 'var(--ap-fg-3)',
  '#666': 'var(--ap-fg-3)',
  '#6b7280': 'var(--ap-fg-3)', // gray-500
  '#64748b': 'var(--ap-fg-3)', // slate-500
  '#4b5563': 'var(--ap-fg-3)', // gray-600
  // Light text greys
  '#888': 'var(--ap-fg-2)',
  '#999': 'var(--ap-fg-2)',
  '#e6edf3': 'var(--ap-fg-1)', // GitHub light text
  '#f3f4f6': 'var(--ap-fg-0)', // gray-100 (tooltip text)

  // ── Alpha-suffixed semantic hex → soft variants ───────────────────────
  // 8-digit hex: #RRGGBBAA. The base RGB maps to its soft token regardless
  // of exact alpha; --ap-X-soft uses 14% alpha which is close to the
  // commonly seen 15/40 (~25%) suffixes used historically.
  '#22c55e15': 'var(--ap-ok-soft)',
  '#22c55e40': 'var(--ap-ok-soft)',
  '#00d26a40': 'var(--ap-ok-soft)',
  '#10b98115': 'var(--ap-ok-soft)',
  '#f59e0b15': 'var(--ap-warn-soft)',
  '#f59e0b40': 'var(--ap-warn-soft)',
  '#f59e0b80': 'var(--ap-warn-soft)',
  '#fbbf2415': 'var(--ap-warn-soft)',
  '#ef444415': 'var(--ap-err-soft)',
  '#ef444440': 'var(--ap-err-soft)',
  '#ef444480': 'var(--ap-err-soft)',
  '#06b6d415': 'var(--ap-info-soft)',
};

function* walk(dir) {
  const out = execSync(
    `find ${JSON.stringify(dir)} -type f \\( -name '*.tsx' -o -name '*.ts' \\) -not -path '*/__tests__/*' -not -name '*.test.*' -not -name '*.stories.*' -not -path '*/generated/*'`,
    { encoding: 'utf8' },
  );
  for (const line of out.split('\n')) if (line.trim()) yield line.trim();
}

// 1. var(--token, #hex) → var(--token) — strip redundant hex fallback.
//    Also handles var(--token, var(--other, #hex)) at one level of nesting.
const VAR_FALLBACK = /var\(\s*(--[a-zA-Z0-9_-]+)\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g;
const VAR_FALLBACK_NESTED = /var\(\s*(--[a-zA-Z0-9_-]+)\s*,\s*var\(\s*(--[a-zA-Z0-9_-]+)\s*,\s*#[0-9a-fA-F]{3,8}\s*\)\s*\)/g;

// 2. Embedded hex inside any string/template body — word-bounded so we don't
//    grab fragments of longer ids. Order matters: 8-digit > 6-digit > 3-digit.
const HEX_BARE = /(?<![A-Za-z0-9_$])(#[0-9a-fA-F]{8}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})(?![A-Za-z0-9_$])/g;

// Quoted-block matcher: single, double, backtick. Body excludes `\n` so we
// don't accidentally span line-comments — legitimate hex literals never
// straddle newlines, and the rule is only interested in single-line strings.
const QUOTED_BLOCK = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1|(`)((?:\\.|(?!`)[^\\\n])*)`/g;

let filesChanged = 0;
let hitsReplaced = 0;
let varFallbacksStripped = 0;
const unmapped = new Map(); // hex -> count

for (const file of walk(ROOT)) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  // Phase 1a: strip nested var(--a, var(--b, #hex)) → var(--a, var(--b))
  after = after.replace(VAR_FALLBACK_NESTED, (_m, outer, inner) => {
    varFallbacksStripped++;
    return `var(${outer}, var(${inner}))`;
  });

  // Phase 1b: strip flat var(--token, #hex) → var(--token)
  after = after.replace(VAR_FALLBACK, (_m, token) => {
    varFallbacksStripped++;
    return `var(${token})`;
  });

  // Phase 2: walk every quoted block and rewrite hex inside.
  after = after.replace(QUOTED_BLOCK, (m, sq, sqBody, bt, btBody) => {
    const open = sq ?? bt;
    const body = sqBody ?? btBody;
    if (!body || !body.includes('#')) return m;

    const newBody = body.replace(HEX_BARE, (mm, hex) => {
      const key = hex.toLowerCase();
      if (MAP[key]) {
        hitsReplaced++;
        return MAP[key];
      }
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
      return mm;
    });
    return open + newBody + open;
  });

  if (after !== before) {
    filesChanged++;
    if (!DRY) writeFileSync(file, after);
    console.log(`  ${DRY ? '[dry] ' : ''}rewrote ${relative(ROOT, file)}`);
  }
}

console.log(
  `\n${DRY ? '[DRY] would rewrite' : 'rewrote'} ${filesChanged} file(s); ` +
  `${hitsReplaced} hex literal(s) replaced; ` +
  `${varFallbacksStripped} var(--token, #hex) fallback(s) stripped.`,
);
if (unmapped.size > 0) {
  console.log(`\n${unmapped.size} unmapped hex(es) left for manual review:`);
  for (const [hex, n] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${hex}  (${n} occurrences)`);
  }
} else {
  console.log('\nNo unmapped hexes — admin tree is token-clean.');
}
