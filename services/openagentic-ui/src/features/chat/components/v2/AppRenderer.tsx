/**
 * AppRenderer — Phase 4 #474 T3 compose_app mount.
 *
 * Plan: <internal-plan>
 *
 * Receives an `app_render` NDJSON frame from the server (validated by
 * composeAppValidator + CdnAllowList) and mounts the HTML payload inside
 * a sandboxed iframe with srcdoc.
 *
 * Hardened sandbox model (mirrors Claude.ai artifacts):
 *   - sandbox="allow-scripts" ONLY — never allow-same-origin (escape risk
 *     per https://oxc.rs/docs/guide/usage/linter/rules/react/iframe-missing-sandbox)
 *   - srcdoc creates an opaque origin → automatic isolation from the
 *     parent's cookies / localStorage
 *   - inline CSP <meta http-equiv> inside srcdoc gates network egress to
 *     /api/cdn/ (same-origin) ONLY (the cluster-internal CDN). Public CDNs
 *     (jsdelivr / unpkg / cdnjs / skypack / esm.sh) are blocked.
 *
 * Pyodide path (pyodideRequired=true):
 *   - Loaded from https:///api/cdn/ (same-origin)/lib/pyodide/ in a Web Worker
 *   - Cold ~2s, warm ~400ms (IndexedDB cache)
 *   - Matplotlib must use Agg backend → PNG → postMessage; HTML5 backend
 *     is broken in Web Workers (no `document` global)
 *
 * The iframe auto-fits content via postMessage bridge — same pattern as
 * WidgetRenderer. Hover surfaces no menu yet (#476 follow-up).
 */

import React, { useMemo } from 'react';
import { resolveThemeTokens } from '../../../../lib/charts/hooks/useThemeTokens';

export interface AppRendererProps {
  /** Server-supplied artifact id (used for hot-swap by group_id and Playwright probing). */
  artifactId: string;
  /** The validated HTML payload from compose_app. */
  html: string;
  /** Title used for iframe a11y label + future modal header. */
  title: string;
  /** When true, srcdoc bootstraps Pyodide in a Web Worker. */
  pyodideRequired?: boolean;
  /**
   * #487 — per-render CSP nonce. Server-side composeAppValidator
   * generates this and attaches `nonce="<value>"` to every `<script>`
   * tag in `html`. When provided we drop `'unsafe-inline'` and use
   * `'nonce-XXX'` so script execution is gated to validated tags only.
   * Null on legacy frames; back-compat path keeps `'unsafe-inline'`.
   */
  nonce?: string | null;
  /** Optional max-height cap (default 90vh). */
  maxHeight?: string;
  className?: string;
  /**
   * Artifact kind. When 'react', `html` is raw JSX/TSX source (NOT a full HTML
   * doc) — we wrap it in a babel-transpiling HTML shell that loads
   * react/react-dom/@babel-standalone from the same-origin /artifact-runtime/
   * dir (the synth-cdn /api/cdn path is not deployed in OSS). Other kinds
   * ('html'/'python_plot') are already full HTML and pass through unchanged.
   */
  kind?: string;
}

/**
 * Wrap raw JSX/TSX (a kind:'react' artifact) in an HTML document that loads
 * React 18 + ReactDOM + @babel/standalone from the same-origin
 * /artifact-runtime/ dir and mounts the component. The model authors either a
 * `export default function Widget(){…}` (esbuild-style) or a bare component +
 * createRoot; we normalize both: strip ES import/export lines (no module
 * resolver in the iframe), then render the default export if present, else let
 * the author's own createRoot run.
 */
function wrapReactArtifact(jsx: string): string {
  // Strip ES import lines (libs are globals) and `export default`/`export`
  // keywords — Babel-in-browser has no module system here.
  const cleaned = jsx
    .replace(/^\s*import\s.+?;?\s*$/gm, '')
    .replace(/export\s+default\s+function/g, 'function')
    .replace(/export\s+default\s+/g, 'const __default__ = ')
    .replace(/^\s*export\s+/gm, '');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<script src="/artifact-runtime/react.production.min.js"></script>',
    '<script src="/artifact-runtime/react-dom.production.min.js"></script>',
    '<script src="/artifact-runtime/babel.min.js"></script>',
    '<style>html,body{margin:0;background:var(--cm-bg-0,#0d1117);color:var(--cm-fg-0,#e6edf3);font-family:var(--cm-font-ui,system-ui,sans-serif)}#root{padding:0}</style>',
    '</head><body><div id="root"></div>',
    '<script type="text/babel" data-presets="react,typescript">',
    'const { useState, useMemo, useEffect, useRef, useCallback } = React;',
    cleaned,
    // Mount: prefer an explicit default export, else a top-level component
    // named Widget/App/Dashboard/Component, else the last-defined function.
    'try {',
    '  const __pick = (typeof __default__!=="undefined" && __default__) ||',
    '    (typeof Widget!=="undefined" && Widget) || (typeof App!=="undefined" && App) ||',
    '    (typeof Dashboard!=="undefined" && Dashboard) || (typeof Component!=="undefined" && Component) || null;',
    '  if (__pick) { ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(__pick)); }',
    '} catch (e) { document.getElementById("root").textContent = "Artifact error: " + e.message; }',
    '</script></body></html>',
  ].join('\n');
}

