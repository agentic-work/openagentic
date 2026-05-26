import React from 'react';

interface ArtifactNodeProps {
  id: string;
  artifactType: string;
  title: string;
  content?: string;
  sizeBytes?: number;
  onAction?: (id: string, action: 'open' | 'copy' | 'canvas') => void;
}

export function ArtifactNode({ id, artifactType, title, content, sizeBytes, onAction }: ArtifactNodeProps) {
  const btnStyle = {
    padding: '2px 8px',
    fontSize: 10,
    fontFamily: 'SF Mono, JetBrains Mono, monospace',
    border: '1px solid color-mix(in srgb, var(--cm-accent) 30%, transparent)',
    background: 'transparent',
    color: 'var(--cm-accent)',
    cursor: 'pointer' as const,
    borderRadius: 3,
  };

  return (
    <div style={{
      border: '1px solid color-mix(in srgb, var(--cm-accent) 20%, transparent)',
      borderRadius: 6,
      padding: 8,
      backgroundColor: 'color-mix(in srgb, var(--cm-accent) 3%, transparent)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 10,
          fontFamily: 'SF Mono, JetBrains Mono, monospace',
          color: 'var(--cm-accent)',
          backgroundColor: 'color-mix(in srgb, var(--cm-accent) 15%, transparent)',
          padding: '1px 6px',
          borderRadius: 3,
        }}>
          {artifactType}
        </span>
        <span style={{ fontSize: 12, color: 'var(--cm-text)', fontFamily: 'SF Mono, JetBrains Mono, monospace' }}>
          {title}
        </span>
        {sizeBytes !== undefined && (
          <span style={{ fontSize: 10, color: 'var(--cm-text-muted)', marginLeft: 'auto' }}>
            {(sizeBytes / 1024).toFixed(1)}KB
          </span>
        )}
      </div>
      {/* Preview */}
      {content && (
        <pre style={{
          margin: '4px 0',
          padding: 6,
          fontSize: 10,
          fontFamily: 'SF Mono, JetBrains Mono, monospace',
          color: 'var(--cm-text-secondary)',
          backgroundColor: 'var(--cm-bg-tertiary)',
          borderRadius: 4,
          maxHeight: 140,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
        }}>
          {content.slice(0, 500)}
        </pre>
      )}
      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button style={btnStyle} onClick={() => onAction?.(id, 'open')}>Open</button>
        <button style={btnStyle} onClick={() => onAction?.(id, 'copy')}>Copy</button>
        <button style={btnStyle} onClick={() => onAction?.(id, 'canvas')}>Canvas</button>
      </div>
    </div>
  );
}
