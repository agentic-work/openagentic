/**
 * AC-D2 — DownloadTile.
 *
 * One clickable tile per ArtifactEmit. Renders icon (mimetype-driven),
 * filename, formatted size, optional producer chip, and an anchor with
 * `download={filename}` pointing at the presigned MinIO URL.
 *
 * Visual treatment matches the v2 token system. Mirrors mock-card
 * shapes used by SavingsCard / ToolCard for inline download chips.
 */

import type { CSSProperties } from 'react';
import type { ArtifactEmit } from '../../hooks/useChatStream';

export interface DownloadTileProps {
  artifact: ArtifactEmit;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function mimeIcon(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf')) return '📄';
  if (ct.includes('wordprocessingml') || ct.includes('msword')) return '📝';
  if (ct.includes('spreadsheet') || ct.includes('excel') || ct.includes('csv')) return '📊';
  if (ct.includes('image/')) return '🖼️';
  if (ct.includes('text/html') || ct.includes('html')) return '🌐';
  if (ct.includes('zip') || ct.includes('tar') || ct.includes('compressed')) return '📦';
  if (ct.includes('json') || ct.includes('yaml')) return '🔣';
  if (ct.includes('text/')) return '📃';
  return '📎';
}

const tileStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  margin: '4px 4px 4px 0',
  border: '1px solid var(--cm-border, #2a2a35)',
  borderRadius: 8,
  background: 'var(--cm-surface-soft, #181821)',
  fontFamily: 'var(--cm-font-body, system-ui, sans-serif)',
  fontSize: 13,
  textDecoration: 'none',
  color: 'var(--cm-text, #e7e7ee)',
};

const filenameStyle: CSSProperties = {
  fontFamily: 'var(--cm-font-mono, monospace)',
  fontSize: 12,
  fontWeight: 600,
};

const metaStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--cm-text-soft, #c5c5d2)',
};

const producerChipStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 999,
  background: 'var(--cm-chip-bg, #1a1a26)',
  border: '1px solid var(--cm-border-soft, #2a2a3a)',
  fontSize: 10,
  color: 'var(--cm-text-soft, #c5c5d2)',
  marginLeft: 6,
};

export function DownloadTile({ artifact }: DownloadTileProps) {
  return (
    <a
      data-testid="download-tile"
      data-mime={artifact.contentType}
      data-artifact-id={artifact.artifactId}
      href={artifact.downloadUrl}
      download={artifact.filename}
      style={tileStyle}
    >
      <span aria-hidden style={{ fontSize: 18 }}>
        {mimeIcon(artifact.contentType)}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={filenameStyle}>{artifact.filename}</span>
        <span style={metaStyle}>
          {formatSize(artifact.sizeBytes)}
          {artifact.producedBy ? (
            <span style={producerChipStyle}>{artifact.producedBy}</span>
          ) : null}
        </span>
      </span>
      <span
        style={{
          marginLeft: 8,
          fontSize: 11,
          color: 'var(--cm-accent, #6c7eff)',
          fontWeight: 600,
        }}
      >
        Download
      </span>
    </a>
  );
}
