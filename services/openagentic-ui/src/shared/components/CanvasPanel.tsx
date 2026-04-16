/**
 * CanvasPanel — Gemini-style artifact canvas with Code | Preview toggle
 *
 * Features:
 * - Split-pane slide-out from right (60vw default, maximizable)
 * - Code view with syntax highlighting + line numbers
 * - Live Preview in sandboxed iframe (HTML/React/SVG/Markdown)
 * - GhostPilot integration: AI can screenshot the preview via /api/canvas/screenshot
 * - Toolbar: title, save, undo/redo, download, share, maximize, close
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Maximize2, Minimize2, FileCode, Eye, Download, Play, Copy, Check,
  Share2, RotateCcw, Save, ExternalLink
} from '@/shared/icons';
import { useShiki } from '@/features/chat/hooks/useShiki';

// ============================================================================
// Types
// ============================================================================

export interface CanvasContent {
  id: string;
  type: 'code' | 'html' | 'react' | 'svg' | 'markdown' | 'visualization' | 'tool-output' | 'mcp-result';
  title: string;
  content: any;
  language?: string;
  timestamp: string;
}

interface CanvasPanelProps {
  isOpen: boolean;
  onClose: () => void;
  content: CanvasContent | null;
  theme: 'light' | 'dark';
  onExecute?: (code: string, language: string) => void;
  onSave?: (content: CanvasContent) => void;
}

// OAT bridge script — injected into all artifact iframes for parent-frame function calls
const OAT_BRIDGE_SCRIPT = '<script>' +
  '(function(){var p={},c=0;window.addEventListener("message",function(e){if(e.data&&e.data.type==="oat-result"){var q=p[e.data.callId];if(q){delete p[e.data.callId];e.data.success?q.resolve(e.data.result):q.reject(new Error(e.data.error||"OAT call failed"))}}});window.ArtifactRuntime=window.ArtifactRuntime||{};window.ArtifactRuntime.oat=function(id,args){return new Promise(function(res,rej){var i=++c;p[i]={resolve:res,reject:rej};setTimeout(function(){if(p[i]){delete p[i];rej(new Error("OAT timeout"))}},30000);window.parent.postMessage({type:"oat-execute",callId:i,functionId:id,args:args||{}},"*")})};window.ArtifactRuntime.loadFont=function(){}})()' +
  '</script>';

// ============================================================================
// Preview HTML builder — wraps content in a complete HTML document
// ============================================================================

/**
 * Theme-defensive base-style block injected into every artifact iframe.
 * Uses `:where()` (zero specificity) so any style the LLM emits still wins
 * — this only kicks in when the model forgot to set a background / text
 * color. Also exposes CSS custom properties (`--app-bg`, `--app-text`...)
 * so well-behaved models can produce theme-consistent output.
 *
 * openagentic-omhs#327: the full-HTML passthrough below used to return the
 * model's raw output with zero wrapping, so a model that emitted
 * `body { font: Arial }` with no background rendered transparent / black
 * text — completely invisible on the dark app chrome.
 */
function canvasThemeDefenseBlock(isDark: boolean): string {
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

/**
 * Splice a payload into the <head> of a full HTML doc. If the doc has no
 * <head>, fabricate one inside the <html> tag. Last-resort: prepend.
 */
function injectIntoHead(html: string, payload: string): string {
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    return html.replace(headMatch[0], `${headMatch[0]}\n${payload}`);
  }
  const htmlMatch = html.match(/<html[^>]*>/i);
  if (htmlMatch) {
    return html.replace(htmlMatch[0], `${htmlMatch[0]}\n<head>\n${payload}\n</head>`);
  }
  return `${payload}\n${html}`;
}

