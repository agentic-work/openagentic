import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { relative, resolve } from 'path';

/**
 * CLAUDE.md Rule 8(b): ALL rendered content must resolve colors via global
 * theme tokens (`var(--cm-*)` / `var(--accent)`). NO hardcoded hex / rgb() /
 * named colors in any chat render component — they break light/dark theme and
 * the user-selected accent.
 *
 * This cage greps every chat component for hardcoded colors that reach an
 * inline `style` prop or a component-scoped `<style>` block and fails on any
 * hit. Tokens flip per `[data-theme]` in index.css (the single SoT for raw
 * color values); components must reference tokens, never the raw values.
 *
 * No allowlist. Per user direction (2026-05-23): "anything in the UI that is
 * hardcoded is a fail — if it doesn't use global CSS, fail."
 */

const SRC_ROOT = resolve(__dirname, '../..');

function readChatFiles(): Array<{ path: string; content: string }> {
  // Scope: the on-screen chat render surface (`components/**`). Excluded:
  // `services/export/**` produces standalone downloadable PDF/HTML/XLSX
  // documents that are opened OUTSIDE the app, where `--cm-*` tokens do not
  // exist — those documents must inline a self-contained palette by
  // definition, so they are not "the UI" this rule governs.
  return globSync('features/chat/components/**/*.{ts,tsx}', { cwd: SRC_ROOT, absolute: true })
    .filter((p) => !p.includes('__tests__'))
    .filter((p) => !p.endsWith('.d.ts'))
    .map((p) => ({ path: p, content: readFileSync(p, 'utf8') }));
}

// CSS color-bearing properties that, when assigned a raw literal, break theming.
const COLOR_PROPS = [
  'color',
  'background',
  'backgroundColor',
  'borderColor',
  'border',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'outline',
  'outlineColor',
  'fill',
  'stroke',
  'boxShadow',
  'textShadow',
  'caretColor',
  'borderTopColor',
  'borderBottomColor',
];

// Matches `prop: '#abc'`, `prop: "#aabbcc"`, `prop: 'rgb(...)'`, `prop: 'rgba(...)'`
// in both JSX inline-style object form and CSS-in-JS template form (`prop: #abc;`).
const HEX = String.raw`#[0-9a-fA-F]{3,8}\b`;
const RGB = String.raw`rgba?\(`;
const PROP_GROUP = COLOR_PROPS.join('|');
// inline-style object: backgroundColor: '#0d1117'
const OBJ_LITERAL = new RegExp(`\\b(?:${PROP_GROUP})\\s*:\\s*['"\`][^'"\`]*(?:${HEX}|${RGB})`, 'g');
// CSS-in-JS / <style> block: background: #0d1117;  OR  color: rgb(...)
const CSS_LITERAL = new RegExp(`\\b(?:${PROP_GROUP})\\s*:\\s*(?:${HEX}|${RGB})`, 'g');

function findViolations(content: string): string[] {
  const hits: string[] = [];
  content.split('\n').forEach((line, i) => {
    // Skip comment lines (issue refs like `#646` are not colors).
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // A `var(--...)` reference on the same property is the compliant form; only
    // flag when the literal is the actual assigned value.
    for (const re of [OBJ_LITERAL, CSS_LITERAL]) {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push(`L${i + 1}: ${trimmed.slice(0, 160)}`);
      }
    }
  });
  return hits;
}

describe('no hardcoded colors in chat renderers (CLAUDE.md Rule 8b)', () => {
  it('every chat component resolves colors through global --cm-* / --accent tokens', () => {
    const offenders: string[] = [];
    for (const { path, content } of readChatFiles()) {
      const hits = findViolations(content);
      if (hits.length > 0) {
        offenders.push(`\n${relative(SRC_ROOT, path)} (${hits.length}):\n  ${hits.join('\n  ')}`);
      }
    }
    expect(
      offenders,
      `Hardcoded colors found in chat renderers. Replace every hex/rgb literal with a ` +
        `global theme token (var(--cm-bg|fg|text|text-muted|border|accent|success|warning|error|info) ` +
        `or color-mix(in srgb, var(--cm-*) N%, transparent) for tints).${offenders.join('')}`,
    ).toEqual([]);
  });
});
