import React, { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkCiteMarker } from './remarkCiteMarker';
import { rehypeSemanticTokens } from '@/features/shared/markdown/rehypeSemanticTokens';
import { onKeyActivate } from '@/utils/a11y';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import 'katex/dist/katex.min.css';

import ShikiCodeBlock from './ShikiCodeBlock';
// v0.6.7 task #159 — EnhancedShikiCodeBlock does tail-only incremental
// highlighting while code streams in, so we swap it in for streaming
// code blocks (isStreaming === true). Non-streaming renders still use
// ShikiCodeBlock so static messages keep their existing appearance.
import EnhancedShikiCodeBlock from './EnhancedShikiCodeBlock';
import ChartRenderer from './ChartRenderer';
import SvgDiagram from './SvgDiagram';
import ReactFlowDiagram from '@/components/diagrams/ReactFlowDiagram';
import { VennDiagram, parseVennJson } from '@/components/diagrams/VennDiagram';
import { DrawioDiagramViewer } from '@/components/diagrams/DrawioDiagramViewer';
import { Code, ChevronDown, ChevronRight } from '@/shared/icons';
import { detectCitation } from '../../utils/citations';
import { StreamingTable as V2StreamingTable } from '../v2/StreamingTable';
import type {
  StreamingTable as V2StreamingTableData,
  StreamingTableColumn as V2StreamingTableColumn,
  StreamingTableCell as V2StreamingTableCell,
} from '../../hooks/useChatStream';

// Custom sanitize schema that allows KaTeX elements, image:// protocol,
// and inline base64 images (data: URIs). The `data` protocol is needed
// for the generate_image tool's base64 fallback path — when MinIO is
// unreachable, the API emits `![...](data:image/png;base64,...)` and
// rehype-sanitize's default schema would strip the data: URI → image
// tag becomes invalid → empty <p></p>. Adding `data` here is safe for
// images specifically (rendered via <img src>, no script execution).
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // KaTeX specific elements
    'math', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msqrt',
    'mroot', 'mfrac', 'mover', 'munder', 'munderover', 'msup', 'msub',
    'msubsup', 'mtable', 'mtr', 'mtd', 'semantics', 'annotation',
    'span'
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'class', 'style'],
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
    // Phase 4 — allow the citation chip's data-cite attr to survive sanitize.
    sup: [...(defaultSchema.attributes?.sup || []), 'className', 'class', 'data-cite']
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'image', 'data']
  }
};

// ============================================================================
// extractTableShape — walk a remark-gfm `<table>` hast Element node and
// pull semantic columns + rows for the v2 <StreamingTable> primitive.
//
// Mock 01:385-462 anatomy. Both render paths (model-prose markdown
// tables AND `streaming_table` NDJSON frames) converge on the same
// React component so the user sees one consistent table skin
// everywhere, with the staggered row-fade-in declared in
// chatmode-v2.css.
//
// Numeric columns (every cell matches /^\$?-?[\d.,%]+$/) get
// `align: 'right'` + `cellClass: 'tnum'` for tabular-num alignment.
// ============================================================================

function _hastNodeText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return typeof node.value === 'string' ? node.value : '';
  if (Array.isArray(node.children)) {
    return node.children.map(_hastNodeText).join('');
  }
  return '';
}

function _hastFindChild(node: any, tagName: string): any | null {
  if (!node?.children) return null;
  for (const child of node.children) {
    if (child?.type === 'element' && child.tagName === tagName) return child;
  }
  return null;
}

function _hastFindChildren(node: any, tagName: string): any[] {
  if (!node?.children) return [];
  return node.children.filter(
    (c: any) => c?.type === 'element' && c.tagName === tagName,
  );
}

const _NUMERIC_CELL_RE = /^\s*\$?-?[\d.,%]+\s*$/;

export function extractTableShape(tableNode: any): {
  columns: V2StreamingTableColumn[];
  rows: Array<Record<string, V2StreamingTableCell>>;
} {
  const thead = _hastFindChild(tableNode, 'thead');
  const tbody = _hastFindChild(tableNode, 'tbody');
  if (!thead || !tbody) return { columns: [], rows: [] };

  const headerRow = _hastFindChild(thead, 'tr');
  if (!headerRow) return { columns: [], rows: [] };

  const ths = _hastFindChildren(headerRow, 'th');
  if (ths.length === 0) return { columns: [], rows: [] };

  const columns: V2StreamingTableColumn[] = ths.map((th: any, i: number) => ({
    key: `c${i}`,
    label: _hastNodeText(th).trim(),
  }));

  const trs = _hastFindChildren(tbody, 'tr');
  const rows: Array<Record<string, V2StreamingTableCell>> = trs.map((tr: any) => {
    const tds = _hastFindChildren(tr, 'td');
    const row: Record<string, V2StreamingTableCell> = {};
    tds.forEach((td: any, i: number) => {
      const colKey = columns[i]?.key ?? `c${i}`;
      row[colKey] = _hastNodeText(td).trim();
    });
    return row;
  });

  // Numeric-column detection: every cell in the column matches the
  // numeric regex → right-align + tnum (parity with autoEmitStreamingTable).
  for (const col of columns) {
    if (rows.length === 0) break;
    const allNumeric = rows.every((r) => {
      const v = r[col.key];
      return typeof v === 'string' && _NUMERIC_CELL_RE.test(v);
    });
    if (allNumeric) {
      col.align = 'right';
      col.cellClass = 'tnum';
    }
  }

  return { columns, rows };
}

// ============================================================================
// MilvusImage Component - Handles image:// protocol for Milvus-stored images
// ============================================================================

interface MilvusImageProps {
  src?: string;
  alt?: string;
  theme: 'light' | 'dark';
}

