/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SharedMarkdownRenderer - SINGLE SOURCE OF TRUTH for markdown rendering
 *
 * This component is used by ALL markdown rendering paths:
 * - AgenticActivityStream (streaming view)
 * - EnhancedMessageContent (final view)
 * - SmoothStreamingText (animated streaming)
 * - InlineMessageContent (inline messages)
 * - CodeModeLayoutV2 (code mode)
 *
 * This ensures streaming content looks IDENTICAL to final rendered content.
 * No more "4th wall breaking" where streaming looks different from completed messages.
 *
 * Features:
 * - GFM (tables, strikethrough, autolinks, task lists)
 * - Math/LaTeX (KaTeX)
 * - Syntax-highlighted code blocks
 * - Interactive artifacts (HTML, React, SVG)
 * - Charts (Recharts)
 * - Diagrams (ReactFlow, Mermaid, Draw.io, Venn)
 * - Milvus image:// protocol support
 * - Excel-style professional table styling
 * - Sanitization
 *
 * @copyright 2026 Gnomus.ai
 */

import React, { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import 'katex/dist/katex.min.css';

import ShikiCodeBlock from './ShikiCodeBlock';
import ArtifactRenderer from './ArtifactRenderer';
import ChartRenderer from './ChartRenderer';
import SvgDiagram from './SvgDiagram';
import ReactFlowDiagram from '@/components/diagrams/ReactFlowDiagram';
import { VennDiagram, parseVennJson } from '@/components/diagrams/VennDiagram';
import { DrawioDiagramViewer } from '@/components/diagrams/DrawioDiagramViewer';
import { Code, ChevronDown, ChevronRight } from '@/shared/icons';

// Custom sanitize schema that allows KaTeX elements and image:// protocol
const sanitizeSchema = {
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
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel']
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'image']
  }
};

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

  useEffect(() => {
    if (src?.startsWith('image://')) {
      const imageId = src.replace('image://', '');
      setLoading(true);
      setImageError(false);

      fetch(`/api/images/${imageId}`, { credentials: 'include' })
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
    return (
      <div className="rounded-lg my-4 flex items-center justify-center" style={{ ...containerStyle, border: '1px solid var(--callout-error-border)', backgroundColor: 'var(--callout-error-bg)' }}>
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>Failed to load image</div>
      </div>
    );
  }

  const finalSrc = isImageProtocol ? imageSrc : (imageSrc || src);
  if (isImageProtocol && !imageSrc) {
    return (
      <div className="rounded-lg my-4 flex items-center justify-center border border-border/20 bg-bg-tertiary/50" style={containerStyle}>
        <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Loading image...</div>
      </div>
    );
  }

  const [imgLoaded, setImgLoaded] = useState(false);

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
        <img
          src={finalSrc}
          alt={alt || 'Generated image'}
          className="rounded-lg shadow-lg max-w-full h-auto cursor-pointer transition-opacity hover:opacity-90"
          style={{ maxHeight: '512px', objectFit: 'contain', display: imgLoaded || isImageProtocol ? 'block' : 'none' }}
          onClick={() => setIsFullscreen(true)}
          onError={() => setImageError(true)}
          onLoad={() => setImgLoaded(true)}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all rounded-lg pointer-events-none">
          <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
            Click to expand
          </span>
        </div>
      </div>

      {isFullscreen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 cursor-pointer" onClick={() => setIsFullscreen(false)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors z-10" onClick={() => setIsFullscreen(false)} aria-label="Close fullscreen">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">Press ESC or click anywhere to close</div>
          <img src={finalSrc} alt={alt || 'Generated image'} className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
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
 * Extract title from SVG or Mermaid code
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
  html: '🌐', react: '⚛️', svg: '🎨', mermaid: '📐', chart: '📊',
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
      <span style={{ fontWeight: 500, color: 'var(--color-primary, #6366f1)' }}>{title}</span>
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
 * URL transform to allow custom protocols
 */
const urlTransform = (url: string): string => {
  // Allow our custom image:// protocol
  if (url.startsWith('image://')) return url;
  // Allow data URLs
  if (url.startsWith('data:')) return url;
  // Allow standard protocols
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) return url;
  // Block other protocols for security
  return '';
};

// Throttle interval for markdown parsing during streaming (ms)
const MARKDOWN_THROTTLE_MS = 100;
// Content length threshold for throttling
const THROTTLE_CONTENT_LENGTH = 500;

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

    // Convert \( ... \) to $...$
    result = result.replace(/\\\((.*?)\\\)/g, '$$$1$$');
    // Convert \[ ... \] to $$...$$
    result = result.replace(/\\\[(.*?)\\\]/g, '$$$$$$1$$$$');

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
      // Inline style: fontSize needs to be explicit (prose-sm-tight CSS
      // handles the rest of the typography scale). lineHeight + color
      // pulled forward from the previous duplicate style block that was
      // left in place during a merge — collapsed into one object here.
      style={{
        fontSize: '15.5px',
        lineHeight: 1.65,
        color: 'var(--color-text)',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeKatex as any,
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

            // Inline code
            if (isInline) {
              return (
                <code
                  className="text-sm font-mono"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: 'var(--text-secondary, #b8b8c0)',
                    padding: '1px 6px',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: 400,
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
                <div className="my-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Simple inline rendering - no nested artifact detection
                      code: ({ children, className: nestedClassName, ...nestedProps }) => {
                        const isNestedInline = !String(children).includes('\n');
                        if (isNestedInline) {
                          return <code className="text-sm font-mono px-1 bg-gray-100 dark:bg-gray-700 rounded" {...nestedProps}>{children}</code>;
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

            // Mermaid diagrams
            if (language === 'mermaid') {
              return (
                <ArtifactSourceToggle code={codeString} language="plaintext" theme={theme} onCopy={handleCopy}>
                  <ArtifactRenderer
                    code={codeString}
                    type="mermaid"
                    theme={theme}
                  />
                </ArtifactSourceToggle>
              );
            }

            // LaTeX/math blocks
            if (language === 'latex' || language === 'tex' || language === 'math') {
              return (
                <ArtifactSourceToggle code={codeString} language="latex" theme={theme} onCopy={handleCopy}>
                  <ArtifactRenderer code={codeString} type="latex" theme={theme} />
                </ArtifactSourceToggle>
              );
            }

            // CSV data tables
            if (language === 'csv') {
              return (
                <ArtifactSourceToggle code={codeString} language="plaintext" theme={theme} onCopy={handleCopy}>
                  <ArtifactRenderer code={codeString} type="csv" theme={theme} />
                </ArtifactSourceToggle>
              );
            }

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

            // Interactive artifacts
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

            // HTML blocks
            if (language === 'html' || language === 'htm') {
              const htmlTitle = extractTitle(codeString) || 'HTML Document';
              return (
                <div style={{ background: 'transparent', margin: '-16px', padding: '8px 0' }}>
                  <ArtifactTag title={htmlTitle} type="html" theme={theme}
                    onClick={() => openInCanvas(codeString, 'html', htmlTitle, 'html')} />
                </div>
              );
            }

            // React/JSX blocks
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
            return (
              <div className="my-4 relative">
                {isStreaming && (
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-2 px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    Live
                  </div>
                )}
                <ShikiCodeBlock
                  code={codeString}
                  language={language || 'plaintext'}
                  theme={theme}
                  onCopy={handleCopy}
                  onExecute={onExecute}
                  executable={executable}
                  isStreaming={isStreaming}
                />
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
          // Excel-style professional table styling with alternating accent colors
          // Uses --color-primary as the accent color for headers and alternating rows
          // NO row numbers - clean professional table appearance
          // ================================================================
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 rounded-lg excel-table-container">
              <table className="min-w-full border-collapse excel-table">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="sticky top-0 z-10">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="excel-tbody">
              {children}
            </tbody>
          ),
          tr: ({ children, ...props }) => {
            // Check if this is in thead (has th children)
            const childArray = React.Children.toArray(children);
            const isHeader = childArray.some(
              (child: any) => child?.type === 'th' || child?.props?.node?.tagName === 'th'
            );

            if (isHeader) {
              return (
                <tr {...props}>
                  {children}
                </tr>
              );
            }

            // Data row - uses CSS nth-child for alternating colors
            return (
              <tr className="excel-data-row transition-colors" {...props}>
                {children}
              </tr>
            );
          },
          th: ({ children }) => (
            <th
              className="px-4 py-2.5 text-left font-semibold border-r border-white/20 last:border-r-0 whitespace-nowrap"
              style={{
                fontSize: '13px',
                textTransform: 'none',
                letterSpacing: '0',
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="px-4 py-2 border-r border-b border-[var(--color-border)] last:border-r-0"
              style={{
                fontSize: '13px',
              }}
            >
              {children}
            </td>
          ),

          // ================================================================
          // Professional headings with colored accents
          // ================================================================
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mt-6 mb-4 pb-2 border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mt-5 mb-3 pb-1 border-b border-[var(--color-primary)]/50 text-[var(--color-text)]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-4 mb-2 text-[var(--color-primary)]">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-semibold mt-3 mb-2 text-[var(--color-text-secondary)]">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-semibold mt-2 mb-1 text-[var(--color-text-secondary)]">
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
          ul: ({ children }) => (
            <ul className="my-3 pl-5 space-y-1 list-disc marker:text-[var(--color-primary)]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 pl-5 space-y-1 list-decimal marker:text-[var(--color-primary)] marker:font-semibold">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-1">
              {children}
            </li>
          ),

          // ================================================================
          // Horizontal rule with gradient
          // ================================================================
          hr: () => (
            <hr className="my-6 border-0 h-px bg-gradient-to-r from-transparent via-[var(--color-primary)]/50 to-transparent" />
          ),

          // ================================================================
          // Enhanced paragraph spacing
          // ================================================================
          p: ({ children }) => (
            <p className="my-3 leading-relaxed">
              {children}
            </p>
          ),

          // ================================================================
          // Strong/bold with subtle color
          // ================================================================
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--color-text)]">
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
          // Links open in new tab
          // ================================================================
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-primary)] hover:underline"
            >
              {children}
            </a>
          ),
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
