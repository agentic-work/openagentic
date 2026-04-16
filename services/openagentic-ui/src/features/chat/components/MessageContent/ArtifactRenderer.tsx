import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play, Maximize2, Minimize2, RefreshCw, Code, Eye, Copy, Check,
  ExternalLink, Download, Printer, Share2, FileText, Image, Database,
  BarChart2, GitBranch, FileCode
} from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';
import ShikiCodeBlock from './ShikiCodeBlock';

// All supported artifact types
type ArtifactType = 'html' | 'react' | 'tsx' | 'svg' | 'mermaid' | 'chart' | 'markdown' | 'latex' | 'csv' | 'canvas';

// Cached bundled library contents — fetched once, inlined into artifact iframes.
// This is required because blob: URLs and srcdoc can't resolve relative <script src> paths.
// Libraries are preloaded at module init time (lazy, cached by browser).
const _libCache: Record<string, string> = {};
const _libPromises: Record<string, Promise<string>> = {};

function preloadBundledLib(name: string): void {
  if (_libPromises[name]) return;
  _libPromises[name] = fetch(`/artifact-runtime/${name}`)
    .then(r => r.ok ? r.text() : '')
    .then(text => { _libCache[name] = text; return text; })
    .catch(() => { _libCache[name] = ''; return ''; });
}

// Preload common chart libraries on module load
preloadBundledLib('plotly-basic.min.js');
preloadBundledLib('d3.min.js');
preloadBundledLib('d3-sankey.min.js');
preloadBundledLib('chart.min.js');

function getInlineLibScript(name: string): string {
  // Check cache first
  if (_libCache[name]) return `<script>${_libCache[name]}</script>`;
  // Synchronous fallback — fetch the lib inline (blocking but reliable)
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/artifact-runtime/${name}`, false); // synchronous
    xhr.send();
    if (xhr.status === 200 && xhr.responseText.length > 100) {
      _libCache[name] = xhr.responseText;
      return `<script>${xhr.responseText}</script>`;
    }
  } catch { /* ignore */ }
  return `<!-- bundled ${name} not available -->`;
}

// Wait for all preloaded libs to be ready
async function ensureLibsLoaded(): Promise<void> {
  await Promise.all(Object.values(_libPromises));
}

// Global flag to track if libs are ready — components use this to trigger re-render
let _libsReady = false;
const _libReadyCallbacks: Array<() => void> = [];
Promise.all(Object.values(_libPromises)).then(() => {
  _libsReady = true;
  _libReadyCallbacks.forEach(cb => cb());
  _libReadyCallbacks.length = 0;
});

function useLibsReady(): boolean {
  const [ready, setReady] = React.useState(_libsReady);
  React.useEffect(() => {
    if (_libsReady) { setReady(true); return; }
    const cb = () => setReady(true);
    _libReadyCallbacks.push(cb);
    return () => {
      const idx = _libReadyCallbacks.indexOf(cb);
      if (idx >= 0) _libReadyCallbacks.splice(idx, 1);
    };
  }, []);
  return ready;
}

interface ArtifactRendererProps {
  code: string;
  type: ArtifactType;
  title?: string;
  theme?: 'light' | 'dark';
  className?: string;
  onExpandToCanvas?: (code: string, type: string, title: string, language?: string) => void;
}

/**
 * Theme-defensive base-style block injected into every artifact iframe.
 * Uses `:where()` (zero specificity) so any style the LLM emits still wins
 * — this only kicks in when the model forgot to set a background / text
 * color. Also exposes CSS custom properties (`--app-bg`, `--app-text`...)
 * so well-behaved models can produce theme-consistent output.
 *
 * openagentic-omhs#327: full-HTML artifacts previously passed through this
 * renderer without any theme enforcement, which meant a model emitting
 * `body { font: Arial }` ended up invisible on the dark app chrome.
 */
function artifactThemeDefenseBlock(theme: string): string {
  const isDark = theme === 'dark';
  const bg = isDark ? '#0d1117' : '#ffffff';
  const surface = isDark ? '#161b22' : '#f6f8fa';
  const border = isDark ? '#30363d' : '#d0d7de';
  const text = isDark ? '#e6edf3' : '#1f2328';
  const muted = isDark ? '#8b949e' : '#656d76';
  const accent = isDark ? '#58a6ff' : '#0969da';
  const danger = isDark ? '#f85149' : '#cf222e';
  const success = isDark ? '#3fb950' : '#1a7f37';
  const fontStack = `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  return `<style data-aw-theme-defense>
:root {
  color-scheme: ${isDark ? 'dark' : 'light'};
  --app-bg: ${bg};
  --app-surface: ${surface};
  --app-border: ${border};
  --app-text: ${text};
  --app-muted: ${muted};
  --app-accent: ${accent};
  --app-danger: ${danger};
  --app-success: ${success};
  --app-font: ${fontStack};
}
:where(html, body) {
  margin: 0;
  background: var(--app-bg);
  color: var(--app-text);
  font-family: var(--app-font);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
:where(body) { padding: 16px; min-height: 100vh; box-sizing: border-box; }
:where(table) { border-collapse: collapse; }
:where(a) { color: var(--app-accent); }

/* ─── ALWAYS-VISIBLE OVERRIDES (openagentic-omhs#330) ──────────────────
   See StreamingArtifactRenderer for rationale. !important on the
   visibility-critical rules so model-emitted Plotly/D3/Chart.js text
   defaults can't make the artifact unreadable against dark chrome.
   ──────────────────────────────────────────────────────────────────── */
html, body { background: var(--app-bg) !important; color: var(--app-text) !important; font-family: var(--app-font) !important; }
svg text                                          { fill: var(--app-text) !important; }
svg .tick text, svg .axis text, svg .legendtext   { fill: var(--app-muted) !important; }
svg .domain, svg .tick line, svg .gridlayer line  { stroke: var(--app-border) !important; }
.js-plotly-plot .plotly .bg, .js-plotly-plot rect.bg     { fill: transparent !important; }
.modebar, .modebar-group                                  { background: transparent !important; }
.modebar-btn path                                         { fill: var(--app-muted) !important; }
.modebar-btn:hover path                                   { fill: var(--app-text) !important; }
.legend rect.bg                                           { fill: var(--app-surface) !important; }
canvas { background: var(--app-surface) !important; border-radius: 6px; }
table th, table td { color: var(--app-text); border-color: var(--app-border); }
table th { background: var(--app-surface); }
</style>`;
}