const MilvusImage: React.FC<MilvusImageProps> = memo(({ src, alt, theme }) => {
  const isImageProtocol = src?.startsWith('image://');
  const [imageSrc, setImageSrc] = useState<string | undefined>(isImageProtocol ? undefined : src);
  const [imageError, setImageError] = useState(false);
  const [loading, setLoading] = useState(isImageProtocol);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  // MUST live with the other useStates above the early returns below —
  // previously hoisted from inside the render body where it caused React
  // error #310 ("rendered fewer/more hooks than during the previous
  // render") every time the loading/error branches fired.
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (src?.startsWith('image://')) {
      const imageId = src.replace('image://', '');
      setLoading(true);
      setImageError(false);

      // Accept: application/json forces /api/images/:id into its JSON
      // branch. Without this header the route content-negotiates on the
      // browser default `*/*` and returns raw PNG bytes, which then blow
      // up `.json()` below.
      fetch(`/api/images/${imageId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
        .then(res => {
          if (!res.ok) throw new Error(`Failed to load image: ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (data.imageData) {
            const format = data.metadata?.format || 'png';
            const dataUrl = `data:image/${format};base64,${data.imageData}`;
            setImageSrc(dataUrl);
            if (data.metadata?.dimensions) {
              const [w, h] = data.metadata.dimensions.split('x').map(Number);
              if (w && h) setImageDimensions({ width: w, height: h });
            }
            setLoading(false);
          } else {
            throw new Error('No image data in response');
          }
        })
        .catch(error => {
          console.error('[MilvusImage] Failed to fetch image:', error);
          setImageError(true);
          setLoading(false);
        });
    }
  }, [src]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  const containerStyle = {
    width: '100%',
    maxWidth: '512px',
    aspectRatio: imageDimensions ? `${imageDimensions.width}/${imageDimensions.height}` : '1/1',
    minHeight: '200px',
    maxHeight: '512px',
  };

  if (loading) {
    return (
      <div className="rounded-lg my-4 flex items-center justify-center border border-border/20 bg-bg-tertiary/50" style={containerStyle}>
        <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Loading image...</div>
      </div>
    );
  }

  if (imageError) {
    // Suppress the broken-image placeholder entirely. Models occasionally
    // fabricate `image://<id>` URLs into prose without an actual image
    // having been generated this turn. The old behavior — a giant 512×512
    // "Failed to load image" callout — dominates the screen and makes
    // every arch_diagram / chart turn look broken. Render nothing for
    // the user instead; the error is already logged to console for
    // debugging. If a legitimate image-gen DID fail, the tool_use card
    // surfaces that path separately.
    return null;
  }

  const finalSrc = isImageProtocol ? imageSrc : (imageSrc || src);
  if (isImageProtocol && !imageSrc) {
    return (
      <div className="rounded-lg my-4 flex items-center justify-center border border-border/20 bg-bg-tertiary/50" style={containerStyle}>
        <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Loading image...</div>
      </div>
    );
  }

  if (!finalSrc) return null;

  return (
    <>
      <div className="relative inline-block my-4 group">
        {/* Skeleton placeholder while image loads — prevents choppy progressive rendering */}
        {!imgLoaded && !isImageProtocol && (
          <div className="rounded-lg flex items-center justify-center border border-border/20 bg-bg-tertiary/30 animate-pulse"
            style={{ width: '100%', maxWidth: '400px', height: '200px' }}>
            <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Loading image...</div>
          </div>
        )}
        <button
          type="button"
          aria-label="Expand image"
          className="block p-0 m-0 bg-transparent border-0 cursor-pointer"
          style={{ display: imgLoaded || isImageProtocol ? 'block' : 'none' }}
          onClick={() => setIsFullscreen(true)}
          onKeyDown={onKeyActivate(() => setIsFullscreen(true))}
        >
          <img
            src={finalSrc}
            alt={alt || 'Generated image'}
            className="rounded-lg shadow-lg max-w-full h-auto cursor-pointer transition-opacity hover:opacity-90"
            style={{ maxHeight: '512px', objectFit: 'contain', display: 'block' }}
            onError={() => setImageError(true)}
            onLoad={() => setImgLoaded(true)}
          />
        </button>
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all rounded-lg pointer-events-none">
          <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
            Click to expand
          </span>
        </div>
      </div>

      {isFullscreen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 cursor-pointer" role="button" tabIndex={0} aria-label="Close fullscreen" onClick={() => setIsFullscreen(false)} onKeyDown={onKeyActivate(() => setIsFullscreen(false))}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors z-10" onClick={() => setIsFullscreen(false)} aria-label="Close fullscreen">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">Press ESC or click anywhere to close</div>
          <img src={finalSrc} alt={alt || 'Generated image'} role="presentation" className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} />
        </div>,
        document.body
      )}
    </>
  );
});

MilvusImage.displayName = 'MilvusImage';

// ============================================================================
// SharedMarkdownRenderer Props
// ============================================================================

export interface SharedMarkdownRendererProps {
  content: string;
  theme: 'light' | 'dark';
  isStreaming?: boolean;
  className?: string;
  /** Callback when code is executed */
  onExecute?: (code: string, language: string) => void;
  /** Whether code blocks can be executed */
  executable?: boolean;
  /** Callback to expand artifact into canvas panel */
  onExpandToCanvas?: (code: string, type: string, title: string, language?: string) => void;
}

/**
 * Extract title from SVG code
 */
const extractTitle = (code: string): string | undefined => {
  // Try <title>...</title> tag first (most reliable for HTML artifacts)
  const htmlTitleMatch = code.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (htmlTitleMatch) return htmlTitleMatch[1].trim();
  // Try first <h1> tag
  const h1Match = code.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  // Fallback: bare "title" keyword
  const titleMatch = code.match(/title\s+(.+)/);
  return titleMatch ? titleMatch[1] : undefined;
};

/**
 * Extract title from Draw.io XML
 */
const extractDrawioTitle = (xml: string): string | undefined => {
  const match = xml.match(/<diagram[^>]*name="([^"]+)"/);
  return match ? match[1] : undefined;
};

