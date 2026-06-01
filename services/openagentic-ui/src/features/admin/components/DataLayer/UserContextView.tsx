import React, { useState, useEffect, useCallback } from 'react';
import { Search, Trash2, RefreshCw, Users, Brain, Code, GitBranch, MessageSquare } from '@/shared/icons';
import { Database } from '../Shared/AdminIcons';
import { PageHeader } from '../../primitives-v2';

// =============================================================================
// Types
// =============================================================================

interface ContextOverview {
  totalEntries: number;
  bySource: {
    chat: number;
    code: number;
    workflow: number;
    memory: number;
  };
  totalUsers: number;
  storageBytes: number;
}

interface UserContextSummary {
  userId: string;
  email: string;
  name: string;
  chatEntries: number;
  codeEntries: number;
  workflowEntries: number;
  memoryEntries: number;
  totalEntries: number;
  lastActivity: string;
}

interface ContextEntry {
  id: string;
  source: 'chat' | 'code' | 'workflow' | 'memory';
  content: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

interface RetentionSettings {
  chatRetentionDays: number;
  codeRetentionDays: number;
  workflowRetentionDays: number;
  memoryRetentionDays: number;
  autoCleanupEnabled: boolean;
}

interface UserContextViewProps {
  theme: string;
}

// =============================================================================
// Helpers
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString();
}

