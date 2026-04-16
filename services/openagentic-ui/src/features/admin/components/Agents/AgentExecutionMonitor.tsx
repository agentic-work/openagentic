/**
 * AgentExecutionMonitor - Live monitoring of agent executions
 * Shows running/completed executions with cost breakdown and error analysis.
 * Features:
 *   - Token count columns (↑input ↓output)
 *   - Tree replay view (click row → full AgentExecutionTree in read-only modal)
 *   - Audit export (CSV / JSON) with optional date-range filter
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Search, X, XCircle, Download, ChevronRight } from '@/shared/icons';
import { AgentExecutionTree } from '@/features/chat/components/AgentExecutionTree';
import type { AgentNodeDisplay, ToolCallDisplay } from '@/features/chat/components/AgentExecutionTree';
import { useAgentTreeStore } from '@/stores/useAgentTreeStore';

interface AgentExecution {
  id: string;
  orchestration: string;
  aggregation: string;
  status: string;
  agent_specs: any[];
  results: any[];
  total_cost_cents: number;
  total_tokens: number;
  input_tokens?: number;
  output_tokens?: number;
  started_at: string;
  completed_at: string | null;
  user_id: string;
  session_id: string;
}

interface AgentAuditEvent {
  id: string;
  executionId: string;
  sessionId: string;
  userId: string;
  agentId: string;
  agentRole: string;
  eventType: string;
  eventPayload: any;
  parentAgentId?: string;
  modelId?: string;
  source: string;
  riskLevel?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
  createdAt: string;
}

interface AgentExecutionMonitorProps {
  theme: string;
}

// ─── Helper: replay audit events into AgentExecutionTree props ──────────────

function replayEventsToTreeProps(
  executionId: string,
  events: AgentAuditEvent[]
): React.ComponentProps<typeof AgentExecutionTree> {
  const agentMap: Record<string, AgentNodeDisplay> = {};
  let strategy = 'unknown';
  let overallStatus: 'running' | 'completed' | 'error' = 'completed';
  let totalDurationMs: number | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalToolCalls = 0;

  for (const ev of events) {
    const p = ev.eventPayload || {};

    if (ev.eventType === 'spawn_plan') {
      strategy = p.strategy || strategy;
      for (const a of p.agents || []) {
        agentMap[a.id] = {
          agentId: a.id,
          role: a.role || 'agent',
          status: 'running',
          toolCalls: [],
        };
      }
    } else if (ev.eventType === 'agent_start') {
      const aid = ev.agentId;
      agentMap[aid] = {
        ...agentMap[aid],
        agentId: aid,
        role: ev.agentRole || p.role || 'agent',
        status: 'running',
        toolCalls: agentMap[aid]?.toolCalls || [],
      };
    } else if (ev.eventType === 'agent_complete') {
      const aid = ev.agentId;
      const node = agentMap[aid] || {
        agentId: aid,
        role: ev.agentRole || 'agent',
        toolCalls: [],
      };
      agentMap[aid] = {
        ...node,
        status: (p.status === 'error' ? 'error' : 'completed') as 'completed' | 'error',
        durationMs: ev.durationMs ?? p.durationMs,
        inputTokens: ev.inputTokens ?? p.inputTokens,
        outputTokens: ev.outputTokens ?? p.outputTokens,
      };
    } else if (ev.eventType === 'agent_thinking') {
      const aid = ev.agentId;
      const node = agentMap[aid];
      if (node) {
        const thinkTool: ToolCallDisplay = {
          toolName: 'thinking',
          isThinking: true,
          status: 'completed',
          durationMs: ev.durationMs ?? p.durationMs,
          thinkingTokens: p.tokens,
        };
        agentMap[aid] = {
          ...node,
          toolCalls: [...(node.toolCalls || []), thinkTool],
        };
      }
    } else if (ev.eventType === 'tool_call') {
      const aid = ev.agentId;
      const node = agentMap[aid] || {
        agentId: aid,
        role: ev.agentRole || 'agent',
        status: 'running' as const,
        toolCalls: [],
      };
      const tool: ToolCallDisplay = {
        toolName: p.toolName || 'unknown',
        input: p.args,
        status: 'running',
      };
      agentMap[aid] = {
        ...node,
        toolCalls: [...(node.toolCalls || []), tool],
      };
    } else if (ev.eventType === 'tool_result') {
      const aid = ev.agentId;
      const node = agentMap[aid];
      if (node) {
        const toolCallId = p.toolCallId;
        const updatedTools = (node.toolCalls || []).map((tc: ToolCallDisplay, idx: number) => {
          // Match last tool with same toolCallId or by index fallback
          if (toolCallId && tc.toolName === p.toolName) {
            return {
              ...tc,
              status: (p.status === 'error' ? 'error' : 'completed') as ToolCallDisplay['status'],
              durationMs: ev.durationMs ?? p.durationMs,
            };
          }
          return tc;
        });
        agentMap[aid] = { ...node, toolCalls: updatedTools };
        totalToolCalls++;
      }
    } else if (ev.eventType === 'execution_complete') {
      overallStatus = p.status === 'error' ? 'error' : 'completed';
      totalDurationMs = ev.durationMs ?? p.totalDurationMs;
      if (p.totalInputTokens) totalInputTokens = p.totalInputTokens;
      if (p.totalOutputTokens) totalOutputTokens = p.totalOutputTokens;
      if (p.totalToolCalls) totalToolCalls = p.totalToolCalls;
    }
  }

  // Compute token totals from agent nodes if not in completion event
  if (!totalInputTokens || !totalOutputTokens) {
    for (const node of Object.values(agentMap)) {
      totalInputTokens += node.inputTokens || 0;
      totalOutputTokens += node.outputTokens || 0;
    }
  }

  return {
    executionId,
    strategy,
    status: overallStatus,
    agents: agentMap,
    totalDurationMs,
    totalInputTokens,
    totalOutputTokens,
    totalToolCalls,
    theme: 'dark',
  };
}

export const AgentExecutionMonitor: React.FC<AgentExecutionMonitorProps> = ({ theme }) => {
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedExecution, setSelectedExecution] = useState<AgentExecution | null>(null);

  // Tree replay state
  const [replayExecution, setReplayExecution] = useState<AgentExecution | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayProps, setReplayProps] = useState<React.ComponentProps<typeof AgentExecutionTree> | null>(null);

  // Export state
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const response = await fetch(`/api/admin/agents/executions?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to fetch executions: ${response.statusText}`);
      const data = await response.json();
      setExecutions(data.executions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchExecutions(); }, [fetchExecutions]);

  // Auto-refresh every 10 seconds for live monitoring
  useEffect(() => {
    const interval = setInterval(fetchExecutions, 10000);
    return () => clearInterval(interval);
  }, [fetchExecutions]);

  const handleCancel = async (id: string) => {
    try {
      await fetch(`/api/admin/agents/executions/${id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      fetchExecutions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Open tree replay for a given execution
  const handleOpenReplay = async (exec: AgentExecution) => {
    setReplayExecution(exec);
    setReplayLoading(true);
    setReplayError(null);
    setReplayProps(null);
    try {
      const res = await fetch(`/api/admin/agents/executions/${exec.id}/events`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to fetch events: ${res.statusText}`);
      const data = await res.json();
      const events: AgentAuditEvent[] = data.events || [];
      const props = replayEventsToTreeProps(exec.id, events);
      setReplayProps(props);
    } catch (err: any) {
      setReplayError(err.message);
    } finally {
      setReplayLoading(false);
    }
  };

  // Export handler
  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format });
      if (exportStartDate) params.set('startDate', exportStartDate);
      if (exportEndDate)   params.set('endDate', exportEndDate);
      const res = await fetch(`/api/admin/agents/audit/export?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent_audit_${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const statusColor = (status: string): string => {
    const colors: Record<string, string> = {
      running: 'bg-blue-500/20 text-blue-300 animate-pulse',
      completed: 'bg-green-500/20 text-green-300',
      failed: 'bg-red-500/20 text-red-300',
      cancelled: 'bg-zinc-500/20 text-zinc-300',
      pending: 'bg-yellow-500/20 text-yellow-300',
    };
    return colors[status] || 'bg-zinc-500/20 text-zinc-300';
  };

  const filteredExecutions = executions.filter(e =>
    e.id.includes(searchQuery) ||
    e.user_id.includes(searchQuery) ||
    e.orchestration.includes(searchQuery)
  );

  const totalCost = executions.reduce((acc, e) => acc + (Number(e.total_cost_cents) || 0), 0);
  const totalTokens = executions.reduce((acc, e) => acc + (Number(e.total_tokens) || 0), 0);
  const runningCount = executions.filter(e => e.status === 'running').length;

  if (loading && executions.length === 0) {
    return <div className="flex items-center justify-center h-full text-text-secondary">Loading executions...</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Agent Execution Monitor</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            {executions.length} executions | {runningCount} running | ${((totalCost || 0) / 100).toFixed(2)} total cost | {(totalTokens || 0).toLocaleString()} tokens
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-bg-surface border border-border-default rounded-lg text-xs text-text-primary"
          >
            <option value="all">All Statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Export toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface border-b border-border-default">
        <span className="text-xs text-text-tertiary font-medium">Export:</span>
        <input
          type="date"
          value={exportStartDate}
          onChange={e => setExportStartDate(e.target.value)}
          className="px-2 py-1 bg-bg-primary border border-border-default rounded text-xs text-text-primary"
          title="Start date"
        />
        <span className="text-xs text-text-tertiary">→</span>
        <input
          type="date"
          value={exportEndDate}
          onChange={e => setExportEndDate(e.target.value)}
          className="px-2 py-1 bg-bg-primary border border-border-default rounded text-xs text-text-primary"
          title="End date"
        />
        <button
          onClick={() => handleExport('csv')}
          disabled={exporting}
          className="flex items-center gap-1 px-3 py-1 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/30 rounded text-xs disabled:opacity-50"
        >
          <Download size={12} />
          CSV
        </button>
        <button
          onClick={() => handleExport('json')}
          disabled={exporting}
          className="flex items-center gap-1 px-3 py-1 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/30 rounded text-xs disabled:opacity-50"
        >
          <Download size={12} />
          JSON
        </button>
        {exporting && <span className="text-xs text-text-tertiary">Exporting…</span>}
      </div>

      {error && (
        <div className="mx-4 mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-100">dismiss</button>
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search by ID, user, or orchestration..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-bg-surface border border-border-default rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </div>
      </div>

      {/* Executions table */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Column headers */}
        {filteredExecutions.length > 0 && (
          <div className="flex items-center gap-2 px-3 mb-1 text-xs text-text-tertiary uppercase tracking-wide">
            <span className="w-16">Status</span>
            <span className="flex-1">ID / Orchestration</span>
            <span className="w-16 text-right">↑ Input</span>
            <span className="w-16 text-right">↓ Output</span>
            <span className="w-14 text-right">Cost</span>
            <span className="w-16 text-right">Time</span>
            <span className="w-16 text-right">Actions</span>
          </div>
        )}

        <div className="space-y-1.5 mt-1">
          {filteredExecutions.map(exec => {
            const inputTok = exec.input_tokens ?? 0;
            const outputTok = exec.output_tokens ?? 0;
            const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

            return (
              <div
                key={exec.id}
                className="bg-bg-surface border border-border-default rounded-lg px-3 py-2 cursor-pointer hover:border-accent-primary/30 transition-colors"
                onClick={() => setSelectedExecution(exec)}
              >
                <div className="flex items-center gap-2">
                  {/* Status badge */}
                  <span className={`shrink-0 w-16 px-1.5 py-0.5 text-xs rounded-full text-center ${statusColor(exec.status)}`}>
                    {exec.status}
                  </span>

                  {/* ID + orchestration */}
                  <div className="flex-1 flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-mono text-text-primary truncate">{exec.id.slice(0, 8)}…</span>
                    <span className="px-1.5 py-0.5 text-xs bg-zinc-700/50 text-zinc-300 rounded-full shrink-0">
                      {exec.orchestration}
                    </span>
                    <span className="text-xs text-text-tertiary shrink-0">
                      {exec.agent_specs?.length || 0} agents
                    </span>
                  </div>

                  {/* Token counts */}
                  <span className="w-16 text-right text-xs text-text-tertiary font-mono">
                    {inputTok > 0 ? `↑${fmt(inputTok)}` : '—'}
                  </span>
                  <span className="w-16 text-right text-xs text-text-tertiary font-mono">
                    {outputTok > 0 ? `↓${fmt(outputTok)}` : '—'}
                  </span>

                  {/* Cost */}
                  <span className="w-14 text-right text-xs text-text-tertiary">
                    ${((Number(exec.total_cost_cents) || 0) / 100).toFixed(3)}
                  </span>

                  {/* Time */}
                  <span className="w-16 text-right text-xs text-text-tertiary">
                    {new Date(exec.started_at).toLocaleTimeString()}
                  </span>

                  {/* Actions */}
                  <div className="w-16 flex items-center justify-end gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); handleOpenReplay(exec); }}
                      className="p-1 text-text-tertiary hover:text-accent-primary rounded"
                      title="View execution tree"
                    >
                      <ChevronRight size={13} />
                    </button>
                    {exec.status === 'running' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleCancel(exec.id); }}
                        className="p-1 text-red-400 hover:text-red-300 rounded"
                        title="Cancel execution"
                      >
                        <XCircle size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredExecutions.length === 0 && (
          <div className="text-center text-text-secondary text-sm mt-8">
            No executions found. Agent executions will appear here when agents are run.
          </div>
        )}
      </div>

      {/* Detail Drawer (metadata) */}
      {selectedExecution && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-primary border border-border-default rounded-xl w-[700px] max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Execution Details</h3>
                <span className="text-xs font-mono text-text-secondary">{selectedExecution.id}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSelectedExecution(null); handleOpenReplay(selectedExecution); }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/30 rounded-lg text-xs"
                >
                  <ChevronRight size={12} />
                  View Tree Replay
                </button>
                <button onClick={() => setSelectedExecution(null)} className="text-text-tertiary hover:text-text-primary">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-bg-surface rounded-lg p-3">
                <div className="text-xs text-text-tertiary uppercase">Status</div>
                <div className={`inline-block px-2 py-0.5 text-xs rounded-full mt-1 ${statusColor(selectedExecution.status)}`}>
                  {selectedExecution.status}
                </div>
              </div>
              <div className="bg-bg-surface rounded-lg p-3">
                <div className="text-xs text-text-tertiary uppercase">Orchestration</div>
                <div className="text-sm text-text-primary mt-1">{selectedExecution.orchestration}</div>
              </div>
              <div className="bg-bg-surface rounded-lg p-3">
                <div className="text-xs text-text-tertiary uppercase">Cost</div>
                <div className="text-sm text-text-primary mt-1">${((Number(selectedExecution.total_cost_cents) || 0) / 100).toFixed(4)}</div>
              </div>
              <div className="bg-bg-surface rounded-lg p-3">
                <div className="text-xs text-text-tertiary uppercase">Tokens (↑ input / ↓ output)</div>
                <div className="text-sm text-text-primary mt-1 font-mono">
                  ↑{(selectedExecution.input_tokens || 0).toLocaleString()} / ↓{(selectedExecution.output_tokens || 0).toLocaleString()}
                  {(!selectedExecution.input_tokens && !selectedExecution.output_tokens && selectedExecution.total_tokens > 0) && (
                    <span className="text-text-secondary"> ({selectedExecution.total_tokens.toLocaleString()} total)</span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-xs font-medium text-text-secondary mb-2">Agent Specs</div>
            <pre className="p-3 bg-bg-surface border border-border-default rounded-lg text-xs text-text-primary overflow-auto max-h-48 whitespace-pre-wrap">
              {JSON.stringify(selectedExecution.agent_specs, null, 2)}
            </pre>

            {selectedExecution.results && (
              <>
                <div className="text-xs font-medium text-text-secondary mt-3 mb-2">Results</div>
                <pre className="p-3 bg-bg-surface border border-border-default rounded-lg text-xs text-text-primary overflow-auto max-h-48 whitespace-pre-wrap">
                  {JSON.stringify(selectedExecution.results, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tree Replay Modal */}
      {replayExecution && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-bg-primary border border-border-default rounded-xl w-[760px] max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border-default shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Execution Tree Replay</h3>
                <span className="text-xs font-mono text-text-secondary">{replayExecution.id}</span>
              </div>
              <button
                onClick={() => { setReplayExecution(null); setReplayProps(null); setReplayError(null); }}
                className="text-text-tertiary hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5">
              {replayLoading && (
                <div className="flex items-center justify-center py-12 text-text-secondary text-sm">
                  Loading execution events…
                </div>
              )}
              {replayError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  {replayError}
                </div>
              )}
              {replayProps && !replayLoading && (
                <AgentExecutionTree {...replayProps} />
              )}
              {replayProps && Object.keys(replayProps.agents).length === 0 && !replayLoading && (
                <div className="mt-4 p-3 bg-bg-surface border border-border-default rounded-lg text-xs text-text-secondary">
                  No agent event data found for this execution. Events may not have been recorded.
                </div>
              )}
            </div>

            {/* Summary footer */}
            {replayProps && (
              <div className="shrink-0 px-5 py-3 border-t border-border-default bg-bg-surface flex items-center gap-4 text-xs text-text-tertiary">
                <span>Strategy: <span className="text-text-secondary font-medium">{replayProps.strategy}</span></span>
                <span>↑ {(replayProps.totalInputTokens || 0).toLocaleString()} input tokens</span>
                <span>↓ {(replayProps.totalOutputTokens || 0).toLocaleString()} output tokens</span>
                <span>{replayProps.totalToolCalls} tool calls</span>
                {replayProps.totalDurationMs !== undefined && (
                  <span>{(replayProps.totalDurationMs / 1000).toFixed(1)}s total</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