// ============================================================================
// ArtifactSourceToggle - Wraps artifact output with a collapsible source viewer
// ============================================================================

interface ArtifactSourceToggleProps {
  children: React.ReactNode;
  code: string;
  language: string;
  theme: 'light' | 'dark';
  onCopy: (text: string) => Promise<void>;
}

/**
 * ArtifactTag — Compact clickable tag that replaces inline artifacts.
 * Clicking opens/closes the CanvasPanel via onExpandToCanvas callback.
 */
const ARTIFACT_ICONS: Record<string, string> = {
  html: '🌐', react: '⚛️', svg: '🎨', reactflow: '🧭', chart: '📊',
  markdown: '📝', latex: '📐', csv: '📋', canvas: '🖼️', visualization: '📊',
};

const ArtifactTag: React.FC<{
  title: string;
  type: string;
  theme: 'light' | 'dark';
  onClick: () => void;
}> = ({ title, type, onClick }) => {
  const icon = ARTIFACT_ICONS[type] || '📄';
  return (
    <button
      onClick={onClick}
      className="artifact-canvas-tag group"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        margin: '6px 0',
        padding: '5px 12px 5px 8px',
        border: '1px solid var(--color-border, rgba(0,0,0,0.1))',
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        background: 'var(--color-surfaceSecondary, rgba(0,0,0,0.03))',
        color: 'var(--color-text, #1f2328)',
        fontFamily: 'inherit',
        fontSize: 13,
        lineHeight: 1.4,
        textAlign: 'left' as const,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'var(--color-primary-alpha-10, rgba(99,102,241,0.08))';
        el.style.borderColor = 'var(--color-primary-alpha-30, rgba(99,102,241,0.25))';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'var(--color-surfaceSecondary, rgba(0,0,0,0.03))';
        el.style.borderColor = 'var(--color-border, rgba(0,0,0,0.1))';
      }}
    >
      <span style={{ fontSize: 14, opacity: 0.7, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontWeight: 500, color: 'var(--color-primary, var(--user-accent-primary))' }}>{title}</span>
      <span style={{ fontSize: 10, color: 'var(--color-textMuted, #8b949e)', textTransform: 'uppercase' as const, letterSpacing: '0.3px', marginLeft: 2 }}>{type}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4, marginLeft: 2, flexShrink: 0 }}>
        <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
};

const ArtifactSourceToggle: React.FC<ArtifactSourceToggleProps> = memo(({
  children,
  code,
  language,
  theme,
  onCopy,
}) => {
  const [showSource, setShowSource] = useState(false);

  return (
    <div className="my-4">
      {/* Rendered artifact output */}
      {children}

      {/* Collapsible source toggle */}
      <button
        onClick={() => setShowSource(prev => !prev)}
        className="flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 hover:bg-[var(--color-surfaceSecondary)] border border-[var(--color-border)]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {showSource ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Code size={12} />
        <span>{showSource ? 'Hide Source' : 'View Source'}</span>
      </button>

      {showSource && (
        <div className="mt-2">
          <ShikiCodeBlock
            code={code}
            language={language}
            theme={theme}
            onCopy={onCopy}
          />
        </div>
      )}
    </div>
  );
});

ArtifactSourceToggle.displayName = 'ArtifactSourceToggle';

/**
 * URL transform — controls which hrefs/srcs survive markdown rendering.
 *
 * Exported because the unit tests pin the allowlist (see
 * __tests__/SharedMarkdownRenderer.urlTransform.test.ts). When you add a
 * new accepted form here, add a matching test there too.
 */
export const urlTransform = (url: string): string => {
  // Allow our custom image:// protocol
  if (url.startsWith('image://')) return url;
  // Allow data URLs
  if (url.startsWith('data:')) return url;
  // Allow standard protocols
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) return url;
  // Hash-only anchors are the admin AI agent's deep-link form,
  // [Open <label>](#<slug>). The shell intercepts these on click and
  // dispatches a navigation event. Without this branch the renderer
  // strips the href to "" and the click reloads the app at /admin.
  if (url.startsWith('#')) return url;
  // mailto: is safe for plain email links inside agent answers.
  if (url.startsWith('mailto:')) return url;
  // Block other protocols for security
  return '';
};

// Throttle interval for markdown parsing during streaming (ms)
const MARKDOWN_THROTTLE_MS = 100;
// Content length threshold for throttling
const THROTTLE_CONTENT_LENGTH = 500;

// ─── ReAct stage decorator ────────────────────────────────────────────────
// Maps a cognitive-loop marker to a tone color. Tones mirror the per-stage
// category colors used elsewhere in the UI: think=blue (reasoning),
// act=orange (doing), observe=green (reading tool output),
// reflect=purple (summarizing), plan=teal (structured intent),
// verify=amber (validation).
const REACT_STAGE_TONES: Record<string, { bg: string; fg: string; label: string }> = {
  THINK:   { bg: 'color-mix(in srgb, var(--color-nfo) 18%, transparent)', fg: 'var(--color-nfo)', label: 'THINK' },
  ACT:     { bg: 'rgba(255, 152, 0, 0.18)',  fg: '#ff9800', label: 'ACT' },
  OBSERVE: { bg: 'rgba(63, 185, 80, 0.18)',  fg: '#3fb950', label: 'OBSERVE' },
  REFLECT: { bg: 'rgba(124, 77, 255, 0.18)', fg: '#7c4dff', label: 'REFLECT' },
  PLAN:    { bg: 'rgba(0, 188, 212, 0.18)',  fg: '#00bcd4', label: 'PLAN' },
  VERIFY:  { bg: 'rgba(255, 193, 7, 0.18)',  fg: '#ffc107', label: 'VERIFY' },
};

const REACT_STAGE_REGEX = new RegExp(
  `^(\\s*)(${Object.keys(REACT_STAGE_TONES).join('|')}):\\s*(.*)$`,
);

