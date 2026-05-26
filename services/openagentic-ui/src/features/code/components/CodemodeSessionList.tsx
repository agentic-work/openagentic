/**
 * CodemodeSessionList — claude.ai/code-style sessions sidebar.
 *
 * Left rail for CodeModeLayout that lists the current user's persisted
 * openagentic sessions, grouped by relative date, with a "+ New Session"
 * header action.
 *
 * Source: GET /api/openagentic/sessions/persisted
 * (see useCodeModeSession.loadPersistedSessions).
 *
 * No GitHub dependency — openagentic runs in a per-user pod, so session
 * ownership is already scoped by the user's auth token; there is no
 * repo-level scoping the way claude.ai/code has.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, MessageSquare } from '@/shared/icons';
import { useCodeModeStore, useActiveSessionId } from '@/stores/useCodeModeStore';

// ─── Types ──────────────────────────────────────────────────────────────
interface PersistedSessionRow {
  id: string;
  userId?: string;
  model: string;
  workspacePath: string;
  title?: string;
  status?: 'active' | 'idle' | 'stopped' | 'error';
  createdAt: string;
  lastActivity: string;
  firstUserMessage?: string; // optional, used as fallback title if present
}

interface CodemodeSessionListProps {
  /** Optional className override */
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function basename(p?: string): string {
  if (!p) return '';
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function deriveTitle(s: PersistedSessionRow): string {
  if (s.title && s.title.trim().length > 0) return truncate(s.title.trim(), 48);
  if (s.firstUserMessage && s.firstUserMessage.trim().length > 0) {
    return truncate(s.firstUserMessage.trim().replace(/\s+/g, ' '), 48);
  }
  const base = basename(s.workspacePath);
  if (base) return base;
  return `Session ${s.id.slice(0, 6)}`;
}

function modelChip(model?: string): string {
  if (!model) return 'default';
  // Display the last path segment (azure deployments are slash-paths) and
  // strip common vendor prefixes to keep the chip narrow.
  const last = model.split('/').pop() || model;
  return truncate(last.replace(/^us\./, '').replace(/^anthropic\./, ''), 16);
}

type Bucket = 'today' | 'yesterday' | 'week' | 'older';

function bucketFor(dateStr: string): Bucket {
  const then = new Date(dateStr);
  if (!Number.isFinite(then.getTime())) return 'older';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400_000;
  const startOfWeek = startOfToday - 6 * 86400_000;
  const t = then.getTime();
  if (t >= startOfToday) return 'today';
  if (t >= startOfYesterday) return 'yesterday';
  if (t >= startOfWeek) return 'week';
  return 'older';
}

const BUCKET_LABEL: Record<Bucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  older: 'Older',
};

// ─── Component ──────────────────────────────────────────────────────────