const SOURCE_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  chat:     { bg: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',   text: 'var(--color-primary)',   icon: <MessageSquare size={14} /> },
  code:     { bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',   text: 'var(--color-success)',   icon: <Code size={14} /> },
  workflow: { bg: 'color-mix(in srgb, var(--color-secondary) 12%, transparent)', text: 'var(--color-secondary)', icon: <GitBranch size={14} /> },
  memory:   { bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',   text: 'var(--color-warning)',   icon: <Brain size={14} /> },
};

// =============================================================================
// Sub-components
// =============================================================================

const MetricCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
  subtext?: string;
}> = ({ icon, label, value, color, subtext }) => (
  <div
    className="rounded-lg p-4 flex flex-col gap-2"
    style={{
      background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
      border: '1px solid var(--color-border, var(--color-border-default))',
    }}
  >
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
      {icon}
      {label}
    </div>
    <div className="text-2xl font-bold" style={{ color: color || 'var(--color-text-primary)' }}>
      {value}
    </div>
    {subtext && <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{subtext}</div>}
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const UserContextView: React.FC<UserContextViewProps> = ({ theme }) => {
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [users, setUsers] = useState<UserContextSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserContextSummary | null>(null);
  const [userEntries, setUserEntries] = useState<ContextEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [retention, setRetention] = useState<RetentionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/user-context/overview', { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to fetch overview: ${response.statusText}`);
      const data = await response.json();
      setOverview(data.overview || {
        totalEntries: 0,
        bySource: { chat: 0, code: 0, workflow: 0, memory: 0 },
        totalUsers: 0,
        storageBytes: 0,
      });
      // Map API response into UserContextSummary shape, with fallback for legacy {userId, entryCount} format
      const mappedUsers: UserContextSummary[] = (data.users || []).map((u: any) => ({
        userId: u.userId || u.user_id || '',
        email: u.email || u.userId || u.user_id || 'Unknown',
        name: u.name || u.email || u.userId || u.user_id || 'Unknown',
        chatEntries: u.chatEntries ?? 0,
        codeEntries: u.codeEntries ?? 0,
        workflowEntries: u.workflowEntries ?? 0,
        memoryEntries: u.memoryEntries ?? 0,
        totalEntries: u.totalEntries ?? u.entryCount ?? 0,
        lastActivity: u.lastActivity || new Date().toISOString(),
      }));
      setUsers(mappedUsers);
    } catch (err: any) {
      // Gracefully handle missing endpoint
      setOverview({
        totalEntries: 0,
        bySource: { chat: 0, code: 0, workflow: 0, memory: 0 },
        totalUsers: 0,
        storageBytes: 0,
      });
      setUsers([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRetention = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/user-context/retention', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      setRetention(data);
    } catch {
      // Gracefully handle missing endpoint
      setRetention({
        chatRetentionDays: 90,
        codeRetentionDays: 30,
        workflowRetentionDays: 180,
        memoryRetentionDays: 365,
        autoCleanupEnabled: false,
      });
    }
  }, []);

  const fetchUserEntries = useCallback(async (userId: string, query?: string) => {
    try {
      setEntriesLoading(true);
      const params = new URLSearchParams({ userId });
      if (query) params.set('q', query);
      const response = await fetch(`/api/admin/user-context/entries?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch entries');
      const data = await response.json();
      setUserEntries(data.entries || []);
    } catch {
      setUserEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  const handlePurge = async () => {
    if (!selectedUser) return;
    try {
      const response = await fetch(`/api/admin/user-context/${selectedUser.userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to purge user context');
      setPurgeConfirm(false);
      setSelectedUser(null);
      setUserEntries([]);
      fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => { fetchOverview(); fetchRetention(); }, [fetchOverview, fetchRetention]);

  useEffect(() => {
    if (selectedUser) {
      fetchUserEntries(selectedUser.userId);
    }
  }, [selectedUser, fetchUserEntries]);

  // ---------------------------------------------------------------------------
  // Filtered users
  // ---------------------------------------------------------------------------

  const filteredUsers = users.filter(u =>
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.userId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-secondary)' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mr-3" />
        Loading user context data...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Content', 'User Memory']}
        title="User Memory"
        explainer={`Cross-mode memory layer · ${formatNumber(overview?.totalEntries || 0)} entries · ${overview?.totalUsers || 0} users · ${formatBytes(overview?.storageBytes || 0)}`}
        actions={[
          { label: 'Refresh', onClick: fetchOverview },
        ]}
      />

      {error && (
        <div className="mx-4 mt-2 p-2 rounded-lg text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)', color: 'var(--color-error)' }}>
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70">dismiss</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <MetricCard
            icon={<Database size={14} />}
            label="Total Entries"
            value={formatNumber(overview?.totalEntries || 0)}
            color="var(--color-accent, var(--color-accent-primary))"
          />
          <MetricCard
            icon={<MessageSquare size={14} />}
            label="Chat Context"
            value={formatNumber(overview?.bySource.chat || 0)}
            color="var(--color-primary)"
            subtext={`${overview?.totalEntries ? Math.round((overview.bySource.chat / overview.totalEntries) * 100) : 0}% of total`}
          />
          <MetricCard
            icon={<Code size={14} />}
            label="Code Context"
            value={formatNumber(overview?.bySource.code || 0)}
            color="var(--color-success)"
            subtext={`${overview?.totalEntries ? Math.round((overview.bySource.code / overview.totalEntries) * 100) : 0}% of total`}
          />
          <MetricCard
            icon={<GitBranch size={14} />}
            label="Workflow Context"
            value={formatNumber(overview?.bySource.workflow || 0)}
            color="var(--color-secondary)"
            subtext={`${overview?.totalEntries ? Math.round((overview.bySource.workflow / overview.totalEntries) * 100) : 0}% of total`}
          />
        </div>

        {/* Memory entries card */}
        <div className="mt-3">
          <MetricCard
            icon={<Brain size={14} />}
            label="Memory Store"
            value={formatNumber(overview?.bySource.memory || 0)}
            color="var(--color-warning)"
            subtext="Persistent memory entries (memory_store)"
          />
        </div>

        {/* Retention Settings */}
        {retention && (
          <div className="mt-4 rounded-lg p-4" style={{
            backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
            border: '1px solid var(--color-border, var(--color-border-default))',
          }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
              Retention Settings
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Chat', days: retention.chatRetentionDays, color: 'var(--color-primary)' },
                { label: 'Code', days: retention.codeRetentionDays, color: 'var(--color-success)' },
                { label: 'Workflow', days: retention.workflowRetentionDays, color: 'var(--color-secondary)' },
                { label: 'Memory', days: retention.memoryRetentionDays, color: 'var(--color-warning)' },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {r.label}: <strong style={{ color: 'var(--color-text-primary)' }}>{r.days}d</strong>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Auto-cleanup: {retention.autoCleanupEnabled ? (
                <span style={{ color: 'var(--color-success)' }}>Enabled</span>
              ) : (
                <span style={{ color: 'var(--color-warning)' }}>Disabled</span>
              )}
            </div>
          </div>
        )}

        {/* User Search */}
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
            <Users size={12} className="inline mr-1" /> Users ({filteredUsers.length})
          </div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input
              type="text"
              placeholder="Search users by email, name, or ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg text-sm outline-none transition-colors"
              style={{
                backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
                border: '1px solid var(--color-border, var(--color-border-default))',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* User List */}
          <div className="space-y-1.5">
            {filteredUsers.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                {searchQuery ? 'No users match your search.' : 'No user context data found.'}
              </div>
            ) : (
              filteredUsers.map(user => {
                const isSelected = selectedUser?.userId === user.userId;
                return (
                  <div
                    key={user.userId}
                    onClick={() => setSelectedUser(isSelected ? null : user)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
                    style={{
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)'
                        : 'var(--color-bg-surface, var(--color-surface))',
                      border: isSelected
                        ? '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)'
                        : '1px solid var(--color-border, var(--color-border-default))',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {user.name || user.email}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{user.email}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {Object.entries(SOURCE_COLORS).map(([source, cfg]) => {
                          const count = user[`${source}Entries` as keyof UserContextSummary] as number;
                          return count > 0 ? (
                            <span key={source} className="flex items-center gap-1 px-1.5 py-0.5 text-xs rounded" style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                              {cfg.icon} {count}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{user.totalEntries}</div>
                      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>entries</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selected User Detail */}
        {selectedUser && (
          <div className="mt-4 rounded-lg overflow-hidden" style={{
            border: '1px solid var(--color-border, var(--color-border-default))',
          }}>
            {/* User header */}
            <div className="flex items-center justify-between px-4 py-3" style={{
              backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, transparent)',
              borderBottom: '1px solid var(--color-border, var(--color-border-default))',
            }}>
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{selectedUser.name || selectedUser.email}</div>
                <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {selectedUser.userId} &middot; Last activity: {formatDate(selectedUser.lastActivity)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPurgeConfirm(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)', color: 'var(--color-error)' }}
                >
                  <Trash2 size={12} /> Purge All
                </button>
              </div>
            </div>

            {/* Context breakdown */}
            <div className="p-4" style={{ backgroundColor: 'var(--color-bg-surface, var(--color-surface))' }}>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {Object.entries(SOURCE_COLORS).map(([source, cfg]) => {
                  const count = selectedUser[`${source}Entries` as keyof UserContextSummary] as number;
                  return (
                    <div key={source} className="p-2 rounded-lg text-center" style={{ backgroundColor: cfg.bg }}>
                      <div className="text-lg font-bold" style={{ color: cfg.text }}>{count}</div>
                      <div className="text-xs capitalize" style={{ color: cfg.text }}>{source}</div>
                    </div>
                  );
                })}
              </div>

              {/* Search within user context */}
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="Search this user's context..."
                  value={userSearchQuery}
                  onChange={e => setUserSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') fetchUserEntries(selectedUser.userId, userSearchQuery);
                  }}
                  className="w-full pl-9 pr-20 py-1.5 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                    border: '1px solid var(--color-border, var(--color-border-default))',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <button
                  onClick={() => fetchUserEntries(selectedUser.userId, userSearchQuery)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs rounded transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'var(--color-accent, var(--color-accent-primary))', color: 'var(--ap-fg-0)' }}
                >
                  Search
                </button>
              </div>

              {/* Entries list */}
              {entriesLoading ? (
                <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading entries...</div>
              ) : userEntries.length === 0 ? (
                <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  {userSearchQuery ? 'No entries match your search.' : 'No context entries found for this user.'}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {userEntries.map(entry => {
                    const cfg = SOURCE_COLORS[entry.source] || SOURCE_COLORS.chat;
                    return (
                      <div key={entry.id} className="flex items-start gap-2 p-2 rounded-lg" style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                      }}>
                        <span className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 text-xs rounded capitalize" style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                          {entry.source}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>{entry.content}</p>
                          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(entry.createdAt)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Purge Confirmation Dialog */}
      {purgeConfirm && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-shadow)_70%,transparent)] backdrop-blur-sm" onClick={() => setPurgeConfirm(false)}>
          <div
            className="rounded-xl w-[440px] shadow-2xl"
            style={{
              backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
              border: '1px solid var(--color-border, var(--color-border-default))',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--color-border, var(--color-border-default))' }}>
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Purge User Context</h3>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                This will permanently delete <strong>all {selectedUser.totalEntries} context entries</strong> for{' '}
                <strong>{selectedUser.name || selectedUser.email}</strong>.
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-error)' }}>
                This action cannot be undone. Chat, code, workflow, and memory entries will all be removed.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid var(--color-border, var(--color-border-default))' }}>
              <button
                onClick={() => setPurgeConfirm(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg transition-opacity hover:opacity-80"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border, var(--color-border-default))' }}
              >Cancel</button>
              <button
                onClick={handlePurge}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium rounded-lg text-on-accent transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'var(--color-error)' }}
              >
                <Trash2 size={14} /> Purge All Context
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
