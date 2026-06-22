/**
 * GenericMCPRenderer - Type-aware tool call display
 *
 * Renders tool call results with intelligent formatting based on content type:
 * - Search results -> result cards with title/url
 * - File listings -> compact file tree
 * - Errors -> red banner with message
 * - Simple text -> inline display
 * - Fallback -> syntax-highlighted collapsible JSON
 */

import React, { useState, useMemo } from 'react';
import { onKeyActivate } from '@/utils/a11y';
import { Check, Loader2, XCircle, ChevronDown, ChevronRight, Terminal, Globe, FileText, AlertCircle, Folder } from '@/shared/icons';
import type { MCPRendererProps } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractMCPContent = (data: unknown): string => {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.content) && obj.content.length > 0) {
      const textContent = obj.content.find((c: any) => c.type === 'text' && c.text);
      if (textContent?.text) return textContent.text;
    }
    if (obj.structuredContent && typeof obj.structuredContent === 'object') {
      const sc = obj.structuredContent as Record<string, unknown>;
      if (typeof sc.result === 'string') return sc.result;
    }
    if (typeof obj.result === 'string') return obj.result;
    if (typeof obj.text === 'string') return obj.text;
  }
  return JSON.stringify(data, null, 2);
};

const formatJson = (data: unknown): string => {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') {
    try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; }
  }
  return JSON.stringify(data, null, 2);
};

const truncate = (str: string, maxLen: number): { text: string; truncated: boolean } => {
  if (str.length <= maxLen) return { text: str, truncated: false };
  return { text: str.substring(0, maxLen), truncated: true };
};

// ---------------------------------------------------------------------------
// Content type detection
// ---------------------------------------------------------------------------

type ContentShape =
  | { kind: 'search_results'; results: Array<{ title: string; url?: string; snippet?: string }> }
  | { kind: 'file_listing'; files: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'simple_text'; text: string }
  | { kind: 'key_value'; entries: Array<{ key: string; value: string }> }
  | { kind: 'json'; raw: string };

function detectContentShape(output: unknown): ContentShape {
  if (!output) return { kind: 'simple_text', text: '' };

  // Try to work with the raw object
  const obj = typeof output === 'string' ? tryParse(output) : output;

  // Check for error shapes
  if (isErrorShape(obj)) {
    const msg = extractErrorMessage(obj);
    return { kind: 'error', message: msg };
  }

  // Check for search result arrays
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;

    // Array of results with title/url
    const results = o.results || o.items || o.data;
    if (Array.isArray(results) && results.length > 0 && results[0] && typeof results[0] === 'object') {
      const first = results[0] as Record<string, unknown>;
      if (first.title || first.name || first.url || first.link) {
        return {
          kind: 'search_results',
          results: results.slice(0, 10).map((r: any) => ({
            title: r.title || r.name || r.url || 'Result',
            url: r.url || r.link || r.href,
            snippet: r.snippet || r.description || r.summary,
          })),
        };
      }
    }

    // File listing (array of strings that look like paths)
    const files = o.files || o.entries || o.paths;
    if (Array.isArray(files) && files.length > 0 && typeof files[0] === 'string') {
      return { kind: 'file_listing', files: files.slice(0, 50) };
    }

    // Plain key-value objects (shallow, few keys)
    const keys = Object.keys(o);
    if (keys.length > 0 && keys.length <= 12 && keys.every(k => {
      const v = o[k];
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null;
    })) {
      return {
        kind: 'key_value',
        entries: keys.map(k => ({ key: k, value: String(o[k] ?? '') })),
      };
    }
  }

  // MCP content extraction
  const text = extractMCPContent(output);

  // Simple short text
  if (text.length < 500 && !text.startsWith('{') && !text.startsWith('[')) {
    return { kind: 'simple_text', text };
  }

  // Fallback: formatted JSON
  return { kind: 'json', raw: formatJson(output) };
}

function tryParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

function isErrorShape(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (o.error) return true;
  if (o.isError === true) return true;
  if (o.success === false) return true;
  if (typeof o.status === 'number' && (o.status as number) >= 400) return true;
  return false;
}

function extractErrorMessage(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return String(obj);
  const o = obj as Record<string, unknown>;
  if (typeof o.error === 'string') return o.error;
  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>;
    return (e.message as string) || JSON.stringify(e);
  }
  if (typeof o.message === 'string') return o.message;
  return JSON.stringify(obj, null, 2);
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

