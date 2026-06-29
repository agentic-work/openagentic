/**
 * ArtifactsModalContent — list-only modal content (uses /api/artifacts GET, NOT
 * the broken /api/knowledge/search the old sidebar accordion was pointed at).
 *
 * Root cause of the 404 the user flagged 2026-05-14: ArtifactsSection.tsx
 * (sidebar accordion) was calling GET /api/knowledge/search — that endpoint
 * only exists as POST /api/chat/knowledge/search behind authMiddleware, so
 * the GET request hit nothing → 404. The correct list endpoint is
 * GET /api/artifacts which is registered in misc.plugin.ts and returns
 * the user's artifacts via ArtifactService.listArtifacts.
 */

import React, { useState, useEffect } from 'react';
import { FileText } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';

interface Artifact {
  id?: string;
  artifact_id?: string;
  artifactId?: string;
  title?: string;
  filename?: string;
  originalName?: string;
  created_at?: string;
  uploaded_at?: string;
  createdAt?: string;
  artifact_type?: string;
  mime_type?: string;
  format?: string;
}

export const ArtifactsModalContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/artifacts?limit=50&sortBy=created&sortOrder=desc', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        setError(`Failed to load artifacts (${res.status})`);
        setItems([]);
        return;
      }
      const data = await res.json();
      // ArtifactService.listArtifacts returns { artifacts: [...] } or [...] directly
      const list = Array.isArray(data) ? data : (data.artifacts || data.results || []);
      setItems(list);
    } catch (e) {
      setError(e?.message || 'Failed to load artifacts');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading artifacts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <div className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>{error}</div>
        <button
          onClick={load}
          className="px-4 py-2 text-sm rounded-lg border transition-colors hover:bg-[var(--color-surface)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
          No artifacts yet
        </div>
        <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          Workflow outputs (compose_visual, render_artifact, etc.) appear here once you run a flow.
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 py-2">
      {items.map((a) => {
        const id = a.id || a.artifact_id || a.artifactId || Math.random().toString(36).slice(2);
        const title = a.title || a.filename || a.originalName || 'Untitled artifact';
        const ts = a.created_at || a.uploaded_at || a.createdAt;
        const type = a.artifact_type || a.mime_type || a.format || 'file';
        return (
          <div
            key={id}
            className="glass-card glass-surface-hover p-4"
          >
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }} title={title}>
                  {title}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {type}
                  {ts ? ` · ${new Date(ts).toLocaleString()}` : ''}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
