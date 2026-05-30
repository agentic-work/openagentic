/**
 * Streaming Artifact Renderer
 *
 * Renders artifacts LIVE during SSE streaming, providing visual feedback
 * as the LLM generates the artifact content. Kills and recreates the iframe
 * on each debounced update to prevent memory accumulation during streaming.
 *
 * Safety harness:
 * - No allow-same-origin in sandbox (scripts only)
 * - CSP meta tag restricting resource origins
 * - 60-second execution timeout
 * - 5000 DOM node cap via MutationObserver
 * - Cleanup on unload for timers/observers
 * - Auto-resize via postMessage (works without same-origin)
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Maximize2, Minimize2, Copy, Check } from '@/shared/icons';
import { ArtifactType, getMinimumViableContent } from '../../utils/streamingArtifactDetector';

interface StreamingArtifactRendererProps {
  /** The partial artifact content being streamed */
  content: string;
  /** The type of artifact */
  type: ArtifactType;
  /** Current theme */
  theme: 'light' | 'dark';
  /** Whether the artifact is still streaming */
  isStreaming: boolean;
  /** Optional height override */
  height?: number;
}

// Debounce interval -- higher during streaming to reduce re-renders and glitching
// 800ms during streaming prevents partial-HTML parse errors in the iframe
const STREAMING_DEBOUNCE_MS = 800;
const FINAL_DEBOUNCE_MS = 50;

// Safety harness JS injected into ALL artifact iframes
const SAFETY_HARNESS_JS = `
<script>
// 5-minute execution timeout for streaming artifacts (generous for complex generation)
window.__ARTIFACT_TIMEOUT = setTimeout(function() {
  document.body.innerHTML = '<div style="padding:20px;color:#ef4444;font-family:system-ui"><h3>Execution Timeout</h3><p>Artifact exceeded 5 minute execution limit.</p></div>';
}, 300000);

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

// CSP meta tags for iframe security
// Locked-down CSP for artifacts that don't need CDN access
const CSP_META_STRICT = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';">`;
// Legacy CSP for artifacts that load from CDNs (react, latex, etc.)
// Cache for bundled library content (fetched once, then inlined into artifact srcdoc)
const _streamingLibCache: Record<string, string> = {};
let _streamingLibsReady = false;
const _streamingLibReadyCallbacks: Array<() => void> = [];

// Preload chart libraries immediately on module load
['plotly-basic.min.js', 'd3.min.js', 'd3-sankey.min.js', 'chart.min.js'].forEach(name => {
  fetch(`/artifact-runtime/${name}`)
    .then(r => r.ok ? r.text() : '')
    .then(text => { if (text.length > 100) _streamingLibCache[name] = text; })
    .catch(() => {});
});
// Mark ready after 3 seconds (all fetches should complete by then)
setTimeout(() => {
  _streamingLibsReady = true;
  _streamingLibReadyCallbacks.forEach(cb => cb());
  _streamingLibReadyCallbacks.length = 0;
}, 3000);

const CSP_META_LEGACY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://cdn.plot.ly https://d3js.org; style-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; img-src data: blob:; font-src data: https://cdn.jsdelivr.net;">`;
// OAT bridge script — injected into all artifact iframes for parent-frame function calls
const OAT_BRIDGE_SCRIPT = '<script>' +
  '(function(){var p={},c=0;window.addEventListener("message",function(e){if(e.data&&e.data.type==="oat-result"){var q=p[e.data.callId];if(q){delete p[e.data.callId];e.data.success?q.resolve(e.data.result):q.reject(new Error(e.data.error||"OAT call failed"))}}});window.ArtifactRuntime=window.ArtifactRuntime||{};window.ArtifactRuntime.oat=function(id,args){return new Promise(function(res,rej){var i=++c;p[i]={resolve:res,reject:rej};setTimeout(function(){if(p[i]){delete p[i];rej(new Error("OAT timeout"))}},30000);window.parent.postMessage({type:"oat-execute",callId:i,functionId:id,args:args||{}},"*")})};window.ArtifactRuntime.loadFont=function(){}})()' +
  '</script>';

/**
 * Build a theme-defensive base-style block that every artifact iframe
 * inherits. Uses the `:where()` selector (zero specificity) so any style
 * the LLM emits still wins — this only kicks in when the model forgot to
 * set a background/text color. Also exposes CSS custom properties
 * (`--app-bg`, `--app-text`, etc.) so models that know about them can
 * produce theme-consistent artifacts without guessing hex codes.
 *
 * Background (openagentic-your-deployment#327): when the model emitted a full HTML
 * doc with `body { font-family: Arial }` and no background, the iframe
 * rendered black text on a transparent bg, which sat over the dark app
 * chrome — the user literally could not see the artifact.
 */