const SearchResultsView: React.FC<{ results: Array<{ title: string; url?: string; snippet?: string }> }> = ({ results }) => (
  <div style={{ padding: '4px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
    {results.map((r, i) => (
      <div key={i} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 8px',
        borderRadius: 4,
        background: 'color-mix(in srgb, var(--color-border) 15%, transparent)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={12} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {r.title}
          </span>
        </div>
        {r.url && (
          <span style={{
            fontSize: 10,
            color: 'var(--color-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            paddingLeft: 18,
          }}>
            {r.url}
          </span>
        )}
        {r.snippet && (
          <span style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            lineHeight: 1.4,
            paddingLeft: 18,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {r.snippet}
          </span>
        )}
      </div>
    ))}
  </div>
);

const FileListingView: React.FC<{ files: string[] }> = ({ files }) => (
  <div style={{ padding: '4px 12px 8px' }}>
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      lineHeight: 1.5,
      color: 'var(--color-text-secondary)',
    }}>
      {files.slice(0, 25).map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          {f.endsWith('/') ? (
            <Folder size={11} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          ) : (
            <FileText size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
        </div>
      ))}
      {files.length > 25 && (
        <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: 4 }}>
          ... and {files.length - 25} more
        </div>
      )}
    </div>
  </div>
);

const ErrorBannerView: React.FC<{ message: string }> = ({ message }) => (
  <div style={{
    margin: '4px 12px 8px',
    padding: '8px 10px',
    borderRadius: 4,
    background: 'color-mix(in srgb, var(--ap-error) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--ap-error) 25%, transparent)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  }}>
    <AlertCircle size={14} style={{ color: 'var(--ap-error)', flexShrink: 0, marginTop: 1 }} />
    <span style={{
      fontSize: 12,
      lineHeight: 1.5,
      color: 'var(--ap-error)',
      wordBreak: 'break-word',
    }}>
      {message.length > 500 ? message.slice(0, 500) + '...' : message}
    </span>
  </div>
);

const KeyValueView: React.FC<{ entries: Array<{ key: string; value: string }> }> = ({ entries }) => (
  <div style={{ padding: '4px 12px 8px' }}>
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      gap: '2px 12px',
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
    }}>
      {entries.map(({ key, value }, i) => (
        <React.Fragment key={i}>
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{key}</span>
          <span style={{
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{value}</span>
        </React.Fragment>
      ))}
    </div>
  </div>
);

const CollapsibleJsonView: React.FC<{ raw: string }> = ({ raw }) => {
  const [expanded, setExpanded] = useState(false);
  const preview = raw.split('\n').slice(0, 3).join('\n');
  const hasMore = raw.split('\n').length > 3;

  return (
    <div style={{ padding: '4px 12px 8px' }}>
      <pre style={{
        margin: 0,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        lineHeight: 1.4,
        color: 'var(--color-text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: expanded ? 300 : 60,
        overflow: expanded ? 'auto' : 'hidden',
        transition: 'max-height 0.2s ease',
      }}>
        {expanded ? (raw.length > 3000 ? raw.slice(0, 3000) + '\n...' : raw) : preview}
      </pre>
      {hasMore && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--color-primary)',
            padding: '2px 0',
            marginTop: 2,
          }}
        >
          {expanded ? 'Show less' : 'Show more...'}
        </button>
      )}
    </div>
  );
};

const SimpleTextView: React.FC<{ text: string }> = ({ text }) => (
  <div style={{
    padding: '0 12px 8px 34px',
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--color-text-secondary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  }}>
    {text}
  </div>
);

// ---------------------------------------------------------------------------
// Status colors
// ---------------------------------------------------------------------------

