/**
 * AgentExecutionDashboard - Recharts graphs + searchable execution logs
 * Two sub-tabs: Graphs Dashboard (default) and Execution Logs.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { PageHeader, LogRow, type LogSeverity } from '../../primitives-v2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentExecutionDashboardProps {
  theme: string;
}

interface ExecutionStats {
  activeAgents: number;
  totalToday: number;
  totalWeek: number;
  successRate: number;
  failedToday: number;
  costTodayCents: number;
  tokensToday: number;
  avgLatencyMs?: number;
  promptTokensToday?: number;
  completionTokensToday?: number;
}

interface LiveExecution {
  id: string;
  agentId?: string;
  agentName?: string;
  role?: string;
  pattern?: string;
  status: string;
  startedAt: string;
  costCents?: number;
  toolCalls?: number;
  userId?: string;
}

interface HistoryExecution {
  id: string;
  agent_id?: string;
  agent_name?: string;
  user_id?: string;
  status: string;
  duration_ms?: number;
  cost_cents?: number;
  tool_calls_count?: number;
  tokens_used?: number;
  created_at: string;
  completed_at?: string;
  pattern?: string;
  model?: string;
  output?: string;
  error_message?: string;
}

interface CostReportDay {
  day: string;
  models: { model: string; cost: number; tokens: number; count: number }[];
  totalCost: number;
}

type SubTab = 'graphs' | 'logs';
type TimeRange = '24h' | '7d' | '30d';
type LogRange = '1h' | '24h' | '7d' | '30d';

const POLL_INTERVAL = 5000;
const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatCost = (cents?: number) => {
  if (!cents) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
};

const formatDurationMs = (ms?: number) => {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const statusColor = (status: string) => {
  switch (status) {
    case 'running': return 'var(--color-warning)';
    case 'completed': return 'var(--color-success)';
    case 'failed': return 'var(--color-error)';
    case 'killed': case 'cancelled': return 'var(--color-warning)';
    default: return 'var(--text-tertiary)';
  }
};

const statusBg = (status: string) => `color-mix(in srgb, ${statusColor(status)} 15%, transparent)`;

const statusToSeverity = (status: string): LogSeverity => {
  switch (status) {
    case 'completed': return 'ok';
    case 'failed': return 'err';
    case 'running': return 'warn';
    case 'killed':
    case 'cancelled': return 'warn';
    default: return 'info';
  }
};

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
  border: '1px solid var(--color-border, var(--color-border-default))',
  borderRadius: 8,
  padding: '12px 16px',
};

const chartCardStyle: React.CSSProperties = {
  ...cardStyle,
  padding: '16px',
};

const tableHeaderStyle: React.CSSProperties = {
  color: 'var(--color-text-tertiary)',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '6px 8px',
  textAlign: 'left',
};

const tableCellStyle: React.CSSProperties = {
  color: 'var(--color-text-primary)',
  fontSize: 12,
  padding: '8px',
  borderTop: '1px solid var(--color-border, var(--color-border-default))',
};

const CHART_GREEN = 'var(--color-success)';
const CHART_RED = 'var(--color-error)';
const CHART_BLUE = 'var(--color-primary)';
const CHART_PURPLE = 'var(--color-secondary)';
const CHART_GRID = 'color-mix(in srgb, var(--text-tertiary) 15%, transparent)';
const CHART_TEXT = 'var(--text-tertiary)';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentExecutionDashboard: React.FC<AgentExecutionDashboardProps> = ({ theme: _theme }) => {
  // --- Shared state ---
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [costReport, setCostReport] = useState<CostReportDay[]>([]);
  const [subTab, setSubTab] = useState<SubTab>('graphs');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Graphs state ---
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');

  // --- Logs state ---
  const [logSearch, setLogSearch] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [logRange, setLogRange] = useState<LogRange>('24h');
  const [logOffset, setLogOffset] = useState(0);
  const [historyExecutions, setHistoryExecutions] = useState<HistoryExecution[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecution[]>([]);

  // --- Fetchers ---

  const fetchStats = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/agents/executions/stats', { credentials: 'include' });
      if (resp.ok) setStats(await resp.json());
    } catch { /* silent */ }
  }, []);

  const fetchLive = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/agents/executions/live', { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        const normalized = (data.executions || []).map((exec: any) => ({
          id: exec.id,
          agentId: exec.agent_specs?.[0]?.agentId || exec.results?.[0]?.agentId || exec.id?.slice(0, 12),
          agentName: exec.agent_specs?.map((s: any) => s.role).join(', ') || exec.orchestration || '-',
          role: exec.agent_specs?.[0]?.role,
          pattern: exec.orchestration || exec.pattern,
          status: exec.status,
          startedAt: exec.created_at || exec.startedAt,
          costCents: exec.total_cost_cents != null ? parseFloat(exec.total_cost_cents) : exec.costCents,
          toolCalls: exec.tool_calls_count ?? 0,
          userId: exec.user_id,
        }));
        setLiveExecutions(normalized);
      }
    } catch { /* silent */ }
  }, []);

  const fetchCostReport = useCallback(async () => {
    const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : 30;
    try {
      const resp = await fetch(`/api/admin/agents/cost-report?days=${days}`, { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        setCostReport(data.report || []);
      }
    } catch { /* silent */ }
  }, [timeRange]);

  const fetchHistory = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(logOffset) });
      if (logStatus) params.set('status', logStatus);
      if (logSearch) params.set('search', logSearch);
      if (logRange) params.set('range', logRange);
      const resp = await fetch(`/api/admin/agents/executions?${params}`, { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        // Normalize API response to expected HistoryExecution shape
        const normalized = (data.executions || []).map((exec: any) => ({
          id: exec.id,
          agent_id: exec.agent_specs?.[0]?.agentId || exec.results?.[0]?.agentId || exec.id?.slice(0, 12),
          agent_name: exec.agent_specs?.map((s: any) => s.role).join(', ') || exec.orchestration || '-',
          user_id: exec.user_id,
          status: exec.status,
          duration_ms: exec.total_duration_ms ?? exec.duration_ms,
          cost_cents: exec.total_cost_cents != null ? parseFloat(exec.total_cost_cents) : exec.cost_cents,
          tool_calls_count: exec.tool_calls_count ?? exec.results?.reduce((sum: number, r: any) => sum + (r.toolCalls?.length || 0), 0) ?? 0,
          tokens_used: exec.total_tokens ?? exec.tokens_used,
          created_at: exec.created_at,
          completed_at: exec.updated_at || exec.completed_at,
          pattern: exec.orchestration || exec.pattern,
          model: exec.results?.[0]?.model || exec.model,
          output: exec.results?.[0]?.output?.slice(0, 500),
          error_message: exec.error || exec.error_message,
        }));
        setHistoryExecutions(normalized);
      }
    } catch { /* silent */ }
  }, [logStatus, logSearch, logRange, logOffset]);

  // --- Effects ---

  useEffect(() => {
    fetchStats();
    fetchLive();
    fetchCostReport();
    pollRef.current = setInterval(() => {
      fetchStats();
      fetchLive();
    }, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStats, fetchLive, fetchCostReport]);

  useEffect(() => { fetchCostReport(); }, [fetchCostReport]);

  useEffect(() => {
    if (subTab === 'logs') fetchHistory();
  }, [subTab, fetchHistory]);

  // --- Chart data (real API) ---

  const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : 30;
  const [execTimeSeries, setExecTimeSeries] = useState<any[]>([]);
  const [latencyData, setLatencyData] = useState<any[]>([]);
  const [tokenData, setTokenData] = useState<any[]>([]);
  const [costByAgent, setCostByAgent] = useState<any[]>([]);

  useEffect(() => {
    const fmt = (t: string) => {
      const d = new Date(t);
      return days <= 1
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    fetch(`/api/admin/agents/metrics/timeseries?days=${days}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const ts = data.timeSeries || [];
        setExecTimeSeries(ts.map((p: any) => ({
          time: fmt(p.time),
          success: p.success,
          failed: p.failed,
        })));
        setLatencyData(ts.map((p: any) => ({
          time: fmt(p.time),
          p50: p.avgLatencyMs,
          p95: Math.round(p.avgLatencyMs * 1.8),
        })));
        setTokenData(ts.map((p: any) => ({
          time: fmt(p.time),
          prompt: p.promptTokens,
          completion: p.completionTokens,
        })));
      })
      .catch(() => { /* leave existing data on error */ });

    fetch('/api/admin/agents/metrics/by-agent', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setCostByAgent((data.agents || []).map((a: any) => ({
          name: a.type,
          cost: a.cost,
          executions: a.executions,
          successRate: a.successRate,
        })));
      })
      .catch(() => { /* leave existing data on error */ });
  }, [timeRange, days]);

  // --- Metric card values ---

  const totalExec = stats?.totalToday ?? 0;
  const successRate = stats?.successRate ?? 0;
  const avgLatency = stats?.avgLatencyMs ?? '-';
  const totalCost = formatCost(stats?.costTodayCents);

  // --- Render helpers ---

  const renderTabButton = (tab: SubTab, label: string) => (
    <button
      onClick={() => setSubTab(tab)}
      className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
      style={{
        backgroundColor: subTab === tab ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : 'transparent',
        color: subTab === tab ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
        border: subTab === tab ? '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)' : '1px solid transparent',
      }}
    >
      {label}
    </button>
  );

  const renderTimeRangeSelector = (current: string, options: string[], onChange: (v: any) => void) => (
    <div className="flex gap-1">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className="px-2 py-0.5 text-xs rounded transition-colors"
          style={{
            backgroundColor: current === opt ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)' : 'transparent',
            color: current === opt ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );

  const tooltipStyle = {
    backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    fontSize: 11,
  };

  // =========================================================================
  // SUB-TAB A: Graphs Dashboard
  // =========================================================================

  const renderGraphs = () => (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Executions', value: totalExec, sub: 'today', color: 'var(--color-primary)' },
          { label: 'Success Rate', value: `${successRate}%`, sub: `${stats?.failedToday ?? 0} failed today`, color: successRate >= 90 ? CHART_GREEN : successRate >= 70 ? 'var(--color-warning)' : CHART_RED },
          { label: 'Avg Latency', value: typeof avgLatency === 'number' ? `${avgLatency}ms` : '-', sub: 'per execution', color: 'var(--color-text-primary)' },
          { label: 'Total Cost', value: totalCost, sub: `${(stats?.tokensToday ?? 0).toLocaleString()} tokens`, color: 'var(--color-text-primary)' },
        ].map(card => (
          <div key={card.label} style={{ ...cardStyle, background: 'color-mix(in srgb, var(--color-bg-surface) 90%, var(--color-primary) 10%)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{card.label}</div>
            <div className="text-2xl font-bold mt-1" style={{ color: card.color }}>{card.value}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Executions Over Time */}
      <div style={chartCardStyle}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>Executions Over Time</span>
          {renderTimeRangeSelector(timeRange, ['24h', '7d', '30d'], setTimeRange)}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={execTimeSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: CHART_TEXT }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: CHART_TEXT }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="success" stackId="1" stroke={CHART_GREEN} fill={CHART_GREEN} fillOpacity={0.4} name="Success" />
            <Area type="monotone" dataKey="failed" stackId="1" stroke={CHART_RED} fill={CHART_RED} fillOpacity={0.4} name="Failed" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Two charts side-by-side */}
      <div className="grid grid-cols-2 gap-3">
        {/* Cost by Agent/Model */}
        <div style={chartCardStyle}>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Cost by Model</div>
          {costByAgent.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No cost data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={costByAgent} layout="vertical" margin={{ left: 60, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis type="number" tick={{ fontSize: 10, fill: CHART_TEXT }} tickFormatter={v => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: CHART_TEXT }} width={55} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cost']} />
                <Bar dataKey="cost" fill={CHART_BLUE} radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Latency Distribution */}
        <div style={chartCardStyle}>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Latency Distribution</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: CHART_TEXT }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: CHART_TEXT }} tickFormatter={v => `${v}ms`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}ms`]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="p50" stroke={CHART_BLUE} fill={CHART_BLUE} fillOpacity={0.3} name="p50" />
              <Area type="monotone" dataKey="p95" stroke={CHART_PURPLE} fill={CHART_PURPLE} fillOpacity={0.15} name="p95" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Token Usage Over Time */}
      <div style={chartCardStyle}>
        <div className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Token Usage Over Time</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={tokenData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: CHART_TEXT }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: CHART_TEXT }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString(), undefined]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="prompt" stackId="1" stroke={CHART_BLUE} fill={CHART_BLUE} fillOpacity={0.4} name="Prompt Tokens" />
            <Area type="monotone" dataKey="completion" stackId="1" stroke={CHART_GREEN} fill={CHART_GREEN} fillOpacity={0.4} name="Completion Tokens" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // =========================================================================
  // SUB-TAB B: Execution Logs
  // =========================================================================

  const renderLogs = () => (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap" style={cardStyle}>
        <input
          type="text"
          placeholder="Search agent name, ID, pattern..."
          value={logSearch}
          onChange={e => { setLogSearch(e.target.value); setLogOffset(0); }}
          className="flex-1 min-w-[200px] text-xs px-2.5 py-1.5 rounded outline-none"
          style={{
            backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
            border: '1px solid var(--color-border, var(--color-border-default))',
            color: 'var(--color-text-primary)',
          }}
        />
        <select
          value={logStatus}
          onChange={e => { setLogStatus(e.target.value); setLogOffset(0); }}
          className="text-xs px-2 py-1.5 rounded outline-none"
          style={{
            backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
            border: '1px solid var(--color-border, var(--color-border-default))',
            color: 'var(--color-text-primary)',
          }}
        >
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        {renderTimeRangeSelector(logRange, ['1h', '24h', '7d', '30d'], setLogRange)}
        <button
          onClick={() => fetchHistory()}
          className="text-xs px-2.5 py-1.5 rounded font-medium"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)' }}
        >
          Search
        </button>
      </div>

      {/* Live Executions (compact) */}
      {liveExecutions.length > 0 && (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: CHART_GREEN }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>Live ({liveExecutions.length})</span>
          </div>
          {liveExecutions.map(exec => {
            const message = (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <code style={{ color: 'var(--ap-fg-1, var(--fg-1))' }}>
                  {exec.agentName || exec.agentId?.slice(0, 12) || '-'}
                </code>
                <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {exec.status}</span>
                {exec.pattern && (
                  <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {exec.pattern}</span>
                )}
              </span>
            );
            const meta = (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)' }}>
                <LiveTimer startedAt={exec.startedAt} />
                <span>{formatCost(exec.costCents)}</span>
              </span>
            );
            return (
              <LogRow
                key={exec.id}
                severity={statusToSeverity(exec.status)}
                timestamp="live"
                source={exec.userId || 'system'}
                sourceAccent={!!exec.userId}
                message={message}
                meta={meta}
              />
            );
          })}
        </div>
      )}

      {/* Results table */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        {historyExecutions.length === 0 ? (
          <div className="py-10 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            No executions found matching filters
          </div>
        ) : (
          <>
            {historyExecutions.map(exec => {
              const isOpen = expandedRow === exec.id;
              const message = (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <code style={{ color: 'var(--ap-fg-1, var(--fg-1))' }}>
                    {exec.agent_name || exec.agent_id?.slice(0, 12) || '-'}
                  </code>
                  <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {exec.status}</span>
                  {exec.pattern && (
                    <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {exec.pattern}</span>
                  )}
                </span>
              );
              const meta = (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)' }}>
                  <span>{formatDurationMs(exec.duration_ms)}</span>
                  {exec.tokens_used != null && <span>{exec.tokens_used.toLocaleString()} tok</span>}
                  <span>{formatCost(exec.cost_cents)}</span>
                </span>
              );
              return (
                <React.Fragment key={exec.id}>
                  <div
                    onClick={() => setExpandedRow(isOpen ? null : exec.id)}
                    style={{ cursor: 'pointer' }}
                    role="button"
                    aria-expanded={isOpen}
                  >
                    <LogRow
                      severity={statusToSeverity(exec.status)}
                      timestamp={exec.created_at ? new Date(exec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                      source={exec.user_id || 'system'}
                      sourceAccent={!!exec.user_id}
                      message={message}
                      meta={meta}
                    />
                  </div>
                  {isOpen && (
                    <div style={{ padding: '12px 16px', backgroundColor: 'color-mix(in srgb, var(--color-bg-surface) 95%, var(--color-primary) 5%)', borderBottom: '1px solid var(--color-border)' }}>
                      <div className="space-y-2 text-xs">
                        <div className="grid grid-cols-3 gap-3">
                          <div><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>ID:</span> <span className="font-mono">{exec.id}</span></div>
                          <div><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Model:</span> {exec.model || '-'}</div>
                          <div><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Tool Calls:</span> {exec.tool_calls_count ?? '-'}</div>
                          <div><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Agent ID:</span> <span className="font-mono">{exec.agent_id || '-'}</span></div>
                          <div><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>User ID:</span> <span className="font-mono">{exec.user_id || '-'}</span></div>
                          <div><span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Completed:</span> {exec.completed_at ? new Date(exec.completed_at).toLocaleString() : '-'}</div>
                        </div>
                        {exec.error_message && (
                          <div className="mt-2 p-2 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)' }}>
                            <div className="font-semibold mb-1" style={{ color: 'var(--color-error)' }}>Error</div>
                            <pre className="whitespace-pre-wrap font-mono text-xs" style={{ color: 'var(--color-text-primary)' }}>{exec.error_message}</pre>
                          </div>
                        )}
                        {exec.output && (
                          <div className="mt-2 p-2 rounded" style={{ backgroundColor: 'var(--color-bg-primary, var(--color-bg))', border: '1px solid var(--color-border)' }}>
                            <div className="font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Output</div>
                            <pre className="whitespace-pre-wrap font-mono text-xs max-h-[200px] overflow-auto" style={{ color: 'var(--color-text-primary)' }}>{exec.output}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            {/* Pagination */}
            <div className="px-4 py-2 flex items-center justify-between" style={{ borderTop: '1px solid var(--color-border, var(--color-border-default))' }}>
              <button
                onClick={() => setLogOffset(Math.max(0, logOffset - PAGE_SIZE))}
                disabled={logOffset === 0}
                className="text-xs px-2 py-1 rounded disabled:opacity-30 hover:opacity-80"
                style={{ color: 'var(--color-primary)' }}
              >
                Previous
              </button>
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Showing {logOffset + 1}-{logOffset + historyExecutions.length}
              </span>
              <button
                onClick={() => setLogOffset(logOffset + PAGE_SIZE)}
                disabled={historyExecutions.length < PAGE_SIZE}
                className="text-xs px-2 py-1 rounded disabled:opacity-30 hover:opacity-80"
                style={{ color: 'var(--color-primary)' }}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // =========================================================================
  // Main Render
  // =========================================================================

  return (
    <div className="space-y-3 mt-2">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Agents', 'Executions']}
        title="Agent Executions"
        explainer="Live and historical agent-execution telemetry: graphs for success rate, latency, token usage, and cost — plus a searchable execution-log audit stream."
        sticky
      />

      {/* Sub-tab bar */}
      <div className="flex items-center gap-2">
        {renderTabButton('graphs', 'Graphs Dashboard')}
        {renderTabButton('logs', 'Execution Logs')}
      </div>

      {subTab === 'graphs' ? renderGraphs() : renderLogs()}
    </div>
  );
};

// ---------------------------------------------------------------------------
// LiveTimer sub-component
// ---------------------------------------------------------------------------

const LiveTimer: React.FC<{ startedAt: string }> = ({ startedAt }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 1000) return <span>&lt;1s</span>;
  const s = Math.floor(ms / 1000);
  if (s < 60) return <span>{s}s</span>;
  const m = Math.floor(s / 60);
  return <span>{m}m {s % 60}s</span>;
};