/**
 * React renderer for a ReAct stage line. Takes the leading whitespace,
 * stage name, and remaining text; renders a pill badge + content.
 * Used inside the `p` component override since react-markdown 9.x escapes
 * raw HTML by default (no rehype-raw wired up).
 */
const ReactStageBadge: React.FC<{ stage: keyof typeof REACT_STAGE_TONES; rest: React.ReactNode }> = ({ stage, rest }) => {
  const tone = REACT_STAGE_TONES[stage];
  return (
    <>
      <span
        className={`react-stage react-stage-${stage.toLowerCase()}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 7px',
          marginRight: 6,
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.4px',
          background: tone.bg,
          color: tone.fg,
          verticalAlign: 'middle',
        }}
      >
        {tone.label}
      </span>
      {rest}
    </>
  );
};

/**
 * Status-keyword wrapper (task #174). Walks rendered React children
 * (inside <p> and <li>) and replaces known k8s/cloud status strings
 * with <span data-status="ok|warn|err"> so mockup-v067.css can paint
 * them OK-green / WARN-amber / ERR-red. Keyword list is intentionally
 * narrow — we only tint when the string is clearly a status token
 * (word boundaries, not substrings of unrelated words).
 */
const STATUS_OK_WORDS = [
  'Ready', 'Running', 'Active', 'Healthy', 'Succeeded', 'OK', 'Pass',
  'Passed', 'stream complete', 'schema valid',
];
const STATUS_WARN_WORDS = [
  'Pending', 'Degraded', 'Throttled', 'Warn', 'Warning', 'Probe failing',
];
const STATUS_ERR_WORDS = [
  'Failed', 'Failing', 'Error', 'ERR', 'OOMKilled', 'OOMKilling',
  'CrashLoopBackOff', 'BackOff', 'Evicted', 'Unknown', 'Unavailable',
  'NotReady', 'NodeNotReady', 'MemoryPressure', 'DiskPressure',
  'PIDPressure', 'NodePressure',
];
const STATUS_REGEX = new RegExp(
  `(?<![\\w-])(${[
    ...STATUS_ERR_WORDS.map(w => w.replace(/[.*+?^${}()|[\\]/g, '\\$&')),
    ...STATUS_WARN_WORDS.map(w => w.replace(/[.*+?^${}()|[\\]/g, '\\$&')),
    ...STATUS_OK_WORDS.map(w => w.replace(/[.*+?^${}()|[\\]/g, '\\$&')),
  ].join('|')})(?![\\w-])`,
  'g',
);

function classifyStatus(word: string): 'ok' | 'warn' | 'err' | null {
  if (STATUS_ERR_WORDS.includes(word)) return 'err';
  if (STATUS_WARN_WORDS.includes(word)) return 'warn';
  if (STATUS_OK_WORDS.includes(word)) return 'ok';
  return null;
}

function wrapStatusKeywords(children: React.ReactNode): React.ReactNode {
  const out: React.ReactNode[] = [];
  React.Children.forEach(children, (child, i) => {
    if (typeof child !== 'string') {
      out.push(child);
      return;
    }
    const parts = child.split(STATUS_REGEX);
    if (parts.length === 1) {
      out.push(child);
      return;
    }
    parts.forEach((piece, j) => {
      const cls = classifyStatus(piece);
      if (cls) {
        out.push(
          <span key={`status-${i}-${j}`} data-status={cls}>
            {piece}
          </span>,
        );
      } else if (piece) {
        out.push(piece);
      }
    });
  });
  return out;
}

/**
 * Fix incomplete markdown constructs during streaming
 * Handles: code fences (``` and ~~~), partial inline backticks,
 * unclosed bold/italic markers, and partial link syntax.
 *
 * Uses line-by-line scanning to track actual fence state.
 */
function fixIncompleteCodeFences(content: string, isStreaming: boolean): string {
  if (!isStreaming || !content) return content;

  const lines = content.split('\n');
  let insideCodeBlock = false;
  let fenceChar = ''; // Track which fence char opened the block (` or ~)

  for (const line of lines) {
    const trimmed = line.trimStart();
    // Check for backtick fences (```) or tilde fences (~~~)
    if (trimmed.startsWith('```') && (fenceChar === '' || fenceChar === '`')) {
      if (!insideCodeBlock) fenceChar = '`';
      else fenceChar = '';
      insideCodeBlock = !insideCodeBlock;
    } else if (trimmed.startsWith('~~~') && (fenceChar === '' || fenceChar === '~')) {
      if (!insideCodeBlock) fenceChar = '~';
      else fenceChar = '';
      insideCodeBlock = !insideCodeBlock;
    }
  }

  // If we ended inside an unclosed code block, close it with the matching fence
  if (insideCodeBlock) {
    const closeFence = fenceChar === '~' ? '~~~' : '```';
    const lastLine = lines[lines.length - 1];
    const lastTrimmed = lastLine.trim();
    // Partial fence at end (1-2 backticks/tildes) - remove and close properly
    if (lastTrimmed === '`' || lastTrimmed === '``' || lastTrimmed === '~' || lastTrimmed === '~~') {
      return lines.slice(0, -1).join('\n') + '\n' + closeFence;
    }
    return content + '\n' + closeFence;
  }

  // Handle trailing partial fences outside code blocks
  const lastLine = lines[lines.length - 1].trim();
  if (lastLine === '`' || lastLine === '``' || lastLine === '~' || lastLine === '~~') {
    return lines.slice(0, -1).join('\n');
  }

  // Fix trailing partial inline constructs that break markdown parsing:
  // Unclosed bold (**text), italic (*text), strikethrough (~~text)
  // Only fix if at the very end of content (likely still streaming)
  let result = content;
  const trailing = result.slice(-20); // Check last 20 chars for partial markers

  // Unclosed bold at end: odd number of ** without closure
  if (/\*\*[^*\n]{1,15}$/.test(trailing) && !/\*\*[^*\n]+\*\*/.test(trailing)) {
    result += '**';
  }
  // Unclosed italic at end: single * without closure (but not **)
  else if (/(?<!\*)\*[^*\n]{1,15}$/.test(trailing) && !/(?<!\*)\*[^*\n]+\*(?!\*)/.test(trailing)) {
    result += '*';
  }

  return result;
}

/**
 * SharedMarkdownRenderer - Renders markdown with full feature support
 *
 * PERFORMANCE OPTIMIZATION:
 * During streaming, markdown parsing is throttled for large content
 * to prevent UI freezing. Full parsing is applied after streaming completes.
 */
export const SharedMarkdownRenderer: React.FC<SharedMarkdownRendererProps> = memo(({
  content,
  theme,
  isStreaming = false,
  className = '',
  onExecute,
  executable = false,
  onExpandToCanvas,
}) => {
  // Throttle content updates during streaming with trailing-edge debounce
  const [throttledContent, setThrottledContent] = useState(content);
  const lastParseTimeRef = useRef<number>(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(content);
  latestContentRef.current = content;

  useEffect(() => {
    if (!isStreaming || content.length < THROTTLE_CONTENT_LENGTH) {
      // Not streaming or content is small - update immediately
      setThrottledContent(content);
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
      return;
    }

    // During streaming with large content, throttle with trailing edge
    const now = Date.now();
    if (now - lastParseTimeRef.current >= MARKDOWN_THROTTLE_MS) {
      setThrottledContent(content);
      lastParseTimeRef.current = now;
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    } else if (!trailingTimerRef.current) {
      // Schedule trailing update so content never stalls
      trailingTimerRef.current = setTimeout(() => {
        setThrottledContent(latestContentRef.current);
        lastParseTimeRef.current = Date.now();
        trailingTimerRef.current = null;
      }, MARKDOWN_THROTTLE_MS);
    }

    return () => {
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    };
  }, [content, isStreaming]);

  // When streaming ends, ensure we have the final content
  useEffect(() => {
    if (!isStreaming) {
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
      setThrottledContent(content);
    }
  }, [isStreaming, content]);

  // Process content for LaTeX delimiters and fix incomplete code fences
  const processedContent = useMemo(() => {
    const contentToProcess = throttledContent;
    if (!contentToProcess || typeof contentToProcess !== 'string') return contentToProcess || '';

    // FIX: Handle incomplete code fences during streaming
    // This prevents markdown parsing from breaking when code blocks are incomplete
    let result = fixIncompleteCodeFences(contentToProcess, isStreaming);

    // STRIP stray <artifact:*> tokens that the model emits as decorative
    // prose (paired AND self-closing). Server strips these at persistence
    // time, but during streaming the raw deltas hit the UI uncleaned —
    // this strips them in real-time so the user never sees them.
    // Kinds: html | svg | react | mermaid. Reference:
    // services/openagentic-api/src/routes/chat/pipeline/response.stripArtifactProseTokens.ts
    result = result.replace(
      /<artifact:(?:html|svg|react|mermaid)\b[^>]*>[\s\S]*?<\/artifact:(?:html|svg|react|mermaid)>/gi,
      '',
    );
    result = result.replace(
      /<artifact:(?:html|svg|react|mermaid)(?:\s+[^>]*?)?\s*\/>/gi,
      '',
    );

    // Convert \( ... \) to $...$
    result = result.replace(/\\\((.*?)\\\)/g, '$$$1$$');
    // Convert \[ ... \] to $$...$$
    result = result.replace(/\\\[(.*?)\\\]/g, '$$$$$$1$$$$');

    // Normalize inline GFM tables that were emitted without row newlines.
    // Qwen (local) and some other models occasionally return an entire table
    // on a single line like `| h1 | h2 | |---|---| | v1 | v2 | | v3 | v4 |`.
    // Without newlines remark-gfm doesn't detect a table and renders raw
    // pipes. When we see an inline `|---|---|` separator, split the line at
    // each `| ... | |` boundary so remark-gfm sees proper rows.
    result = result.split('\n').map((line) => {
      if (!line.includes('|')) return line;
      // Inline separator signature — at least 2 dash groups between pipes,
      // with no surrounding newlines.
      const hasInlineSep = /\|\s*:?-{2,}:?\s*\|\s*:?-{2,}:?\s*\|/.test(line);
      if (!hasInlineSep) return line;
      // Insert a newline at every `|<spaces>|` boundary between rows. Use
      // a lookbehind-free split: replace `| |` (one pipe, whitespace, one
      // pipe) with `|\n|`.
      return line.replace(/\|\s+\|/g, '|\n|');
    }).join('\n');

    // Split prose from a table header that was emitted on the same line.
    // gpt-5.4-mini (and others) sometimes glue a paragraph and the first
    // table row together, e.g.
    //   "Found 2 subs.| Subscription ID | Name | State |\n|---|---|---|\n| ... |"
    // remark-gfm needs the header row to start the line. When the NEXT
    // line is a separator (|---|---|...|), split this line at the first
    // pipe and inject a blank line so GFM detects the table.
    const splitLines = result.split('\n');
    const splitOut: string[] = [];
    const isSeparatorLine = (s: string) =>
      /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
    for (let i = 0; i < splitLines.length; i++) {
      const line = splitLines[i];
      const next = splitLines[i + 1] || '';
      if (
        line.includes('|') &&
        !/^\s*\|/.test(line) && // line does NOT start with a pipe
        isSeparatorLine(next)
      ) {
        const firstPipe = line.indexOf('|');
        const prose = line.slice(0, firstPipe).trimEnd();
        const header = line.slice(firstPipe);
        if (prose.length > 0 && /\|/.test(header)) {
          splitOut.push(prose);
          splitOut.push('');
          splitOut.push(header);
          continue;
        }
      }
      splitOut.push(line);
    }
    result = splitOut.join('\n');

    // Note: ReAct stage badges (THINK/ACT/OBSERVE/REFLECT) are rendered
    // inside the `p` component override below — not via preprocessing —
    // because react-markdown 9.x escapes raw HTML unless rehype-raw is
    // wired in, which would change escape semantics across the whole app.

    return result;
  }, [throttledContent, isStreaming]);

  // Copy handler for code blocks
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <div
      className={`prose dark:prose-invert max-w-none ${className}`}
      // Editorial typography — mirror codemode .cm-markdown so chatmode
      // and codemode read the SAME (user ask: chatmode should use the
      // "badass" codemode font). Inter first, tighter letter-spacing,
      // full font-feature set for single-story 'a' + ligatures + tabular
      // nums. max-width is driven by the shared --transcript-max-width
      // token so chatmode and codemode share one column (no width jump
      // on sidebar flip). 2026-04-24: 820 -> 902px (10% wider).
      style={{
        fontFamily:
          '"Inter", "IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: '15px',
        lineHeight: 1.6,
        letterSpacing: '-0.005em',
        fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1, "tnum" 1, "cv11" 1',
        WebkitFontSmoothing: 'antialiased',
        textRendering: 'optimizeLegibility',
        color: 'var(--color-text)',
        maxWidth: 'var(--transcript-max-width)',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkCiteMarker]}
        rehypePlugins={[
          rehypeKatex as any,
          rehypeSemanticTokens,
          [rehypeSanitize, sanitizeSchema]
        ]}
        urlTransform={urlTransform}
        components={{
          // Strip the default <pre> wrapper - our ShikiCodeBlock handles its own container
          pre: ({ children }) => <>{children}</>,

          // ================================================================
          // Code blocks with full feature support
          // ================================================================
          code: ({ node, className: codeClassName, children, ...props }) => {
            const match = /language-([\w:.+-]+)/.exec(codeClassName || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');
            const isInline = !match && !String(children).includes('\n');

            // Inline code — tightened pill styling (F₂.1) to match codemode's
            // compact mono-pill aesthetic. Was 6px radius + 6% bg; now 4px +
            // 10% for better contrast against the message bubble, with
            // slightly tighter horizontal padding so pills don't float
            // away from the surrounding prose.
            if (isInline) {
              return (
                <code
                  className="font-mono"
                  style={{
                    fontSize: '0.88em',
                    background: 'var(--accent-soft, rgba(139, 92, 246, 0.14))',
                    color: 'var(--fg-0, #f8fafc)',
                    padding: '0.1em 0.42em',
                    borderRadius: '6px',
                    border: '1px solid var(--accent-line, rgba(139, 92, 246, 0.32))',
                    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontWeight: 500,
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            // Chart blocks
            if (language === 'chart' || language === 'chart-json') {
              try {
                const chartSpec = JSON.parse(codeString);
                return (
                  <ArtifactSourceToggle code={codeString} language="json" theme={theme} onCopy={handleCopy}>
                    <ChartRenderer chartSpec={chartSpec} theme={theme} height={300} />
                  </ArtifactSourceToggle>
                );
              } catch {
                // Not valid JSON, render as code
              }
            }

            // JSON that looks like chart data
            if (language === 'json') {
              try {
                const jsonData = JSON.parse(codeString);
                if (jsonData.type && jsonData.data && Array.isArray(jsonData.data)) {
                  return (
                    <div className="my-4">
                      <ChartRenderer chartSpec={jsonData} theme={theme} height={300} />
                    </div>
                  );
                }
              } catch {
                // Not valid JSON or not chart data
              }
            }

            // ReactFlow diagrams
            if (language === 'diagram' || language === 'reactflow' || language === 'flowchart-json' || language === 'diagram-json' || language === 'flowchart') {
              try {
                const diagramJson = JSON.parse(codeString);
                return (
                  <ReactFlowDiagram
                    diagram={{
                      ...diagramJson,
                      theme: theme === 'dark' ? 'dark' : 'light'
                    }}
                    height={450}
                    interactive={true}
                  />
                );
              } catch {
                // Not valid JSON
              }
            }

            // Venn diagrams
            if (language === 'venn' || language === 'venn-json') {
              try {
                const vennDef = parseVennJson(codeString);
                if (vennDef) {
                  return (
                    <div className="my-4">
                      <VennDiagram venn={vennDef} height={400} />
                    </div>
                  );
                }
              } catch {
                // If parse fails, fall through to code block
              }
            }

            // SVG diagrams
            if (language === 'svg' || language === 'geometry') {
              return (
                <ArtifactSourceToggle code={codeString} language="xml" theme={theme} onCopy={handleCopy}>
                  <SvgDiagram
                    code={codeString}
                    title={extractTitle(codeString)}
                    theme={theme}
                  />
                </ArtifactSourceToggle>
              );
            }

            // Draw.io/mxGraph diagrams
            if (language === 'drawio' || language === 'mxgraph' || language === 'drawio-xml') {
              return (
                <DrawioDiagramViewer
                  xml={codeString}
                  title={extractDrawioTitle(codeString)}
                  height={450}
                  showControls={true}
                />
              );
            }

            // Markdown blocks - render as rich markdown inline (not as code block)
            if (language === 'markdown' || language === 'md') {
              return (
                <div className="my-4 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Simple inline rendering - no nested artifact detection
                      code: ({ children, className: nestedClassName, ...nestedProps }) => {
                        const isNestedInline = !String(children).includes('\n');
                        if (isNestedInline) {
                          return <code className="text-sm font-mono px-1 bg-[var(--color-surface-2)] rounded" {...nestedProps}>{children}</code>;
                        }
                        return <pre className="bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto text-sm"><code {...nestedProps}>{children}</code></pre>;
                      }
                    }}
                  >
                    {codeString}
                  </ReactMarkdown>
                </div>
              );
            }

            // Legacy ArtifactRenderer pipeline (latex/csv inline iframe) ripped
            // 2026-05-13 (#781 Phase D.4). LaTeX/CSV fences now fall through to
            // standard Shiki code-block rendering. Interactive viz arrives via
            // Message.visualizations[] + ArtifactSlideOutLauncher.

            // ═══════════════════════════════════════════════════════════
            // ARTIFACT RENDERING: Show clickable ArtifactTag + open Canvas
            // Uses CustomEvent to communicate with ChatContainer's CanvasPanel
            // regardless of which rendering path reaches here.
            // ═══════════════════════════════════════════════════════════

            const openInCanvas = (code: string, type: string, title: string, lang: string) => {
              // Use prop callback if available, otherwise dispatch CustomEvent
              if (onExpandToCanvas) {
                onExpandToCanvas(code, type, title, lang);
              } else {
                window.dispatchEvent(new CustomEvent('openagentic:open-canvas', {
                  detail: { content: code, type, title, language: lang }
                }));
              }
            };

            // Interactive artifacts — explicit `artifact:*` fence is the
            // primary opt-in. Bare `html`/`htm`/`jsx`/`tsx`/`react` fences
            // are also auto-promoted as a fallback (some models won't
            // emit the explicit form even when prompted). The
            // server-side strip in
            // services/openagentic-api/src/routes/chat/pipeline/response.artifactStrip.ts
            // already downgrades these fences to ```plaintext when the
            // user's intent is NOT visualization, so by the time we get
            // here, a plain ```html block legitimately means "the user
            // asked to see something visual." See #417.
            if (language.startsWith('artifact:')) {
              const artifactType = language.replace('artifact:', '') as string;
              const artifactTitle = extractTitle(codeString)
                || (() => { const m = codeString.match(/^(?:\/\/|<!--)\s*(.+?)(?:-->)?\s*$/m); return m ? m[1].trim() : null; })()
                || `${artifactType.charAt(0).toUpperCase() + artifactType.slice(1)} Artifact`;
              const artifactLang = artifactType === 'react' ? 'tsx' : artifactType === 'svg' ? 'xml' : artifactType === 'html' ? 'html' : 'plaintext';
              return (
                <div style={{ background: 'transparent', margin: '-16px', padding: '8px 0' }}>
                  <ArtifactTag title={artifactTitle} type={artifactType} theme={theme}
                    onClick={() => openInCanvas(codeString, artifactType, artifactTitle, artifactLang)} />
                </div>
              );
            }

            if (language === 'html' || language === 'htm') {
              const htmlTitle = extractTitle(codeString) || 'HTML Document';
              return (
                <div style={{ background: 'transparent', margin: '-16px', padding: '8px 0' }}>
                  <ArtifactTag title={htmlTitle} type="html" theme={theme}
                    onClick={() => openInCanvas(codeString, 'html', htmlTitle, 'html')} />
                </div>
              );
            }

            if (language === 'jsx' || language === 'tsx' || language === 'react') {
              const reactTitle = extractTitle(codeString) || 'React Component';
              return (
                <div style={{ background: 'transparent', margin: '-16px', padding: '8px 0' }}>
                  <ArtifactTag title={reactTitle} type="react" theme={theme}
                    onClick={() => openInCanvas(codeString, 'react', reactTitle, 'tsx')} />
                </div>
              );
            }

            // Default: Syntax-highlighted code block
            // v0.6.7 task #159 — use EnhancedShikiCodeBlock during streaming
            // so only the appended tail is re-highlighted on each delta.
            // Non-streaming renders keep the standard ShikiCodeBlock path
            // (it supports onExecute + executable which the enhanced
            // variant intentionally does not).
            return (
              <div className="my-4 relative">
                {isStreaming && (
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-2 px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    {' '}
                    Live
                  </div>
                )}
                {isStreaming ? (
                  <EnhancedShikiCodeBlock
                    code={codeString}
                    language={language || 'plaintext'}
                    theme={theme}
                    onCopy={handleCopy}
                    isStreaming={true}
                  />
                ) : (
                  <ShikiCodeBlock
                    code={codeString}
                    language={language || 'plaintext'}
                    theme={theme}
                    onCopy={handleCopy}
                    onExecute={onExecute}
                    executable={executable}
                    isStreaming={false}
                  />
                )}
              </div>
            );
          },

          // ================================================================
          // Images - special handling for Milvus image:// protocol
          // ================================================================
          img: ({ src, alt }) => (
            <MilvusImage src={src} alt={alt} theme={theme} />
          ),

          // ================================================================
          // Tables route through the v2 <StreamingTable> primitive
          // (mock 01:385-462) so model-prose markdown tables share the
          // same anatomy as `streaming_table` NDJSON frames emitted by
          // autoEmitStreamingTable. Single source of truth for tabular
          // rendering; staggered row-fade-in keyed off `tbody tr:nth-child`
          // in chatmode-v2.css. Empty / malformed tables fall back to a
          // plain HTML <table> so we never silently lose data.
          // ================================================================
          table: ({ node, children }) => {
            const { columns, rows } = extractTableShape(node);
            if (columns.length === 0) {
              return <table>{children}</table>;
            }
            const tableData: V2StreamingTableData = {
              artifactId: 'md-table',
              title: '',
              columns,
              rows,
            };
            return <V2StreamingTable table={tableData} />;
          },

          // ================================================================
          // Headings (F₂.1 — match codemode's tighter rhythm).
          //
          // Was: big h1/h2 with heavy coloured border-b underlines — that
          // made responses read like generated documents with divider
          // chrome rather than conversational prose. Dropped the
          // border-b and border-b-2 entirely, shrunk the sizes a notch,
          // and pulled the top/bottom margins in so dense markdown
          // doesn't feel like it's breathing past its lungs.
          // ================================================================
          // v0.6.7 mockup parity — h2 gets a line-1 rule underneath, h3 picks
          // up the violet accent, h4 stays muted. Inline styles beat the
          // prose plugin's defaults without a specificity war.
          h1: ({ children }) => (
            <h1
              className="text-xl font-semibold mt-5 mb-3"
              style={{ color: 'var(--fg-0, #f8fafc)', letterSpacing: '-0.02em' }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className="text-lg font-semibold mt-5 mb-2"
              style={{
                color: 'var(--cm-fg-0)',
                letterSpacing: '-0.015em',
                borderBottom: '1px solid var(--cm-line-1)',
                paddingBottom: 4,
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="text-base font-semibold mt-4 mb-2"
              style={{ color: 'var(--cm-fg-0)', letterSpacing: '-0.01em' }}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className="text-sm font-semibold mt-3 mb-1.5"
              style={{ color: 'var(--cm-fg-1)' }}
            >
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-medium mt-2 mb-1 text-[var(--color-text-secondary)]">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-xs font-semibold mt-2 mb-1 text-[var(--color-text-muted)] uppercase tracking-wide">
              {children}
            </h6>
          ),

          // ================================================================
          // Enhanced list styling
          // ================================================================
          // F₂.1: tighter list rhythm to match codemode. Was my-3 with
          // space-y-1 per item; now my-2 with space-y-0.5 — makes dense
          // bullet lists feel more like text and less like a checklist.
          ul: ({ children }) => (
            <ul className="my-2 pl-5 space-y-0.5 list-disc marker:text-[var(--color-primary)]/70">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 pl-5 space-y-0.5 list-decimal marker:text-[var(--color-primary)]/70 marker:font-medium">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-1 leading-snug">
              {wrapStatusKeywords(children)}
            </li>
          ),

          // ================================================================
          // Horizontal rule — F₂.1 tightened. Was a decorative gradient
          // across the full width; now a subtle neutral hairline so
          // section dividers don't steal visual weight from headings.
          // ================================================================
          hr: () => (
            <hr className="my-4 border-0 h-px bg-[var(--color-border)]/40" />
          ),

          // ================================================================
          // Enhanced paragraph spacing.
          // Also detects ReAct cognitive-loop stage markers at the START
          // of the paragraph's first text child (THINK/ACT/OBSERVE/REFLECT/
          // PLAN/VERIFY followed by ":") and renders a small colored pill
          // before the content. Purely visual — the underlying markdown
          // text is unchanged. Stops after the first child since stage
          // markers always appear at line start.
          // ================================================================
          p: ({ children }) => {
            const arr = React.Children.toArray(children);
            if (arr.length > 0 && typeof arr[0] === 'string') {
              const m = (arr[0] as string).match(REACT_STAGE_REGEX);
              if (m) {
                const [, leadingWs, stage, restOfFirstChild] = m;
                const stageKey = stage as keyof typeof REACT_STAGE_TONES;
                const remainingChildren = [restOfFirstChild, ...arr.slice(1)];
                return (
                  <p className="my-3 leading-relaxed">
                    {leadingWs}
                    <ReactStageBadge stage={stageKey} rest={remainingChildren} />
                  </p>
                );
              }
            }
            return (
              <p className="my-3 leading-relaxed">
                {wrapStatusKeywords(children)}
              </p>
            );
          },

          // ================================================================
          // Strong/bold with subtle color
          // ================================================================
          strong: ({ children }) => (
            <strong
              className="font-semibold"
              style={{ color: 'var(--fg-0, #f8fafc)', fontWeight: 600 }}
            >
              {children}
            </strong>
          ),

          // ================================================================
          // Emphasis/italic
          // ================================================================
          em: ({ children }) => (
            <em className="italic text-[var(--color-text-secondary)]">
              {children}
            </em>
          ),

          // ================================================================
          // Blockquotes with styling
          // ================================================================
          blockquote: ({ children }) => (
            <blockquote
              className="border-l-4 pl-4 my-4 italic"
              style={{
                borderColor: 'var(--color-primary)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {children}
            </blockquote>
          ),

          // ================================================================
          // Links open in new tab.
          //
          // F.5: links whose text is a bracketed-digit citation (`[1]`, `1`,
          // `^1`) OR whose href is a GFM-footnote anchor render as a compact
          // chip instead of an underlined URL word. Everything else keeps
          // the existing look-and-feel.
          // ================================================================
          a: ({ href, children, title }) => {
            const linkText = React.Children.toArray(children)
              .map(c => (typeof c === 'string' ? c : ''))
              .join('')
              .trim();
            const citation = detectCitation(linkText, href, typeof title === 'string' ? title : null);

            if (citation) {
              return (
                <a
                  href={citation.href || '#'}
                  target={citation.isFootnote ? undefined : '_blank'}
                  rel={citation.isFootnote ? undefined : 'noopener noreferrer'}
                  title={citation.title || citation.href || `Source ${citation.label}`}
                  aria-label={`Citation ${citation.label}${citation.href ? `, ${citation.href}` : ''}`}
                  data-testid="citation-chip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 16,
                    padding: '0 4px',
                    margin: '0 1px',
                    borderRadius: 3,
                    fontSize: '0.72em',
                    fontWeight: 600,
                    lineHeight: 1,
                    color: 'var(--color-primary, var(--user-accent-primary))',
                    background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
                    textDecoration: 'none',
                    verticalAlign: 'baseline',
                    transition: 'background 120ms ease, border-color 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      'color-mix(in srgb, var(--color-primary) 22%, transparent)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      'color-mix(in srgb, var(--color-primary) 12%, transparent)';
                  }}
                >
                  {citation.label}
                </a>
              );
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>

      {/* Streaming cursor */}
      {isStreaming && (
        <span
          className="animate-pulse inline-block"
          style={{
            width: '2px',
            height: '14px',
            marginLeft: '2px',
            backgroundColor: 'var(--color-primary)',
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </div>
  );
});

SharedMarkdownRenderer.displayName = 'SharedMarkdownRenderer';

export default SharedMarkdownRenderer;
