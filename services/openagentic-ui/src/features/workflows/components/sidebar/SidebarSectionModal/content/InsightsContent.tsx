/**
 * InsightsContent — per-user run stats (Flows-scoped — replaces the leak to
 * the admin observability dashboard for non-admin users).
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import type { Execution } from '../sectionShared';

export const InsightsContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(workflowEndpoint('/workflows/executions/mine?limit=200'), {
          method: 'GET',
          headers: getAuthHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        setExecutions(data.executions || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [getAuthHeaders]);

  const stats = useMemo(() => {
    const total = executions.length;
    const succeeded = executions.filter(e => e.status === 'completed').length;
    const failed = executions.filter(e => e.status === 'failed').length;
    const running = executions.filter(e => e.status === 'running').length;
    const rate = total > 0 ? Math.round((succeeded / total) * 100) : 0;
    const byWorkflow: Record<string, number> = {};
    for (const e of executions) {
      const name = e.workflow?.name || e.workflow_name || e.workflow_id || 'unknown';
      byWorkflow[name] = (byWorkflow[name] || 0) + 1;
    }
    const topWorkflows = Object.entries(byWorkflow)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return { total, succeeded, failed, running, rate, topWorkflows };
  }, [executions]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Insights</h2>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Stats across your last 200 runs. Workspace-scoped — for cross-tenant observability, ask your admin.
        </p>
      </div>
      {loading && (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</div>
      )}
      {!loading && (
        <>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Runs', value: stats.total, color: 'var(--color-text)' },
              { label: 'Succeeded', value: stats.succeeded, color: 'var(--color-success)' },
              { label: 'Failed', value: stats.failed, color: 'var(--color-error)' },
              { label: 'Success Rate', value: `${stats.rate}%`, color: 'var(--color-text)' },
            ].map(card => (
              <div
                key={card.label}
                className="glass-card p-3"
              >
                <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                  {card.label}
                </div>
                <div className="text-xl font-semibold mt-1" style={{ color: card.color }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>Top workflows</div>
            {stats.topWorkflows.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No runs yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {stats.topWorkflows.map(([name, count]) => (
                  <li key={name} className="flex items-center justify-between text-sm" style={{ color: 'var(--color-text)' }}>
                    <span className="truncate">{name}</span>
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{count} runs</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};
