/**
 * Theme-aware preamble for sandboxed widget iframes.
 *
 * Sev-0 2026-05-08. Pre-fix: WidgetRenderer hardcoded a dark palette into
 * the iframe srcdoc — model-emitted SVG/HTML stayed dark in light mode
 * and vice-versa. This module emits light OR dark variable sets so the
 * iframe re-paints when the parent's theme toggles. Accent token is
 * swappable too.
 */

export type WidgetTheme = 'light' | 'dark';

export interface PreambleOptions {
  /** Override --accent (defaults to #8b5cf6). */
  accent?: string;
}

const DARK_PALETTE = {
  bg0: '#09090b',
  bg1: '#0f1012',
  bg2: '#16181c',
  bg3: '#1c1f24',
  fg0: '#f8fafc',
  fg1: '#d4d4d8',
  fg2: '#a1a1aa',
  fg3: '#71717a',
  line1: 'rgba(255,255,255,0.06)',
  line2: 'rgba(255,255,255,0.10)',
};

const LIGHT_PALETTE = {
  bg0: '#ffffff',
  bg1: '#f8fafc',
  bg2: '#f1f5f9',
  bg3: '#e2e8f0',
  fg0: '#0f172a',
  fg1: '#1e293b',
  fg2: '#475569',
  fg3: '#64748b',
  line1: 'rgba(15,23,42,0.06)',
  line2: 'rgba(15,23,42,0.10)',
};

export function buildPreambleCSS(theme: WidgetTheme, opts: PreambleOptions = {}): string {
  const p = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
  const accent = opts.accent ?? '#8b5cf6';
  return `
:root {
  color-scheme: ${theme};
  --accent: ${accent};
  --accent-soft: color-mix(in srgb, ${accent} 14%, transparent);
  --bg-0: ${p.bg0};
  --bg-1: ${p.bg1};
  --bg-2: ${p.bg2};
  --bg-3: ${p.bg3};
  --fg-0: ${p.fg0};
  --fg-1: ${p.fg1};
  --fg-2: ${p.fg2};
  --fg-3: ${p.fg3};
  --line-1: ${p.line1};
  --line-2: ${p.line2};
  --ok: #22c55e;
  --warn: #f59e0b;
  --err: #ef4444;
  --info: #38bdf8;
  --font-sans: 'Inter', system-ui, -apple-system, Segoe UI, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
html, body { margin: 0; padding: 0; background: transparent; color: var(--fg-1); font-family: var(--font-sans); }
body { padding: 8px; }
svg { display: block; max-width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; }
* { box-sizing: border-box; }
/* Sev-0 fix: defensive overrides — when models emit hardcoded near-black
 * fills (#000/#0a0/#111) on a light theme they go invisible. Map common
 * SVG fill/stroke heuristics to theme-tone equivalents. */
${
  theme === 'light'
    ? `
text[fill="white"], text[fill="#fff"], text[fill="#ffffff"], .light-on-dark text { fill: var(--fg-0); }
[stroke="white"], [stroke="#fff"], [stroke="#ffffff"] { stroke: var(--fg-0); }
[fill="black"], [fill="#000"], [fill="#000000"] { fill: var(--fg-0); }
`
    : `
[fill="black"], [fill="#000"], [fill="#000000"], .dark-on-light text { fill: var(--fg-0); }
[stroke="black"], [stroke="#000"], [stroke="#000000"] { stroke: var(--fg-0); }
text[fill="white"], text[fill="#fff"], text[fill="#ffffff"] { fill: var(--fg-0); }
`
}
`.trim();
}

/**
 * Best-effort detection of the active theme from the parent document.
 * Reads:
 *   1. document.documentElement.dataset.theme ('light' | 'dark')
 *   2. matchMedia('(prefers-color-scheme: light)') as fallback
 * Defaults to 'dark' (the historical chatmode default).
 */
export function detectParentTheme(): WidgetTheme {
  if (typeof document === 'undefined') return 'dark';
  const declared = document.documentElement.dataset.theme;
  if (declared === 'light' || declared === 'dark') return declared;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  }
  return 'dark';
}

/**
 * Reads the live --accent CSS var off the parent document so the iframe
 * stays in sync with the user's accent picker.
 */
export function detectParentAccent(): string | undefined {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return undefined;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return v && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}