/**
 * Build the CSP meta tag injected into srcdoc.
 *
 * #482 same-origin architecture: scripts and exec endpoints are served by
 * the parent origin (chat.example.com) — UI nginx reverse-proxies
 * `/api/cdn/*` to synth-cdn:8080 inside the cluster. No separate
 * /api/cdn/ (same-origin) DNS / TLS / ingress needed.
 *
 * - default-src 'none'         — deny everything by default
 * - script-src ${origin}       — same-origin (libs from /api/cdn/lib/*, no public CDNs)
 * - style-src 'unsafe-inline'  — required for inline styles in mini-apps
 * - img-src self/data/blob     — allow PNG postMessage from Pyodide matplotlib
 * - connect-src ${origin}      — fetch/XHR to /api/synth/exec (auth-injected)
 * - worker-src 'self' blob:    — Pyodide runs in a Web Worker (blob: per Pyodide docs)
 */
function buildCspMeta(pyodideRequired: boolean, origin: string, nonce?: string | null): string {
  // #484 C2 — script-src is path-prefixed to /api/cdn/lib/ ONLY. CSP3
  // path-prefix sources match a path scope (https://chat-dev/api/cdn/lib/*)
  // not just a host. Without this restriction, the iframe could
  // `<script src="/api/embed/x.js">` and execute arbitrary JS returned
  // from any chat-dev endpoint that emits application/javascript.
  //
  // connect-src stays bare-origin because the iframe needs to POST to
  // /api/synth/exec (auth-checked, AD-only).
  //
  // #487 — when the server supplies a per-render nonce, we drop
  // `'unsafe-inline'` and grant `'nonce-XXX'` instead. The validator
  // attaches matching `nonce="<value>"` to every `<script>` tag in
  // the payload, so any model-injected script without the nonce is
  // refused by the browser. Without nonce, fall back to legacy
  // `'unsafe-inline'` for back-compat.
  // /artifact-runtime/ serves the same-origin react/react-dom/babel + d3/plotly
  // bundles (kind:'react' artifacts load react+babel from here, since the
  // synth-cdn /api/cdn path is not deployed in OSS).
  const scriptSrcParts = [`'self'`, `${origin}/api/cdn/lib/`, `${origin}/artifact-runtime/`];
  if (nonce) {
    scriptSrcParts.push(`'nonce-${nonce}'`);
  } else {
    scriptSrcParts.push(`'unsafe-inline'`);
  }
  const parts = [
    "default-src 'none'",
    `script-src ${scriptSrcParts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${origin}`,
    "font-src 'self' data:",
  ];
  if (pyodideRequired) {
    parts.push("worker-src 'self' blob:");
  }
  return `<meta http-equiv="Content-Security-Policy" content="${parts.join('; ')}">`;
}

/**
 * Pyodide bootstrap script. Loads pyodide.js from the internal CDN via the
 * same-origin proxy path. Only injected when pyodideRequired=true to avoid
 * the ~15MB cold load on apps that don't need it.
 */
const PYODIDE_BOOTSTRAP = `
<script src="/api/cdn/lib/pyodide/0.27/pyodide.js"></script>
<script>
window.__pyodideReady = (async () => {
  const py = await loadPyodide({ indexURL: "/api/cdn/lib/pyodide/0.27/" });
  return py;
})();
</script>
`.trim();

/**
 * Build a `<style>` block that overrides the iframe's `:root` CSS variables
 * with the parent document's resolved theme tokens. Iframes do NOT inherit
 * CSS variables from the parent — server-baked `:root { --cm-bg-0: ... }`
 * locks the iframe to whichever theme the template author hardcoded.
 *
 * Names come from the canonical VAR_MAP in
 * `services/openagentic-ui/src/lib/charts/hooks/useThemeTokens.ts` —
 * `--cm-bg-0/1/2`, `--cm-fg-0/1/2/3`, `--cm-ok`, `--cm-warn`, `--cm-err`,
 * `--cm-info`, `--cm-accent`, `--cm-line-1/2`, `--cm-cap-*`, `--cm-font-*`.
 * Reading any other name (e.g. `--cm-bg`, `--cm-success`) silently no-ops
 * because :root never defines them.
 */
