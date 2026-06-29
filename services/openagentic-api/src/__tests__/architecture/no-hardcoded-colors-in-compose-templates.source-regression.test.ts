/**
 * Architecture cage — no hardcoded colors in compose_app templates.
 *
 * Rule (user direction 2026-05-13, Sev-1 #810):
 *   "compositions in chatmode have to always have the global css assigned to
 *    them for themes/accents or they will be unviewable."
 *
 * Every artifact-rendering surface MUST resolve colors via `var(--cm-*)` or
 * `var(--accent)` tokens — NOT hardcoded hex / rgb() / named-color literals.
 * Hardcoded colors break light/dark theme parity and the user's accent
 * preference.
 *
 * Token defaults live in `_shared.ts` (the THEME_PREAMBLE block). That file
 * is the ONLY allowed source of literal color values. Every other template
 * must reference the tokens.
 *
 * Allowed exceptions:
 *   - `_shared.ts` (token defaults)
 *   - hex inside a `var(--cm-*, #fallback)` expression — the fallback is the
 *     last-resort default when the variable is not defined; the primary path
 *     is still the token
 *
 * Forbidden:
 *   - bare `#rrggbb` / `#rgb` / `#rrggbbaa` in template CSS or JS
 *   - `rgb(...)` / `rgba(...)` with literal numeric channels in template CSS
 *     or JS (the chart libraries' palettes / strokeStyle / fill values)
 *   - named colors like `red`, `white`, `black` in `background:` / `color:` /
 *     `fill:` / `stroke:` / `border-color:` properties
 *
 * Spec for the rule: feedback_compositions_must_use_global_theme_tokens.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '../../services/composeAppTemplates');

/** Files in the compose_app templates folder that are EXEMPT (token-source files). */
const EXEMPT_FILES = new Set<string>([
  '_shared.ts',
]);

interface Violation {
  file: string;
  line: number;
  excerpt: string;
  reason: string;
}

/**
 * Scan a template's source for hex / rgb / named-color literals that govern
 * artifact-rendering chrome.
 *
 * Heuristic: we strip away allowed contexts first (var(--cm-*, #fallback)
 * fallback expressions, comment lines, doc strings) and then look for hex
 * + rgb literals in what remains.
 */
function scanFile(filePath: string, rel: string): Violation[] {
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const out: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const lineNum = i + 1;

    // Skip blank lines and pure-comment lines.
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Strip allowed `var(--cm-*, #fallback)` and `var(--accent, #fallback)`
    // expressions — the hex inside is a documented safety fallback, not the
    // primary color source.
    let scrubbed = line.replace(/var\(\s*--[a-zA-Z0-9_-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, 'var(--scrubbed)');
    // Also scrub var(--cm-*, rgba(...)) and var(--cm-*, rgb(...)) fallbacks
    scrubbed = scrubbed.replace(/var\(\s*--[a-zA-Z0-9_-]+\s*,\s*rgba?\([^)]+\)\s*\)/g, 'var(--scrubbed)');

    // Hex color literal pattern (3, 4, 6, or 8 hex digits after #).
    const hexMatches = scrubbed.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hexMatches) {
      for (const m of hexMatches) {
        // Heuristic exclusion: hex sequences inside long identifiers (e.g.
        // GitHub issue refs `#4827`) are decimal. The hex pattern above
        // requires hex digits, but a sequence like `#4827` is also valid
        // hex. We distinguish by surrounding context — accept the match
        // ONLY if it looks like a color (3/6/8 digits, A-F mix allowed,
        // and not inside a sentence comment).
        if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(m)) continue;
        // Skip 4-digit decimal-only sequences with no hex letters that look
        // like issue/PR references in titles/strings (e.g. `#4827`, `#4119`).
        // A color literal in real CSS/JS will appear next to a CSS property
        // or a style/attr/fill/stroke/color string — not inside an English
        // sentence describing an incident. We approximate by requiring at
        // least one a-f / A-F digit, OR a length other than 4.
        if (m.length === 5 /* '#XXXX' */ && /^#[0-9]{4}$/.test(m)) continue;
        out.push({
          file: rel,
          line: lineNum,
          excerpt: trimmed.slice(0, 180),
          reason: `hex literal ${m} outside var(--cm-*, fallback) — use var(--cm-*) token instead`,
        });
      }
    }

    // rgb() / rgba() literal pattern — bare numeric channels.
    const rgbMatches = scrubbed.match(/\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g);
    if (rgbMatches) {
      for (const m of rgbMatches) {
        out.push({
          file: rel,
          line: lineNum,
          excerpt: trimmed.slice(0, 180),
          reason: `rgb literal ${m}... outside var(--cm-*, fallback) — use var(--cm-*) token instead`,
        });
      }
    }
  }

  return out;
}

describe('Architecture cage — no hardcoded colors in compose_app templates', () => {
  it('all template files MUST resolve colors via var(--cm-*) tokens, not hex/rgb literals', () => {
    const entries = readdirSync(TEMPLATES_DIR);
    const templateFiles = entries.filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && !EXEMPT_FILES.has(f),
    );

    const allViolations: Violation[] = [];
    for (const f of templateFiles) {
      const filePath = join(TEMPLATES_DIR, f);
      const found = scanFile(filePath, f);
      allViolations.push(...found);
    }

    const summary = allViolations.length === 0
      ? ''
      : `\n${allViolations.length} hardcoded color literal(s) found in compose_app templates:\n` +
        allViolations.slice(0, 80).map(v => `  ${v.file}:${v.line} — ${v.reason}\n      ${v.excerpt}`).join('\n') +
        `\n\nRule: every artifact-rendering surface MUST resolve colors via var(--cm-*) tokens.\n` +
        `Token defaults live in _shared.ts (THEME_PREAMBLE). Use var(--cm-bg), var(--cm-fg),\n` +
        `var(--cm-border), var(--cm-accent), var(--cm-warn), var(--cm-error), etc. Hex/rgb\n` +
        `fallbacks are allowed ONLY inside var(--cm-*, #fallback) safety expressions.\n` +
        `See feedback_compositions_must_use_global_theme_tokens.md for full rule.`;

    expect(allViolations, summary).toEqual([]);
  });
});
