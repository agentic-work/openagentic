/**
 * RunsContent — the user's recent workflow executions (Flows-scoped — replaces
 * the SEV-1 admin/observability leak from the F.5 backlog).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import {
  tableHeaderClass, tableHeaderStyle, tableCellClass, tableCellStyle,
  type Execution,
} from '../sectionShared';

export const RunsContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true);
      // Re-use the WorkflowApiService endpoint; mirrors FlowsSidebar's
      // own getUserExecutions() call so we stay on the user-scoped read
      // path (NOT /admin/observability — that's what was leaking).
      const res = await fetch(workflowEndpoint('/workflows/executions/mine?limit=50'), {
        method: 'GET',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setExecutions(data.executions || []);
    } catch {
      // ignore — Flows-scoped surface; never falls back to admin
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchExecutions(); }, [fetchExecutions]);

  const statusColor = (status: string) => {
    if (status === 'completed') return 'var(--color-success)';
    if (status === 'failed') return 'var(--color-error)';
    if (status === 'running') return 'var(--color-warning)';
    return 'var(--color-fg-muted)';
  };

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>My Runs</h2>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Recent workflow executions you've launched. Workspace-scoped — admin observability lives in the admin portal.
          </p>
        </div>
        <button
          onClick={fetchExecutions}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors hover:bg-[var(--color-surface)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>
      {loading && (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</div>
      )}
      {!loading && executions.length === 0 && (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          No runs yet. Open a workflow and click Run.
        </div>
      )}
      {!loading && executions.length > 0 && (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-secondary, var(--color-bg-primary))' }}>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Workflow</th>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Status</th>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Started</th>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((ex: Execution) => (
                <tr key={ex.id}>
                  <td className={tableCellClass} style={tableCellStyle}>
                    {ex.workflow?.name || ex.workflow_name || ex.workflow_id || 'Workflow'}
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full"
                      style={{
                        backgroundColor: `${statusColor(ex.status)}22`,
                        color: statusColor(ex.status),
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor(ex.status) }} />
                      {ex.status || 'unknown'}
                    </span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    {timeAgo(ex.created_at || ex.started_at)}
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    {ex.duration_ms ? `${(ex.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
