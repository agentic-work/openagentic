/**
 * iframeThemeStylesheet — verifies the parent app's CSS variables are
 * snapshotted into a <style> block that can be injected into a sandboxed
 * iframe's srcdoc so the rendered HTML report inherits the live theme.
 *
 * Iframes with srcdoc are opaque cross-origin contexts — they do NOT
 * inherit CSS custom properties from the parent. They have to be
 * **copied in as concrete values** at the moment of render.
 *
 * Per user directive 2026-05-14: "all rendered/reports, etc have to
 * adhere to global css themes". webhook_response HTML reports used to
 * render with hardcoded inline body { color: #e6edf3; background:
 * #0d1117 } in SafeHtmlIframe regardless of light/dark — these tests
 * pin the dark + light behaviour for the helper that replaces that.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getIframeThemeStylesheet } from '../iframeThemeStylesheet';

// Variables this helper MUST always emit. Driven by the actual variables
// declared in styles/mockup-v067.css + design-tokens.css + admin-tokens.css
// + index.css that the templates' inline HTML elements consume.
const REQUIRED_VARS = [
  '--bg-0',
  '--bg-1',
  '--bg-2',
  '--bg-3',
  '--fg-0',
  '--fg-1',
  '--fg-2',
  '--line-1',
  '--line-2',
  '--accent',
  '--accent-soft',
  '--ok',
  '--warn',
  '--err',
  '--info',
  '--color-background',
  '--color-surface',
  '--color-text',
  '--color-border',
  '--color-primary',
  '--font-sans',
];

function setDocumentTheme(theme: 'dark' | 'light', extraVars: Record<string, string> = {}) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
  // Sample values for the spec — vary per theme so we can prove the helper
  // actually reads from the parent each call.
  const defaults = theme === 'dark'
    ? {
        '--bg-0': '#09090b',
        '--bg-1': '#0f1012',
        '--bg-2': '#16181c',
        '--bg-3': '#1c1f24',
        '--fg-0': '#f8fafc',
        '--fg-1': '#d4d4d8',
        '--fg-2': '#a1a1aa',
        '--line-1': 'rgba(255, 255, 255, 0.06)',
        '--line-2': 'rgba(255, 255, 255, 0.10)',
        '--accent': '#8b5cf6',
        '--accent-soft': 'rgba(139, 92, 246, 0.14)',
        '--ok': '#22c55e',
        '--warn': '#f59e0b',
        '--err': '#ef4444',
        '--info': '#38bdf8',
        '--color-background': '#09090b',
        '--color-surface': '#0f1012',
        '--color-text': '#f8fafc',
        '--color-border': 'rgba(255, 255, 255, 0.06)',
        '--color-primary': '#8b5cf6',
        '--font-sans': 'Inter, system-ui, sans-serif',
      }
    : {
        '--bg-0': '#ffffff',
        '--bg-1': '#fafafa',
        '--bg-2': '#f4f4f5',
        '--bg-3': '#e4e4e7',
        '--fg-0': '#09090b',
        '--fg-1': '#3f3f46',
        '--fg-2': '#52525b',
        '--line-1': 'rgba(0, 0, 0, 0.06)',
        '--line-2': 'rgba(0, 0, 0, 0.10)',
        '--accent': '#8b5cf6',
        '--accent-soft': 'rgba(139, 92, 246, 0.10)',
        '--ok': '#16A34A',
        '--warn': '#EA580C',
        '--err': '#B91C1C',
        '--info': '#1D4ED8',
        '--color-background': '#ffffff',
        '--color-surface': '#fafafa',
        '--color-text': '#09090b',
        '--color-border': 'rgba(0, 0, 0, 0.06)',
        '--color-primary': '#8b5cf6',
        '--font-sans': 'Inter, system-ui, sans-serif',
      };
  const merged = { ...defaults, ...extraVars };
  for (const [k, v] of Object.entries(merged)) {
    root.style.setProperty(k, v);
  }
  return merged;
}

function clearDocumentTheme() {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.classList.remove('dark', 'light');
  for (const v of REQUIRED_VARS) root.style.removeProperty(v);
}

describe('getIframeThemeStylesheet', () => {
  beforeEach(() => clearDocumentTheme());
  afterEach(() => clearDocumentTheme());

  it('returns a <style> block with id openagentic-theme-injected so it can be replaced on theme change', () => {
    setDocumentTheme('dark');
    const out = getIframeThemeStylesheet();
    expect(out).toMatch(/<style id="openagentic-theme-injected">/);
    expect(out).toMatch(/<\/style>/);
  });

  it('emits color-scheme: dark when documentElement has the dark class', () => {
    setDocumentTheme('dark');
    const out = getIframeThemeStylesheet();
    expect(out).toMatch(/color-scheme:\s*dark/);
  });

  it('emits color-scheme: light when documentElement has data-theme="light"', () => {
    setDocumentTheme('light');
    const out = getIframeThemeStylesheet();
    expect(out).toMatch(/color-scheme:\s*light/);
  });

  it('copies the live --bg-0 value from documentElement into the stylesheet', () => {
    setDocumentTheme('dark', { '--bg-0': '#aabbcc' });
    const out = getIframeThemeStylesheet();
    expect(out).toContain('--bg-0: #aabbcc');
  });

  it('switches to light --bg-0 when theme flips', () => {
    setDocumentTheme('light', { '--bg-0': '#ffffff' });
    const out = getIframeThemeStylesheet();
    expect(out).toContain('--bg-0: #ffffff');
  });

  it('includes every required theme variable so templates always have something to read', () => {
    setDocumentTheme('dark');
    const out = getIframeThemeStylesheet();
    for (const v of REQUIRED_VARS) {
      expect(out, `missing var ${v}`).toContain(v);
    }
  });

  it('falls back to sensible defaults when a variable is unset on documentElement', () => {
    // Don't set any vars — helper should still emit a full block
    // (template HTML must not break with empty CSS values).
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
    const out = getIframeThemeStylesheet();
    // No `:` followed by `;` (empty value) on any var declaration
    expect(out).not.toMatch(/--[a-z0-9-]+:\s*;/);
  });

  it('styles body, h1, h2, h3, table, th, td, pre, code, blockquote — the template element set', () => {
    setDocumentTheme('dark');
    const out = getIframeThemeStylesheet();
    expect(out).toMatch(/\bbody\b/);
    expect(out).toMatch(/\bh1\b/);
    expect(out).toMatch(/\bh2\b/);
    expect(out).toMatch(/\bh3\b/);
    expect(out).toMatch(/\btable\b/);
    expect(out).toMatch(/\bth\b/);
    expect(out).toMatch(/\btd\b/);
    expect(out).toMatch(/\bpre\b/);
    expect(out).toMatch(/\bcode\b/);
  });

  it('uses var() references in element selectors so future theme tweaks propagate without re-render', () => {
    setDocumentTheme('dark');
    const out = getIframeThemeStylesheet();
    // body block must consume injected vars, not hardcoded hexes
    expect(out).toMatch(/body\s*{[^}]*var\(--bg-0\)/s);
    expect(out).toMatch(/body\s*{[^}]*var\(--fg-1\)/s);
  });

  it('does not bake any hardcoded #0d1117 / #e6edf3 (old SafeHtmlIframe defaults) into the body declaration', () => {
    setDocumentTheme('light');
    const out = getIframeThemeStylesheet();
    // Specifically the body declaration must come from vars, not the
    // pre-2026-05-14 hardcoded GitHub-dark fallback. Other places can
    // still mention these hexes as variable values if they happen to match.
    const bodyMatch = out.match(/body\s*{[^}]*}/s);
    expect(bodyMatch).toBeTruthy();
    expect(bodyMatch![0]).not.toContain('#0d1117');
    expect(bodyMatch![0]).not.toContain('#e6edf3');
  });

  it('emits unique stylesheets for dark vs light themes', () => {
    setDocumentTheme('dark');
    const dark = getIframeThemeStylesheet();
    clearDocumentTheme();
    setDocumentTheme('light');
    const light = getIframeThemeStylesheet();
    expect(dark).not.toEqual(light);
  });
});
