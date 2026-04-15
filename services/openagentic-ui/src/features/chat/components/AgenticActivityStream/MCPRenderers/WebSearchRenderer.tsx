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
 * WebSearchRenderer - Specialized renderer for web search MCP calls
 *
 * Displays search results in a rich format with:
 * - Favicons for each result
 * - Clickable titles
 * - Snippet previews
 * - Result count
 */

import React from 'react';
import { Globe, Check, Loader2, ExternalLink } from '@/shared/icons';
import type { MCPRendererProps, WebSearchOutput, WebSearchResult } from './types';

// Try to extract favicon URL from a domain
const getFaviconUrl = (url: string): string => {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
};

// Parse the output to extract search results
const parseSearchOutput = (output: unknown): WebSearchResult[] => {
  if (!output) return [];

  // Handle string output (might be JSON)
  if (typeof output === 'string') {
    try {
      output = JSON.parse(output);
    } catch {
      return [];
    }
  }

  const data = output as WebSearchOutput;

  // Check for results array
  if (Array.isArray(data.results)) {
    return data.results;
  }

  // Check if the output itself is an array
  if (Array.isArray(output)) {
    return output.filter((item): item is WebSearchResult =>
      item && typeof item === 'object' && 'url' in item
    );
  }

  return [];
};

// Parse query from input
const parseQuery = (input: unknown): string => {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed.query || parsed.q || parsed.search || input;
    } catch {
      return input;
    }
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    return String(obj.query || obj.q || obj.search || '');
  }
  return '';
};

export const WebSearchRenderer: React.FC<MCPRendererProps> = ({
  input,
  output,
  status,
  isComplete,
}) => {
  const query = parseQuery(input);
  const results = parseSearchOutput(output);
  const hasResults = results.length > 0;

  return (
    <div
      style={{
        borderRadius: 6,
        border: '1px solid color-mix(in srgb, var(--color-border) 60%, transparent)',
        borderLeft: `2px solid ${status === 'success' ? '#2ea043' : status === 'error' ? '#da3633' : '#58a6ff'}`,
        background: status === 'success' ? 'rgba(46, 160, 67, 0.06)' : status === 'error' ? 'rgba(218, 54, 51, 0.06)' : 'rgba(88, 166, 255, 0.06)',
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
          borderBottom: hasResults ? '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' : 'none',
        }}
      >
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {status === 'calling' ? (
            <Loader2 size={14} style={{ color: '#58a6ff', animation: 'spin 1s linear infinite' }} />
          ) : status === 'success' ? (
            <Check size={14} style={{ color: '#2ea043' }} />
          ) : (
            <Globe size={14} style={{ color: '#58a6ff' }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontWeight: 500,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: 'var(--color-text-secondary)',
            }}
          >
            Web Search{query ? `: "${query}"` : ''}
          </span>
          {hasResults && (
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                marginLeft: 8,
              }}
            >
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      {hasResults && (
        <div style={{ padding: '8px 12px' }}>
          {results.slice(0, 5).map((result, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 0',
                borderBottom: idx < Math.min(results.length, 5) - 1 ? '1px solid var(--color-border-light, rgba(0,0,0,0.05))' : 'none',
              }}
            >
              <img
                src={result.favicon || getFaviconUrl(result.url)}
                alt=""
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 2,
                  marginTop: 2,
                  flexShrink: 0,
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-primary)',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {result.title}
                  </span>
                  <ExternalLink size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                </a>
                {result.snippet && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                      marginTop: 2,
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {result.snippet}
                  </div>
                )}
              </div>
            </div>
          ))}
          {results.length > 5 && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-muted)',
                padding: '8px 0 0',
                textAlign: 'center',
              }}
            >
              +{results.length - 5} more results
            </div>
          )}
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
          Searching...
        </div>
      )}
    </div>
  );
};

export default WebSearchRenderer;
