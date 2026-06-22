/**
 * Shared scaffolding for compose_app templates.
 *
 * the design notes
 *
 * Every template renders a single self-contained HTML document. The
 * scaffolding here pins:
 *   - <!doctype html> + <html> + <head> shape
 *   - Theme-token CSS preamble (matches mocks/UX/AI/Chatmode/00-target-mock-10.html
 *     and the dark mode used by mocks/Diagrams/*.html)
 *   - Meta CSP that mirrors the iframe srcdoc CSP (script-src 'self' + the
 *     synth-cdn proxy; no inline-script eval; no nested iframes)
 *   - JSON-script payload preamble so the template body can hydrate from
 *     deterministic params without string concatenation footguns
 *   - HTML escaping helpers
 *
 * Trust boundary: whatever this scaffolding emits ALSO flows through the
 * server-side composeAppValidator + CdnAllowList. Templates are NOT a
 * privilege escalation; they're a quality-floor convenience.
 */

/** Same-origin path the UI nginx reverse-proxies to the synth-cdn pod. */
export const CDN_ROOT = '/api/cdn/lib';

/** Catalogue of the lib URLs templates may reference. Stays in sync with the
 *  CdnAllowList allow-list — every URL here begins with `/api/cdn/lib/`. */
export const CDN_LIB = {
  d3: `${CDN_ROOT}/d3@7/dist/d3.min.js`,
  d3Sankey: `${CDN_ROOT}/d3-sankey@0/dist/d3-sankey.min.js`,
  d3Hierarchy: `${CDN_ROOT}/d3-hierarchy@3/dist/d3-hierarchy.min.js`,
  d3Chord: `${CDN_ROOT}/d3-chord@3/dist/d3-chord.min.js`,
  /** d3-flame-graph — Phase 6 mocks-parity (flamegraph template). Same-origin
   *  proxy path; synth-cdn resolves arbitrary npm packages. */
  d3FlameGraph: `${CDN_ROOT}/d3-flame-graph@4/dist/d3-flamegraph.min.js`,
  d3FlameGraphCss: `${CDN_ROOT}/d3-flame-graph@4/dist/d3-flamegraph.css`,
  echarts: `${CDN_ROOT}/echarts@5/dist/echarts.min.js`,
  // plotly + mermaid CDN entries removed (2026-05-19) — zero callers across
  // every template file; mermaid was deprecated platform-wide in favor of
  // d3 + dagre-driven `arch_diagram` compose_visual template. Re-add only
  // when a real template needs them AND CdnAllowList allows them.
  cytoscape: `${CDN_ROOT}/cytoscape@3/cytoscape.min.js`,
} as const;

/** HTML-escape a string for safe interpolation between tags. */
export function escHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;');
}

/** Embed a JSON object inside an inline `<script type="application/json">`
 *  payload. The terminator `</` is escaped so user data containing literal
 *  `</script>` cannot break out of the script tag. */
export function embedJson(id: string, value: unknown): string {
  const json = JSON.stringify(value).replace(/<\/(?=script)/gi, '<\\/');
  return `<script id="${escHtml(id)}" type="application/json">${json}</script>`;
}

export interface ScaffoldOptions {
  title: string;
  /** CSS appended after the theme preamble. Use scoped selectors. */
  css?: string;
  /** Inline body markup. Inserted between <main> and the script tags. */
  bodyHtml: string;
  /** Inline scripts to run after libs load. The runtime is a normal browser
   *  context; no eval / new Function. */
  inlineScripts?: string[];
  /** Same-origin /api/cdn/lib/* URLs to inject as <script src>. Order
   *  preserved — d3 before d3-sankey, etc. */
  cdnScripts?: string[];
  /** JSON payloads to embed (id → object). Read with
   *  `JSON.parse(document.getElementById(id).textContent)`. */
  jsonPayloads?: Record<string, unknown>;
}

/**
 * JS preamble that exposes the theme tokens to inline scripts (ECharts,
 * d3, cytoscape config). Prepended automatically to every inline script
 * by buildHtml so templates can write e.g.
 *
 *   chart.setOption({ textStyle: { color: CM.fg } });
 *
 * instead of embedding hex literals that would break light/dark/accent
 * theme parity. The values resolve at runtime from getComputedStyle on
 * :root so the parent's theme/accent overrides propagate.
 *
 * Spec: feedback_compositions_must_use_global_theme_tokens.md
 */
