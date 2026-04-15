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
 * WebFetchRenderer - Professional web fetch tool call display
 *
 * Clean card design matching the unified MCP renderer style:
 * - Left border accent by status
 * - Subtle tinted background
 * - Colored icons (no solid circles)
 * - Favicon + domain display
 * - Content preview with word count
 */

import React, { useState } from 'react';
import { Globe, Check, Loader2, ChevronDown, ChevronRight, ExternalLink, XCircle } from '@/shared/icons';
import type { MCPRendererProps } from './types';

// Parse URL from input
const parseUrl = (input: unknown): string => {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed.url || input;
    } catch {
      return input;
    }
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    return String(obj.url || '');
  }
  return '';
};

// Parse fetch output
const parseFetchOutput = (output: unknown): {
  title?: string;
  content?: string;
  wordCount?: number;
} => {
  if (!output) return {};

  let data = output;
  if (typeof output === 'string') {
    try {
      data = JSON.parse(output);
    } catch {
      const words = output.split(/\s+/).length;
      return { content: output, wordCount: words };
    }
  }

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    let content = '';
    if (Array.isArray(obj.content)) {
      content = (obj.content as any[])
        .filter((c: any) => c.type === 'text' && c.text)
        .map((c: any) => c.text)
        .join('\n');
    } else {
      content = String(obj.content || obj.text || obj.markdown || '');
    }
    const words = content.split(/\s+/).length;
    return { title: obj.title as string | undefined, content, wordCount: words };
  }

  return {};
};

const getDomain = (url: string): string => {
  try { return new URL(url).hostname; } catch { return url; }
};

const getFaviconUrl = (url: string): string => {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch { return ''; }
};

const getReadTime = (wordCount: number): string => {
  const minutes = Math.ceil(wordCount / 200);
  return `${minutes} min read`;
};

const STATUS_COLORS = {
  success: { accent: '#2ea043', icon: '#2ea043', bg: 'rgba(46, 160, 67, 0.06)' },
  error: { accent: '#da3633', icon: '#da3633', bg: 'rgba(218, 54, 51, 0.06)' },
  calling: { accent: '#58a6ff', icon: '#58a6ff', bg: 'rgba(88, 166, 255, 0.06)' },
} as const;

export const WebFetchRenderer: React.FC<MCPRendererProps> = ({
  input,
  output,
  status,
}) => {
  const [expanded, setExpanded] = useState(false);
  const url = parseUrl(input);
  const { title, content, wordCount } = parseFetchOutput(output);
  const domain = getDomain(url);
  const hasContent = Boolean(content);

  const colors = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.calling;

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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: hasContent ? 'pointer' : 'default',
          borderBottom: expanded && hasContent ? '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' : 'none',
        }}
        onClick={() => hasContent && setExpanded(!expanded)}
      >
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {status === 'calling' ? (
            <Loader2 size={14} style={{ color: colors.icon, animation: 'spin 1s linear infinite' }} />
          ) : status === 'error' ? (
            <XCircle size={14} style={{ color: colors.icon }} />
          ) : status === 'success' ? (
            <Check size={14} style={{ color: colors.icon }} />
          ) : (
            <Globe size={14} style={{ color: colors.icon }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasContent && (
            expanded
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          <img
            src={getFaviconUrl(url)}
            alt=""
            style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span
            style={{
              fontWeight: 500,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title || domain}
          </span>
        </div>

        {/* Meta badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {wordCount && wordCount > 0 && status === 'success' && (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                color: 'var(--color-text-muted)',
                padding: '1px 6px',
                borderRadius: 3,
                background: 'var(--color-bg-tertiary)',
              }}
            >
              {wordCount.toLocaleString()} words
            </span>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={12} style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />
            </a>
          )}
        </div>
      </div>

      {/* Collapsed preview */}
      {!expanded && content && (
        <div
          style={{
            padding: '0 12px 8px 34px',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {content.split('\n')[0].substring(0, 120)}
          {content.length > 120 && '...'}
        </div>
      )}

      {/* Expanded content */}
      {expanded && content && (
        <div
          style={{
            maxHeight: 400,
            overflow: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
              color: 'var(--color-text-muted)',
              padding: '6px 12px 2px',
              opacity: 0.7,
            }}
          >
            Content
          </div>
          <div
            style={{
              margin: 0,
              padding: '2px 12px 8px',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {content.substring(0, 1500)}
            {content.length > 1500 && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                {'\n\n'}... ({wordCount?.toLocaleString()} words total)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Loading state */}
      {status === 'calling' && (
        <div
          style={{
            padding: '12px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--color-text-muted)',
          }}
        >
          Fetching page...
        </div>
      )}
    </div>
  );
};

export default WebFetchRenderer;
