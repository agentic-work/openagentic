/**
 * TeamDetailDialog — slide-in panel when a team row is clicked.
 *
 * Three tabs:
 *   Members      — list users; Add User / Remove
 *   Shared Flows — list WorkflowShare rows; Share Flow / Revoke
 *   Settings     — edit team metadata (display_name, description, etc.)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchTeamMembers,
  fetchSharedFlows,
  addTeamMember,
  removeTeamMember,
  shareFlowWithTeam,
  revokeFlowShare,
  updateTeam,
} from '../../services/teamsAdminApi';
import type { Team, TeamMember, SharedFlow, FlowRole } from '../../services/teamsAdminApi';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TeamDetailDialogProps {
  team: Team;
  onClose: () => void;
  onUpdated: () => void;
}

type TabId = 'members' | 'shared-flows' | 'settings';

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
};

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

function MembersTab({ teamId }: { teamId: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addEmail, setAddEmail] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTeamMembers(teamId);
      setMembers(data.members);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setSubmitting(true);
    setAddError(null);
    try {
      await addTeamMember(teamId, addEmail.trim());
      setAddEmail('');
      load();
    } catch (err: any) {
      setAddError(err?.message ?? 'Failed to add user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeTeamMember(teamId, userId);
      load();
    } catch (err: any) {
      /* silently log — non-critical */
    }
  };

  return (
    <div className="space-y-4">
      {/* Add user form */}
      <form onSubmit={handleAdd} className="flex gap-2 items-end">
        <div className="flex-1">
          <label style={labelStyle} htmlFor="add-user-email">Add User by Email</label>
          <input
            id="add-user-email"
            type="email"
            value={addEmail}
            onChange={e => setAddEmail(e.target.value)}
            placeholder="user@example.com"
            style={inputStyle}
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !addEmail.trim()}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--ap-fg-0)' }}
        >
          Add User
        </button>
      </form>
      {addError && <p className="text-xs" style={{ color: 'var(--color-error)' }}>{addError}</p>}

      {/* Member list */}
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      ) : members.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No members yet.</p>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th className="text-left py-2 px-1" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Email</th>
              <th className="text-left py-2 px-1" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Name</th>
              <th className="text-left py-2 px-1" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="py-2 px-1" style={{ color: 'var(--text-primary)' }}>{m.user.email}</td>
                <td className="py-2 px-1" style={{ color: 'var(--text-secondary)' }}>{m.user.name ?? '—'}</td>
                <td className="py-2 px-1" style={{ color: 'var(--text-secondary)' }}>{m.role}</td>
                <td className="py-2 px-1 text-right">
                  <button
                    onClick={() => handleRemove(m.user_id)}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared Flows tab
// ---------------------------------------------------------------------------

const ROLES: FlowRole[] = ['viewer', 'editor', 'executor', 'admin'];