// CSP meta tag for artifact iframe security — locked down, no CDN origins
const ARTIFACT_CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';">`;

// Legacy CSP for artifacts that load from CDNs (backward compatibility)
const ARTIFACT_CSP_META_LEGACY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://cdn.plot.ly https://d3js.org; style-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; img-src data: blob:; font-src data: https://cdn.jsdelivr.net;">`;

// OAT bridge script — injected into all artifact iframes for parent-frame function calls
const OAT_BRIDGE_SCRIPT = '<script>' +
  '(function(){var p={},c=0;window.addEventListener("message",function(e){if(e.data&&e.data.type==="oat-result"){var q=p[e.data.callId];if(q){delete p[e.data.callId];e.data.success?q.resolve(e.data.result):q.reject(new Error(e.data.error||"OAT call failed"))}}});window.ArtifactRuntime=window.ArtifactRuntime||{};window.ArtifactRuntime.oat=function(id,args){return new Promise(function(res,rej){var i=++c;p[i]={resolve:res,reject:rej};setTimeout(function(){if(p[i]){delete p[i];rej(new Error("OAT timeout"))}},30000);window.parent.postMessage({type:"oat-execute",callId:i,functionId:id,args:args||{}},"*")})};window.ArtifactRuntime.loadFont=function(){}})()' +
  '</script>';

// Safety harness JS injected into ALL artifact iframes
const ARTIFACT_SAFETY_HARNESS = `
<script>
// No execution timeout for completed artifacts — users need to interact with them indefinitely
window.__ARTIFACT_TIMEOUT = null;

// DOM node cap (5000 nodes max)
var __domObserver = new MutationObserver(function() {
  if (document.querySelectorAll('*').length > 5000) {
    __domObserver.disconnect();
    clearTimeout(window.__ARTIFACT_TIMEOUT);
    document.body.innerHTML = '<div style="padding:20px;color:#ef4444;font-family:system-ui"><h3>DOM Limit Exceeded</h3><p>Artifact created too many DOM nodes (&gt;5000).</p></div>';
  }
});
if (document.body) {
  __domObserver.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', function() {
    __domObserver.observe(document.body, { childList: true, subtree: true });
  });
}

// Cleanup on unload
window.addEventListener('unload', function() {
  clearTimeout(window.__ARTIFACT_TIMEOUT);
  __domObserver.disconnect();
});

// Auto-resize communication (works without same-origin)
var __resizeObserver = new ResizeObserver(function() {
  window.parent.postMessage({ type: 'artifact-resize', height: document.documentElement.scrollHeight }, '*');
});
if (document.body) {
  __resizeObserver.observe(document.body);
} else {
  document.addEventListener('DOMContentLoaded', function() {
    __resizeObserver.observe(document.body);
  });
}
</script>`;

