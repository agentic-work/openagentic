/**
 * DeployedContent — legacy list view for deployed workflows, kept for
 * backwards compatibility. The live "deployed" section renders
 * WorkflowCardGridView with filter="deployed"; this module is retained
 * unwired so no behavior changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Rocket, Trash2 } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { inputClass, inputStyle, type WorkflowSummary } from '../sectionShared';

export const DeployedContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchDeployed = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/workflows', { headers });
      if (res.ok) {
        const data = await res.json();
        const all = data.workflows || data || [];
        setWorkflows(all.filter((w: WorkflowSummary) => w.status === 'active'));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [getAuthHeaders]);

  useEffect(() => { fetchDeployed(); }, [fetchDeployed]);

  const handleUndeploy = async (id: string) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
      if (res.ok) {
        setWorkflows(prev => prev.filter(w => w.id !== id));
      }
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE', headers });
      if (res.ok) {
        setWorkflows(prev => prev.filter(w => w.id !== id));
      }
    } catch { /* ignore */ }
    setDeleting(null);
  };

  const filtered = searchTerm
    ? workflows.filter(w => w.name?.toLowerCase().includes(searchTerm.toLowerCase()))
    : workflows;

  if (loading) {
    return <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading deployed workflows...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Manage workflows that are currently deployed and active. Undeploy to move back to draft, or delete permanently.
      </p>

      {workflows.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search deployed workflows..."
            className={inputClass}
            style={{ ...inputStyle, paddingLeft: '2.25rem' }}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <Rocket className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {searchTerm ? 'No matching deployed workflows' : 'No deployed workflows yet'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }}>
            Deploy a workflow from the canvas to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(wf => (
            <div
              key={wf.id}
              className="glass-card glass-surface-hover flex items-center gap-3 p-3"
            >
              {/* Status dot */}
              <span className="relative flex-shrink-0">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--color-success)' }} />
                <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: 'var(--color-success)', opacity: 0.3, width: 10, height: 10 }} />
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {wf.name || 'Untitled Workflow'}
                </div>
                <div className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  <span>{wf.executionCount || 0} runs</span>
                  {wf.updatedAt && (
                    <>
                      <span>·</span>
                      <span>Updated {new Date(wf.updatedAt).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleUndeploy(wf.id)}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border transition-colors hover:bg-[var(--color-surface)]"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                  title="Move back to draft"
                >
                  Undeploy
                </button>
                <button
                  onClick={() => handleDelete(wf.id, wf.name)}
                  disabled={deleting === wf.id}
                  className="p-1.5 rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]"
                  style={{ color: 'var(--color-error)' }}
                  title="Delete permanently"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {workflows.length} deployed workflow{workflows.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};
