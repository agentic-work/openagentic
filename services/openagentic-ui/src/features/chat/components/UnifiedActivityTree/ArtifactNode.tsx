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
    border: '1px solid rgba(188,140,255,0.3)',
    background: 'transparent',
    color: '#bc8cff',
    cursor: 'pointer' as const,
    borderRadius: 3,
  };

  return (
    <div style={{
      border: '1px solid rgba(188,140,255,0.2)',
      borderRadius: 6,
      padding: 8,
      backgroundColor: 'rgba(188,140,255,0.03)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 10,
          fontFamily: 'SF Mono, JetBrains Mono, monospace',
          color: '#bc8cff',
          backgroundColor: 'rgba(188,140,255,0.15)',
          padding: '1px 6px',
          borderRadius: 3,
        }}>
          {artifactType}
        </span>
        <span style={{ fontSize: 12, color: '#e6edf3', fontFamily: 'SF Mono, JetBrains Mono, monospace' }}>
          {title}
        </span>
        {sizeBytes !== undefined && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>
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
          color: 'rgba(255,255,255,0.5)',
          backgroundColor: 'rgba(0,0,0,0.2)',
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