const STATUS_COLORS = {
  success: {
    accent: 'var(--cm-success)',
    icon: 'var(--cm-success)',
    bg: 'color-mix(in srgb, var(--cm-success) 6%, transparent)',
  },
  error: {
    accent: 'var(--cm-error)',
    icon: 'var(--cm-error)',
    bg: 'color-mix(in srgb, var(--cm-error) 6%, transparent)',
  },
  calling: {
    accent: 'var(--cm-info)',
    icon: 'var(--cm-info)',
    bg: 'color-mix(in srgb, var(--cm-info) 6%, transparent)',
  },
} as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const GenericMCPRenderer: React.FC<MCPRendererProps> = ({
  toolName,
  input,
  output,
  status,
  duration,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showInput, setShowInput] = useState(false);

  const inputStr = formatJson(input);
  const contentShape = useMemo(() => detectContentShape(output), [output]);
  const hasOutput = contentShape.kind !== 'simple_text' || contentShape.text !== '';
  const hasDetails = !!inputStr || hasOutput;
  const colors = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.calling;

  // Generate a 1-line summary for collapsed state
  const collapsedSummary = useMemo((): string => {
    switch (contentShape.kind) {
      case 'search_results':
        return `${contentShape.results.length} result${contentShape.results.length !== 1 ? 's' : ''}`;
      case 'file_listing':
        return `${contentShape.files.length} file${contentShape.files.length !== 1 ? 's' : ''}`;
      case 'error':
        return contentShape.message.split('\n')[0].slice(0, 80);
      case 'key_value':
        return contentShape.entries.map(e => `${e.key}: ${e.value}`).slice(0, 3).join(', ');
      case 'simple_text':
        return contentShape.text.split('\n')[0].slice(0, 80);
      case 'json': {
        const firstLine = contentShape.raw.split('\n')[0].slice(0, 80);
        return firstLine;
      }
    }
  }, [contentShape]);

  return (
    <div
      style={{
        borderRadius: 6,
        border: '1px solid color-mix(in srgb, var(--color-border) 60%, transparent)',
        borderLeft: `2px solid ${colors.accent}`,
        background: colors.bg,
        overflow: 'hidden',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      {/* Header */}
      <div
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        aria-expanded={hasDetails ? expanded : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: hasDetails ? 'pointer' : 'default',
        }}
        onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
        onKeyDown={hasDetails ? onKeyActivate(() => setExpanded(!expanded)) : undefined}
      >
        {/* Status icon */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {status === 'calling' ? (
            <Loader2 size={14} style={{ color: colors.icon, animation: 'spin 1s linear infinite' }} />
          ) : status === 'error' ? (
            <XCircle size={14} style={{ color: colors.icon }} />
          ) : status === 'success' ? (
            <Check size={14} style={{ color: colors.icon }} />
          ) : (
            <Terminal size={14} style={{ color: colors.icon }} />
          )}
        </div>

        {/* Tool name */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasDetails && (
            expanded
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          <span
            style={{
              fontWeight: 500,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {toolName}
          </span>
        </div>

        {/* Collapsed summary */}
        {!expanded && collapsedSummary && status !== 'calling' && (
          <span style={{
            fontSize: 11,
            color: contentShape.kind === 'error' ? 'var(--ap-error)' : 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '40%',
            flexShrink: 1,
          }}>
            {collapsedSummary}
          </span>
        )}

        {/* Duration badge */}
        {duration != null && status === 'success' && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-muted)',
              padding: '1px 6px',
              borderRadius: 3,
              background: 'var(--color-bg-tertiary)',
              flexShrink: 0,
            }}
          >
            {duration}ms
          </span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div
          style={{
            borderTop: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
          }}
        >
          {/* Input toggle */}
          {inputStr && (
            <div>
              <button
                onClick={(e) => { e.stopPropagation(); setShowInput(!showInput); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 12px',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase' as const,
                  color: 'var(--color-text-muted)',
                  opacity: 0.7,
                  width: '100%',
                  textAlign: 'left' as const,
                }}
              >
                {showInput ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Input
              </button>
              {showInput && (
                <pre style={{
                  margin: 0,
                  padding: '2px 12px 8px',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1.4,
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 150,
                  overflow: 'auto',
                }}>
                  {inputStr.length > 1000 ? inputStr.slice(0, 1000) + '...' : inputStr}
                </pre>
              )}
            </div>
          )}

          {/* Type-aware output rendering */}
          {hasOutput && (() => {
            switch (contentShape.kind) {
              case 'search_results':
                return <SearchResultsView results={contentShape.results} />;
              case 'file_listing':
                return <FileListingView files={contentShape.files} />;
              case 'error':
                return <ErrorBannerView message={contentShape.message} />;
              case 'key_value':
                return <KeyValueView entries={contentShape.entries} />;
              case 'simple_text':
                return <SimpleTextView text={contentShape.text} />;
              case 'json':
                return <CollapsibleJsonView raw={contentShape.raw} />;
            }
          })()}
        </div>
      )}
    </div>
  );
};

export default GenericMCPRenderer;
