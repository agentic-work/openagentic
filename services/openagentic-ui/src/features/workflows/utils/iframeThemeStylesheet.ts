/**
 * iframeThemeStylesheet — snapshot the parent app's live theme tokens
 * into a self-contained <style> block that gets injected into the
 * <head> of every srcdoc-sandboxed SafeHtmlIframe.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Per user directive 2026-05-14: "all rendered/reports, etc have to
 * adhere to global css themes". The 10 AIOps templates emit HTML
 * fragments like `<div class="pod-health-report"><h2>...</h2>...</div>`
 * with no inline styles, so prior to this helper the iframe fell back
 * to SafeHtmlIframe's hardcoded GitHub-dark defaults — looking out of
 * place on the light theme and not matching the surrounding chrome on
 * dark either.
 *
 * Iframes with srcdoc are opaque cross-origin contexts. They do NOT
 * inherit CSS custom properties from the parent — `:root { --bg-0: ... }`
 * declared in the parent document is invisible inside the iframe. So we
 * must copy the *computed values* of those variables at render time and
 * re-declare them inside the iframe's own :root.
 *
 * Variables sourced from:
 *   - styles/mockup-v067.css      (--bg-*, --fg-*, --line-*, --accent, --ok/--warn/--err)
 *   - styles/design-tokens.css    (--surface-*, --radius-*)
 *   - index.css                   (--font-sans, --text-*)
 *   - styles/admin-tokens.css     (--toast-*)
 *   - hooks/useTheme.ts bridge    (--color-* legacy semantic tokens)
 *
 * Theme switch reactivity: parent theme toggles flip both
 * `<html data-theme="light">` and `<html class="light">`. The
 * SafeHtmlIframe consumer should re-call this helper and regenerate
 * srcdoc on theme change so the iframe re-paints in the new palette.
 */

interface ThemeVar {
  /** CSS variable name */
  name: string;
  /** Dark-theme fallback if not declared on documentElement */
  darkDefault: string;
  /** Light-theme fallback if not declared on documentElement */
  lightDefault: string;
}

const THEME_VARS: ThemeVar[] = [
  // ── Surface stack (mockup v067) ────────────────────────────────────
  { name: '--bg-0', darkDefault: '#09090b', lightDefault: '#ffffff' },
  { name: '--bg-1', darkDefault: '#0f1012', lightDefault: '#fafafa' },
  { name: '--bg-2', darkDefault: '#16181c', lightDefault: '#f4f4f5' },
  { name: '--bg-3', darkDefault: '#1c1f24', lightDefault: '#e4e4e7' },
  { name: '--bg-4', darkDefault: '#242831', lightDefault: '#d4d4d8' },
  // ── Foreground stack ───────────────────────────────────────────────
  { name: '--fg-0', darkDefault: '#f8fafc', lightDefault: '#09090b' },
  { name: '--fg-1', darkDefault: '#d4d4d8', lightDefault: '#3f3f46' },
  { name: '--fg-2', darkDefault: '#a1a1aa', lightDefault: '#52525b' },
  { name: '--fg-3', darkDefault: '#71717a', lightDefault: '#71717a' },
  // ── Borders ────────────────────────────────────────────────────────
  { name: '--line-1', darkDefault: 'rgba(255, 255, 255, 0.06)', lightDefault: 'rgba(0, 0, 0, 0.06)' },
  { name: '--line-2', darkDefault: 'rgba(255, 255, 255, 0.10)', lightDefault: 'rgba(0, 0, 0, 0.10)' },
  { name: '--line-3', darkDefault: 'rgba(255, 255, 255, 0.16)', lightDefault: 'rgba(0, 0, 0, 0.16)' },
  // ── Brand + status ─────────────────────────────────────────────────
  { name: '--accent', darkDefault: '#8b5cf6', lightDefault: '#8b5cf6' },
  { name: '--accent-soft', darkDefault: 'rgba(139, 92, 246, 0.14)', lightDefault: 'rgba(139, 92, 246, 0.10)' },
  { name: '--accent-line', darkDefault: 'rgba(139, 92, 246, 0.32)', lightDefault: 'rgba(139, 92, 246, 0.28)' },
  { name: '--ok', darkDefault: '#22c55e', lightDefault: '#16A34A' },
  { name: '--warn', darkDefault: '#f59e0b', lightDefault: '#EA580C' },
  { name: '--err', darkDefault: '#ef4444', lightDefault: '#B91C1C' },
  { name: '--info', darkDefault: '#38bdf8', lightDefault: '#1D4ED8' },
  // ── Legacy semantic alias bridge (so old-style markup keeps working) ─
  { name: '--color-background', darkDefault: '#09090b', lightDefault: '#ffffff' },
  { name: '--color-surface', darkDefault: '#0f1012', lightDefault: '#fafafa' },
  { name: '--color-text', darkDefault: '#f8fafc', lightDefault: '#09090b' },
  { name: '--color-border', darkDefault: 'rgba(255, 255, 255, 0.06)', lightDefault: 'rgba(0, 0, 0, 0.06)' },
  { name: '--color-primary', darkDefault: '#8b5cf6', lightDefault: '#8b5cf6' },
  // ── Typography ─────────────────────────────────────────────────────
  {
    name: '--font-sans',
    darkDefault: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    lightDefault: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
];

function detectTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  const root = document.documentElement;
  // Order: explicit data-theme attr wins, then class on <html>, then
  // OS preference. Matches useTheme.ts behaviour.
  const attr = root.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  if (root.classList.contains('light')) return 'light';
  if (root.classList.contains('dark')) return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return fallback;
  }
  const computed = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return computed || fallback;
}