function themeDefenseBlock(isDark: boolean): string {
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
:where(body) {
  padding: 16px;
  min-height: 100vh;
  box-sizing: border-box;
}
:where(table) { border-collapse: collapse; }
:where(a) { color: var(--app-accent); }

/* ─── ALWAYS-VISIBLE OVERRIDES (openagentic-your-deployment#330) ──────────────────
   Force visibility regardless of what the model emits. Models write
   Plotly / D3 / Chart.js charts with default text fills that are
   invisible against our dark chrome — these !important rules guarantee
   the user can always READ the artifact. Model-specified colors are
   intentionally overridden here because invisible-by-accident is worse
   than chart-style-mismatch.
   ──────────────────────────────────────────────────────────────────── */
html, body { background: var(--app-bg) !important; color: var(--app-text) !important; font-family: var(--app-font) !important; }
/* SVG: ALL text legible, axis lines visible */
svg text                                          { fill: var(--app-text) !important; }
svg .tick text, svg .axis text, svg .legendtext   { fill: var(--app-muted) !important; }
svg .domain, svg .tick line, svg .gridlayer line  { stroke: var(--app-border) !important; }
/* Plotly: paper + plot areas transparent so our bg shows */
.js-plotly-plot .plotly .bg, .js-plotly-plot rect.bg     { fill: transparent !important; }
.modebar, .modebar-group                                  { background: transparent !important; }
.modebar-btn path                                         { fill: var(--app-muted) !important; }
.modebar-btn:hover path                                   { fill: var(--app-text) !important; }
.legend rect.bg                                           { fill: var(--app-surface) !important; }
/* Chart.js canvas frame */
canvas { background: var(--app-surface) !important; border-radius: 6px; }
/* Plain table cells stay readable on dark chrome */
table th, table td { color: var(--app-text); border-color: var(--app-border); }
table th { background: var(--app-surface); }
</style>`;
}

// Generate HTML wrapper for artifact content
function wrapArtifactContent(content: string, type: ArtifactType, theme: 'light' | 'dark'): string {
  const isDark = theme === 'dark';
  const bgColor = isDark ? '#0d1117' : '#ffffff';
  const textColor = isDark ? '#e6edf3' : '#1f2328';
  const themeDefense = themeDefenseBlock(isDark);
  // For HTML type, check if user content has CDN URLs and use legacy CSP if so
  const htmlCsp = /https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdn\.tailwindcss\.com|fonts\.googleapis\.com|esm\.sh)/i.test(content)
    ? CSP_META_LEGACY : CSP_META_STRICT;

  switch (type) {
    case 'html': {
      // Detect chart libraries needed and inject from bundled runtime
      const needsPlotly = content.includes('Plotly.') || content.includes('plotly');
      // d3.sankey() is a separate npm module (d3-sankey@0.12). Detect its
      // use independently of plain d3 so we inject the extra lib.
      // agentic-work/openagentic-your-deployment#329.
      const needsD3Sankey = /\bd3\.sankey\s*\(/.test(content) || /d3-sankey/i.test(content);
      const needsD3 = needsD3Sankey || content.includes('d3.select') || content.includes('d3.create');
      const needsChart = content.includes('new Chart(');
      // Use legacy CSP if any libraries needed (allows CDN fallback)
      const effectiveCsp = (needsPlotly || needsD3 || needsChart) ? CSP_META_LEGACY : htmlCsp;
      // Inject bundled libs via <script src> — works because iframe has allow-same-origin for chart artifacts
      const libScripts: string[] = [];
      if (needsPlotly) libScripts.push('<script src="/artifact-runtime/plotly-basic.min.js"><\/script>');
      if (needsD3) libScripts.push('<script src="/artifact-runtime/d3.min.js"><\/script>');
      if (needsD3Sankey) libScripts.push('<script src="/artifact-runtime/d3-sankey.min.js"><\/script>');
      if (needsChart) libScripts.push('<script src="/artifact-runtime/chart.min.js"><\/script>');
      // Clean the content: strip artifact label, CDN script tags
      let cleanContent = content
        // Strip "artifact:html" label that gpt-oss sometimes prepends
        .replace(/^artifact:html\s*/i, '')
        // Strip CDN script tags (avoid double-loading, use bundled instead)
        .replace(/<script[^>]*src=["'][^"']*(?:cdn\.plot\.ly|plotly)[^"']*["'][^>]*><\/script>/gi, '')
        .replace(/<script[^>]*src=["'][^"']*d3js\.org[^"']*["'][^>]*><\/script>/gi, '')
        .replace(/<script[^>]*src=["'][^"']*cdn\.jsdelivr\.net\/npm\/chart\.js[^"']*["'][^>]*><\/script>/gi, '')
        .replace(/<script[^>]*src=["'][^"']*cdn\.tailwindcss\.com[^"']*["'][^>]*><\/script>/gi, '');

      // If content is a full HTML document, inject libs AND the theme-
      // defense block into <head> and return. Previously the passthrough
      // skipped all theme wrapping, so any full-HTML artifact that didn't
      // set its own background rendered as transparent black-on-dark and
      // was invisible against the dark app chrome. See openagentic-your-deployment#327.
      const trimmed = cleanContent.trim().toLowerCase();
      if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
        const headInjection = [themeDefense, ...libScripts].join('\n');
        const headMatch = cleanContent.match(/<head[^>]*>/i);
        if (headMatch) {
          cleanContent = cleanContent.replace(headMatch[0], `${headMatch[0]}\n${headInjection}`);
        } else {
          // Model emitted <html>...</html> without a <head>; splice one in
          // right after the opening <html> so our defense lands inside it.
          const htmlMatch = cleanContent.match(/<html[^>]*>/i);
          if (htmlMatch) {
            cleanContent = cleanContent.replace(
              htmlMatch[0],
              `${htmlMatch[0]}\n<head>\n${headInjection}\n</head>`,
            );
          } else {
            cleanContent = `${headInjection}\n${cleanContent}`;
          }
        }
        return cleanContent;
      }
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${effectiveCsp}
  ${themeDefense}
  ${libScripts.join('\n  ')}
  <style>
    * { box-sizing: border-box; }
  </style>
</head>
<body>${cleanContent}${SAFETY_HARNESS_JS}${OAT_BRIDGE_SCRIPT}</body>
</html>`;
    }

    case 'svg':
      const viableSvg = getMinimumViableContent('svg', content);
      return `<!DOCTYPE html>
<html>
<head>
  ${CSP_META_STRICT}
  ${themeDefense}
  <style>
    :where(body) {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>${viableSvg}${SAFETY_HARNESS_JS}${OAT_BRIDGE_SCRIPT}</body>
</html>`;

    case 'latex':
      return `<!DOCTYPE html>
<html>
<head>
  ${CSP_META_LEGACY}
  ${themeDefense}
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <style>
    :where(body) {
      display: flex;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div id="math"></div>
  <script>
    try {
      katex.render(\`${content.replace(/`/g, '\\`')}\`, document.getElementById('math'), { displayMode: true });
    } catch (e) {
      document.getElementById('math').textContent = 'Rendering...';
    }
  </script>
  ${SAFETY_HARNESS_JS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>`;

    case 'csv':
      const rows = content.trim().split('\n').map(row => row.split(','));
      const tableHtml = `<table style="border-collapse: collapse; width: 100%;">
        ${rows.map((row, i) => `<tr>${row.map(cell =>
          `<${i === 0 ? 'th' : 'td'} style="border: 1px solid var(--app-border); padding: 8px;">${cell.trim()}</${i === 0 ? 'th' : 'td'}>`
        ).join('')}</tr>`).join('')}
      </table>`;
      return `<!DOCTYPE html>
<html>
<head>
  ${CSP_META_STRICT}
  ${themeDefense}
  <style>
    th { background: var(--app-surface); }
  </style>
</head>
<body>${tableHtml}${SAFETY_HARNESS_JS}${OAT_BRIDGE_SCRIPT}</body>
</html>`;

    case 'react':
    case 'tsx': {
      // Escape backticks and ${} in user content to prevent template literal injection
      const safeContent = content.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${CSP_META_LEGACY}
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18",
      "react-dom": "https://esm.sh/react-dom@18",
      "react-dom/client": "https://esm.sh/react-dom@18/client",
      "sucrase": "https://esm.sh/sucrase@3"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${bgColor};
      color: ${textColor};
    }
    #root { padding: 16px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error" style="display:none;padding:20px;color:#ef4444;font-family:system-ui"></div>
  <script type="module">
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { transform } from 'sucrase';

    const code = \`${safeContent}\`;

    try {
      // Transpile TSX/JSX to plain JS
      const result = transform(code, {
        transforms: ['typescript', 'jsx'],
        jsxRuntime: 'classic',
        jsxPragma: 'React.createElement',
        jsxFragmentPragma: 'React.Fragment',
        production: true,
      });

      // Create a module from transpiled code
      const moduleCode = result.code;

      // Wrap in a function that provides React in scope
      const fn = new Function('React', 'module', 'exports', moduleCode);
      const moduleObj = { exports: {} };
      fn(React, moduleObj, moduleObj.exports);

      // Find the default export (the component)
      const Component = moduleObj.exports.default || moduleObj.exports;

      if (typeof Component === 'function') {
        const root = createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
      } else {
        document.getElementById('error').style.display = 'block';
        document.getElementById('error').innerHTML = '<h3>No Component Found</h3><p>Artifact must export a default React component.</p>';
      }
    } catch (err) {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').innerHTML = '<h3>' + (err.name || 'Error') + '</h3><pre>' + err.message + '</pre>';
    }
  </script>
  ${SAFETY_HARNESS_JS}
  ${OAT_BRIDGE_SCRIPT}
</body>
</html>`;
    }

    default:
      return `<!DOCTYPE html>
<html>
<head>${CSP_META_STRICT}<style>body { margin: 0; padding: 16px; background: ${bgColor}; color: ${textColor}; }</style></head>
<body><pre>${content}</pre>${SAFETY_HARNESS_JS}${OAT_BRIDGE_SCRIPT}</body>
</html>`;
  }
}