function buildPreviewHTML(content: CanvasContent, theme: 'light' | 'dark'): string {
  const raw = typeof content.content === 'string' ? content.content : JSON.stringify(content.content, null, 2);
  const isDark = theme === 'dark';
  const bg = isDark ? '#0d1117' : '#ffffff';
  const fg = isDark ? '#e6edf3' : '#1f2328';
  const themeDefense = canvasThemeDefenseBlock(isDark);

  // Legacy CDN detection — artifacts with CDN URLs get permissive CSP, new ones get locked down
  const hasCDNUrls = /https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdn\.tailwindcss\.com|fonts\.googleapis\.com|esm\.sh)/i.test(raw);
  const cspMeta = hasCDNUrls
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; img-src data: blob:; font-src data: https://cdn.jsdelivr.net;">`
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';">`;

  // Legacy CSP for templates that always load CDNs
  const legacyCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; img-src data: blob:; font-src data: https://cdn.jsdelivr.net;">`;

  // For React/TSX: wrap in a simple React runtime
  if (content.type === 'react' || content.language === 'tsx' || content.language === 'jsx') {
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${legacyCsp}
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<!-- Recharts and lucide-react UMD builds are broken — omitted -->
<style>
  body { margin: 0; background: ${bg}; color: ${fg}; font-family: system-ui, sans-serif; }
  #root { min-height: 100vh; }
</style>
</head><body>
<div id="root"></div>
<script type="text/babel" data-presets="react,typescript">
const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext, memo, forwardRef, lazy, Suspense, Fragment } = React;
// Provide common icon stubs
const iconStub = (props) => React.createElement('span', props, '●');
// Track the last defined component for export default detection
var __LAST_COMPONENT__ = null;
var __EXPORT_DEFAULT__ = null;
${raw.replace(/export\s+default\s+function\s+(\w+)/g, 'function $1').replace(/export\s+default\s+(\w+)\s*;?/g, '__EXPORT_DEFAULT__ = $1;').replace(/export\s+function\s+(\w+)/g, 'function $1').replace(/export\s+const\s+(\w+)/g, 'const $1')}
// Find and render the component
try {
  let ComponentToRender = __EXPORT_DEFAULT__ || null;
  if (!ComponentToRender) {
    // Check common component names
    const names = ['App','Game','Main','Root','Dashboard','Component','Page','Widget','Demo','Example','Tracker','Chart','Table','View','Panel','Layout'];
    for (const name of names) {
      if (typeof window[name] === 'function') { ComponentToRender = window[name]; break; }
    }
  }
  // If none found, look for any PascalCase function defined in this scope
  if (!ComponentToRender) {
    for (const key of Object.keys(window)) {
      if (/^[A-Z][a-z]/.test(key) && typeof window[key] === 'function' && !['React','ReactDOM','Babel','Set','Map','Promise','Proxy','Reflect','Symbol','WeakMap','WeakSet','Error','Array','Object','String','Number','Boolean','Date','RegExp','Function','JSON','Math','Intl','URL','URLSearchParams','FormData','Headers','Request','Response','Blob','File','FileReader','FileList','DOMParser','XMLSerializer','Event','CustomEvent','MutationObserver','ResizeObserver','IntersectionObserver','PerformanceObserver','MediaQueryList','AbortController','TextEncoder','TextDecoder','ReadableStream','WritableStream','TransformStream','Notification','Worker','SharedWorker','ServiceWorker','WebSocket','EventSource','XMLHttpRequest','Image','Audio','Video','Canvas','SVGElement','HTMLElement','Node','Document','Window','Navigator','Location','History','Screen','Storage','Console','Performance','Crypto'].includes(key)) {
        ComponentToRender = window[key];
        break;
      }
    }
  }
  if (ComponentToRender) {
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ComponentToRender));
  } else {
    document.getElementById('root').innerHTML = '<pre style="color:#f97316;padding:20px">No React component found. The code may use import/export syntax that needs conversion.</pre>';
  }
} catch(e) {
  document.getElementById('root').innerHTML = '<pre style="color:red;padding:20px">Error: '+e.message+'</pre>';
}
</script>
${OAT_BRIDGE_SCRIPT}
</body></html>`;
  }

  // For HTML: use as-is (or wrap minimally)
  if (content.type === 'html' || content.language === 'html') {
    // If it's a full document (has <html> or <!DOCTYPE>), inject the
    // theme defense + OAT bridge into the head and return. Previously the
    // passthrough returned the model's raw output verbatim, which meant
    // any artifact missing an explicit background rendered invisible on
    // the dark app chrome. See openagentic-omhs#327.
    if (raw.includes('<html') || raw.includes('<!DOCTYPE') || raw.includes('<!doctype')) {
      const withDefense = injectIntoHead(raw, themeDefense);
      // OAT bridge at end of body so child scripts can use it.
      const bodyEndMatch = withDefense.match(/<\/body>/i);
      if (bodyEndMatch) {
        return withDefense.replace(bodyEndMatch[0], `${OAT_BRIDGE_SCRIPT}\n${bodyEndMatch[0]}`);
      }
      return `${withDefense}\n${OAT_BRIDGE_SCRIPT}`;
    }
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${cspMeta}
${themeDefense}
${hasCDNUrls ? '<script src="https://cdn.tailwindcss.com"></script>' : ''}
</head><body>${raw}${OAT_BRIDGE_SCRIPT}</body></html>`;
  }

  // For SVG
  if (content.type === 'svg' || content.language === 'svg') {
    const svgCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';">`;
    return `<!DOCTYPE html>
<html><head>${svgCsp}<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:${bg}}</style></head>
<body>${raw}${OAT_BRIDGE_SCRIPT}</body></html>`;
  }

  // For Markdown: basic render
  if (content.type === 'markdown' || content.language === 'markdown' || content.language === 'md') {
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
${legacyCsp}
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
body{margin:0;padding:32px;background:${bg};color:${fg};font-family:system-ui,sans-serif;max-width:740px;margin:0 auto;line-height:1.7}
h1,h2,h3{color:${isDark ? '#58a6ff' : '#0969da'}}
code{background:${isDark ? '#2a2a2e' : '#f0f0f0'};padding:2px 6px;border-radius:4px;font-size:0.9em}
pre{background:${isDark ? '#1e1e21' : '#f6f8fa'};padding:16px;border-radius:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%}
th,td{padding:12px 16px;border-bottom:1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'};text-align:left}
th{font-weight:600;border-bottom-width:2px}
</style>
</head><body>
<div id="content"></div>
<script>document.getElementById('content').innerHTML = marked.parse(${JSON.stringify(raw)});</script>
${OAT_BRIDGE_SCRIPT}
</body></html>`;
  }

  // Fallback: wrap in pre
  const fallbackCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';">`;
  return `<!DOCTYPE html>
<html><head>${fallbackCsp}<style>body{margin:0;padding:24px;background:${bg};color:${fg};font-family:monospace}</style></head>
<body><pre>${raw.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>${OAT_BRIDGE_SCRIPT}</body></html>`;
}

// ============================================================================
// Helper: detect if content is previewable
// ============================================================================

function isPreviewable(content: CanvasContent | null): boolean {
  if (!content) return false;
  const { type, language } = content;
  return ['html', 'react', 'svg', 'markdown'].includes(type) ||
    ['html', 'tsx', 'jsx', 'svg', 'md', 'markdown'].includes(language || '');
}

// ============================================================================
// Component
// ============================================================================

const CanvasPanel: React.FC<CanvasPanelProps> = ({
  isOpen,
  onClose,
  content,
  theme,
  onExecute,
  onSave,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeView, setActiveView] = useState<'code' | 'preview'>('preview');
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { highlighter, isLoading } = useShiki();

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

  const panelWidth = isMaximized ? '100vw' : '60vw';
  const canPreview = isPreviewable(content);

  // Default to preview if previewable, code otherwise
  useEffect(() => {
    if (content) {
      setActiveView(canPreview ? 'preview' : 'code');
    }
  }, [content?.id, canPreview]);

  // Generate syntax-highlighted HTML
  useEffect(() => {
    if (!content || !highlighter || isLoading) return;
    const raw = typeof content.content === 'string' ? content.content : JSON.stringify(content.content, null, 2);
    const lang = content.language || 'text';
    try {
      const html = highlighter.codeToHtml(raw, {
        lang: lang === 'tsx' ? 'tsx' : lang === 'jsx' ? 'jsx' : lang,
        theme: theme === 'dark' ? 'github-dark' : 'github-light'
      });
      setHighlightedHtml(html);
    } catch {
      setHighlightedHtml(`<pre><code>${escapeHtml(raw)}</code></pre>`);
    }
  }, [content, highlighter, isLoading, theme]);

  // Expose preview screenshot for GhostPilot / AI vision
  useEffect(() => {
    if (!isOpen || !content) return;
    // Register a global function that GhostPilot can call to get canvas state
    (window as any).__canvasPanel = {
      getContent: () => ({
        id: content.id,
        type: content.type,
        title: content.title,
        language: content.language,
        activeView,
        contentLength: typeof content.content === 'string' ? content.content.length : 0,
      }),
      getPreviewElement: () => iframeRef.current,
    };
    return () => { delete (window as any).__canvasPanel; };
  }, [isOpen, content, activeView]);

  const escapeHtml = (unsafe: string): string =>
    unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const handleCopy = useCallback(() => {
    if (!content) return;
    const raw = typeof content.content === 'string' ? content.content : JSON.stringify(content.content, null, 2);
    navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleDownload = useCallback(() => {
    if (!content) return;
    const raw = typeof content.content === 'string' ? content.content : JSON.stringify(content.content, null, 2);
    const ext = content.language || (content.type === 'html' ? 'html' : content.type === 'react' ? 'tsx' : 'txt');
    const blob = new Blob([raw], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${content.title.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [content]);

  const handleOpenExternal = useCallback(() => {
    if (!content) return;
    const html = buildPreviewHTML(content, theme);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }, [content, theme]);

  const previewSrcDoc = useMemo(() => {
    if (!content || !canPreview) return '';
    return buildPreviewHTML(content, theme);
  }, [content, theme, canPreview]);

  const codeLines = useMemo(() => {
    if (!content) return [];
    const raw = typeof content.content === 'string' ? content.content : JSON.stringify(content.content, null, 2);
    return raw.split('\n');
  }, [content]);

  if (!content) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — click to close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-0 right-0 z-50 flex flex-col"
            style={{
              width: panelWidth,
              height: '100vh',
              background: 'var(--color-surface)',
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            {/* ─── Toolbar ─── */}
            <div
              className="flex items-center justify-between px-4 h-12 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              {/* Left: title + type badge */}
              <div className="flex items-center gap-3 min-w-0">
                <FileCode size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {content.title}
                </span>
                {content.language && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--color-surfaceSecondary)', color: 'var(--text-secondary)' }}
                  >
                    {content.language}
                  </span>
                )}
              </div>

              {/* Center: Code | Preview toggle */}
              <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <button
                  onClick={() => setActiveView('code')}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors"
                  style={{
                    background: activeView === 'code' ? 'var(--color-primary)' : 'transparent',
                    color: activeView === 'code' ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  <FileCode size={13} />
                  Code
                </button>
                {canPreview && (
                  <button
                    onClick={() => setActiveView('preview')}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: activeView === 'preview' ? 'var(--color-primary)' : 'transparent',
                      color: activeView === 'preview' ? '#fff' : 'var(--text-secondary)',
                      borderLeft: '1px solid var(--color-border)',
                    }}
                  >
                    <Eye size={13} />
                    Preview
                  </button>
                )}
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-1">
                {/* Copy */}
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                  title="Copy code"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
                </button>

                {/* Download */}
                <button
                  onClick={handleDownload}
                  className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                  title="Download"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Download size={15} />
                </button>

                {/* Open in new tab */}
                {canPreview && (
                  <button
                    onClick={handleOpenExternal}
                    className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                    title="Open in new tab"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <ExternalLink size={15} />
                  </button>
                )}

                {/* Execute (for runnable code) */}
                {onExecute && content.type === 'code' && content.language &&
                  ['python', 'javascript', 'typescript', 'bash'].includes(content.language) && (
                  <button
                    onClick={() => onExecute(content.content, content.language!)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors"
                    style={{ background: 'var(--color-success)', color: '#fff' }}
                    title="Execute code"
                  >
                    <Play size={12} />
                    Run
                  </button>
                )}

                {/* Save to Knowledge Base */}
                {onSave && (
                  <button
                    onClick={() => onSave(content)}
                    className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                    title="Save to Knowledge Base"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Save size={15} />
                  </button>
                )}

                {/* Maximize */}
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                  title={isMaximized ? 'Restore' : 'Maximize'}
                  style={{ color: 'var(--text-muted)' }}
                >
                  {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>

                {/* Close */}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md transition-colors hover:bg-white/5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* ─── Content area ─── */}
            <div className="flex-1 overflow-hidden">
              {activeView === 'code' ? (
                /* ─── Code View ─── */
                <div className="h-full overflow-auto" style={{ background: theme === 'dark' ? '#1a1b26' : '#fafbfc' }}>
                  {highlightedHtml && !isLoading ? (
                    <div className="flex h-full">
                      {/* Line numbers */}
                      <div
                        className="flex-shrink-0 select-none text-right pr-3 pt-4 pb-4 pl-3"
                        style={{
                          color: theme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)',
                          fontSize: '13px',
                          lineHeight: '1.5rem',
                          fontFamily: 'var(--font-mono)',
                          borderRight: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'}`,
                          minWidth: '48px',
                        }}
                      >
                        {codeLines.map((_, i) => (
                          <div key={i}>{i + 1}</div>
                        ))}
                      </div>
                      {/* Highlighted code */}
                      <div
                        className="flex-1 overflow-x-auto p-4 shiki-canvas-code"
                        style={{ fontSize: '13px', lineHeight: '1.5rem' }}
                        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                      />
                    </div>
                  ) : (
                    <pre
                      className="p-4 text-sm leading-relaxed overflow-auto h-full m-0"
                      style={{
                        color: theme === 'dark' ? '#e8e8ed' : '#1a1a1a',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <code>{typeof content.content === 'string' ? content.content : JSON.stringify(content.content, null, 2)}</code>
                    </pre>
                  )}
                </div>
              ) : (
                /* ─── Preview View ─── */
                <div className="h-full relative" style={{ background: theme === 'dark' ? '#161618' : '#fff' }}>
                  <iframe
                    ref={iframeRef}
                    srcDoc={previewSrcDoc}
                    title="Artifact Preview"
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    className="w-full h-full border-0"
                    style={{ background: theme === 'dark' ? '#161618' : '#fff' }}
                  />
                  {/* Floating GhostPilot indicator — AI can see this preview */}
                  <div
                    className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
                    style={{
                      background: 'rgba(0,0,0,0.5)',
                      color: 'rgba(255,255,255,0.6)',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <Eye size={11} />
                    Live Preview
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CanvasPanel;
