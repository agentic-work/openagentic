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
 * Artifacts Panel Component
 * Slide-out file manager for uploading, downloading, and managing artifacts.
 * Uses drag-and-drop or file picker for uploads, inline feedback for operations.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Upload, Download, Trash2, File, FileText, FileImage,
  FileSpreadsheet, Folder, Loader, CheckCircle, AlertCircle
} from '@/shared/icons';

interface Artifact {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  createdAt?: string;
}

interface ArtifactsPanelProps {
  theme: string;
  isOpen: boolean;
  onClose: () => void;
}

/** Human-readable file size */
function formatSize(bytes?: number): string {
  if (bytes == null || bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format date for display */
function formatDate(iso?: string): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Pick an icon component by MIME type */
function FileIcon({ mimeType, size = 18 }: { mimeType?: string; size?: number }) {
  if (!mimeType) return <Folder size={size} />;
  if (mimeType.startsWith('image/')) return <FileImage size={size} />;
  if (mimeType.startsWith('text/')) return <FileText size={size} />;
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('csv') ||
    mimeType.includes('excel')
  ) return <FileSpreadsheet size={size} />;
  return <File size={size} />;
}

const ArtifactsPanel: React.FC<ArtifactsPanelProps> = ({ theme, isOpen, onClose }) => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Feedback helper ----
  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3500);
  }, []);

  // ---- Fetch artifacts ----
  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/artifacts', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load artifacts (${res.status})`);
      const data = await res.json();
      setArtifacts(Array.isArray(data) ? data : data.artifacts ?? []);
    } catch (err: any) {
      showFeedback('error', err.message ?? 'Failed to load artifacts');
    } finally {
      setLoading(false);
    }
  }, [showFeedback]);

  useEffect(() => {
    if (isOpen) fetchArtifacts();
  }, [isOpen, fetchArtifacts]);

  // ---- Upload ----
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append('file', f));
      const res = await fetch('/api/artifacts/upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      showFeedback('success', `Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
      fetchArtifacts();
    } catch (err: any) {
      showFeedback('error', err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [fetchArtifacts, showFeedback]);

  // ---- Download ----
  const downloadArtifact = useCallback(async (a: Artifact) => {
    try {
      const res = await fetch(`/api/artifacts/${a.id}/download`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showFeedback('error', err.message ?? 'Download failed');
    }
  }, [showFeedback]);

  // ---- Delete ----
  const deleteArtifact = useCallback(async (a: Artifact) => {
    try {
      const res = await fetch(`/api/artifacts/${a.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      showFeedback('success', `Deleted ${a.filename}`);
      setArtifacts((prev) => prev.filter((x) => x.id !== a.id));
    } catch (err: any) {
      showFeedback('error', err.message ?? 'Delete failed');
    }
  }, [showFeedback]);

  // ---- Drag & Drop ----
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  // ---- Styles ----
  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 150,
    backgroundColor: 'rgba(0,0,0,0.35)',
    opacity: isOpen ? 1 : 0,
    pointerEvents: isOpen ? 'auto' : 'none',
    transition: 'opacity 0.25s ease',
  };

  const panel: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 380,
    maxWidth: '100vw',
    zIndex: 151,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-surface)',
    borderLeft: '1px solid var(--color-border)',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
    transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--color-border)',
  };

  const dropzoneStyle: React.CSSProperties = {
    margin: '16px 20px',
    padding: '24px 16px',
    border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
    borderRadius: 10,
    backgroundColor: dragOver ? 'var(--color-primary)' + '14' : 'transparent',
    textAlign: 'center' as const,
    cursor: 'pointer',
    transition: 'border-color 0.2s, background-color 0.2s',
  };

  if (!isOpen) {
    // Render hidden panel for transition-out animation
    return (
      <>
        <div style={overlay} onClick={onClose} />
        <div style={panel} />
      </>
    );
  }

  return (
    <>
      {/* Overlay */}
      <div style={overlay} onClick={onClose} />

      {/* Panel */}
      <div style={panel}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Folder size={20} style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
              Artifacts
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
            }}
            aria-label="Close artifacts panel"
          >
            <X size={20} />
          </button>
        </div>

        {/* Feedback toast */}
        {feedback && (
          <div
            style={{
              margin: '12px 20px 0',
              padding: '8px 12px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              backgroundColor: feedback.type === 'success'
                ? 'var(--color-success)' + '1a'
                : 'var(--color-error)' + '1a',
              color: feedback.type === 'success'
                ? 'var(--color-success)'
                : 'var(--color-error)',
              border: `1px solid ${feedback.type === 'success' ? 'var(--color-success)' : 'var(--color-error)'}33`,
            }}
          >
            {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {feedback.message}
          </div>
        )}

        {/* Upload dropzone */}
        <div
          style={dropzoneStyle}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Loader size={28} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Uploading...</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Upload size={28} style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Drop files here or click to browse
              </span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* File list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Loader size={24} style={{ color: 'var(--text-tertiary)', animation: 'spin 1s linear infinite' }} />
            </div>
          ) : artifacts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
              No artifacts yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {artifacts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--color-border)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--color-surface)';
                  }}
                >
                  {/* Icon */}
                  <div style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                    <FileIcon mimeType={a.mimeType} size={20} />
                  </div>

                  {/* Metadata */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={a.filename}
                    >
                      {a.filename}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {formatSize(a.size)} {a.createdAt ? `\u00B7 ${formatDate(a.createdAt)}` : ''}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => downloadArtifact(a)}
                      title="Download"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 5,
                        borderRadius: 6,
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      onClick={() => deleteArtifact(a)}
                      title="Delete"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 5,
                        borderRadius: 6,
                        color: 'var(--color-error)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Spinner keyframe (injected once) */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};

export default ArtifactsPanel;