// React template with Sucrase for TypeScript/TSX, Tailwind CDN, safety harness, better error boundary
const REACT_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META_LEGACY}
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
      min-height: 100vh;
    }
    #root { width: 100%; height: 100%; min-height: 100vh; }
    .artifact-error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border: 1px solid ${theme === 'dark' ? '#7f1d1d' : '#fecaca'};
      border-radius: 8px;
      font-family: monospace;
      white-space: pre-wrap;
      font-size: 13px;
      line-height: 1.5;
    }
    .artifact-error h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      font-family: system-ui, sans-serif;
      color: #dc2626;
    }
    .artifact-error .stack {
      color: ${theme === 'dark' ? '#fca5a5' : '#b91c1c'};
      font-size: 11px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid ${theme === 'dark' ? '#7f1d1d' : '#fecaca'};
    }
  </style>
  <script>
    // Configure Tailwind for dark mode if needed
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: {} }
    };
    ${theme === 'dark' ? 'document.documentElement.classList.add("dark");' : ''}
  </script>
</head>
<body>
  <div id="root"></div>
  ${ARTIFACT_SAFETY_HARNESS}
  <script type="text/babel" data-presets="react,typescript">
    // Error boundary for better error display
    class ArtifactErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo });
        console.error('[Artifact Error Boundary]', error, errorInfo);
      }
      render() {
        if (this.state.hasError) {
          const name = this.state.error?.name || 'Error';
          const message = this.state.error?.message || 'Unknown error';
          const stack = this.state.error?.stack || '';
          const componentStack = this.state.errorInfo?.componentStack || '';
          return React.createElement('div', { className: 'artifact-error' },
            React.createElement('h4', null, name + ': ' + message),
            stack && React.createElement('div', { className: 'stack' }, 'Stack Trace:\\n' + stack.split('\\n').slice(0, 5).join('\\n')),
            componentStack && React.createElement('div', { className: 'stack' }, 'Component Stack:' + componentStack)
          );
        }
        return this.props.children;
      }
    }

    try {
      // Execute user code - components will be added to global scope
      ${code}

      // Find the component to render (try common names and patterns)
      let ComponentToRender = null;

      // Check for commonly used component names (in order of preference)
      const componentNames = ['App', 'Game', 'Main', 'Root', 'Component', 'Page', 'Widget', 'Dashboard', 'Demo', 'Example'];
      for (const name of componentNames) {
        if (typeof window[name] === 'function' || (typeof window[name] === 'object' && window[name]?.$$typeof)) {
          ComponentToRender = window[name];
          break;
        }
      }

      // If no common name found, look for any PascalCase function (React component convention)
      if (!ComponentToRender) {
        const globalKeys = Object.keys(window);
        for (const key of globalKeys) {
          if (/^[A-Z]/.test(key) && typeof window[key] === 'function') {
            ComponentToRender = window[key];
            break;
          }
        }
      }

      if (ComponentToRender) {
        ReactDOM.createRoot(document.getElementById('root')).render(
          React.createElement(ArtifactErrorBoundary, null,
            React.createElement(ComponentToRender)
          )
        );
      } else {
        document.getElementById('root').innerHTML =
          '<div class="artifact-error"><h4>No React Component Found</h4>' +
          'Define a component using one of these patterns:\\n\\n' +
          'const App = () => <div>Hello World</div>;\\n\\n' +
          'function Game() { return <div>Game</div>; }\\n\\n' +
          'Supported names: App, Game, Main, Root, Component, Page, Widget, Dashboard, Demo, Example\\n' +
          'Or any PascalCase function name.</div>';
      }
    } catch (error) {
      const name = error.name || 'Error';
      const message = error.message || 'Unknown';
      const stack = (error.stack || '').split('\\n').slice(0, 5).join('\\n');
      document.getElementById('root').innerHTML =
        '<div class="artifact-error"><h4>' + name + ': ' + message + '</h4>' +
        (stack ? '<div class="stack">Stack Trace:\\n' + stack + '</div>' : '') +
        '</div>';
      console.error(error);
    }
  </script>
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