function readParentThemeTokens(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  let tokens: ReturnType<typeof resolveThemeTokens>;
  try {
    tokens = resolveThemeTokens();
  } catch {
    return '';
  }
  const colorScheme = (() => {
    try {
      return (
        window
          .getComputedStyle(document.documentElement)
          .getPropertyValue('color-scheme')
          .trim() || 'dark'
      );
    } catch {
      return 'dark';
    }
  })();
  const decls = [
    `--cm-accent: ${tokens.accent};`,
    `--cm-ok: ${tokens.ok};`,
    `--cm-warn: ${tokens.warn};`,
    `--cm-err: ${tokens.err};`,
    `--cm-info: ${tokens.info};`,
    `--cm-fg-0: ${tokens.fg0};`,
    `--cm-fg-1: ${tokens.fg1};`,
    `--cm-fg-2: ${tokens.fg2};`,
    `--cm-fg-3: ${tokens.fg3};`,
    `--cm-bg-0: ${tokens.bg0};`,
    `--cm-bg-1: ${tokens.bg1};`,
    `--cm-bg-2: ${tokens.bg2};`,
    `--cm-line-1: ${tokens.line1};`,
    `--cm-line-2: ${tokens.line2};`,
    `--cm-cap-thinking: ${tokens.capThinking};`,
    `--cm-cap-streaming: ${tokens.capStreaming};`,
    `--cm-cap-tools: ${tokens.capTools};`,
    `--cm-font-ui: ${tokens.fontUi};`,
    `--cm-font-mono: ${tokens.fontMono};`,
  ].map((d) => `  ${d}`).join('\n');
  return [
    '<style id="cm-parent-theme-override">',
    ':root {',
    `  color-scheme: ${colorScheme};`,
    decls,
    '}',
    '</style>',
  ].join('\n');
}

function buildSrcdoc(html: string, pyodideRequired: boolean, origin: string, nonce?: string | null): string {
  // <base href> pins relative URLs (`/api/cdn/lib/...`) to the parent
  // origin. Without it, srcdoc iframes resolve relative URLs against
  // about:srcdoc — every fetch fails.
  const base = `<base href="${origin}/">`;
  const csp = buildCspMeta(pyodideRequired, origin, nonce);
  // #487 — also nonce-tag the Pyodide bootstrap scripts since they'll be
  // governed by the same CSP. When nonce is null (legacy back-compat
  // path), buildCspMeta keeps `'unsafe-inline'` and the bootstrap stays
  // un-nonced.
  const pyodide = pyodideRequired
    ? (nonce
        ? PYODIDE_BOOTSTRAP.replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`)
        : PYODIDE_BOOTSTRAP)
    : '';
  // Parent theme override — appended AFTER the template's own theme block
  // so CSS cascade lets the override win. Without this the iframe locks
  // to the server-baked dark default regardless of user theme.
  const themeOverride = readParentThemeTokens();
  // Insert base + CSP + pyodide at the top of <head> so they apply before
  // any user script runs. Theme override goes at the END of <head> so the
  // cascade resolves to the parent's tokens.
  const headTop = `${base}\n${csp}\n${pyodide}`;
  if (/<head\b[^>]*>/i.test(html)) {
    let out = html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${headTop}`);
    if (themeOverride) {
      // Append the override JUST before </head>. If no </head> present,
      // splice it in after the head injection (less ideal cascade but
      // still wins over body style attributes).
      if (/<\/head>/i.test(out)) {
        out = out.replace(/<\/head>/i, `${themeOverride}\n</head>`);
      } else {
        out = out.replace(headTop, `${headTop}\n${themeOverride}`);
      }
    }
    return out;
  }
  return `<!doctype html><html><head>${headTop}\n${themeOverride}</head><body>${html}</body></html>`;
}

export function AppRenderer({
  artifactId,
  html,
  title,
  pyodideRequired = false,
  nonce,
  maxHeight,
  className,
  kind,
}: AppRendererProps) {
  const srcdoc = useMemo(
    () => {
      if (!html) return '';
      // Read parent origin at render-time. Falls back to a sentinel when
      // window is undefined (SSR / tests with no jsdom origin).
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'about:srcdoc';
      // kind:'react' arrives as raw JSX (not a full HTML doc) — wrap it so the
      // babel-in-iframe shell transpiles + mounts it. A react payload that
      // already looks like a full HTML doc (legacy) passes through. The
      // wrapper's own <script src="/artifact-runtime/*"> is dropped from
      // nonce-gating since those are trusted same-origin libs, so force the
      // legacy unsafe-inline CSP path (nonce=null) for wrapped react.
      const looksLikeHtml = /^\s*<!doctype|^\s*<html/i.test(html);
      if (kind === 'react' && !looksLikeHtml) {
        return buildSrcdoc(wrapReactArtifact(html), false, origin, null);
      }
      return buildSrcdoc(html, pyodideRequired, origin, nonce);
    },
    [html, pyodideRequired, nonce, kind],
  );

  if (!html) return null;

  const cap = maxHeight || '90vh';

  return (
    <div
      className={['cm-v2', 'cm-app-renderer', className || ''].filter(Boolean).join(' ')}
      data-app-renderer="true"
      data-artifact-id={artifactId}
      style={{ position: 'relative', margin: '12px 0' }}
    >
      <iframe
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title={title}
        style={{
          width: '100%',
          border: 0,
          display: 'block',
          height: '60vh',
          maxHeight: cap,
          background: 'transparent',
        }}
      />
    </div>
  );
}
