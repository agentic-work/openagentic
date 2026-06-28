/**
 * #781 Phase B — ArtifactActionBar.
 *
 * Renders 0-6 action buttons (Copy / Download / Export PDF / Export PNG /
 * Open new tab / Re-run) based on the cap flags. Each button is only
 * rendered when its corresponding `can*` flag is true — the action bar
 * is intentionally minimalist; absent capabilities show nothing rather
 * than a disabled grey button (cleaner editorial aesthetic).
 *
 * Buttons share a single inline style. Phase C renderers can wrap this
 * inside their own header for kind-specific aesthetics.
 */
import React from 'react';

export interface ArtifactActionBarProps {
  canCopy?: boolean;
  canDownloadSource?: boolean;
  canExportPdf?: boolean;
  canExportPng?: boolean;
  canOpenNewTab?: boolean;
  canRerun?: boolean;
  onCopy?: () => void;
  onDownloadSource?: () => void;
  onExportPdf?: () => void;
  onExportPng?: () => void;
  onOpenNewTab?: () => void;
  onRerun?: () => void;
}

const BTN_STYLE: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--ink-on-paper, rgba(13,13,12,0.18))',
  cursor: 'pointer',
  padding: '4px 10px',
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
  fontSize: '10.5px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink, #0d0d0c)',
};

export const ArtifactActionBar: React.FC<ArtifactActionBarProps> = ({
  canCopy,
  canDownloadSource,
  canExportPdf,
  canExportPng,
  canOpenNewTab,
  canRerun,
  onCopy,
  onDownloadSource,
  onExportPdf,
  onExportPng,
  onOpenNewTab,
  onRerun,
}) => {
  return (
    <div
      data-testid="artifact-action-bar"
      style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
    >
      {canCopy && (
        <button
          type="button"
          data-testid="artifact-action-copy"
          aria-label="Copy artifact content"
          title="Copy (⌘C)"
          onClick={onCopy}
          style={BTN_STYLE}
        >
          Copy
        </button>
      )}
      {canDownloadSource && (
        <button
          type="button"
          data-testid="artifact-action-download-source"
          aria-label="Download source"
          title="Download source"
          onClick={onDownloadSource}
          style={BTN_STYLE}
        >
          Source
        </button>
      )}
      {canExportPdf && (
        <button
          type="button"
          data-testid="artifact-action-export-pdf"
          aria-label="Export to PDF"
          title="Export PDF (⌘⇧P)"
          onClick={onExportPdf}
          style={BTN_STYLE}
        >
          PDF
        </button>
      )}
      {canExportPng && (
        <button
          type="button"
          data-testid="artifact-action-export-png"
          aria-label="Export to PNG"
          title="Export PNG"
          onClick={onExportPng}
          style={BTN_STYLE}
        >
          PNG
        </button>
      )}
      {canOpenNewTab && (
        <button
          type="button"
          data-testid="artifact-action-open-new-tab"
          aria-label="Open artifact in new tab"
          title="Open in new tab"
          onClick={onOpenNewTab}
          style={BTN_STYLE}
        >
          ↗
        </button>
      )}
      {canRerun && (
        <button
          type="button"
          data-testid="artifact-action-rerun"
          aria-label="Re-run artifact"
          title="Re-run (⌘R)"
          onClick={onRerun}
          style={BTN_STYLE}
        >
          Re-run
        </button>
      )}
    </div>
  );
};
