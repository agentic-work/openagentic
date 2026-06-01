/**
 * AdminWorkflowsView - Admin console view for managing all workflows across users
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/utils/api';
import { SoTBanner, PageHeader } from '../../primitives-v2';
import {
  Search,
  Trash2,
  Eye,
  Filter,
  Globe,
  Lock,
  Users,
  Activity,
  Clock,
} from '@/shared/icons';
import { format } from 'date-fns';

interface AdminWorkflow {
  id: string;
  name: string;
  description: string;
  user_id: string;
  user: { id: string; email: string; name: string } | null;
  nodeCount: number;
  visibility: 'private' | 'team' | 'public';
  status: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  created_at: string;
  updated_at: string;
}

interface WorkflowStats {
  totalWorkflows: number;
  activeWorkflows: number;
  publicWorkflows: number;
  totalExecutions: number;
  runningExecutions: number;
  failedExecutions: number;
}

interface AdminWorkflowsViewProps {
  theme?: string;
}

export const AdminWorkflowsView: React.FC<AdminWorkflowsViewProps> = ({ theme }) => {
  const [workflows, setWorkflows] = useState<AdminWorkflow[]>([]);
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<string>('all');
  const [total, setTotal] = useState(0);
  const fetchWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (visibilityFilter !== 'all') params.set('visibility', visibilityFilter);
      params.set('limit', '50');

      const res = await apiRequest(`/api/admin/workflows?${params}`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setLoading(false);
    }
  }, [search, visibilityFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiRequest('/api/admin/workflows/stats');
      if (res.ok) {
        setStats(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete workflow "${name}"?`)) return;
    try {
      const res = await apiRequest(`/api/admin/workflows/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchWorkflows();
        fetchStats();
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleVisibilityChange = async (id: string, visibility: string) => {
    try {
      await apiRequest(`/api/admin/workflows/${id}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      });
      fetchWorkflows();
    } catch (err) {
      console.error('Failed to change visibility:', err);
    }
  };

  const visibilityIcon = (v: string) => {
    if (v === 'public') return <Globe className="w-3.5 h-3.5 text-ok" />;
    if (v === 'team') return <Users className="w-3.5 h-3.5 text-info" />;
    return <Lock className="w-3.5 h-3.5 text-text-tertiary" />;
  };

  const visibilityBadge = (v: string) => {
    const colors = { public: 'bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)] text-ok', team: 'bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)] text-info', private: 'bg-[color-mix(in_srgb,var(--color-fg-subtle)_10%,transparent)] text-text-tertiary' };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${(colors as any)[v] || colors.private}`}>
        {visibilityIcon(v)} {v}
      </span>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        crumbs={['Admin', 'Flows', 'All Workflows']}
        title="Workflows"
        explainer="Manage all workflows across users — search, filter, and inspect ownership, visibility, and execution metrics."
      />

      {/* Mission Control · SoT enforcement banner */}
      <SoTBanner context="Workflow nodes that pick a model use the registry; pinning a non-registry model in a node fails build-time AND surfaces a 503 with retry-from-fallback at runtime." />

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Workflows', value: stats.totalWorkflows, color: 'var(--color-primary)' },
            { label: 'Active', value: stats.activeWorkflows, color: 'var(--color-success)' },
            { label: 'Total Executions', value: stats.totalExecutions, color: 'var(--color-warning)' },
            { label: 'Failed', value: stats.failedExecutions, color: 'var(--color-error)' },
          ].map(card => (
            <div
              key={card.label}
              className="rounded-lg border p-4"
              style={{ background: 'var(--wf-node-bg)', borderColor: 'var(--wf-node-border)' }}
            >
              <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border text-sm"
            style={{ background: 'var(--wf-node-bg)', borderColor: 'var(--wf-node-border)', color: 'var(--color-text)' }}
          />
        </div>
        <select
          value={visibilityFilter}
          onChange={e => setVisibilityFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm"
          style={{ background: 'var(--wf-node-bg)', borderColor: 'var(--wf-node-border)', color: 'var(--color-text)' }}
        >
          <option value="all">All Visibility</option>
          <option value="private">Private</option>
          <option value="team">Team</option>
          <option value="public">Public</option>
        </select>
        <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{total} total</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--wf-node-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'color-mix(in srgb, var(--color-shadow) 3%, transparent)', borderBottom: '1px solid var(--wf-node-border)' }}>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Name</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Owner</th>
              <th className="text-center px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Visibility</th>
              <th className="text-center px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Nodes</th>
              <th className="text-center px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Runs</th>
              <th className="text-right px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Updated</th>
              <th className="text-right px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
            )}
            {!loading && workflows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No workflows found</td></tr>
            )}
            {!loading && workflows.map(wf => (
              <tr
                key={wf.id}
                className="transition-colors"
                style={{ borderBottom: '1px solid var(--wf-node-border)' }}
              >
                <td className="px-4 py-3">
                  <div className="font-medium" style={{ color: 'var(--color-text)' }}>{wf.name}</div>
                  {wf.description && (
                    <div className="text-xs truncate max-w-[200px]" style={{ color: 'var(--color-text-tertiary)' }}>{wf.description}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {wf.user?.email || wf.user_id?.substring(0, 8)}
                </td>
                <td className="px-4 py-3 text-center">{visibilityBadge(wf.visibility)}</td>
                <td className="px-4 py-3 text-center" style={{ color: 'var(--color-text-secondary)' }}>{wf.nodeCount}</td>
                <td className="px-4 py-3 text-center">
                  <span style={{ color: wf.failedExecutions > 0 ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                    {wf.totalExecutions}
                    {wf.failedExecutions > 0 && <span className="text-xs"> ({wf.failedExecutions} failed)</span>}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {wf.updated_at ? format(new Date(wf.updated_at), 'MMM d, HH:mm') : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => window.open(`/workflows/${wf.id}`, '_blank')}
                      className="p-1.5 rounded transition-colors hover:bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]"
                      title="View in Canvas"
                    >
                      <Eye className="w-3.5 h-3.5 text-info" />
                    </button>
                    <select
                      value={wf.visibility}
                      onChange={e => handleVisibilityChange(wf.id, e.target.value)}
                      className="text-xs px-1 py-0.5 rounded border"
                      style={{ background: 'var(--wf-node-bg)', borderColor: 'var(--wf-node-border)', color: 'var(--color-text)' }}
                    >
                      <option value="private">Private</option>
                      <option value="team">Team</option>
                      <option value="public">Public</option>
                    </select>
                    <button
                      onClick={() => handleDelete(wf.id, wf.name)}
                      className="p-1.5 rounded transition-colors hover:bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)]"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-err" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
