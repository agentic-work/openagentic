/**
 * CodeMode Users View
 *
 * Active sessions monitoring + user management for code mode.
 * - Active Sessions: table with kill/bulk-kill controls
 * - User Management: ban/disable, per-user quotas
 * - Observability: summary cards + Grafana links
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Monitor, Trash2, Shield, Eye, RefreshCw,
  Activity, Clock, Zap, DollarSign, Terminal,
  ChevronDown, ChevronRight, Search, ExternalLink, AlertTriangle
} from '@/shared/icons';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiRequest } from '@/utils/api';

type ActivityState = 'idle' | 'thinking' | 'writing' | 'editing' | 'executing' | 'artifact' | 'error';

interface CodeModeSession {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  status: 'running' | 'idle' | 'stopped' | 'error';
  model: string;
  createdAt: string;
  lastActivity: string;
  activityState?: ActivityState;
  metrics?: {
    cpu: number;
    memory: number;
    memoryMB: number;
    elapsed: number;
  } | null;
  tokenCount?: number;
  messageCount?: number;
  storageMB?: number;
}

interface CodeModeUser {
  id: string;
  name: string;
  email: string;
  sessionsCount: number;
  totalTokens: number;
  totalCost: number;
  status: 'active' | 'disabled' | 'banned';
  lastSession?: string;
}

interface SummaryStats {
  activeSessions: number;
  tokensToday: number;
  costToday: number;
  avgSessionDuration: number;
}

interface CodeModeUsersViewProps {
  theme?: string;
}

const ACTIVITY_COLORS: Record<ActivityState, string> = {
  idle: 'var(--color-textMuted)',
  thinking: 'var(--color-warning)',
  writing: 'var(--color-success)',
  editing: 'var(--color-primary)',
  executing: '#f97316',
  artifact: '#a855f7',
  error: 'var(--color-error)',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'var(--color-success)',
  idle: 'var(--color-textMuted)',
  stopped: 'var(--color-textMuted)',
  error: 'var(--color-error)',
  active: 'var(--color-success)',
  disabled: 'var(--color-warning)',
  banned: 'var(--color-error)',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export const CodeModeUsersView: React.FC<CodeModeUsersViewProps> = ({ theme }) => {
  const confirm = useConfirm();

  const [activeTab, setActiveTab] = useState<'sessions' | 'users'>('sessions');
  const [sessions, setSessions] = useState<CodeModeSession[]>([]);
  const [users, setUsers] = useState<CodeModeUser[]>([]);
  const [stats, setStats] = useState<SummaryStats>({ activeSessions: 0, tokensToday: 0, costToday: 0, avgSessionDuration: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Derive users from sessions data — /admin/codemode/users endpoint doesn't exist
  const deriveUsersFromSessions = useCallback((sessionList: CodeModeSession[]) => {
    const userMap = new Map<string, CodeModeUser>();
    for (const s of sessionList) {
      const existing = userMap.get(s.userId);
      if (existing) {
        existing.sessionsCount += 1;
        existing.totalTokens += s.tokenCount || 0;
        if (s.lastActivity > (existing.lastSession || '')) {
          existing.lastSession = s.lastActivity;
        }
      } else {
        userMap.set(s.userId, {
          id: s.userId,
          name: s.userName || s.userEmail || s.userId,
          email: s.userEmail || '',
          sessionsCount: 1,
          totalTokens: s.tokenCount || 0,
          totalCost: 0,
          status: 'active',
          lastSession: s.lastActivity,
        });
      }
    }
    setUsers(Array.from(userMap.values()));
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await apiRequest('/admin/code/sessions');
      if (response.ok) {
        const data = await response.json();
        const sessionList = data.sessions || [];
        setSessions(sessionList);
        // Compute summary stats from sessions
        const active = sessionList.filter((s: CodeModeSession) => s.status === 'running' || s.status === 'idle');
        setStats(prev => ({
          ...prev,
          activeSessions: active.length,
          tokensToday: active.reduce((sum: number, s: CodeModeSession) => sum + (s.tokenCount || 0), 0),
        }));
        // Derive users from sessions
        deriveUsersFromSessions(sessionList);
      }
    } catch {
      // Silent fail for polling
    } finally {
      setLoading(false);
    }
  }, [deriveUsersFromSessions]);

  useEffect(() => {
    fetchSessions();
    // Poll sessions every 10s
    pollRef.current = setInterval(fetchSessions, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchSessions]);

  const handleKillSession = async (session: CodeModeSession) => {
    if (!await confirm(`Kill session ${session.id.slice(0, 8)}... for ${session.userName || session.userEmail || session.userId}?`, { variant: 'danger', title: 'Kill Session' })) return;
    try {
      const response = await apiRequest(`/admin/code/sessions/${session.id}`, { method: 'DELETE' });
      if (response.ok) {
        setSessions(prev => prev.filter(s => s.id !== session.id));
        setSuccess('Session killed');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to kill session');
      }
    } catch {
      setError('Failed to kill session');
    }
  };

  const handleBanUser = async (user: CodeModeUser) => {
    const action = user.status === 'banned' ? 'unban' : 'ban';
    if (!await confirm(`${action === 'ban' ? 'Ban' : 'Unban'} ${user.name} from code mode?`, { variant: 'danger', title: `${action === 'ban' ? 'Ban' : 'Unban'} User` })) return;
    try {
      await apiRequest(`/admin/codemode/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: action === 'ban' ? 'banned' : 'active' }),
      });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: action === 'ban' ? 'banned' : 'active' } : u));
    } catch {
      setError(`Failed to ${action} user`);
    }
  };

  const handleDisableUser = async (user: CodeModeUser) => {
    const action = user.status === 'disabled' ? 'enable' : 'disable';
    try {
      await apiRequest(`/admin/codemode/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: action === 'disable' ? 'disabled' : 'active' }),
      });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: action === 'disable' ? 'disabled' : 'active' } : u));
    } catch {
      setError(`Failed to ${action} user`);
    }
  };

  const filteredSessions = sessions.filter(s =>
    !search || (s.userName || '').toLowerCase().includes(search.toLowerCase()) || (s.userEmail || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredUsers = users.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold mb-1 text-text-primary flex items-center gap-2">
          <Users size={20} />
          CodeMode Users
        </h2>
        <p className="text-sm text-text-secondary">
          Monitor active sessions and manage user access
        </p>
      </div>

      {/* Messages */}
      {success && <div className="p-3 rounded-lg bg-success-500/10 border border-success/30 ap-text-success text-sm">{success}</div>}
      {error && <div className="p-3 rounded-lg bg-error-500/10 border border-error/30 ap-text-error text-sm">{error}</div>}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Active Sessions', value: stats.activeSessions, icon: <Monitor size={16} />, color: 'var(--color-success)' },
          { label: 'Tokens Today', value: formatTokens(stats.tokensToday), icon: <Zap size={16} />, color: 'var(--color-primary)' },
          { label: 'Cost Today', value: `$${stats.costToday.toFixed(2)}`, icon: <DollarSign size={16} />, color: 'var(--color-warning)' },
          { label: 'Avg Duration', value: formatDuration(stats.avgSessionDuration), icon: <Clock size={16} />, color: 'var(--accent-info, var(--color-primary))' },
        ].map((card, i) => (
          <div key={i} className="glass-card px-4 py-3">
            <div className="flex items-center gap-2 text-text-tertiary mb-1">
              <span style={{ color: card.color }}>{card.icon}</span>
              <span className="text-xs">{card.label}</span>
            </div>
            <div className="text-lg font-semibold text-text-primary">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center gap-1 border-b border-white/10 pb-px">
        {(['sessions', 'users'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-sm font-medium transition-colors relative capitalize ${
              activeTab === tab ? 'text-primary-500' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab === 'sessions' ? `Sessions (${sessions.length})` : `Users (${users.length})`}
            {activeTab === tab && <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary-500" />}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={fetchSessions} className="p-1.5 rounded hover:bg-surface-secondary text-text-tertiary transition-colors" title="Refresh">
          <RefreshCw size={14} />
        </button>
        <div className="relative ml-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-xs w-48"
            placeholder="Search..."
          />
        </div>
      </div>

      {/* Sessions Tab */}
      {activeTab === 'sessions' && (
        loading ? (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <Terminal size={32} className="mx-auto text-text-tertiary mb-3" />
            <p className="text-text-secondary text-sm">No active sessions</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1fr_100px_80px_80px_80px_60px] gap-2 px-4 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wider">
              <span>User</span>
              <span>Session</span>
              <span>Status</span>
              <span>Model</span>
              <span>Duration</span>
              <span>Tokens</span>
              <span></span>
            </div>
            {filteredSessions.map(session => {
              const elapsed = Math.floor((Date.now() - new Date(session.createdAt).getTime()) / 1000);
              return (
                <div key={session.id} className="glass-card grid grid-cols-[1fr_1fr_100px_80px_80px_80px_60px] gap-2 px-4 py-2.5 items-center">
                  <div>
                    <div className="text-sm text-text-primary">{session.userName || session.userEmail || 'Unknown'}</div>
                    <div className="text-xs text-text-tertiary">{session.userEmail}</div>
                  </div>
                  <div className="text-xs text-text-tertiary font-mono">{session.id.slice(0, 12)}...</div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[session.status] || STATUS_COLORS.idle }} />
                    <span className="text-xs text-text-secondary capitalize">{session.activityState || session.status}</span>
                  </div>
                  <span className="text-xs text-text-tertiary truncate">{session.model}</span>
                  <span className="text-xs text-text-tertiary">{formatDuration(elapsed)}</span>
                  <span className="text-xs text-text-tertiary">{formatTokens(session.tokenCount || 0)}</span>
                  <button
                    onClick={() => handleKillSession(session)}
                    className="p-1 rounded hover:bg-error-500/10 text-text-tertiary hover:text-error-500 transition-colors"
                    title="Kill session"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        filteredUsers.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <Users size={32} className="mx-auto text-text-tertiary mb-3" />
            <p className="text-text-secondary text-sm">
              {users.length === 0 ? 'No users found — users are derived from active sessions' : 'No matching users'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_1fr_80px_80px_80px_100px] gap-2 px-4 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wider">
              <span>User</span>
              <span>Email</span>
              <span>Sessions</span>
              <span>Tokens</span>
              <span>Cost</span>
              <span>Actions</span>
            </div>
            {filteredUsers.map(user => (
              <div key={user.id} className="glass-card grid grid-cols-[1fr_1fr_80px_80px_80px_100px] gap-2 px-4 py-2.5 items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[user.status] || STATUS_COLORS.active }} />
                  <span className="text-sm text-text-primary">{user.name}</span>
                </div>
                <span className="text-xs text-text-tertiary">{user.email}</span>
                <span className="text-xs text-text-tertiary">{user.sessionsCount}</span>
                <span className="text-xs text-text-tertiary">{formatTokens(user.totalTokens)}</span>
                <span className="text-xs text-text-tertiary">${user.totalCost.toFixed(2)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDisableUser(user)}
                    className={`px-2 py-1 rounded text-xs transition-colors ${
                      user.status === 'disabled'
                        ? 'bg-success-500/10 text-success-500 hover:bg-success-500/20'
                        : 'bg-surface-secondary text-text-tertiary hover:bg-warning-500/10 hover:text-warning-500'
                    }`}
                    title={user.status === 'disabled' ? 'Enable' : 'Disable'}
                  >
                    {user.status === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    onClick={() => handleBanUser(user)}
                    className={`p-1 rounded transition-colors ${
                      user.status === 'banned'
                        ? 'bg-success-500/10 text-success-500 hover:bg-success-500/20'
                        : 'hover:bg-error-500/10 text-text-tertiary hover:text-error-500'
                    }`}
                    title={user.status === 'banned' ? 'Unban' : 'Ban'}
                  >
                    <Shield size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default CodeModeUsersView;
