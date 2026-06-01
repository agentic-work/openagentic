/**
 * Phase H (task #153) + v0.6.7 UX iteration — ArtifactPanel.
 *
 * Right-side slide-out panel that renders streaming artifacts produced
 * by the model. The panel opens on `artifact_open`, appends streamed
 * content on `artifact_delta` (one or many files), and freezes when
 * `artifact_close` fires with stats (bytes + lines + completion badge).
 *
 * Matches docs/release-plans/v0.6.7-ux-mockups/03-secure-api-build.html:
 *   header   ARTIFACT {title} · {language} · {N files} · {loc} loc · download.tar ×
 *   tabs     cmd/server/main.go | handlers/user.go ● | ...
 *   body     Shiki-highlighted preview of active file (live streaming cursor)
 *
 * Distinct from `CanvasPanel` which handles live HTML/React preview
 * execution. This is the stream-surface side; CanvasPanel still owns
 * the post-stream interactive preview.
 */
import React, { memo, useMemo, useState, useEffect } from 'react';
import ShikiCodeBlock from '@/features/chat/components/MessageContent/ShikiCodeBlock';
import type {
  ArtifactFile,
  ArtifactKind,
} from './types';

// The stream state in `useChatStream` uses a plain Record for files (not
// a Map). Accept both shapes so the panel is agnostic of the upstream
// wiring — the reducer in `useArtifactPanelStream.ts` still produces a
// Map for other consumers.
export interface ArtifactPanelRenderState {
  artifactId: string | null;
  kind: ArtifactKind;
  title: string;
  language?: string;
  fileName?: string;
  files: Record<string, ArtifactFile> | Map<string, ArtifactFile>;
  isOpen: boolean;
  isComplete: boolean;
  stats?: { bytes: number; lines: number } | null;
}

export interface ArtifactPanelProps {
  state: ArtifactPanelRenderState;
  onClose?: () => void;
  onDownload?: (files: ArtifactFile[], title: string) => void;
  theme?: 'light' | 'dark';
  className?: string;
}

function toFileArray(
  files: Record<string, ArtifactFile> | Map<string, ArtifactFile>,
): ArtifactFile[] {
  if (files instanceof Map) return Array.from(files.values());
  return Object.values(files);
}

function lookupFile(
  files: Record<string, ArtifactFile> | Map<string, ArtifactFile>,
  name: string,
): ArtifactFile | undefined {
  if (files instanceof Map) return files.get(name);
  return files[name];
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '0B';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

const KindLabel: Record<ArtifactKind, string> = {
  markdown: 'markdown',
  code: 'code',
  chart: 'chart',
  csv: 'csv',
};

// Build a deterministic display title of the form "user-api/" when the
// panel has >1 file and the title is a plain string. This matches the
// mockup where the header shows the root folder + trailing slash.
function displayTitle(title: string, fileList: ArtifactFile[]): string {
  if (fileList.length > 1 && !title.endsWith('/') && !title.includes('.')) {
    return `${title}/`;
  }
  return title;
}

// Heuristic language detection from fileName extension. The stream may
// not supply language on every delta, so we infer from the tab's file
// extension. Matches the bundled Shiki languages loaded in useShiki.
function languageFromFileName(fileName: string, fallback?: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', rs: 'rust', java: 'java',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    c: 'c', cpp: 'cpp', cs: 'csharp', sql: 'sql',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    yaml: 'yaml', yml: 'yaml', json: 'json', toml: 'toml',
    xml: 'xml', html: 'html', css: 'css', scss: 'scss',
    md: 'markdown', markdown: 'markdown',
    dockerfile: 'dockerfile',
  };
  return map[ext] || fallback || 'plaintext';
}

