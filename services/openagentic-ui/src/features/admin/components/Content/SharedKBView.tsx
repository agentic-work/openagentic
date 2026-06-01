/**
 * Shared Knowledge Base — Admin view
 *
 * Real implementation backed by /api/admin/shared-kb/*. Supports listing
 * sources, adding a webpage source, triggering ingestion, viewing docs,
 * and deleting sources/docs. More source types (document upload, RSS,
 * HTTP, database, agent) are wired as "Coming soon" tiles in the Add
 * Source modal — the backend is ready to accept them once their
 * ingesters are implemented.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe, FileText, Database, Book, Brain, Sparkles,
  Link2, Waves, Trash2, RefreshCw, Plus,
  CheckCircle, AlertCircle, X,
} from '@/shared/icons';
import type { IconComponent } from '@/shared/icons';
import { PageHeader } from '../../primitives-v2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceType = 'webpage' | 'document' | 'rss' | 'http' | 'database' | 'agent';

interface SharedKBSource {
  id: string;
  name: string;
  description: string | null;
  type: SourceType;
  config: Record<string, unknown>;
  enabled: boolean;
  schedule: string | null;
  last_ingest_at: string | null;
  last_ingest_status: string | null;
  last_ingest_error: string | null;
  doc_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

interface SharedKBDocument {
  id: string;
  origin: string;
  title: string | null;
  chunk_count: number;
  tokens_est: number | null;
  ingested_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api/admin/shared-kb';

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) {
    let msg = `${resp.status} ${resp.statusText}`;
    try { const j = await resp.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return resp.json() as Promise<T>;
}

const TYPE_META: Record<SourceType, {
  title: string;
  icon: IconComponent;
  description: string;
  available: boolean;
}> = {
  webpage: {
    title: 'Web Page',
    icon: Globe,
    description: 'Crawl a URL, strip navigation chrome, chunk and embed the content. Good for vendor docs, blog posts, wikis.',
    available: true,
  },
  document: {
    title: 'Document Upload',
    icon: FileText,
    description: 'Upload PDF, DOCX, MD, TXT, HTML, or CSV. Each file is parsed, chunked, and embedded.',
    available: false,
  },
  rss: {
    title: 'RSS / Atom Feed',
    icon: Waves,
    description: 'Subscribe to a feed URL and auto-ingest new items on a schedule.',
    available: false,
  },
  http: {
    title: 'HTTP / API Pull',
    icon: Link2,
    description: 'Hit a JSON endpoint, walk via JSONPath, turn each result into a KB entry.',
    available: false,
  },
  database: {
    title: 'Database Query',
    icon: Database,
    description: 'Reuse a Flows Data Store, run a SQL query on a schedule, embed each row.',
    available: false,
  },
  agent: {
    title: 'Agent Research',
    icon: Brain,
    description: 'Give an agent a topic ("collect everything on X in the last 90 days"), let it find, fetch, and ingest autonomously.',
    available: false,
  },
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SharedKBView() {
  const [sources, setSources] = useState<SharedKBSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [ingestingSourceId, setIngestingSourceId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ sources: SharedKBSource[] }>('/sources');
      setSources(data.sources || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleIngest = async (source: SharedKBSource) => {
    setIngestingSourceId(source.id);
    try {
      const result = await api<{ docsIngested: number; chunksIngested: number; errors: string[] }>(
        `/sources/${source.id}/ingest`,
        { method: 'POST' },
      );
      if (result.errors?.length > 0) {
        showToast('err', `Ingested ${result.chunksIngested} chunks with ${result.errors.length} errors: ${result.errors[0]}`);
      } else {
        showToast('ok', `Ingested ${result.docsIngested} docs / ${result.chunksIngested} chunks`);
      }
      await loadSources();
    } catch (err: any) {
      showToast('err', err.message || 'Ingestion failed');
    } finally {
      setIngestingSourceId(null);
    }
  };

  const handleDelete = async (source: SharedKBSource) => {
    if (!confirm(`Delete source "${source.name}" and all its documents? This cannot be undone.`)) return;
    try {
      await api(`/sources/${source.id}`, { method: 'DELETE' });
      showToast('ok', `Deleted "${source.name}"`);
      if (selectedSourceId === source.id) setSelectedSourceId(null);
      await loadSources();
    } catch (err: any) {
      showToast('err', err.message || 'Delete failed');
    }
  };

  const handleToggleEnabled = async (source: SharedKBSource) => {
    try {
      await api(`/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      await loadSources();
    } catch (err: any) {
      showToast('err', err.message || 'Toggle failed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Content', 'Shared KB']}
        title="Shared Knowledge Base"
        explainer="Cluster-wide RAG available to every user and every platform AI. Ingest a webpage, document, feed, or database once — Chat mode, Code mode, Flows, and every multi-agent workflow can all search against it."
      />

      {/* Add-source action bar */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setAddDialogOpen(true)}
          className="px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          style={{ background: 'var(--ap-accent)', color: 'var(--ap-fg-on-accent)' }}
        >
          <Plus size={16} />
          Add Source
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`rounded-lg border p-3 flex items-start gap-2 ${
            toast.kind === 'ok'
              ? 'border-[color-mix(in_srgb,var(--color-ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)] text-ok'
              : 'border-[color-mix(in_srgb,var(--color-err)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)] text-err'
          }`}
        >
          {toast.kind === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span className="text-sm">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-err)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)] p-4 text-sm text-err">
          {error}
        </div>
      )}

      {/* Sources list */}
      {loading ? (
        <div className="text-text-secondary text-sm">Loading sources…</div>
      ) : sources.length === 0 ? (
        <div className="rounded-lg border border-border bg-[color:var(--color-surface-primary)] p-8 text-center">
          <Book size={32} className="text-text-tertiary mx-auto mb-3" />
          <p className="text-text-primary font-medium mb-1">No sources yet</p>
          <p className="text-text-secondary text-sm mb-4">
            Add a webpage, document, feed, or database to start populating the shared knowledge base.
          </p>
          <button
            onClick={() => setAddDialogOpen(true)}
            className="px-4 py-2 rounded-lg inline-flex items-center gap-2 transition-colors"
            style={{ background: 'var(--ap-accent)', color: 'var(--ap-fg-on-accent)' }}
          >
            <Plus size={16} />
            Add your first source
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--color-surface-secondary)] text-text-secondary">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Docs</th>
                <th className="text-right px-4 py-2 font-medium">Chunks</th>
                <th className="text-left px-4 py-2 font-medium">Last Ingest</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const meta = TYPE_META[s.type];
                const Icon = meta?.icon || Globe;
                const isIngesting = ingestingSourceId === s.id;
                return (
                  <React.Fragment key={s.id}>
                    <tr className="border-t border-border hover:bg-[color:var(--color-surface-secondary)]/50">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedSourceId(selectedSourceId === s.id ? null : s.id)}
                          className="text-left"
                        >
                          <div className="font-medium text-text-primary">{s.name}</div>
                          {s.description && (
                            <div className="text-xs text-text-tertiary truncate max-w-md">{s.description}</div>
                          )}
                          <div className="text-xs text-text-tertiary font-mono mt-0.5 truncate max-w-md">
                            {(s.config as any)?.url || ''}
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Icon size={14} /> {meta?.title || s.type}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary">{s.doc_count}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">{s.chunk_count}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatRelativeTime(s.last_ingest_at)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.last_ingest_status} enabled={s.enabled} error={s.last_ingest_error} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleIngest(s)}
                            disabled={isIngesting || !s.enabled}
                            className="p-1.5 rounded hover:bg-[color:var(--color-surface-secondary)] text-text-secondary disabled:opacity-40"
                            title="Trigger ingest"
                          >
                            <RefreshCw size={14} className={isIngesting ? 'animate-spin' : ''} />
                          </button>
                          <button
                            onClick={() => handleToggleEnabled(s)}
                            className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium border"
                            style={{
                              borderColor: s.enabled ? 'color-mix(in srgb, var(--color-ok) 40%, transparent)' : 'color-mix(in srgb, var(--color-fg-subtle) 40%, transparent)',
                              color: s.enabled ? 'var(--color-ok)' : 'var(--color-fg-subtle)',
                            }}
                          >
                            {s.enabled ? 'enabled' : 'disabled'}
                          </button>
                          <button
                            onClick={() => handleDelete(s)}
                            className="p-1.5 rounded hover:bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)] text-err"
                            title="Delete source"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {selectedSourceId === s.id && (
                      <tr className="border-t border-border bg-[color:var(--color-surface-primary)]">
                        <td colSpan={7} className="px-4 py-3">
                          <SourceDocumentsPanel sourceId={s.id} onChange={loadSources} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addDialogOpen && (
        <AddSourceDialog
          onClose={() => setAddDialogOpen(false)}
          onCreated={async () => {
            setAddDialogOpen(false);
            await loadSources();
            showToast('ok', 'Source created');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  enabled,
  error,
}: {
  status: string | null;
  enabled: boolean;
  error: string | null;
}) {
  if (!enabled) {
    return <span className="text-xs text-text-tertiary">disabled</span>;
  }
  if (!status) {
    return <span className="text-xs text-text-tertiary">not ingested</span>;
  }
  if (status === 'running') {
    return <span className="text-xs text-info">running…</span>;
  }
  if (status === 'success') {
    return <span className="text-xs text-ok">ok</span>;
  }
  if (status === 'partial') {
    return <span className="text-xs text-warn" title={error || ''}>partial</span>;
  }
  return <span className="text-xs text-err" title={error || ''}>error</span>;
}

// ---------------------------------------------------------------------------
// Documents panel (expands inside the row)
// ---------------------------------------------------------------------------

function SourceDocumentsPanel({ sourceId, onChange }: { sourceId: string; onChange: () => void }) {
  const [docs, setDocs] = useState<SharedKBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ documents: SharedKBDocument[] }>(`/sources/${sourceId}/documents`);
      setDocs(data.documents || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document and its chunks?')) return;
    try {
      await api(`/sources/${sourceId}/documents/${docId}`, { method: 'DELETE' });
      await load();
      onChange();
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    }
  };

  if (loading) return <div className="text-xs text-text-secondary">Loading documents…</div>;
  if (error) return <div className="text-xs text-err">{error}</div>;
  if (docs.length === 0) {
    return <div className="text-xs text-text-secondary">No documents ingested yet. Click the refresh button in the row to run ingest.</div>;
  }

  return (
    <div className="space-y-1">
      <div className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">
        Documents ({docs.length})
      </div>
      {docs.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between px-3 py-1.5 rounded border border-border bg-[color:var(--color-surface-secondary)] text-xs"
        >
          <div className="flex-1 min-w-0">
            <div className="text-text-primary truncate">{d.title || d.origin}</div>
            <div className="text-text-tertiary font-mono truncate">{d.origin}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-text-secondary">{d.chunk_count} chunks</span>
            <span className="text-text-tertiary">{formatRelativeTime(d.ingested_at)}</span>
            <button
              onClick={() => handleDelete(d.id)}
              className="p-1 rounded hover:bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)] text-err"
              title="Delete document"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add source dialog
// ---------------------------------------------------------------------------

function AddSourceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [step, setStep] = useState<'choose' | 'webpage'>('choose');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // webpage form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/sources', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          type: 'webpage',
          config: { url: url.trim() },
          enabled: true,
        }),
      });
      await onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create source');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-shadow)_50%,transparent)]" onClick={onClose}>
      <div
        className="bg-[color:var(--color-surface-primary)] border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-base font-semibold text-text-primary">
            {step === 'choose' ? 'Add Source' : TYPE_META.webpage.title}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[color:var(--color-surface-secondary)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {step === 'choose' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(Object.keys(TYPE_META) as SourceType[]).map((type) => {
                const meta = TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    disabled={!meta.available}
                    onClick={() => meta.available && setStep(type as 'webpage')}
                    className="text-left rounded-lg border border-border bg-[color:var(--color-surface-secondary)] p-4 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    onMouseEnter={(e) => { if (meta.available) e.currentTarget.style.borderColor = 'var(--ap-accent-line)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = ''; }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Icon size={20} style={{ color: 'var(--ap-accent)' }} />
                      {!meta.available && (
                        <span className="text-[10px] text-text-tertiary uppercase">Soon</span>
                      )}
                    </div>
                    <div className="font-medium text-text-primary text-sm mb-1">{meta.title}</div>
                    <div className="text-xs text-text-secondary leading-relaxed">
                      {meta.description}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. OpenAI API docs"
                  className="w-full px-3 py-2 rounded border border-border bg-[color:var(--color-surface-secondary)] text-text-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Platform documentation and pricing"
                  className="w-full px-3 py-2 rounded border border-border bg-[color:var(--color-surface-secondary)] text-text-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/docs"
                  className="w-full px-3 py-2 rounded border border-border bg-[color:var(--color-surface-secondary)] text-text-primary font-mono text-xs"
                />
                <p className="text-xs text-text-tertiary mt-1">
                  The page will be fetched, stripped of navigation, chunked, and embedded on first ingest.
                </p>
              </div>
              {error && (
                <div className="rounded border border-[color-mix(in_srgb,var(--color-err)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)] p-3 text-xs text-err">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border p-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded border border-border text-text-secondary hover:bg-[color:var(--color-surface-secondary)]"
          >
            Cancel
          </button>
          {step === 'webpage' && (
            <button
              onClick={handleSubmit}
              disabled={saving || !name.trim() || !url.trim()}
              className="px-4 py-2 rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              style={{ background: 'var(--ap-accent)', color: 'var(--ap-fg-on-accent)' }}
            >
              {saving ? 'Creating…' : 'Create Source'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SharedKBView;
