/**
 * AdminExecutionsView - Admin console view for all workflow executions across users
 * Enhanced with per-node drill-down, filters, cost metrics, and search
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiRequest } from '@/utils/api';
import {
  Search,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Download,
} from '@/shared/icons';
import { format } from 'date-fns';
import { PageHeader } from '../../primitives-v2';

interface NodeOutput {
  status: string;
  output?: any;
  input?: any;
  error?: string;
  duration?: number;
  nodeType?: string;
}

interface Execution {
  id: string;
  workflowId: string;
  workflowName: string;
  user: { id: string; email: string; name: string } | null;
  status: string;
  triggerType: string;
  totalNodes: number;
  completedNodes: number;
  executionTimeMs: number | null;
  cost: number | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  nodeOutputs?: Record<string, NodeOutput>;
}

interface AdminExecutionsViewProps {
  theme?: string;
}

export const AdminExecutionsView: React.FC<AdminExecutionsViewProps> = ({ theme }) => {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [nodeDetail, setNodeDetail] = useState<Record<string, Record<string, NodeOutput>>>({});

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('limit', '50');
      params.set('include_node_outputs', 'true');

      const res = await apiRequest(`/api/admin/workflows/executions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setExecutions(data.executions || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch executions:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchExecutions(); }, [fetchExecutions]);

  // Fetch node outputs for expanded execution
  const fetchNodeOutputs = useCallback(async (execId: string, workflowId: string) => {
    if (nodeDetail[execId]) return; // already loaded
    try {
      const res = await apiRequest(`/api/workflows/${workflowId}/executions/${execId}`);
      if (res.ok) {
        const data = await res.json();
        const outputs = data.execution?.node_outputs || data.node_outputs || data.nodeSummary || {};
        setNodeDetail(prev => ({ ...prev, [execId]: outputs }));
      }
    } catch {
      // silently handle
    }
  }, [nodeDetail]);

  // Filtered executions
  const filteredExecutions = useMemo(() => {
    if (!searchQuery) return executions;
    const q = searchQuery.toLowerCase();
    return executions.filter(e =>
      e.workflowName?.toLowerCase().includes(q) ||
      e.user?.email?.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      e.workflowId.toLowerCase().includes(q)
    );
  }, [executions, searchQuery]);

  // Aggregate metrics
  const metrics = useMemo(() => {
    const completed = executions.filter(e => e.status === 'completed' || e.status === 'completed_with_errors');
    const failed = executions.filter(e => e.status === 'failed');
    const totalCost = executions.reduce((sum, e) => sum + (e.cost || 0), 0);
    const avgDuration = completed.length > 0
      ? completed.reduce((sum, e) => sum + (e.executionTimeMs || 0), 0) / completed.length
      : 0;
    return {
      total: executions.length,
      completed: completed.length,
      failed: failed.length,
      running: executions.filter(e => e.status === 'running').length,
      totalCost,
      avgDuration,
    };
  }, [executions]);

  const statusBadge = (status: string) => {
    const config: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
      completed: { color: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 15%, transparent)', icon: <CheckCircle className="w-3 h-3" /> },
      completed_with_errors: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 15%, transparent)', icon: <AlertCircle className="w-3 h-3" /> },
      running: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 15%, transparent)', icon: <Activity className="w-3 h-3" /> },
      failed: { color: 'var(--color-error)', bg: 'color-mix(in srgb, var(--color-error) 15%, transparent)', icon: <XCircle className="w-3 h-3" /> },
      pending: { color: 'var(--color-text-tertiary)', bg: 'color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)', icon: <Clock className="w-3 h-3" /> },
    };
    const c = config[status] || config.pending;
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold uppercase"
        style={{ color: c.color, backgroundColor: c.bg }}
      >
        {c.icon} {status.replace(/_/g, ' ')}
      </span>
    );
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
  };

  const toggleNodeExpand = (key: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleExport = () => {
    const data = JSON.stringify(filteredExecutions, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-executions-${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        crumbs={['Admin', 'Flows', 'Executions']}
        title="Workflow Executions"
        explainer="Inspect all workflow executions across users with filters, per-node drill-down, and cost metrics."
        actions={[
          { label: 'Export', onClick: handleExport },
        ]}
      />

      {/* Metrics cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: metrics.total, color: 'var(--color-text)' },
          { label: 'Completed', value: metrics.completed, color: 'var(--color-success)' },
          { label: 'Failed', value: metrics.failed, color: 'var(--color-error)' },
          { label: 'Avg Duration', value: formatDuration(Math.round(metrics.avgDuration)), color: 'var(--color-primary)' },
          { label: 'Total Cost', value: `$${metrics.totalCost.toFixed(4)}`, color: 'var(--color-accent)' },
        ].map(m => (
          <div
            key={m.label}
            className="p-3 rounded-lg border"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
              {m.label}
            </div>
            <div className="text-lg font-bold mt-0.5" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search workflows, users, IDs..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="all">All Status</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="completed_with_errors">Completed w/ Errors</option>
        </select>
        <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          {filteredExecutions.length}{filteredExecutions.length !== total ? ` of ${total}` : ''} executions
        </span>
        <div className="flex-1" />
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          title="Export as JSON"
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
        <button
          onClick={fetchExecutions}
          className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <RotateCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Workflow</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>User</th>
              <th className="text-center px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Status</th>
              <th className="text-center px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Nodes</th>
              <th className="text-right px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Duration</th>
              <th className="text-right px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Cost</th>
              <th className="text-right px-4 py-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Started</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
            )}
            {!loading && filteredExecutions.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No executions found</td></tr>
            )}
            {!loading && filteredExecutions.map(exec => (
              <React.Fragment key={exec.id}>
                <tr
                  className="transition-colors cursor-pointer hover:bg-[var(--color-surface)]"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                  onClick={() => {
                    const newId = expandedId === exec.id ? null : exec.id;
                    setExpandedId(newId);
                    if (newId) fetchNodeOutputs(newId, exec.workflowId);
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {expandedId === exec.id
                        ? <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                        : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                      }
                      <div>
                        <div className="font-medium" style={{ color: 'var(--color-text)' }}>{exec.workflowName}</div>
                        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                          {exec.triggerType} &middot; {exec.id.substring(0, 8)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {exec.user?.email || '-'}
                  </td>
                  <td className="px-4 py-3 text-center">{statusBadge(exec.status)}</td>
                  <td className="px-4 py-3 text-center" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="font-mono">{exec.completedNodes}/{exec.totalNodes}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatDuration(exec.executionTimeMs)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono" style={{ color: exec.cost ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}>
                    {exec.cost !== null && exec.cost > 0 ? `$${exec.cost.toFixed(4)}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {exec.startedAt ? format(new Date(exec.startedAt), 'MMM d, HH:mm:ss') : '-'}
                  </td>
                </tr>

                {/* Expanded detail row with per-node drill-down */}
                {expandedId === exec.id && (
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td colSpan={7} className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                      <div className="space-y-3">
                        {/* Execution metadata */}
                        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          <span><strong>Execution ID:</strong> <code className="font-mono">{exec.id}</code></span>
                          <span><strong>Workflow:</strong> <code className="font-mono">{exec.workflowId}</code></span>
                          {exec.completedAt && <span><strong>Completed:</strong> {format(new Date(exec.completedAt), 'MMM d, HH:mm:ss')}</span>}
                        </div>

                        {/* Error banner */}
                        {exec.error && (
                          <div className="p-2 rounded-lg text-xs" style={{ background: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)', border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)' }}>
                            <strong>Error:</strong> {exec.error}
                          </div>
                        )}

                        {/* Per-node outputs */}
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                            Node Outputs
                          </div>
                          {(() => {
                            const outputs = nodeDetail[exec.id] || exec.nodeOutputs || {};
                            if (Object.keys(outputs).length === 0) {
                              return <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Loading node outputs...</div>;
                            }
                            return (
                              <div className="space-y-1">
                                {Object.entries(outputs).map(([nodeId, nodeOut]: [string, any]) => {
                                  const isExpanded = expandedNodes.has(`${exec.id}-${nodeId}`);
                                  const nodeStatus = nodeOut.status || 'unknown';
                                  const statusColor = nodeStatus === 'completed' ? 'var(--color-success)'
                                    : nodeStatus === 'failed' ? 'var(--color-error)'
                                    : nodeStatus === 'running' ? 'var(--color-warning)' : 'var(--color-text-tertiary)';

                                  return (
                                    <div key={nodeId} className="rounded border" style={{ borderColor: 'var(--color-border)' }}>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleNodeExpand(`${exec.id}-${nodeId}`); }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--color-bg-primary)] transition-colors"
                                      >
                                        {isExpanded
                                          ? <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                                          : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                                        }
                                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor }} />
                                        <span className="font-medium flex-1" style={{ color: 'var(--color-text)' }}>
                                          {nodeId}
                                        </span>
                                        {nodeOut.nodeType && (
                                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)' }}>
                                            {nodeOut.nodeType}
                                          </span>
                                        )}
                                        {nodeOut.duration && (
                                          <span className="font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                                            {formatDuration(nodeOut.duration)}
                                          </span>
                                        )}
                                      </button>
                                      {isExpanded && (
                                        <div className="px-3 pb-3 pt-1 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
                                          {nodeOut.error && (
                                            <div className="text-xs p-2 rounded" style={{ background: 'color-mix(in srgb, var(--color-error) 5%, transparent)', color: 'var(--color-error)' }}>
                                              <strong>Error:</strong> {nodeOut.error}
                                            </div>
                                          )}
                                          {nodeOut.input && (
                                            <div>
                                              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Input</div>
                                              <pre className="text-xs font-mono p-2 rounded overflow-auto max-h-40" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)' }}>
                                                {typeof nodeOut.input === 'string' ? nodeOut.input : JSON.stringify(nodeOut.input, null, 2)}
                                              </pre>
                                            </div>
                                          )}
                                          {nodeOut.output !== undefined && nodeOut.output !== null && (
                                            <div>
                                              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Output</div>
                                              <pre className="text-xs font-mono p-2 rounded overflow-auto max-h-60" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)' }}>
                                                {typeof nodeOut.output === 'string' ? nodeOut.output : JSON.stringify(nodeOut.output, null, 2)}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
