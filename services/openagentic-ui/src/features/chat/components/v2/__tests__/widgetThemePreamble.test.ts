/**
 * RED → GREEN: rendered artifacts must respect light + dark theme.
 *
 * Sev-0 2026-05-08. Pre-fix: WidgetRenderer iframe srcdoc PREAMBLE_CSS
 * hardcoded dark palette (#09090b bg, #f8fafc fg). In light mode the
 * iframe stayed black-on-black ⇒ unreadable charts.
 *
 * Post-fix: buildPreambleCSS(theme) emits light or dark palette.
 */
import { describe, it, expect } from 'vitest';
import { buildPreambleCSS } from '../widgetThemePreamble.js';

describe('buildPreambleCSS — light theme', () => {
  const css = buildPreambleCSS('light');
  it('sets a light background', () => {
    expect(css).toMatch(/--bg-0:\s*#f/i);
  });
  it('sets dark foreground for contrast on light bg', () => {
    expect(css).toMatch(/--fg-0:\s*#0|--fg-0:\s*#1/i);
  });
  it('does not leave any obviously-dark hex literal as bg-0', () => {
    expect(css).not.toMatch(/--bg-0:\s*#09090b/);
  });
});

describe('buildPreambleCSS — dark theme', () => {
  const css = buildPreambleCSS('dark');
  it('sets a dark background', () => {
    expect(css).toMatch(/--bg-0:\s*#09090b|--bg-0:\s*#0/i);
  });
  it('sets light foreground', () => {
    expect(css).toMatch(/--fg-0:\s*#f/i);
  });
});

describe('buildPreambleCSS — accent override', () => {
  it('honors a runtime accent token instead of the hardcoded violet', () => {
    const css = buildPreambleCSS('dark', { accent: '#22c55e' });
    expect(css).toContain('#22c55e');
    expect(css).not.toMatch(/--accent:\s*#8b5cf6/);
  });
});

/**
 * CLAUDE.md Rule 8(b) — iframe-rendered compose_visual artifacts MUST
 * resolve `var(--cm-*)` tokens. The preamble defines the canonical
 * `--cm-*` family in addition to the legacy `--accent` / `--bg-*` /
 * `--fg-*` aliases so ComposeVisualTool's emitted SVG/HTML
 * (`fill="var(--cm-accent)"`, etc.) tracks the parent theme.
 */
describe('buildPreambleCSS — canonical --cm-* tokens (Rule 8(b))', () => {
  const css = buildPreambleCSS('dark', { accent: '#ffb547' });
  const requiredTokens = [
    '--cm-accent',
    '--cm-bg',
    '--cm-bg-0',
    '--cm-bg-1',
    '--cm-bg-2',
    '--cm-bg-3',
    '--cm-fg',
    '--cm-fg-0',
    '--cm-fg-1',
    '--cm-fg-2',
    '--cm-fg-3',
    '--cm-border',
    '--cm-success',
    '--cm-warn',
    '--cm-error',
    '--cm-info',
  ];
  for (const token of requiredTokens) {
    it(`defines ${token}`, () => {
      const re = new RegExp(`${token}\\s*:`);
      expect(css).toMatch(re);
    });
  }

  it('aliases --cm-accent to the user-selected accent (not the violet default)', () => {
    // The alias chain is --cm-accent: var(--accent); --accent: #ffb547.
    // Either form is acceptable as proof the chain is wired.
    expect(css).toMatch(/--cm-accent:\s*var\(--accent\)|--cm-accent:\s*#ffb547/);
    expect(css).toContain('#ffb547');
  });

  it('also defines --mw-* aliases so legacy table/kpi_grid HTML resolves correctly', () => {
    expect(css).toMatch(/--mw-bg-1\s*:/);
    expect(css).toMatch(/--mw-fg-1\s*:/);
    expect(css).toMatch(/--mw-line-1\s*:/);
    expect(css).toMatch(/--mw-accent\s*:/);
  });
});

