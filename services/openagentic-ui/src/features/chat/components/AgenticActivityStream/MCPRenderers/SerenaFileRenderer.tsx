/**
 * SerenaFileRenderer - Professional file operation display
 *
 * Clean card design matching the unified MCP renderer style:
 * - Left border accent by status
 * - Subtle tinted background
 * - Colored icons (no solid circles)
 * - File path with line count badge
 * - Syntax-highlighted preview
 */

import React, { useState } from 'react';
import { onKeyActivate } from '@/utils/a11y';
import { FileText, Folder, Check, Loader2, ChevronDown, ChevronRight, XCircle } from '@/shared/icons';
import type { MCPRendererProps } from './types';

const parseFilePath = (input: unknown): string => {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed.relative_path || parsed.path || parsed.file_path || input;
    } catch { return input; }
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    return String(obj.relative_path || obj.path || obj.file_path || '');
  }
  return '';
};

const parseFileContent = (output: unknown): { content: string; lines: number } => {
  if (!output) return { content: '', lines: 0 };

  let content = '';
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output);
      content = parsed.content || parsed.text || output;
    } catch { content = output; }
  } else if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    content = String(obj.content || obj.text || '');
  }

  const lines = (content.match(/\n/g) || []).length + 1;
  return { content, lines };
};

const getFileLanguage = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php',
    cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', css: 'css', scss: 'scss',
    html: 'html', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    sql: 'sql', sh: 'bash', bash: 'bash',
  };
  return langMap[ext] || 'text';
};

const STATUS_COLORS = {
  success: { accent: '#2ea043', icon: '#2ea043', bg: 'rgba(46, 160, 67, 0.06)' },
  error: { accent: '#da3633', icon: '#da3633', bg: 'rgba(218, 54, 51, 0.06)' },
  calling: { accent: '#58a6ff', icon: '#58a6ff', bg: 'rgba(88, 166, 255, 0.06)' },
} as const;

export const SerenaFileRenderer: React.FC<MCPRendererProps> = ({
  toolName,
  input,
  output,
  status,
}) => {
  const [expanded, setExpanded] = useState(false);
  const filePath = parseFilePath(input);
  const { content, lines } = parseFileContent(output);
  const fileName = filePath.split('/').pop() || filePath;
  const language = getFileLanguage(filePath);
  const isDirectory = toolName.includes('list_dir');

  const previewLines = content.split('\n').slice(0, 10);
  const hasMoreContent = content.split('\n').length > 10;

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
        role="button"
        tabIndex={0}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: content ? 'pointer' : 'default',
          borderBottom: expanded && content ? '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' : 'none',
        }}
        onClick={() => content && setExpanded(!expanded)}
        onKeyDown={onKeyActivate(() => content && setExpanded(!expanded))}
      >
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {status === 'calling' ? (
            <Loader2 size={14} style={{ color: colors.icon, animation: 'spin 1s linear infinite' }} />
          ) : status === 'error' ? (
            <XCircle size={14} style={{ color: colors.icon }} />
          ) : status === 'success' ? (
            <Check size={14} style={{ color: colors.icon }} />
          ) : isDirectory ? (
            <Folder size={14} style={{ color: colors.icon }} />
          ) : (
            <FileText size={14} style={{ color: colors.icon }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {content && (
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
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </span>
          {filePath !== fileName && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                opacity: 0.7,
              }}
            >
              {filePath}
            </span>
          )}
        </div>

        {/* Line count badge */}
        {lines > 0 && status === 'success' && (
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
            {lines} lines
          </span>
        )}
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
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          <pre
            style={{
              margin: 0,
              padding: '8px 12px',
              fontSize: 11,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              lineHeight: 1.4,
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <code className={`language-${language}`}>
              {previewLines.join('\n')}
              {hasMoreContent && '\n...'}
            </code>
          </pre>
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
          Reading file...
        </div>
      )}
    </div>
  );
};

export default SerenaFileRenderer;
