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
 * SerenaSearchRenderer - Professional search operation display
 *
 * Clean card design matching the unified MCP renderer style:
 * - Left border accent by status
 * - Subtle tinted background
 * - Colored icons (no solid circles)
 * - Search pattern with match count
 * - Grouped file results with line numbers
 */

import React, { useState } from 'react';
import { Search, FileText, Check, Loader2, ChevronDown, ChevronRight, Code, XCircle } from '@/shared/icons';
import type { MCPRendererProps } from './types';

interface SearchMatch {
  file: string;
  line?: number;
  content?: string;
  symbol?: string;
}

const parseSearchInput = (input: unknown): { pattern: string; path?: string } => {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return {
        pattern: parsed.substring_pattern || parsed.pattern || parsed.name_path_pattern || parsed.name_path || input,
        path: parsed.relative_path,
      };
    } catch { return { pattern: input }; }
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    return {
      pattern: String(obj.substring_pattern || obj.pattern || obj.name_path_pattern || obj.name_path || ''),
      path: obj.relative_path as string | undefined,
    };
  }
  return { pattern: '' };
};

const parseSearchOutput = (output: unknown): SearchMatch[] => {
  if (!output) return [];

  let data = output;
  if (typeof output === 'string') {
    try { data = JSON.parse(output); } catch { return []; }
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    const matches: SearchMatch[] = [];
    for (const [file, value] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        value.forEach((match: unknown) => {
          if (typeof match === 'string') {
            matches.push({ file, content: match });
          } else if (typeof match === 'object' && match !== null) {
            const m = match as Record<string, unknown>;
            matches.push({
              file,
              line: m.line as number | undefined,
              content: m.content as string | undefined,
              symbol: m.symbol as string | undefined,
            });
          }
        });
      } else if (typeof value === 'string') {
        matches.push({ file, content: value });
      }
    }
    return matches;
  }

  if (Array.isArray(data)) {
    return data.map((item: unknown): SearchMatch => {
      if (typeof item === 'object' && item !== null) {
        const m = item as Record<string, unknown>;
        return {
          file: String(m.file || m.path || m.relative_path || ''),
          line: m.line as number | undefined,
          content: m.content as string | undefined,
          symbol: (m.symbol || m.name) as string | undefined,
        };
      }
      return { file: String(item), content: undefined };
    });
  }

  return [];
};

const groupByFile = (matches: SearchMatch[]): Map<string, SearchMatch[]> => {
  const groups = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const existing = groups.get(match.file) || [];
    existing.push(match);
    groups.set(match.file, existing);
  }
  return groups;
};

const STATUS_COLORS = {
  success: { accent: '#2ea043', icon: '#2ea043', bg: 'rgba(46, 160, 67, 0.06)' },
  error: { accent: '#da3633', icon: '#da3633', bg: 'rgba(218, 54, 51, 0.06)' },
  calling: { accent: '#58a6ff', icon: '#58a6ff', bg: 'rgba(88, 166, 255, 0.06)' },
} as const;

export const SerenaSearchRenderer: React.FC<MCPRendererProps> = ({
  toolName,
  input,
  output,
  status,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { pattern, path } = parseSearchInput(input);
  const matches = parseSearchOutput(output);
  const groupedMatches = groupByFile(matches);
  const fileCount = groupedMatches.size;
  const totalMatches = matches.length;
  const isSymbolSearch = toolName.includes('symbol');

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
          cursor: totalMatches > 0 ? 'pointer' : 'default',
          borderBottom: expanded && totalMatches > 0 ? '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' : 'none',
        }}
        onClick={() => totalMatches > 0 && setExpanded(!expanded)}
      >
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {status === 'calling' ? (
            <Loader2 size={14} style={{ color: colors.icon, animation: 'spin 1s linear infinite' }} />
          ) : status === 'error' ? (
            <XCircle size={14} style={{ color: colors.icon }} />
          ) : status === 'success' ? (
            <Check size={14} style={{ color: colors.icon }} />
          ) : isSymbolSearch ? (
            <Code size={14} style={{ color: colors.icon }} />
          ) : (
            <Search size={14} style={{ color: colors.icon }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {totalMatches > 0 && (
            expanded
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          <span
            style={{
              fontWeight: 500,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: 'var(--color-text-secondary)',
            }}
          >
            {isSymbolSearch ? 'Find Symbol' : 'Search'}
          </span>
          <code style={{
            fontSize: 11,
            backgroundColor: 'color-mix(in srgb, var(--color-text-muted) 10%, transparent)',
            padding: '1px 5px',
            borderRadius: 3,
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {pattern}
          </code>
        </div>

        {/* Match count badge */}
        {status === 'success' && totalMatches > 0 && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: 'var(--color-text-muted)',
              padding: '1px 6px',
              borderRadius: 3,
              background: 'var(--color-bg-tertiary)',
              flexShrink: 0,
            }}
          >
            {totalMatches} in {fileCount} file{fileCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Results */}
      {expanded && totalMatches > 0 && (
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {Array.from(groupedMatches.entries()).slice(0, 5).map(([file, fileMatches]) => (
            <div
              key={file}
              style={{
                borderBottom: '1px solid color-mix(in srgb, var(--color-border) 30%, transparent)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                }}
              >
                <FileText size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    color: 'var(--color-text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.split('/').pop()}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                  ({fileMatches.length})
                </span>
              </div>
              <div style={{ padding: '2px 12px 6px' }}>
                {fileMatches.slice(0, 3).map((match, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '2px 0',
                      fontSize: 11,
                    }}
                  >
                    {match.line && (
                      <span
                        style={{
                          color: 'var(--color-text-muted)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          minWidth: 36,
                          textAlign: 'right',
                          opacity: 0.7,
                        }}
                      >
                        :{match.line}
                      </span>
                    )}
                    <code
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        color: 'var(--color-text-secondary)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        flex: 1,
                      }}
                    >
                      {match.content?.substring(0, 100) || match.symbol}
                      {match.content && match.content.length > 100 && '...'}
                    </code>
                  </div>
                ))}
                {fileMatches.length > 3 && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', padding: '2px 0', opacity: 0.7 }}>
                    +{fileMatches.length - 3} more
                  </div>
                )}
              </div>
            </div>
          ))}
          {fileCount > 5 && (
            <div
              style={{
                padding: '6px 12px',
                fontSize: 11,
                color: 'var(--color-text-muted)',
                textAlign: 'center',
              }}
            >
              +{fileCount - 5} more files
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

export default SerenaSearchRenderer;