export const CodemodeSessionList: React.FC<CodemodeSessionListProps> = ({ className }) => {
  const activeSessionId = useActiveSessionId();
  const setActiveSession = useCodeModeStore((s) => s.setActiveSession);

  const [sessions, setSessions] = useState<PersistedSessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getToken = useCallback((): string => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('auth_token') || '';
  }, []);

  const loadSessions = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/openagentic/sessions/persisted', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const rows: PersistedSessionRow[] = Array.isArray(data?.sessions) ? data.sessions : [];
      // Sort newest first by lastActivity (fallback createdAt)
      rows.sort((a, b) => {
        const aT = new Date(a.lastActivity || a.createdAt).getTime();
        const bT = new Date(b.lastActivity || b.createdAt).getTime();
        return bT - aT;
      });
      setSessions(rows);
    } catch (err: any) {
      setError(err?.message || 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  // Initial load + refresh when active session changes (new session created
  // elsewhere in the layout should appear here without a manual refresh).
  useEffect(() => {
    loadSessions();
  }, [loadSessions, activeSessionId]);

  const handleNewSession = useCallback(async () => {
    const token = getToken();
    if (!token || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const resp = await fetch('/api/openagentic/sessions/persisted', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workspacePath: '/workspace' }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const s = data?.session;
      if (!s?.id) throw new Error('no session.id in response');
      setActiveSession(s.id, {
        sessionId: s.id,
        userId: s.userId || 'anonymous',
        workspacePath: s.workspacePath || '/workspace',
        model: s.model || '',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      setSessions((prev) => [
        {
          id: s.id,
          userId: s.userId,
          model: s.model || '',
          workspacePath: s.workspacePath || '/workspace',
          title: s.title,
          status: s.status || 'active',
          createdAt: s.createdAt || new Date().toISOString(),
          lastActivity: s.lastActivity || new Date().toISOString(),
        },
        ...prev.filter((r) => r.id !== s.id),
      ]);
    } catch (err: any) {
      setError(err?.message || 'Failed to create session');
    } finally {
      setIsCreating(false);
    }
  }, [getToken, isCreating, setActiveSession]);

  const handleSelect = useCallback(
    (row: PersistedSessionRow) => {
      if (row.id === activeSessionId) return;
      setActiveSession(row.id, {
        sessionId: row.id,
        userId: row.userId || 'anonymous',
        workspacePath: row.workspacePath || '/workspace',
        model: row.model || '',
        createdAt: new Date(row.createdAt).getTime(),
        lastActiveAt: new Date(row.lastActivity).getTime(),
      });
    },
    [activeSessionId, setActiveSession],
  );

  // Group sessions into buckets preserving order.
  const grouped: Array<{ bucket: Bucket; rows: PersistedSessionRow[] }> = [];
  const seen: Partial<Record<Bucket, number>> = {};
  for (const s of sessions) {
    const b = bucketFor(s.lastActivity || s.createdAt);
    if (seen[b] === undefined) {
      seen[b] = grouped.length;
      grouped.push({ bucket: b, rows: [s] });
    } else {
      grouped[seen[b]!].rows.push(s);
    }
  }

  return (
    <aside
      className={`flex flex-col h-full flex-shrink-0 border-r ${className || ''}`}
      style={{
        width: 240,
        backgroundColor: 'var(--cm-bg-secondary, #161b22)',
        borderColor: 'var(--cm-border, rgba(255,255,255,0.08))',
        color: 'var(--cm-text, #e6edf3)',
      }}
      aria-label="Code sessions"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--cm-border, rgba(255,255,255,0.08))' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--cm-text-muted, #7d8590)' }}>
          Sessions
        </span>
        <button
          type="button"
          onClick={handleNewSession}
          disabled={isCreating}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors disabled:opacity-50"
          style={{
            color: 'var(--cm-text, #e6edf3)',
            backgroundColor: 'transparent',
            border: '1px solid var(--cm-border, rgba(255,255,255,0.12))',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              'var(--cm-bg, rgba(255,255,255,0.04))';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          }}
          title="New session"
        >
          {isCreating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Plus size={12} />
          )}
          <span>New</span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading && sessions.length === 0 && (
          <div className="flex items-center justify-center py-6"
               style={{ color: 'var(--cm-text-muted, #7d8590)' }}>
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}

        {error && (
          <div className="px-3 py-2 text-xs" style={{ color: '#f85149' }}>
            {error}
          </div>
        )}

        {!isLoading && !error && sessions.length === 0 && (
          <div className="px-3 py-6 text-xs text-center"
               style={{ color: 'var(--cm-text-muted, #7d8590)' }}>
            <MessageSquare size={20} className="mx-auto mb-2 opacity-60" />
            <div>No sessions yet.</div>
            <div className="mt-1">Click <span className="font-medium">+ New</span> to start.</div>
          </div>
        )}

        {grouped.map(({ bucket, rows }) => (
          <div key={bucket} className="py-1">
            <div
              className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--cm-text-muted, #7d8590)' }}
            >
              {BUCKET_LABEL[bucket]}
            </div>
            <ul className="space-y-0.5 px-1">
              {rows.map((s) => {
                const isActive = s.id === activeSessionId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(s)}
                      className="w-full text-left px-2 py-1.5 rounded-md transition-colors"
                      style={{
                        backgroundColor: isActive
                          ? 'var(--cm-accent, rgba(88,166,255,0.15))'
                          : 'transparent',
                        borderLeft: isActive
                          ? '2px solid var(--cm-accent-border, #58a6ff)'
                          : '2px solid transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                            'var(--cm-bg, rgba(255,255,255,0.04))';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                            'transparent';
                        }
                      }}
                      title={s.title || s.workspacePath || s.id}
                    >
                      <div className="text-xs font-medium truncate"
                           style={{ color: 'var(--cm-text, #e6edf3)' }}>
                        {deriveTitle(s)}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded truncate max-w-[120px]"
                          style={{
                            backgroundColor: 'var(--cm-bg, rgba(255,255,255,0.06))',
                            color: 'var(--cm-text-muted, #7d8590)',
                          }}
                        >
                          {modelChip(s.model)}
                        </span>
                        <span className="text-[10px] whitespace-nowrap"
                              style={{ color: 'var(--cm-text-muted, #7d8590)' }}>
                          {relativeTime(s.lastActivity || s.createdAt)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
};

export default CodemodeSessionList;