const StreamingArtifactRenderer: React.FC<StreamingArtifactRendererProps> = ({
  content,
  type,
  theme,
  isStreaming,
  height = 300,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUpdateRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const iframeKeyRef = useRef(0);
  contentRef.current = content;

  // UX state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dynamicHeight, setDynamicHeight] = useState<number | null>(null);

  // Track when bundled libs are ready — re-render iframe when they load
  const [libsLoaded, setLibsLoaded] = useState(_streamingLibsReady);
  useEffect(() => {
    if (_streamingLibsReady) { setLibsLoaded(true); return; }
    const cb = () => setLibsLoaded(true);
    _streamingLibReadyCallbacks.push(cb);
    return () => {
      const idx = _streamingLibReadyCallbacks.indexOf(cb);
      if (idx >= 0) _streamingLibReadyCallbacks.splice(idx, 1);
    };
  }, []);

  // Listen for postMessage resize events from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'artifact-resize' && typeof event.data.height === 'number') {
        // Only apply if the resize comes from our iframe context
        if (event.data.height > 0 && event.data.height < 5000) {
          setDynamicHeight(Math.max(event.data.height + 20, 100));
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Kill and recreate iframe on each debounced update to prevent memory accumulation
  const updateIframe = useCallback(() => {
    if (!containerRef.current) return;

    // Remove old iframe if any
    const oldIframe = containerRef.current.querySelector('iframe');
    if (oldIframe) {
      oldIframe.remove();
    }

    // Create fresh iframe
    const iframe = document.createElement('iframe');
    iframe.title = `Streaming ${type} artifact`;
    iframe.className = 'w-full h-full border-0';
    iframe.sandbox.add('allow-scripts');

    const currentContent = contentRef.current;
    // For HTML artifacts that reference chart libraries, add allow-same-origin
    // so the iframe can load bundled libs from /artifact-runtime/
    const needsLibs = type === 'html' && (
      currentContent.includes('Plotly.') || currentContent.includes('d3.select') ||
      currentContent.includes('new Chart(') || currentContent.includes('plotly')
    );
    if (needsLibs) {
      iframe.sandbox.add('allow-same-origin');
    }

    const html = wrapArtifactContent(currentContent, type, theme);
    iframe.srcdoc = html;

    iframeKeyRef.current++;
    containerRef.current.appendChild(iframe);

    lastUpdateRef.current = Date.now();
  }, [type, theme]);

  useEffect(() => {
    const debounceMs = isStreaming ? STREAMING_DEBOUNCE_MS : FINAL_DEBOUNCE_MS;
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (timeSinceLastUpdate >= debounceMs) {
      updateIframe();
    } else {
      timerRef.current = setTimeout(updateIframe, debounceMs - timeSinceLastUpdate);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, isStreaming, updateIframe, libsLoaded]);

  // Final update when streaming completes
  useEffect(() => {
    if (!isStreaming) {
      const t = setTimeout(updateIframe, FINAL_DEBOUNCE_MS);
      return () => clearTimeout(t);
    }
  }, [isStreaming, updateIframe]);

  // Escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // Copy source code (without showing it inline)
  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy artifact source:', err);
    }
  }, [content]);

  const effectiveHeight = dynamicHeight && !isStreaming ? Math.min(dynamicHeight, 600) : height;

  // During streaming, show an animated artifact creation indicator
  if (isStreaming) {
    const sizeKB = Math.round(content.length / 1024);
    const typeLabel = type === 'html' ? 'HTML' : type === 'react' ? 'React' : type === 'svg' ? 'SVG' : type.toUpperCase();
    const typeIcon = type === 'html' ? '🌐' : type === 'react' ? '⚛️' : type === 'svg' ? '🎨' : '📄';
    return (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative rounded-xl overflow-hidden"
        style={{
          background: theme === 'dark'
            ? 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.08) 50%, rgba(236,72,153,0.08) 100%)'
            : 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(168,85,247,0.06) 50%, rgba(236,72,153,0.06) 100%)',
          border: `1px solid ${theme === 'dark' ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.2)'}`,
        }}
        data-testid="streaming-artifact"
      >
        {/* Animated gradient border effect */}
        <div
          className="absolute inset-0 rounded-xl"
          style={{
            background: `linear-gradient(90deg, transparent, ${theme === 'dark' ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.1)'}, transparent)`,
            animation: 'shimmer 2s ease-in-out infinite',
          }}
        />
        <style>{`@keyframes shimmer { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>

        <div className="relative flex items-center gap-3 px-4 py-3">
          {/* Type icon with pulse */}
          <div className="relative flex-shrink-0">
            <span className="text-lg">{typeIcon}</span>
            <span
              className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full animate-pulse"
              style={{ background: '#8b5cf6' }}
            />
          </div>

          {/* Info */}
          <div className="flex flex-col min-w-0">
            <span style={{ color: theme === 'dark' ? '#c4b5fd' : '#7c3aed', fontSize: 13, fontWeight: 600 }}>
              Creating {typeLabel} Artifact
            </span>
            <span style={{ color: theme === 'dark' ? '#9ca3af' : '#6b7280', fontSize: 11 }}>
              {sizeKB > 0 ? `${sizeKB}KB generated` : 'Starting...'} — streaming live
            </span>
          </div>

          {/* Progress bar */}
          <div className="ml-auto flex items-center gap-2">
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ width: 60, background: theme === 'dark' ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.15)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: '100%',
                  background: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
                  animation: 'progress-pulse 1.5s ease-in-out infinite',
                }}
              />
              <style>{`@keyframes progress-pulse { 0%,100% { transform: scaleX(0.3); transform-origin: left; } 50% { transform: scaleX(1); } }`}</style>
            </div>
            <button
              onClick={handleCopyCode}
              className="p-1.5 rounded-md transition-all duration-150 hover:scale-105"
              style={{ background: 'rgba(139,92,246,0.1)', color: theme === 'dark' ? '#c4b5fd' : '#7c3aed', border: `1px solid ${theme === 'dark' ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.2)'}` }}
              title="Copy source code"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  const artifactContent = (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-lg overflow-hidden border ${isFullscreen ? 'fixed inset-4 z-[9998] rounded-xl shadow-2xl' : ''}`}
      style={{
        height: isFullscreen ? undefined : effectiveHeight,
        borderColor: 'var(--color-border)',
        background: theme === 'dark' ? '#1a1a2e' : '#ffffff',
      }}
      data-testid="artifact-complete"
    >
      {/* Toolbar row */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {/* Copy Code button */}
        <button
          onClick={handleCopyCode}
          className="p-1.5 rounded-md transition-all duration-150 hover:scale-105"
          style={{
            background: 'rgba(var(--color-primary-rgb), 0.1)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
          title="Copy source code"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>

        {/* Fullscreen button */}
        <button
          onClick={() => setIsFullscreen(prev => !prev)}
          className="p-1.5 rounded-md transition-all duration-150 hover:scale-105"
          style={{
            background: 'rgba(var(--color-primary-rgb), 0.1)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Iframe container -- iframes are created/destroyed imperatively */}
      <div ref={containerRef} className="w-full h-full" />
    </motion.div>
  );

  // When fullscreen, render a backdrop overlay via portal
  if (isFullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[9997] bg-black/80" onClick={() => setIsFullscreen(false)}>
        <div onClick={(e) => e.stopPropagation()}>
          {artifactContent}
        </div>
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] text-white/60 text-sm">
          Press ESC or click backdrop to close
        </div>
      </div>,
      document.body
    );
  }

  return artifactContent;
};

export default React.memo(StreamingArtifactRenderer);