export const THEME_TOKENS_JS_PREAMBLE = `
// Resolve theme tokens from :root at runtime so light/dark/accent
// overrides flow through to chart libraries. Returns the var() form
// AND a resolved hex/rgb string for libraries that don't accept var().
(function () {
  function read(name) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v || '').trim();
    } catch (_e) { return ''; }
  }
  var fallback = {
    '--cm-bg': '#0b0f14',
    '--cm-bg-2': '#111722',
    '--cm-bg-3': '#1a2230',
    '--cm-fg': '#e6edf6',
    '--cm-fg-dim': '#9aa5b3',
    '--cm-fg-muted': '#6c7787',
    '--cm-border': '#2a3242',
    '--cm-accent': '#4ade80',
    '--cm-accent-2': '#22d3ee',
    '--cm-warn': '#f59e0b',
    '--cm-error': '#ef4444',
    '--cm-info': '#60a5fa',
    '--cm-success': '#22c55e',
  };
  function tok(name) { return read(name) || fallback[name] || ''; }
  window.CM = {
    bg: tok('--cm-bg'),
    bg2: tok('--cm-bg-2'),
    bg3: tok('--cm-bg-3'),
    fg: tok('--cm-fg'),
    fgDim: tok('--cm-fg-dim'),
    fgMuted: tok('--cm-fg-muted'),
    border: tok('--cm-border'),
    accent: tok('--cm-accent'),
    accent2: tok('--cm-accent-2'),
    warn: tok('--cm-warn'),
    error: tok('--cm-error'),
    info: tok('--cm-info'),
    success: tok('--cm-success'),
    // Palette used for series colors across chart templates. Pulls from
    // the accent ramp first, then fills with neutral chart-distinct tints.
    palette: [
      tok('--cm-accent'),
      tok('--cm-accent-2'),
      tok('--cm-info'),
      tok('--cm-warn'),
      tok('--cm-success'),
      tok('--cm-error'),
      tok('--cm-fg-dim'),
    ],
    // Translucent overlays — same hue family as the warn/error/info/success
    // tone tokens, alpha-tuned for backdrop-style fills (table cell tints,
    // grid splitLines, low-emphasis backgrounds).
    successSoft: 'color-mix(in srgb, ' + tok('--cm-success') + ' 18%, transparent)',
    warnSoft: 'color-mix(in srgb, ' + tok('--cm-warn') + ' 18%, transparent)',
    errorSoft: 'color-mix(in srgb, ' + tok('--cm-error') + ' 18%, transparent)',
    infoSoft: 'color-mix(in srgb, ' + tok('--cm-info') + ' 18%, transparent)',
    accentSoft: 'color-mix(in srgb, ' + tok('--cm-accent') + ' 18%, transparent)',
    borderSoft: 'color-mix(in srgb, ' + tok('--cm-border') + ' 50%, transparent)',
  };
})();
`.trim();

/**
 * Theme tokens — derived from `mocks/UX/AI/Chatmode/00-target-mock-10.html`.
 * Dark default; an explicit `:root.light` override could be added later.
 */
const THEME_PREAMBLE = `
:root {
  --cm-bg: #0b0f14;
  --cm-bg-2: #111722;
  --cm-bg-3: #1a2230;
  --cm-fg: #e6edf6;
  --cm-fg-dim: #9aa5b3;
  --cm-fg-muted: #6c7787;
  --cm-border: #2a3242;
  --cm-accent: #4ade80;
  --cm-accent-2: #22d3ee;
  --cm-warn: #f59e0b;
  --cm-error: #ef4444;
  --cm-info: #60a5fa;
  --cm-success: #22c55e;
  --cm-radius: 10px;
  --cm-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --cm-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; background: var(--cm-bg); color: var(--cm-fg); font-family: var(--cm-sans); }
main { padding: 16px; }
.cm-card { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 12px; }
.cm-tag { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--cm-bg-3); color: var(--cm-fg-dim); font-size: 11px; font-family: var(--cm-mono); border: 1px solid var(--cm-border); }
.cm-tag.ok { color: var(--cm-success); border-color: rgba(34,197,94,0.4); }
.cm-tag.warn { color: var(--cm-warn); border-color: rgba(245,158,11,0.4); }
.cm-tag.error { color: var(--cm-error); border-color: rgba(239,68,68,0.4); }
.cm-tag.info { color: var(--cm-info); border-color: rgba(96,165,250,0.4); }
.viz-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; margin: 0 0 8px 0; background: var(--cm-bg-3); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); font-size: 12px; color: var(--cm-fg-dim); }
.viz-head .viz-title { color: var(--cm-fg); font-weight: 600; }
table.cm-grid { width: 100%; border-collapse: collapse; font-size: 13px; }
table.cm-grid th, table.cm-grid td { padding: 6px 10px; border-bottom: 1px solid var(--cm-border); text-align: left; }
table.cm-grid th { color: var(--cm-fg-dim); font-weight: 600; background: var(--cm-bg-3); }
`.trim();

/**
 * Build the full HTML document. Pure string concatenation — no template
 * literals interpolating untrusted strings (use embedJson + escHtml).
 *
 * IMPORTANT: do NOT add `<meta http-equiv="Content-Security-Policy">`
 * here. The iframe srcdoc CSP is enforced by the parent UI when it mounts
 * the iframe — duplicating it inline would either (a) be redundant or
 * (b) drift away from the parent's policy. The validator already checks
 * the script-src URLs match the same-origin /api/cdn/lib/ allow-list.
 */
export function buildHtml(opts: ScaffoldOptions): string {
  const cdnScriptTags = (opts.cdnScripts ?? [])
    .map((src) => `<script src="${escHtml(src)}"></script>`)
    .join('\n');
  const jsonTags = Object.entries(opts.jsonPayloads ?? {})
    .map(([id, value]) => embedJson(id, value))
    .join('\n');
  // Every inline script gets the theme-token preamble prepended so it can
  // reference `CM.fg`, `CM.accent`, `CM.palette[...]` etc. instead of
  // hardcoded hex/rgb literals. The preamble is idempotent (it overwrites
  // window.CM on each evaluation), safe to repeat across multiple script
  // tags.
  const inline = (opts.inlineScripts ?? [])
    .map((s) => `<script>\n${THEME_TOKENS_JS_PREAMBLE}\n${s}\n</script>`)
    .join('\n');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    `<title>${escHtml(opts.title)}</title>`,
    '<style>',
    THEME_PREAMBLE,
    opts.css ?? '',
    '</style>',
    cdnScriptTags,
    '</head>',
    '<body>',
    '<main>',
    opts.bodyHtml,
    '</main>',
    jsonTags,
    inline,
    '</body>',
    '</html>',
  ].join('\n');
}