/**
 * Build a `<style id="openagentic-theme-injected">` block to inject into the
 * <head> of a srcdoc iframe so the rendered HTML adopts the parent
 * app's live theme.
 */
export function getIframeThemeStylesheet(): string {
  const theme = detectTheme();

  const vars: Array<[string, string]> = THEME_VARS.map(({ name, darkDefault, lightDefault }) => {
    const fallback = theme === 'dark' ? darkDefault : lightDefault;
    return [name, readVar(name, fallback)];
  });

  const varDeclarations = vars
    .map(([k, v]) => `        ${k}: ${v};`)
    .join('\n');

  return `<style id="openagentic-theme-injected">
      :root {
${varDeclarations}
        color-scheme: ${theme};
      }
      html, body {
        background: var(--bg-0);
        color: var(--fg-1);
        font-family: var(--font-sans);
        font-size: 14px;
        line-height: 1.6;
        margin: 0;
        padding: 1.5rem;
        letter-spacing: -0.01em;
        -webkit-font-smoothing: antialiased;
      }
      h1, h2, h3, h4, h5, h6 {
        color: var(--fg-0);
        font-family: var(--font-sans);
        letter-spacing: -0.02em;
        line-height: 1.25;
        margin: 1.25rem 0 0.5rem;
      }
      h1 { font-size: 1.625rem; font-weight: 700; margin-top: 0; }
      h2 { font-size: 1.25rem; font-weight: 600; }
      h3 { font-size: 1.05rem; font-weight: 600; color: var(--fg-1); }
      h4 { font-size: 0.95rem; font-weight: 600; color: var(--fg-2); }
      p { margin: 0.5rem 0; color: var(--fg-1); }
      strong { color: var(--fg-0); font-weight: 600; }
      em { color: var(--fg-1); }
      a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-line); }
      a:hover { color: var(--accent); border-bottom-color: var(--accent); }
      hr { border: 0; border-top: 1px solid var(--line-1); margin: 1.5rem 0; }
      ul, ol { margin: 0.5rem 0; padding-left: 1.5rem; color: var(--fg-1); }
      li { margin: 0.25rem 0; }
      table {
        border-collapse: separate;
        border-spacing: 0;
        width: 100%;
        margin: 0.75rem 0;
        background: var(--bg-1);
        border: 1px solid var(--line-1);
        border-radius: 10px;
        overflow: hidden;
        font-size: 0.9rem;
      }
      th, td {
        padding: 0.55rem 0.85rem;
        text-align: left;
        border-bottom: 1px solid var(--line-1);
        color: var(--fg-1);
      }
      th {
        background: var(--bg-2);
        color: var(--fg-0);
        font-weight: 600;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      tr:last-child td { border-bottom: 0; }
      tr:hover td { background: var(--bg-2); }
      code {
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.85em;
        background: var(--bg-2);
        color: var(--fg-0);
        padding: 0.1rem 0.35rem;
        border-radius: 4px;
        border: 1px solid var(--line-1);
      }
      pre {
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.85rem;
        line-height: 1.55;
        background: var(--bg-1);
        color: var(--fg-1);
        border: 1px solid var(--line-1);
        border-radius: 10px;
        padding: 0.85rem 1rem;
        margin: 0.75rem 0;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      pre code {
        background: transparent;
        border: 0;
        padding: 0;
        font-size: inherit;
        color: inherit;
      }
      blockquote {
        border-left: 3px solid var(--accent);
        padding: 0.25rem 0 0.25rem 1rem;
        margin: 0.75rem 0;
        color: var(--fg-2);
        background: var(--accent-soft);
        border-radius: 0 6px 6px 0;
      }
      /* Common report-shell wrappers emitted by the AIOps templates. */
      [class$="-report"], [class$="-snapshot"], [class$="-digest"], [class$="-rca"], [class$="-survey"] {
        max-width: 100%;
      }
      /* Status / severity / banner classes the templates emit inline. */
      .summary, .narrative, .diagnoses, .rca, .digest, .patterns, .research, .alerts-table, .unhealthy-pods, .recs-table, .targets-table, .pods-table, .services-table, .deployments-table {
        margin: 0.5rem 0;
      }
      .banner, .empty-banner, .all-healthy-banner, .all-up-banner {
        display: block;
        padding: 0.75rem 1rem;
        margin: 0.75rem 0;
        background: var(--accent-soft);
        color: var(--fg-0);
        border-left: 3px solid var(--accent);
        border-radius: 6px;
        font-size: 0.9rem;
      }
      .severity-critical, .severity-high, .alert-critical, .status-error, .status-failed, .status-down {
        color: var(--err);
        font-weight: 600;
      }
      .severity-warning, .severity-medium, .alert-warning, .status-degraded, .status-warning {
        color: var(--warn);
        font-weight: 600;
      }
      .severity-info, .severity-low, .alert-info, .status-info {
        color: var(--info);
      }
      .severity-ok, .status-ok, .status-healthy, .status-running, .status-up {
        color: var(--ok);
        font-weight: 600;
      }
    </style>`;
}

/**
 * Lightweight detector used by SafeHtmlIframe consumers that need to
 * know whether to regenerate srcdoc on theme change.
 */
export function getCurrentIframeTheme(): 'dark' | 'light' {
  return detectTheme();
}
