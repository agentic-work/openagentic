/**
 * TeamContent — workflow sharing (owner, shares, roles) + recent activity feed.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Search, Users, Clock } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import {
  btnPrimary, btnPrimaryStyle, inputClass, inputStyle,
  tableHeaderClass, tableHeaderStyle, tableCellClass, tableCellStyle,
  roleColors, StatusDot,
} from '../sectionShared';

interface Share { id: string; name?: string; email?: string; role: string; type?: string }
interface ActivityEntry { id: string; user_name: string; status: string; started_at: string; duration_ms?: number }
interface RawExecution {
  id?: string;
  user_name?: string;
  user_email?: string;
  status?: string;
  started_at?: string;
  created_at?: string;
  duration_ms?: number;
}

export const TeamContent: React.FC<{ workflowId?: string }> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const [shares, setShares] = useState<Share[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newShare, setNewShare] = useState({ email: '', role: 'viewer' });
  const [saving, setSaving] = useState(false);

  const fetchShares = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares`), { headers });
      if (res.ok) {
        const data = await res.json();
        setShares(Array.isArray(data) ? data : data.shares || []);
        if (data.owner) setOwner(data.owner);
      }
    } catch { /* silently handle */ }
    finally { setLoading(false); }
  }, [workflowId, getAuthHeaders]);

  const fetchActivity = useCallback(async () => {
    if (!workflowId) return;
    try {
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions?limit=10`), { headers });
      if (res.ok) {
        const data = await res.json();
        const execs = Array.isArray(data) ? data : data.executions || [];
        setActivity(execs.slice(0, 10).map((ex: RawExecution) => ({
          id: ex.id,
          user_name: ex.user_name || ex.user_email || 'Unknown',
          status: ex.status,
          started_at: ex.started_at || ex.created_at,
          duration_ms: ex.duration_ms,
        })));
      }
    } catch { /* silently handle */ }
  }, [workflowId, getAuthHeaders]);

  useEffect(() => { fetchShares(); fetchActivity(); }, [fetchShares, fetchActivity]);

  const handleAddShare = useCallback(async () => {
    if (!workflowId || !newShare.email.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares`), {
        method: 'POST', headers,
        body: JSON.stringify({ email: newShare.email.trim(), role: newShare.role }),
      });
      if (res.ok) { setNewShare({ email: '', role: 'viewer' }); setShowAddUser(false); fetchShares(); }
    } catch { /* silently handle */ }
    finally { setSaving(false); }
  }, [workflowId, newShare, getAuthHeaders, fetchShares]);

  const handleUpdateRole = useCallback(async (shareId: string, role: string) => {
    if (!workflowId) return;
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      await fetch(workflowEndpoint(`/workflows/${workflowId}/shares/${shareId}`), {
        method: 'PATCH', headers, body: JSON.stringify({ role }),
      });
      fetchShares();
    } catch { /* silently handle */ }
  }, [workflowId, getAuthHeaders, fetchShares]);

  const statusColors: Record<string, string> = { completed: 'var(--color-success)', failed: 'var(--color-error)', running: 'var(--color-warning)' };

  if (!workflowId) {
    return <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Save workflow first to manage team access</div>;
  }

  return (
    <div className="space-y-4">
      {/* Owner */}
      {owner && (
        <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Owner:</span>
          <span className="text-sm font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--glass-accent-fill-2)', color: 'var(--color-accent)' }}>
            {owner}
          </span>
        </div>
      )}

      {/* Shares */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Shared with {shares.length} user{shares.length !== 1 ? 's' : ''}
          </span>
          <button onClick={() => setShowAddUser(!showAddUser)} className={btnPrimary} style={btnPrimaryStyle}>
            <span className="flex items-center gap-1.5">
              {showAddUser ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showAddUser ? 'Cancel' : 'Add User'}
            </span>
          </button>
        </div>

        {/* Add user form */}
        <AnimatePresence>
          {showAddUser && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden mb-4">
              <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input type="text" value={newShare.email} onChange={e => setNewShare(s => ({ ...s, email: e.target.value }))} placeholder="Search by email..." className={`${inputClass} pl-9`} style={inputStyle} />
                </div>
                <select value={newShare.role} onChange={e => setNewShare(s => ({ ...s, role: e.target.value }))} className={inputClass} style={inputStyle}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="executor">Executor</option>
                  <option value="admin">Admin</option>
                </select>
                <button onClick={handleAddShare} disabled={saving || !newShare.email.trim()} className={`${btnPrimary} w-full`} style={btnPrimaryStyle}>
                  {saving ? 'Adding...' : 'Add User'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Shares table */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                <th className={tableHeaderClass} style={tableHeaderStyle}>User / Group</th>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Email</th>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Role</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
              ) : shares.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No shares yet</td></tr>
              ) : (
                shares.map(share => (
                  <tr key={share.id} className="transition-colors hover:bg-[var(--color-surface)]">
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center gap-2">
                        {share.type === 'group' ? (
                          <Users className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                            {share.name?.charAt(0)?.toUpperCase() || '?'}
                          </span>
                        )}
                        <span className="font-medium">{share.name}</span>
                      </div>
                    </td>
                    <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-secondary)' }}>
                      {share.email || '-'}
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <select
                        value={share.role}
                        onChange={e => handleUpdateRole(share.id, e.target.value)}
                        className="text-xs px-2 py-1 rounded-lg border-none cursor-pointer focus:outline-none"
                        style={{ backgroundColor: `${roleColors[share.role]}20`, color: roleColors[share.role] }}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="executor">Executor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Activity Feed</span>
        </div>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {activity.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No recent activity</div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {activity.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface)]">
                  <StatusDot color={statusColors[entry.status] || 'var(--color-fg-muted)'} />
                  <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{entry.user_name}</span>
                  <span className="text-xs capitalize" style={{ color: statusColors[entry.status] || 'var(--color-fg-muted)' }}>{entry.status}</span>
                  {entry.duration_ms !== undefined && (
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {entry.duration_ms < 1000 ? `${entry.duration_ms}ms` : `${(entry.duration_ms / 1000).toFixed(1)}s`}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {new Date(entry.started_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