// HTML template with optional dark mode, CSP, and safety harness
const HTML_TEMPLATE = (code: string, theme: string) => {
  // Detect which libraries the code needs
  const needsPlotly = code.includes('Plotly.') || code.includes('plotly');
  // d3.sankey() is a separate npm module (d3-sankey@0.12). Detect it
  // independently so we inject the extra lib. agentic-work/openagentic-omhs#329.
  const needsD3Sankey = /\bd3\.sankey\s*\(/.test(code) || /d3-sankey/i.test(code);
  const needsD3 = needsD3Sankey || (code.includes('d3.') && (code.includes('d3.select') || code.includes('d3.create')));
  const needsChartJS = code.includes('new Chart(') || code.includes('Chart.register');

  // Inject libraries from bundled runtime — works because iframe has allow-same-origin for chart artifacts
  const libScripts: string[] = [];
  if (needsPlotly) libScripts.push('<script src="/artifact-runtime/plotly-basic.min.js"></script>');
  if (needsD3) libScripts.push('<script src="/artifact-runtime/d3.min.js"></script>');
  if (needsD3Sankey) libScripts.push('<script src="/artifact-runtime/d3-sankey.min.js"></script>');
  if (needsChartJS) libScripts.push('<script src="/artifact-runtime/chart.min.js"></script>');

  const themeDefense = artifactThemeDefenseBlock(theme);

  // Check if code already has full HTML structure
  if (code.trim().toLowerCase().startsWith('<!doctype') || code.trim().toLowerCase().startsWith('<html')) {
    let html = code;
    // Strip ALL CDN script tags — replace with bundled inline versions
    html = html.replace(/<script[^>]*src=["'][^"']*(?:cdn\.plot\.ly|plotly)[^"']*["'][^>]*><\/script>/gi, '');
    html = html.replace(/<script[^>]*src=["'][^"']*d3js\.org[^"']*["'][^>]*><\/script>/gi, '');
    html = html.replace(/<script[^>]*src=["'][^"']*cdn\.jsdelivr\.net\/npm\/chart\.js[^"']*["'][^>]*><\/script>/gi, '');
    html = html.replace(/<script[^>]*src=["'][^"']*cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi, '');
    // Inject theme-defense + bundled libs into <head>. Theme defense goes
    // FIRST so any styles in the model's own <head> override it (the
    // defense uses :where() selectors with zero specificity). Previously
    // this path skipped theme wrapping entirely — full-HTML artifacts
    // inherited transparent bg / black text and became invisible on the
    // dark app chrome. See openagentic-omhs#327.
    const headInjection = [themeDefense, ...libScripts].join('\n');
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      html = html.replace(headMatch[0], `${headMatch[0]}\n${headInjection}`);
    } else {
      const htmlMatch = html.match(/<html[^>]*>/i);
      if (htmlMatch) {
        html = html.replace(
          htmlMatch[0],
          `${htmlMatch[0]}\n<head>\n${headInjection}\n</head>`,
        );
      } else {
        html = `${headInjection}\n${html}`;
      }
    }
    return html;
  }

  // Minimal wrapper — inject bundled libraries, no CDN dependencies.
  return `
<!DOCTYPE html>
<html data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META_LEGACY}
  ${themeDefense}
  ${libScripts.join('\n  ')}
  <style>
    * { box-sizing: border-box; }
  </style>
</head>
<body>
  ${code}
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;
};

// SVG template with CSP and safety harness
const SVG_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${ARTIFACT_CSP_META}
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
    }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  ${code}
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

// Mermaid diagram template with CSP and safety harness
const MERMAID_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META_LEGACY}
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    #mermaid-container {
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .mermaid {
      max-width: 100%;
    }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
      font-family: monospace;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="mermaid-container">
    <pre class="mermaid">
${code}
    </pre>
  </div>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: '${theme === 'dark' ? 'dark' : 'default'}',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      },
      sequence: {
        useMaxWidth: true
      },
      gantt: {
        useMaxWidth: true
      }
    });

    // Handle errors
    mermaid.parseError = function(err, hash) {
      document.getElementById('mermaid-container').innerHTML =
        '<div class="error">Mermaid Error: ' + err + '</div>';
    };
  </script>
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

// Chart.js template with CSP and safety harness
const CHART_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META_LEGACY}
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    #chart-container {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 300px;
    }
    canvas {
      max-width: 100%;
    }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div id="chart-container">
    <canvas id="chart"></canvas>
  </div>
  <script>
    try {
      Chart.defaults.color = '${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'}';
      Chart.defaults.borderColor = '${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}';

      const ctx = document.getElementById('chart').getContext('2d');
      const chartConfig = ${code};
      new Chart(ctx, chartConfig);
    } catch (error) {
      document.getElementById('chart-container').innerHTML =
        '<div class="error">Chart Error: ' + error.message + '</div>';
      console.error(error);
    }
  </script>
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

// Markdown template with marked.js, CSP and safety harness
const MARKDOWN_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META_LEGACY}
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-${theme === 'dark' ? 'dark' : 'light'}.min.css">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
    }
    .markdown-body {
      max-width: 100%;
      padding: 16px;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
    }
    .markdown-body pre {
      background: ${theme === 'dark' ? '#0d1117' : '#f6f8fa'};
    }
    .markdown-body code {
      background: ${theme === 'dark' ? '#161b22' : '#f6f8fa'};
    }
  </style>
</head>
<body>
  <div id="content" class="markdown-body"></div>
  <script>
    const content = ${JSON.stringify(code)};
    document.getElementById('content').innerHTML = marked.parse(content);
  </script>
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

// LaTeX/Math template with KaTeX, CSP and safety harness
const LATEX_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META_LEGACY}
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/contrib/auto-render.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
    }
    #math-container {
      text-align: center;
      font-size: 1.4em;
    }
    .katex { font-size: 1.2em; }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div id="math-container">${code}</div>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      try {
        renderMathInElement(document.getElementById("math-container"), {
          delimiters: [
            {left: "$$", right: "$$", display: true},
            {left: "$", right: "$", display: false},
            {left: "\\\\[", right: "\\\\]", display: true},
            {left: "\\\\(", right: "\\\\)", display: false}
          ],
          throwOnError: false
        });
      } catch (error) {
        document.getElementById('math-container').innerHTML =
          '<div class="error">LaTeX Error: ' + error.message + '</div>';
      }
    });
  </script>
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

// CSV table template with interactive editing, CSP and safety harness
const CSV_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META}
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    .table-container {
      overflow-x: auto;
      max-width: 100%;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 14px;
    }
    th, td {
      border: 1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'};
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: ${theme === 'dark' ? '#374151' : '#f3f4f6'};
      font-weight: 600;
      position: sticky;
      top: 0;
    }
    tr:nth-child(even) {
      background: ${theme === 'dark' ? '#1f2937' : '#f9fafb'};
    }
    tr:hover {
      background: ${theme === 'dark' ? '#2d3748' : '#f3f4f6'};
    }
    td[contenteditable="true"]:focus {
      outline: 2px solid #3b82f6;
      outline-offset: -2px;
    }
    .controls {
      margin-bottom: 12px;
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      background: #3b82f6;
      color: white;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover {
      background: #2563eb;
    }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="controls">
    <button onclick="addRow()">+ Add Row</button>
    <button onclick="exportCSV()">Export CSV</button>
  </div>
  <div class="table-container">
    <table id="data-table"></table>
  </div>
  <script>
    let data = [];
    const csvContent = ${JSON.stringify(code)};

    function parseCSV(csv) {
      const lines = csv.trim().split('\\n');
      return lines.map(line => {
        // Handle quoted fields with commas
        const result = [];
        let inQuotes = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      });
    }

    function renderTable() {
      const table = document.getElementById('data-table');
      if (data.length === 0) {
        table.innerHTML = '<tr><td>No data</td></tr>';
        return;
      }

      let html = '<thead><tr>';
      data[0].forEach((header, i) => {
        html += '<th contenteditable="true" data-row="0" data-col="' + i + '">' + header + '</th>';
      });
      html += '</tr></thead><tbody>';

      for (let i = 1; i < data.length; i++) {
        html += '<tr>';
        data[i].forEach((cell, j) => {
          html += '<td contenteditable="true" data-row="' + i + '" data-col="' + j + '">' + cell + '</td>';
        });
        html += '</tr>';
      }
      html += '</tbody>';
      table.innerHTML = html;

      // Add event listeners for edits
      table.querySelectorAll('[contenteditable]').forEach(cell => {
        cell.addEventListener('blur', function() {
          const row = parseInt(this.dataset.row);
          const col = parseInt(this.dataset.col);
          data[row][col] = this.textContent;
        });
      });
    }

    function addRow() {
      if (data.length === 0) return;
      const newRow = data[0].map(() => '');
      data.push(newRow);
      renderTable();
    }

    function exportCSV() {
      const csv = data.map(row => row.map(cell => {
        if (cell.includes(',') || cell.includes('"')) {
          return '"' + cell.replace(/"/g, '""') + '"';
        }
        return cell;
      }).join(',')).join('\\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    try {
      data = parseCSV(csvContent);
      renderTable();
    } catch (error) {
      document.querySelector('.table-container').innerHTML =
        '<div class="error">CSV Error: ' + error.message + '</div>';
    }
  </script>
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

// Canvas drawing template (simple Excalidraw-like) with CSP and safety harness
const CANVAS_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${ARTIFACT_CSP_META}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      overflow: hidden;
    }
    .toolbar {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 4px;
      padding: 8px;
      background: ${theme === 'dark' ? '#374151' : '#f3f4f6'};
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 100;
    }
    .toolbar button {
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    .toolbar button:hover {
      background: ${theme === 'dark' ? '#4b5563' : '#e5e7eb'};
    }
    .toolbar button.active {
      background: #3b82f6;
      color: white;
    }
    .color-picker {
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      padding: 4px;
    }
    canvas {
      cursor: crosshair;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="pen" class="active" title="Pen">✏️</button>
    <button id="line" title="Line">📏</button>
    <button id="rect" title="Rectangle">⬜</button>
    <button id="circle" title="Circle">⭕</button>
    <button id="text" title="Text">🔤</button>
    <button id="eraser" title="Eraser">🧹</button>
    <input type="color" class="color-picker" id="color" value="#3b82f6">
    <button id="clear" title="Clear">🗑️</button>
    <button id="save" title="Save">💾</button>
  </div>
  <canvas id="canvas"></canvas>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let tool = 'pen';
    let color = '#3b82f6';
    let startX, startY;
    let shapes = [];
    let currentPath = [];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
      redraw();
    }

    function redraw() {
      ctx.fillStyle = '${theme === 'dark' ? '#1a1a2e' : '#ffffff'}';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      shapes.forEach(shape => {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.lineWidth || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (shape.type === 'path') {
          ctx.beginPath();
          shape.points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        } else if (shape.type === 'line') {
          ctx.beginPath();
          ctx.moveTo(shape.x1, shape.y1);
          ctx.lineTo(shape.x2, shape.y2);
          ctx.stroke();
        } else if (shape.type === 'rect') {
          ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
        } else if (shape.type === 'circle') {
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
          ctx.stroke();
        } else if (shape.type === 'text') {
          ctx.fillStyle = shape.color;
          ctx.font = '16px sans-serif';
          ctx.fillText(shape.text, shape.x, shape.y);
        }
      });
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    canvas.addEventListener('mousedown', e => {
      isDrawing = true;
      const pos = getPos(e);
      startX = pos.x;
      startY = pos.y;

      if (tool === 'pen' || tool === 'eraser') {
        currentPath = [pos];
      } else if (tool === 'text') {
        const text = prompt('Enter text:');
        if (text) {
          shapes.push({ type: 'text', x: pos.x, y: pos.y, text, color });
          redraw();
        }
        isDrawing = false;
      }
    });

    canvas.addEventListener('mousemove', e => {
      if (!isDrawing) return;
      const pos = getPos(e);

      if (tool === 'pen') {
        currentPath.push(pos);
        redraw();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        currentPath.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      } else if (tool === 'eraser') {
        currentPath.push(pos);
        redraw();
        ctx.strokeStyle = '${theme === 'dark' ? '#1a1a2e' : '#ffffff'}';
        ctx.lineWidth = 20;
        ctx.beginPath();
        currentPath.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      } else {
        redraw();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        if (tool === 'line') {
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
        } else if (tool === 'rect') {
          ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
        } else if (tool === 'circle') {
          const r = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
          ctx.beginPath();
          ctx.arc(startX, startY, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    });

    canvas.addEventListener('mouseup', e => {
      if (!isDrawing) return;
      isDrawing = false;
      const pos = getPos(e);

      if (tool === 'pen') {
        shapes.push({ type: 'path', points: currentPath, color, lineWidth: 2 });
      } else if (tool === 'eraser') {
        shapes.push({ type: 'path', points: currentPath, color: '${theme === 'dark' ? '#1a1a2e' : '#ffffff'}', lineWidth: 20 });
      } else if (tool === 'line') {
        shapes.push({ type: 'line', x1: startX, y1: startY, x2: pos.x, y2: pos.y, color });
      } else if (tool === 'rect') {
        shapes.push({ type: 'rect', x: startX, y: startY, w: pos.x - startX, h: pos.y - startY, color });
      } else if (tool === 'circle') {
        const r = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
        shapes.push({ type: 'circle', x: startX, y: startY, r, color });
      }

      currentPath = [];
      redraw();
    });

    // Toolbar handlers
    document.querySelectorAll('.toolbar button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.id === 'clear') {
          shapes = [];
          redraw();
          return;
        }
        if (btn.id === 'save') {
          const link = document.createElement('a');
          link.download = 'drawing.png';
          link.href = canvas.toDataURL();
          link.click();
          return;
        }
        document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tool = btn.id;
      });
    });

    document.getElementById('color').addEventListener('change', e => {
      color = e.target.value;
    });

    // Load initial data if provided
    try {
      const initialData = ${code ? JSON.stringify(code) : 'null'};
      if (initialData && typeof initialData === 'object') {
        shapes = initialData.shapes || [];
      }
    } catch (e) {}

    window.addEventListener('resize', resize);
    resize();
  </script>
  ${ARTIFACT_SAFETY_HARNESS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>
`;

const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({
  code,
  type,
  title,
  theme = 'dark',
  className = '',
  onExpandToCanvas,
}) => {
  const [isRunning, setIsRunning] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false); // Default to showing PREVIEW (rendered iframe) for artifacts
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // OAT postMessage handler — proxies function calls from iframe to API
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      // CRITICAL: Only accept messages from OUR iframe
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (event.data?.type !== 'oat-execute') return;

      const { callId, functionId, args } = event.data;
      try {
        const token = localStorage.getItem('auth_token') || '';
        const response = await fetch(`/api/artifact-functions/${functionId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ args })
        });
        const result = await response.json();
        iframeRef.current?.contentWindow?.postMessage({
          type: 'oat-result', callId, success: true, result: result.result || result
        }, '*');
      } catch (error: any) {
        iframeRef.current?.contentWindow?.postMessage({
          type: 'oat-result', callId, success: false, error: error.message
        }, '*');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Wait for bundled libraries (Plotly, D3, Chart.js) to be fetched before rendering
  const libsReady = useLibsReady();

  // Generate blob URL for the iframe — re-generates when libs become available
  const generateBlobUrl = useMemo(() => {
    if (!libsReady) return null; // Don't render until libs are cached
    try {
      let html: string;
      switch (type) {
        case 'react':
          html = REACT_TEMPLATE(code, theme);
          break;
        case 'svg':
          html = SVG_TEMPLATE(code, theme);
          break;
        case 'mermaid':
          html = MERMAID_TEMPLATE(code, theme);
          break;
        case 'chart':
          html = CHART_TEMPLATE(code, theme);
          break;
        case 'markdown':
          html = MARKDOWN_TEMPLATE(code, theme);
          break;
        case 'latex':
          html = LATEX_TEMPLATE(code, theme);
          break;
        case 'csv':
          html = CSV_TEMPLATE(code, theme);
          break;
        case 'canvas':
          html = CANVAS_TEMPLATE(code, theme);
          break;
        case 'html':
        default:
          html = HTML_TEMPLATE(code, theme);
          break;
      }

      const blob = new Blob([html], { type: 'text/html' });
      return URL.createObjectURL(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate artifact');
      return null;
    }
  }, [code, type, theme, libsReady]);

  useEffect(() => {
    if (generateBlobUrl) {
      setBlobUrl(generateBlobUrl);
    }

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [generateBlobUrl]);

  const handleRefresh = () => {
    if (iframeRef.current && blobUrl) {
      iframeRef.current.src = blobUrl;
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleOpenExternal = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank');
    }
  };

  // Export/Download functionality
  const handleDownload = useCallback(() => {
    let filename: string;
    let content: string;
    let mimeType: string;

    switch (type) {
      case 'svg':
        filename = `${title || 'graphic'}.svg`;
        content = code;
        mimeType = 'image/svg+xml';
        break;
      case 'mermaid':
        filename = `${title || 'diagram'}.mmd`;
        content = code;
        mimeType = 'text/plain';
        break;
      case 'chart':
        filename = `${title || 'chart'}.json`;
        content = code;
        mimeType = 'application/json';
        break;
      case 'markdown':
        filename = `${title || 'document'}.md`;
        content = code;
        mimeType = 'text/markdown';
        break;
      case 'latex':
        filename = `${title || 'equation'}.tex`;
        content = code;
        mimeType = 'text/x-latex';
        break;
      case 'csv':
        filename = `${title || 'data'}.csv`;
        content = code;
        mimeType = 'text/csv';
        break;
      case 'react':
        filename = `${title || 'component'}.jsx`;
        content = code;
        mimeType = 'text/javascript';
        break;
      case 'html':
      default:
        filename = `${title || 'document'}.html`;
        content = code;
        mimeType = 'text/html';
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, type, title]);

  // Print functionality
  const handlePrint = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  }, []);

  // Share functionality (Web Share API)
  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || 'Artifact',
          text: code,
        });
      } catch (err) {
        // User cancelled or error
        console.log('Share cancelled');
      }
    } else {
      // Fallback: copy to clipboard
      await handleCopy();
    }
  }, [code, title, handleCopy]);

  const getTypeLabel = () => {
    switch (type) {
      case 'react': return 'React Component';
      case 'svg': return 'SVG Graphic';
      case 'html': return 'HTML';
      case 'mermaid': return 'Mermaid Diagram';
      case 'chart': return 'Chart';
      case 'markdown': return 'Markdown';
      case 'latex': return 'LaTeX Math';
      case 'csv': return 'Data Table';
      case 'canvas': return 'Canvas Drawing';
      default: return 'Artifact';
    }
  };

  const getTypeColor = () => {
    switch (type) {
      case 'react': return 'text-cyan-400 bg-cyan-500/10';
      case 'svg': return 'text-amber-400 bg-amber-500/10';
      case 'html': return 'text-orange-400 bg-orange-500/10';
      case 'mermaid': return 'text-indigo-400 bg-indigo-500/10';
      case 'chart': return 'text-green-400 bg-green-500/10';
      case 'markdown': return 'text-blue-400 bg-blue-500/10';
      case 'latex': return 'text-red-400 bg-red-500/10';
      case 'csv': return 'text-emerald-400 bg-emerald-500/10';
      case 'canvas': return 'text-pink-400 bg-pink-500/10';
      default: return 'text-gray-400 bg-gray-500/10';
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'react': return <FileCode size={14} />;
      case 'svg': return <Image size={14} />;
      case 'mermaid': return <GitBranch size={14} />;
      case 'chart': return <BarChart2 size={14} />;
      case 'markdown': return <FileText size={14} />;
      case 'csv': return <Database size={14} />;
      default: return <Code size={14} />;
    }
  };

  // Get syntax highlighting language for each artifact type
  const getLanguageForType = (): string => {
    switch (type) {
      case 'react': return 'tsx';
      case 'svg': return 'xml';
      case 'html': return 'html';
      case 'mermaid': return 'plaintext';
      case 'chart': return 'json';
      case 'markdown': return 'markdown';
      case 'latex': return 'latex';
      case 'csv': return 'plaintext';
      case 'canvas': return 'javascript';
      default: return 'plaintext';
    }
  };

  if (error) {
    return (
      <div className={`rounded-lg border border-red-500/30 bg-red-500/10 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-red-400 mb-2">
          <span className="font-medium">Artifact Error</span>
        </div>
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border/60 bg-bg-secondary overflow-hidden shadow-lg shadow-black/5 ${className}`}>
      {/* Professional Header - Technical Manual Style */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-gradient-to-r from-bg-tertiary to-bg-secondary">
        <div className="flex items-center gap-3">
          {/* Technical document badge */}
          <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-md border ${getTypeColor()} border-current/20`}>
            <span className="opacity-80">{getTypeIcon()}</span>
            <span className="tracking-wide uppercase">{getTypeLabel()}</span>
          </div>
          {title && (
            <span className="text-sm font-medium text-text-primary border-l border-border/40 pl-3 ml-1">
              {title}
            </span>
          )}
        </div>

        {/* Professional action buttons */}
        <div className="flex items-center gap-0.5 bg-bg-secondary/50 rounded-lg p-1 border border-border/30">
          {/* Toggle Code/Preview */}
          <button
            onClick={() => setShowCode(!showCode)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
              showCode
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'hover:bg-bg-hover text-text-muted hover:text-text-primary'
            }`}
            title={showCode ? 'Show Preview' : 'Show Code'}
          >
            {showCode ? (
              <>
                <Eye size={13} />
                <span className="hidden sm:inline">Preview</span>
              </>
            ) : (
              <>
                <Code size={13} />
                <span className="hidden sm:inline">Code</span>
              </>
            )}
          </button>

          <div className="w-px h-5 bg-border/40 mx-1" />

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md transition-all duration-150 hover:bg-bg-hover text-text-muted hover:text-text-primary hover:scale-105"
            title="Copy code"
          >
            {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            className="p-1.5 rounded-md transition-all duration-150 hover:bg-bg-hover text-text-muted hover:text-text-primary hover:scale-105"
            title="Download"
          >
            <Download size={15} />
          </button>

          {/* Print */}
          <button
            onClick={handlePrint}
            className="p-1.5 rounded-md transition-all duration-150 hover:bg-bg-hover text-text-muted hover:text-text-primary hover:scale-105"
            title="Print"
          >
            <Printer size={15} />
          </button>

          {/* Share */}
          <button
            onClick={handleShare}
            className="p-1.5 rounded-md transition-all duration-150 hover:bg-bg-hover text-text-muted hover:text-text-primary hover:scale-105"
            title="Share"
          >
            <Share2 size={15} />
          </button>

          <div className="w-px h-5 bg-border/40 mx-1" />

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-md transition-all duration-150 hover:bg-bg-hover text-text-muted hover:text-text-primary hover:scale-105"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>

          {/* Open in new tab */}
          <button
            onClick={handleOpenExternal}
            className="p-1.5 rounded-md transition-all duration-150 hover:bg-bg-hover text-text-muted hover:text-text-primary hover:scale-105"
            title="Open in new tab"
          >
            <ExternalLink size={15} />
          </button>

          {/* Open in Canvas — Gemini-style split pane */}
          <button
            onClick={() => {
              if (onExpandToCanvas) {
                const lang = type === 'html' ? 'html' : type === 'react' || type === 'tsx' ? 'tsx' : type === 'svg' ? 'svg' : type === 'markdown' ? 'md' : type;
                onExpandToCanvas(code, type, title || 'Artifact', lang);
              } else {
                // Dispatch global event for canvas panel (avoids prop drilling)
                window.dispatchEvent(new CustomEvent('openagentic:open-canvas', {
                  detail: {
                    content: code,
                    type,
                    title: title || 'Artifact',
                    language: type === 'html' ? 'html' : type === 'react' || type === 'tsx' ? 'tsx' : type === 'svg' ? 'svg' : type === 'markdown' ? 'md' : type,
                  }
                }));
              }
            }}
            className={`p-1.5 rounded-md transition-all duration-150 hover:scale-105 ${
              isExpanded
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-bg-hover text-text-muted hover:text-text-primary'
            }`}
            title={onExpandToCanvas ? 'Open in Canvas' : (isExpanded ? 'Collapse' : 'Expand')}
          >
            {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {showCode ? (
          <motion.div
            key="code"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`overflow-auto ${isExpanded ? 'max-h-[600px]' : 'max-h-[300px]'}`}
          >
            <ShikiCodeBlock
              code={code}
              language={getLanguageForType()}
              theme={theme}
              onCopy={handleCopy}
              copied={copied}
            />
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={isExpanded ? 'h-[600px]' : 'h-[300px]'}
          >
            {blobUrl && (
              <iframe
                ref={iframeRef}
                src={blobUrl}
                className="w-full h-full border-0"
                sandbox={`allow-scripts allow-modals allow-popups${
                  code.includes('Plotly.') || code.includes('d3.select') || code.includes('new Chart(')
                    ? ' allow-same-origin' : ''
                }`}
                title={title || 'Artifact Preview'}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ArtifactRenderer;
