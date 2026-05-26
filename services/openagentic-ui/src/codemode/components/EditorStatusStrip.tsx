import React from 'react';

export interface EditorStatusStripProps {
  path: string | null;
  encoding?: string;
  eol?: 'LF' | 'CRLF';
  languageLabel: string;
  cursor: { line: number; column: number } | null;
  sizeBytes: number;
  onDownload?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Last 2 path segments, e.g. "backend/app/main.py". */
function lastTwoSegments(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

const DISPLAY_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  json: 'JSON',
  python: 'Python',
  markdown: 'Markdown',
  yaml: 'YAML',
  ini: 'TOML',
  html: 'HTML',
  css: 'CSS',
  shell: 'Shell',
  go: 'Go',
  rust: 'Rust',
  xml: 'XML',
  sql: 'SQL',
  dockerfile: 'Dockerfile',
  plaintext: 'Plain Text',
};

function displayLabel(lang: string): string {
  return DISPLAY_LABELS[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

export function EditorStatusStrip({
  path,
  encoding = 'UTF-8',
  eol = 'LF',
  languageLabel,
  cursor,
  sizeBytes,
  onDownload,
}: EditorStatusStripProps): React.ReactElement {
  if (!path) {
    return (
      <div className="fp-status">
        <span className="cell">No file open</span>
      </div>
    );
  }

  return (
    <div className="fp-status">
      <span className="cell path">
        <span className="val">{lastTwoSegments(path)}</span>
      </span>
      <span className="sep">·</span>
      <span className="cell">
        <span className="val">{encoding}</span>
      </span>
      <span className="sep">·</span>
      <span className="cell">
        <span className="val">{eol}</span>
      </span>
      <span className="sep">·</span>
      <span className="cell">
        <span className="val">{displayLabel(languageLabel)}</span>
      </span>
      <div className="right">
        {cursor && (
          <>
            <span className="cell">
              Ln <span className="val">{cursor.line}</span>, Col{' '}
              <span className="val">{cursor.column}</span>
            </span>
            <span className="sep">·</span>
          </>
        )}
        <span className="cell">
          <span className="val">{formatBytes(sizeBytes)}</span>
        </span>
        {onDownload && (
          <button
            className="fp-status-download"
            title="Download"
            aria-label="Download file"
            onClick={onDownload}
          >
            ⇩
          </button>
        )}
      </div>
    </div>
  );
}
