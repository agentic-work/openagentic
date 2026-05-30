/**
 * CodeSessionsPanel — Codemode sessions list, styled to match the Chat
 * "Recent" list in ChatSidebar. Renders inside the unified Chat|Code|Flows
 * sidebar (below the mode toggle) when appMode === 'code'.
 *
 * Fetches GET /api/openagentic/sessions/persisted, creates via POST, and
 * activates a session by calling useCodeModeStore.setActiveSession.
 *
 * Mirrors the helper utilities originally in CodemodeSessionList.tsx but
 * reimplements the markup to visually match the Chat Recent list.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit3, Loader2, MessageSquare } from '@/shared/icons';
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
  firstUserMessage?: string;
}

interface CodeSessionsPanelProps {
  isExpanded: boolean;
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
  // Skip workspacePath as a fallback — for codemode every session
  // workspaces at /workspace, so the basename would render as a
  // useless "workspace" label on every row. Fall back to a short id.
  return `Session ${s.id.slice(0, 8)}`;
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

export const CodeSessionsPanel: React.FC<CodeSessionsPanelProps> = ({ isExpanded }) => {
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

  // Initial load + refresh whenever active session changes elsewhere
  useEffect(() => {
    loadSessions();
  }, [loadSessions, activeSessionId]);

  // Refresh on window focus so new sessions created in other tabs appear
  useEffect(() => {
    const onFocus = () => loadSessions();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadSessions]);

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

  // Bucketed groups preserving order
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
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      {/* New Session Button — mirrors "New Chat" button markup */}
      <div className="px-3 mb-2 mt-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleNewSession}
          disabled={isCreating}
          className={`button-glass flex items-center gap-3 p-2 rounded-lg text-secondary ${
            isExpanded ? 'w-full justify-start' : 'justify-center'
          } ${isCreating ? 'opacity-60 cursor-wait' : ''}`}
          title={!isExpanded ? 'New Session' : undefined}
        >
          {isCreating ? (
            <Loader2 size={20} className="flex-shrink-0 animate-spin" />
          ) : (
            <Edit3 size={20} className="flex-shrink-0" />
          )}
          <AnimatePresence>
            {isExpanded && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="font-medium whitespace-nowrap"
              >
                New Session
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Error banner */}
      {error && isExpanded && (
        <div className="px-3 pb-2 text-xs" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && sessions.length === 0 && isExpanded && (
        <div className="px-6 py-6 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
          <MessageSquare size={20} className="mx-auto mb-2 opacity-60" />
          <div>No sessions yet.</div>
          <div className="mt-1">
            Click <span className="font-medium">+ New Session</span> to start.
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && sessions.length === 0 && isExpanded && (
        <div className="flex items-center justify-center py-6" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}

      {/* Recent header */}
      {sessions.length > 0 && (
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-6 py-2 flex items-center justify-between"
            >
              <h3
                className="text-sm font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Recent
              </h3>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Grouped session rows */}
      <div className="px-3">
        {grouped.map(({ bucket, rows }) => (
          <div key={bucket} className="mb-2">
            {isExpanded && (
              <div
                className="px-3 pt-1 pb-1 text-[11px] uppercase tracking-wider"
                style={{ color: 'var(--text-muted)', opacity: 0.8 }}
              >
                {BUCKET_LABEL[bucket]}
              </div>
            )}
            {rows.map((s) => {
              const isActive = s.id === activeSessionId;
              return (
                <div key={s.id} className="relative mb-1">
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors hover:bg-theme-bg-secondary ${
                      isActive
                        ? 'bg-theme-bg-secondary text-theme-text-primary'
                        : 'text-theme-text-secondary hover:text-theme-text-primary'
                    }`}
                    onClick={() => handleSelect(s)}
                  >
                    {!isExpanded ? (
                      <div className="flex items-center justify-center w-full relative group">
                        <motion.div
                          className={`w-3 h-3 rounded-full border-2 transition-all duration-200 ${
                            isActive
                              ? 'bg-theme-accent border-theme-accent shadow-lg'
                              : 'bg-theme-bg-tertiary border-theme-border-primary hover:border-theme-accent hover:bg-theme-accent/20'
                          }`}
                          whileHover={{ scale: 1.3 }}
                          whileTap={{ scale: 0.9 }}
                          title={deriveTitle(s)}
                        />
                        {isActive && (
                          <motion.div
                            className="absolute w-6 h-6 rounded-full border-2 border-theme-accent opacity-30"
                            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
                            transition={{ duration: 2, repeat: Infinity }}
                          />
                        )}
                        <div className="absolute left-full ml-2 px-2 py-1 bg-theme-bg-primary text-theme-text-primary text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                          {deriveTitle(s)}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-shrink-0 mr-3">
                          <motion.div
                            className={`w-2 h-2 rounded-full transition-all duration-200 ${
                              isActive ? 'bg-theme-accent shadow-lg' : 'bg-theme-bg-muted'
                            }`}
                            animate={
                              isActive
                                ? { scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }
                                : {}
                            }
                            transition={isActive ? { duration: 2, repeat: Infinity } : {}}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-sm truncate font-medium ${
                              isActive ? 'text-theme-accent' : 'text-theme-text-primary'
                            }`}
                          >
                            {deriveTitle(s)}
                          </div>
                          <div
                            className="text-xs mt-0.5 flex items-center gap-2"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <span>{relativeTime(s.lastActivity || s.createdAt)}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </motion.div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CodeSessionsPanel;
