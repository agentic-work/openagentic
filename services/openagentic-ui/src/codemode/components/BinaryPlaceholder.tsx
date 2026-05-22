import React from 'react';

export interface BinaryPlaceholderProps {
  contentType: string;
  size: number;
  reason: 'binary' | 'too_large';
  onDownload?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BinaryPlaceholder({
  contentType,
  size,
  reason,
  onDownload,
}: BinaryPlaceholderProps): React.ReactElement {
  const message =
    reason === 'too_large'
      ? 'File exceeds 2 MB preview limit'
      : 'Binary file';

  return (
    <div className="fp-binary-placeholder">
      <div className="fp-binary-icon">⬡</div>
      <p className="fp-binary-message">{message}</p>
      <p className="fp-binary-meta">
        <span className="fp-binary-type">{contentType}</span>
        {' · '}
        <span className="fp-binary-size">{formatBytes(size)}</span>
      </p>
      {onDownload && (
        <button
          className="fp-binary-download"
          onClick={onDownload}
          aria-label="Download file"
        >
          Download
        </button>
      )}
    </div>
  );
}