const ArtifactPanelComponent: React.FC<ArtifactPanelProps> = ({
  state,
  onClose,
  onDownload,
  theme = 'dark',
  className,
}) => {
  const { artifactId, kind, title, files, isOpen, isComplete, stats, language } =
    state;

  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileList: ArtifactFile[] = useMemo(() => toFileArray(files), [files]);

  // Track the most-recently-updated file during streaming — we highlight
  // it as "active" on the first render and mark streaming tabs with a ●
  // dot (mockup's "dirty" indicator, reused for the live-write signal).
  const [lastUpdatedFile, setLastUpdatedFile] = useState<string | null>(null);
  useEffect(() => {
    if (fileList.length === 0) return;
    // Pick the file with the highest lastSeq — that's the one currently
    // receiving deltas. Falls back to the last-inserted file name.
    let top = fileList[0];
    for (const f of fileList) {
      if ((f.lastSeq ?? -1) > (top.lastSeq ?? -1)) top = f;
    }
    setLastUpdatedFile(top.fileName);
  }, [fileList]);

  // Default active file = currently-streaming file, unless user clicked.
  const effectiveActive =
    activeFile ?? lastUpdatedFile ?? fileList[0]?.fileName ?? null;
  const activeFileData = effectiveActive
    ? lookupFile(files, effectiveActive) ?? null
    : null;

  // Total lines-of-code across all files (mockup header: "612 loc").
  const totalLoc = useMemo(
    () => fileList.reduce((acc, f) => acc + (f.content?.split('\n').length ?? 0), 0),
    [fileList],
  );
  const totalBytes = useMemo(
    () =>
      stats?.bytes ??
      fileList.reduce((acc, f) => acc + (f.content?.length ?? 0), 0),
    [fileList, stats],
  );
  const fileCount = fileList.length;

  // V2 persistent-dock semantics — render an empty state instead of null
  // when the panel has no active artifact. The mock anatomy
  // (mocks/UX/02..09) shows the right-rail panel as always-docked once a
  // session has produced any artifact; the X button dismisses the
  // current artifact tab, not the panel chrome itself. Per
  // chatmode-ux-mock-parity user direction: persistent right-rail.
  if (!isOpen || !artifactId) {
    return (
      <aside
        data-testid="artifact-panel"
        data-empty="true"
        aria-label="Artifact panel — no active artifact"
        className={className}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: 'var(--color-surface)',
          borderLeft: '1px solid color-mix(in srgb, var(--user-accent-primary) 18%, transparent)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderBottom: '1px solid color-mix(in srgb, var(--user-accent-primary) 12%, transparent)',
            background: 'color-mix(in srgb, var(--user-accent-primary) 3%, transparent)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: 0.8,
              color: 'var(--user-accent-primary)',
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
            }}
          >
            ARTIFACT
          </span>
          <span style={{ flex: 1 }} />
        </header>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: 'var(--color-fg-subtle)',
            fontSize: 13,
            fontFamily: 'var(--font-body)',
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 14, marginBottom: 6, color: 'var(--color-fg-muted)' }}>
              Awaiting artifact
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              When the assistant emits a renderable artifact (chart, diagram,
              code bundle, document) it will appear here.
            </div>
          </div>
        </div>
      </aside>
    );
  }

  const headerTitle = displayTitle(title || 'artifact', fileList);

  const handleDownload = () => {
    if (onDownload) {
      onDownload(fileList, title || 'artifact');
      return;
    }
    // Default: download concatenated text (fallback — no tar lib in browser).
    // Per-file payload, separated with `===== FILE: name =====` headers.
    const payload = fileList
      .map(f => `===== FILE: ${f.fileName} =====\n${f.content}\n`)
      .join('\n');
    const blob = new Blob([payload], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'artifact').replace(/[^a-z0-9._-]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!activeFileData?.content) return;
    try {
      await navigator.clipboard.writeText(activeFileData.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const activeLang =
    activeFileData?.language ||
    (effectiveActive ? languageFromFileName(effectiveActive, language) : undefined) ||
    language ||
    'plaintext';

  return (
    <aside
      data-testid="artifact-panel"
      data-artifact-id={artifactId}
      data-kind={kind}
      data-complete={isComplete ? 'true' : undefined}
      aria-label={`Artifact: ${headerTitle}`}
      className={className}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--color-surface)',
        borderLeft: '1px solid color-mix(in srgb, var(--user-accent-primary) 24%, transparent)',
        overflow: 'hidden',
      }}
    >
      {/* ═══ Header ═══
          mockup: ARTIFACT {title} · {lang} · {N} files · {loc} loc    download.tar ×
      */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid color-mix(in srgb, var(--user-accent-primary) 18%, transparent)',
          background: 'linear-gradient(90deg, color-mix(in srgb, var(--user-accent-primary) 6%, transparent), color-mix(in srgb, var(--user-accent-secondary) 3%, transparent))',
          flexShrink: 0,
        }}
      >
        <span
          data-testid="artifact-panel-kind"
          style={{
            fontSize: 10,
            letterSpacing: 0.8,
            color: 'var(--user-accent-primary)',
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
          }}
        >
          ARTIFACT
        </span>
        <span
          data-testid="artifact-panel-title"
          style={{
            color: 'var(--color-text)',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 240,
          }}
        >
          {headerTitle}
        </span>
        <span
          data-testid="artifact-panel-meta"
          style={{
            fontSize: 11,
            color: 'var(--color-fg-subtle)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}
        >
          {language ? `· ${language} ` : ''}
          · {fileCount} file{fileCount === 1 ? '' : 's'} · {totalLoc} loc
        </span>
        <span style={{ flex: 1 }} />

        {isComplete && (
          <span
            data-testid="artifact-panel-complete-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 7px',
              borderRadius: 99,
              background: 'color-mix(in srgb, var(--color-ok) 14%, transparent)',
              color: 'var(--color-ok)',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {formatBytes(totalBytes)}
          </span>
        )}

        <button
          data-testid="artifact-panel-download"
          onClick={handleDownload}
          title="Download all files"
          style={{
            padding: '4px 8px',
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-fg-subtle)',
            fontSize: 11,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          download.tar
        </button>

        <button
          data-testid="artifact-panel-copy"
          onClick={handleCopy}
          title="Copy active file"
          style={{
            padding: '4px 6px',
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            color: copied ? 'var(--color-ok)' : 'var(--color-fg-subtle)',
            cursor: 'pointer',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {copied ? (
              <polyline points="20 6 9 17 4 12" />
            ) : (
              <>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </>
            )}
          </svg>
        </button>

        {onClose && (
          <button
            data-testid="artifact-panel-close"
            onClick={onClose}
            aria-label="Close artifact panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-fg-subtle)',
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </header>

      {/* ═══ Tab strip ═══
          Always rendered when there's at least one file. data-artifact-tab
          attribute is the DOM contract the evidence-verifier checks for.
      */}
      {fileList.length >= 1 && (
        <nav
          data-testid="artifact-panel-tabs"
          role="tablist"
          style={{
            display: 'flex',
            gap: 1,
            padding: '0 10px',
            borderBottom: '1px solid color-mix(in srgb, var(--user-accent-primary) 14%, transparent)',
            background: 'var(--color-surface-2)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {fileList.map(file => {
            const selected = file.fileName === effectiveActive;
            // Streaming signal: the file receiving the most recent deltas
            // (and stream hasn't completed) gets the ● dirty marker — in
            // the mockup this is "patched pass 2", for live stream it's
            // "actively being written".
            const isStreaming =
              !isComplete && file.fileName === lastUpdatedFile;
            return (
              <button
                key={file.fileName}
                data-testid={`artifact-panel-tab-${file.fileName}`}
                data-artifact-tab={file.fileName}
                data-selected={selected ? 'true' : undefined}
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveFile(file.fileName)}
                style={{
                  padding: '8px 11px',
                  background: selected
                    ? 'var(--color-surface)'
                    : 'transparent',
                  border: 'none',
                  borderBottom: selected
                    ? '2px solid var(--color-accent)'
                    : '2px solid transparent',
                  color: selected
                    ? 'var(--color-fg)'
                    : 'var(--color-fg-subtle)',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {file.fileName}
                {isStreaming && (
                  <span
                    aria-label="streaming"
                    title="streaming"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--color-warn)',
                      display: 'inline-block',
                    }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* ═══ Preview body ═══
          Syntax-highlighted via ShikiCodeBlock. The streaming cursor
          (▌) is appended by ShikiCodeBlock internals when isStreaming.
      */}
      <div
        data-testid="artifact-panel-body"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: 'var(--color-surface)',
        }}
      >
        {activeFileData?.content ? (
          <ShikiCodeBlock
            key={effectiveActive || 'default'}
            code={activeFileData.content}
            language={activeLang}
            theme={theme}
            onCopy={() => { void handleCopy(); }}
            copied={copied}
            showLineNumbers
            isInCanvas
            isStreaming={!isComplete}
            filename={effectiveActive || undefined}
          />
        ) : (
          <div
            style={{
              padding: 24,
              color: 'var(--color-fg-subtle)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            Waiting for content…
          </div>
        )}
      </div>
    </aside>
  );
};

export const ArtifactPanel = memo(ArtifactPanelComponent);
ArtifactPanel.displayName = 'ArtifactPanel';