function SharedFlowsTab({ teamId }: { teamId: string }) {
  const [shares, setShares] = useState<SharedFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workflowId, setWorkflowId] = useState('');
  const [role, setRole] = useState<FlowRole>('viewer');
  const [addError, setAddError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSharedFlows(teamId);
      setShares(data.shares);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflowId.trim()) return;
    setSubmitting(true);
    setAddError(null);
    try {
      await shareFlowWithTeam(teamId, workflowId.trim(), role);
      setWorkflowId('');
      load();
    } catch (err: any) {
      setAddError(err?.message ?? 'Failed to share flow');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeFlowShare(teamId, shareId);
      load();
    } catch { /* non-critical */ }
  };

  return (
    <div className="space-y-4">
      {/* Share form */}
      <form onSubmit={handleShare} className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-40">
          <label style={labelStyle} htmlFor="share-workflow-id">Workflow ID</label>
          <input
            id="share-workflow-id"
            type="text"
            value={workflowId}
            onChange={e => setWorkflowId(e.target.value)}
            placeholder="workflow-id"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="share-role">Role</label>
          <select
            id="share-role"
            value={role}
            onChange={e => setRole(e.target.value as FlowRole)}
            style={{ ...inputStyle, width: 'auto' }}
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting || !workflowId.trim()}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--ap-fg-0)' }}
        >
          Share Flow
        </button>
      </form>
      {addError && <p className="text-xs" style={{ color: 'var(--color-error)' }}>{addError}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      ) : shares.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No shared flows yet.</p>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th className="text-left py-2 px-1" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Workflow</th>
              <th className="text-left py-2 px-1" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shares.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="py-2 px-1" style={{ color: 'var(--text-primary)' }}>
                  {s.workflow?.name ?? s.workflow_id}
                </td>
                <td className="py-2 px-1" style={{ color: 'var(--text-secondary)' }}>{s.role}</td>
                <td className="py-2 px-1 text-right">
                  <button
                    onClick={() => handleRevoke(s.id)}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function SettingsTab({ team, onUpdated }: { team: Team; onUpdated: () => void }) {
  const [displayName, setDisplayName] = useState(team.display_name);
  const [description, setDescription] = useState(team.description ?? '');
  const [costCenter, setCostCenter] = useState(team.cost_center ?? '');
  const [billingEmail, setBillingEmail] = useState(team.billing_contact_email ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateTeam(team.id, {
        display_name: displayName,
        description: description || undefined,
        cost_center: costCenter || undefined,
        billing_contact_email: billingEmail || undefined,
      });
      setSaveMsg('Saved');
      onUpdated();
    } catch (err: any) {
      setSaveMsg(err?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label htmlFor="settings-display-name" style={labelStyle}>Display Name *</label>
        <input
          id="settings-display-name"
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          style={inputStyle}
          required
          aria-label="Display Name"
        />
      </div>
      <div>
        <label htmlFor="settings-description" style={labelStyle}>Description</label>
        <textarea
          id="settings-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          aria-label="Description"
        />
      </div>
      <div>
        <label htmlFor="settings-cost-center" style={labelStyle}>Cost Center</label>
        <input
          id="settings-cost-center"
          type="text"
          value={costCenter}
          onChange={e => setCostCenter(e.target.value)}
          style={inputStyle}
          aria-label="Cost Center"
        />
      </div>
      <div>
        <label htmlFor="settings-billing-email" style={labelStyle}>Billing Contact Email</label>
        <input
          id="settings-billing-email"
          type="email"
          value={billingEmail}
          onChange={e => setBillingEmail(e.target.value)}
          style={inputStyle}
          aria-label="Billing Contact Email"
        />
      </div>

      {saveMsg && (
        <p
          className="text-xs"
          style={{ color: saveMsg === 'Saved' ? 'var(--color-success)' : 'var(--color-error)' }}
        >
          {saveMsg}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--ap-fg-0)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function TeamDetailDialog({ team, onClose, onUpdated }: TeamDetailDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('members');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'members', label: 'Members' },
    { id: 'shared-flows', label: 'Shared Flows' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-shadow) 50%, transparent)' }}
    >
      <div
        className="w-full max-w-2xl rounded-lg shadow-xl flex flex-col"
        style={{
          backgroundColor: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          maxHeight: '85vh',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {team.display_name}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {team.name}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded"
            style={{ color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex border-b px-6"
          style={{ borderColor: 'var(--color-border)' }}
          role="tablist"
        >
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-4 py-2 text-sm font-medium -mb-px transition-colors"
              style={{
                color: activeTab === tab.id ? 'var(--color-primary)' : 'var(--text-secondary)',
                borderBottom: activeTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === 'members' && <MembersTab teamId={team.id} />}
          {activeTab === 'shared-flows' && <SharedFlowsTab teamId={team.id} />}
          {activeTab === 'settings' && <SettingsTab team={team} onUpdated={onUpdated} />}
        </div>
      </div>
    </div>
  );
}

export default TeamDetailDialog;
