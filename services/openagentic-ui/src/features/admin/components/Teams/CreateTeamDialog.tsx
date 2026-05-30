/**
 * CreateTeamDialog — modal form for creating a new UserGroup (Team).
 *
 * Fields: name (required), display_name (required), description,
 *         parent_group_id (dropdown), cost_center, billing_contact_email.
 */

import React, { useState } from 'react';
import { createTeam } from '../../services/teamsAdminApi';
import type { Team, CreateTeamInput } from '../../services/teamsAdminApi';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CreateTeamDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (team: Team) => void;
  existingTeams: Team[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateTeamDialog({ open, onClose, onCreated, existingTeams }: CreateTeamDialogProps) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [parentGroupId, setParentGroupId] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !displayName.trim()) return;

    setSubmitting(true);
    setError(null);

    const input: CreateTeamInput = {
      name: name.trim(),
      display_name: displayName.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(parentGroupId ? { parent_group_id: parentGroupId } : {}),
      ...(costCenter.trim() ? { cost_center: costCenter.trim() } : {}),
      ...(billingEmail.trim() ? { billing_contact_email: billingEmail.trim() } : {}),
    };

    try {
      const res = await createTeam(input);
      // Reset form
      setName(''); setDisplayName(''); setDescription('');
      setParentGroupId(''); setCostCenter(''); setBillingEmail('');
      onCreated(res.team);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create team');
    } finally {
      setSubmitting(false);
    }
  };

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

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-lg shadow-xl"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Title */}
        <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Create Team
          </h3>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="team-name" style={labelStyle}>
              Name *
            </label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. engineering"
              style={inputStyle}
              required
              aria-label="Name"
            />
          </div>

          {/* Display Name */}
          <div>
            <label htmlFor="team-display-name" style={labelStyle}>
              Display Name *
            </label>
            <input
              id="team-display-name"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. Engineering"
              style={inputStyle}
              required
              aria-label="Display Name"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="team-description" style={labelStyle}>
              Description
            </label>
            <textarea
              id="team-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
              aria-label="Description"
            />
          </div>

          {/* Parent group */}
          {existingTeams.length > 0 && (
            <div>
              <label htmlFor="team-parent" style={labelStyle}>
                Parent Team
              </label>
              <select
                id="team-parent"
                value={parentGroupId}
                onChange={e => setParentGroupId(e.target.value)}
                style={inputStyle}
                aria-label="Parent Team"
              >
                <option value="">— None —</option>
                {existingTeams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Cost Center */}
          <div>
            <label htmlFor="team-cost-center" style={labelStyle}>
              Cost Center
            </label>
            <input
              id="team-cost-center"
              type="text"
              value={costCenter}
              onChange={e => setCostCenter(e.target.value)}
              placeholder="e.g. CC-100"
              style={inputStyle}
              aria-label="Cost Center"
            />
          </div>

          {/* Billing Email */}
          <div>
            <label htmlFor="team-billing-email" style={labelStyle}>
              Billing Contact Email
            </label>
            <input
              id="team-billing-email"
              type="email"
              value={billingEmail}
              onChange={e => setBillingEmail(e.target.value)}
              placeholder="billing@example.com"
              style={inputStyle}
              aria-label="Billing Contact Email"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs" style={{ color: 'var(--color-error)' }}>
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm"
              style={{ border: '1px solid var(--color-border)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !displayName.trim()}
              className="px-3 py-1.5 rounded text-sm font-medium"
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'var(--ap-fg-0)',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateTeamDialog;
