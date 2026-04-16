/**
 * LLM Performance Metrics - GCP Cloud Monitoring-style Dashboard
 *
 * Displays real-time LLM performance: latency percentiles, throughput,
 * cost attribution, provider health, model comparison, and tool analytics.
 * Uses Recharts for time series and shared design components.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Users, HelpCircle } from '@/shared/icons';
import {
  Activity, Zap, DollarSign, TrendingUp, RefreshCw,
  Timer as Clock, CheckCircle, XCircle
} from '../Shared/AdminIcons';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { AdminStatusBadge } from '../Shared/AdminStatusBadge';
import { AdminTooltip, InfoTooltip } from '../Shared/AdminTooltip';
import { AdminCard } from '../Shared/AdminCard';
import { CHART_COLORS } from '../Shared/chartColors';
import { apiRequest } from '@/utils/api';

// ── Tooltip Descriptions ──────────────────────────────────────────────

const TIPS = {
  totalQueries: 'Total LLM API requests in the selected time window',
  totalTokens: 'Combined prompt + completion tokens processed',
  estimatedCost: 'Estimated cost based on per-model token pricing',
  mcpToolCalls: 'MCP tool invocations triggered by the LLM',
  ttft: 'Time to First Token — how quickly the LLM begins generating. Lower is better.',
  tokensPerSec: 'Output generation speed. Higher is better.',
  responseTime: 'Total end-to-end request duration',
  modelLatency: 'Average response time per model',
  errorRate: 'Failed request percentage per model',
  concurrent: 'Simultaneous in-flight requests',
  cacheHitRate: 'Cache hit ratio — higher means lower cost and faster responses',
  providerCost: 'Cost breakdown by LLM provider from request logs',
  modelUsage: 'Token consumption and cost per model',
  userCost: 'Per-user cost attribution for billing',
  toolStats: 'MCP tool call success rates and execution times',
};

// ── Interfaces ────────────────────────────────────────────────────────

interface LLMPerformanceMetricsProps { theme: string }

interface OverviewMetrics {
  totalQueries: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  avgResponseTime: number;
  uniqueUsers: number;
  successCount: number;
  failureCount: number;
  successRate: string;
  toolCalls: number;
}
interface ModelBreakdown { model: string; queries: number; tokens: number; cost: number; avgTokensPerQuery: number }
interface UserMetrics { userId: string; email: string; totalQueries: number; totalTokens: number; promptTokens: number; completionTokens: number; estimatedCost: number; toolCalls: number; avgResponseTime: number }
interface ToolMetrics { toolName: string; serverName: string; totalCalls: number; successCount: number; failureCount: number; successRate: number; avgExecutionTime: number; estimatedCost: number }
interface TrendData { timestamp: string; queries: number; tokens: number; cost: number; toolCalls: number }
interface ProviderMetrics { provider: string; totalRequests: number; successfulRequests: number; failedRequests: number; successRate: string; promptTokens: number; completionTokens: number; totalTokens: number; totalCost: string; avgLatencyMs: number; avgTokensPerSecond: number }
interface PerformanceTrendPoint {
  timestamp: string;
  requestCount: number;
  avgTTFT: number | null;
  p95TTFT: number | null;
  p99TTFT: number | null;
  avgTokensPerSecond: number | null;
  p95TokensPerSecond: number | null;
  avgTotalLatency: number | null;
  p95TotalLatency: number | null;
  avgInputLatency: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgChunkLatency: number | null;
  p95ChunkLatency: number | null;
}
interface PerformanceKPIs {
  avgTTFT: number; p50TTFT: number; p95TTFT: number; p99TTFT: number;
  avgTokensPerSecond: number; p50TokensPerSecond: number; p95TokensPerSecond: number;
  avgResponseTime: number; p50ResponseTime: number; p95ResponseTime: number; p99ResponseTime: number;
  totalPromptTokens: number; totalCompletionTokens: number; totalTokens: number;
  avgPromptTokens: number; avgCompletionTokens: number;
  modelLatencyByModel: { model: string; avgLatency: number; count: number }[];
  errorRateByModel: { model: string; errorRate: number; totalRequests: number }[];
  totalCost: number; avgCostPerRequest: number;
  costByModel: { model: string; totalCost: number; count: number }[];
  avgConcurrentRequests: number; maxConcurrentRequests: number;
  avgQueueWait: number; p95QueueWait: number;
  cacheHitRate: number; totalCacheHits: number; totalCacheMisses: number;
}

// ── Time range map ────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS = [
  { value: '1', label: '1h' },
  { value: '6', label: '6h' },
  { value: '24', label: '24h' },
  { value: '168', label: '7d' },
  { value: '720', label: '30d' },
];

// ── Helpers ───────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};
const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
const fmtMs = (n: number) => `${n.toFixed(0)}ms`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ── Custom Recharts tooltip ───────────────────────────────────────────

const ChartTooltipContent: React.FC<{ active?: boolean; payload?: any[]; label?: string; valueFormatter?: (v: number) => string }> = ({
  active, payload, label, valueFormatter = String,
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--color-surfaceSecondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-semibold">{valueFormatter(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ── Section Header ────────────────────────────────────────────────────

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; tooltip?: string; extra?: React.ReactNode }> = ({ icon, title, tooltip, extra }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tooltip && <InfoTooltip content={tooltip} />}
    {extra && <div className="ml-auto">{extra}</div>}
  </div>
);

// ── Percentile gauge row ──────────────────────────────────────────────

const PercentileRow: React.FC<{
  label: string; avg: number; p50: number; p95: number; p99?: number;
  unit?: string; goodBelow?: number;
}> = ({ label, avg, p50, p95, p99, unit = 'ms', goodBelow }) => {
  const color = (v: number) => {
    if (goodBelow && v <= goodBelow) return 'var(--color-success)';
    if (goodBelow && v <= goodBelow * 2) return 'var(--color-warning)';
    return 'var(--color-error)';
  };
  const vals = [
    { label: 'Avg', value: avg },
    { label: 'P50', value: p50 },
    { label: 'P95', value: p95 },
    ...(p99 !== undefined ? [{ label: 'P99', value: p99 }] : []),
  ];
  return (
    <div className="mb-3">
      <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${vals.length}, 1fr)` }}>
        {vals.map((v) => (
          <div key={v.label} className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{v.label}</div>
            <div className="text-lg font-bold" style={{ color: goodBelow ? color(v.value) : 'var(--text-primary)' }}>
              {v.value}{unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════

const LLMPerformanceMetrics: React.FC<LLMPerformanceMetricsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdown[]>([]);
  const [userMetrics, setUserMetrics] = useState<UserMetrics[]>([]);
  const [toolMetrics, setToolMetrics] = useState<ToolMetrics[]>([]);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [providerMetrics, setProviderMetrics] = useState<ProviderMetrics[]>([]);
  const [providerTotalCost, setProviderTotalCost] = useState('0.000000');
  const [performanceKPIs, setPerformanceKPIs] = useState<PerformanceKPIs | null>(null);
  const [performanceTrends, setPerformanceTrends] = useState<PerformanceTrendPoint[]>([]);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const [overviewRes, usersRes, toolsRes, trendsRes, providersRes, performanceRes, perfTrendsRes] = await Promise.all([
        apiRequest(`/admin/metrics/llm/overview?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/users?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/tools?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/trends?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/providers?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/performance?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/performance-trends?hours=${timeRange}`),
      ]);

      if (overviewRes.ok) { const d = await overviewRes.json(); setOverview(d.overview); setModelBreakdown(d.modelBreakdown || []); }
      if (usersRes.ok) { const d = await usersRes.json(); setUserMetrics(d.users || []); }
      if (toolsRes.ok) { const d = await toolsRes.json(); setToolMetrics(d.tools || []); }
      if (trendsRes.ok) { const d = await trendsRes.json(); setTrends(d.trends || []); }
      if (providersRes.ok) { const d = await providersRes.json(); setProviderMetrics(d.providers || []); setProviderTotalCost(d.totalCost || '0.000000'); }
      if (performanceRes.ok) { const d = await performanceRes.json(); setPerformanceKPIs(d.kpis || null); }
      if (perfTrendsRes.ok) { const d = await perfTrendsRes.json(); setPerformanceTrends(d.trends || []); }
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to fetch LLM metrics:', e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchMetrics]);

  // Format trend timestamps for chart labels
  const chartTrends = trends.map((t) => ({
    ...t,
    time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  // Format performance trend timestamps
  const chartPerfTrends = performanceTrends.map((t) => ({
    ...t,
    time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  // Filter tool / user metrics by search
  const filteredTools = toolMetrics.filter(
    (t) => !searchTerm || t.toolName.toLowerCase().includes(searchTerm.toLowerCase()) || t.serverName.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const filteredUsers = userMetrics.filter(
    (u) => !searchTerm || u.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // ── Loading state ─────────────────────────────────────────────────

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Header + Filter Bar ────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>LLM Performance</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Updated {lastUpdated.toLocaleTimeString()} {autoRefresh && '(auto-refresh 30s)'}
          </p>
        </div>
        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          timeRangeOptions={TIME_RANGE_OPTIONS}
          onRefresh={fetchMetrics}
          refreshing={loading}
          extraFilters={
            <AdminTooltip content={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  border: `1px solid ${autoRefresh ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  backgroundColor: autoRefresh ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'var(--color-surface)',
                  color: autoRefresh ? 'var(--color-primary)' : 'var(--text-secondary)',
                }}
              >
                <RefreshCw size={14} />
              </button>
            </AdminTooltip>
          }
        />
      </div>

      {/* ── Top-level KPI Cards ────────────────────────────────── */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <AdminMetricCard
            label="Total Queries"
            value={fmt(overview.totalQueries)}
            subtext={`${overview.uniqueUsers} unique users`}
            icon={<Activity size={18} />}
            tooltip={TIPS.totalQueries}
            sparklineData={chartTrends.map((t) => t.queries)}
          />
          <AdminMetricCard
            label="Total Tokens"
            value={fmt(performanceKPIs?.totalTokens ?? overview.totalTokens)}
            subtext={`${fmt(performanceKPIs?.totalPromptTokens ?? overview.totalPromptTokens)} in / ${fmt(performanceKPIs?.totalCompletionTokens ?? overview.totalCompletionTokens)} out`}
            icon={<Zap size={18} />}
            tooltip={TIPS.totalTokens}
            sparklineData={chartTrends.map((t) => t.tokens)}
          />
          <AdminMetricCard
            label="Total Cost"
            value={fmtUsd(performanceKPIs?.totalCost ?? overview.totalCost)}
            subtext={`${fmtMs(performanceKPIs?.avgResponseTime ?? overview.avgResponseTime)} avg response`}
            icon={<DollarSign size={18} />}
            tooltip={TIPS.estimatedCost}
            sparklineData={chartTrends.map((t) => t.cost)}
          />
          <AdminMetricCard
            label="MCP Tool Calls"
            value={fmt(overview.toolCalls)}
            subtext={`${overview.successRate}% success rate`}
            icon={<CheckCircle size={18} />}
            tooltip={TIPS.mcpToolCalls}
            sparklineData={chartTrends.map((t) => t.toolCalls)}
          />
        </div>
      )}

      {/* ── Trend Charts (2-col) ───────────────────────────────── */}
      {chartTrends.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Queries over time */}
          <AdminCard>
            <SectionHeader icon={<Activity size={16} />} title="Requests Over Time" tooltip="Query volume trend across the selected window" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="queryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => fmt(v)} />} />
                  <Area type="monotone" dataKey="queries" name="Queries" stroke="#6366f1" fill="url(#queryGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Cost over time */}
          <AdminCard>
            <SectionHeader icon={<DollarSign size={16} />} title="Cost Over Time" tooltip="Cumulative LLM cost trend" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00D26A" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00D26A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `$${v}`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmtUsd} />} />
                  <Area type="monotone" dataKey="cost" name="Cost" stroke="#00D26A" fill="url(#costGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Tokens over time */}
          <AdminCard>
            <SectionHeader icon={<Zap size={16} />} title="Token Usage Over Time" tooltip="Token consumption trend" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={fmt} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmt} />} />
                  <Area type="monotone" dataKey="tokens" name="Tokens" stroke="#f59e0b" fill="url(#tokenGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Tool calls over time */}
          <AdminCard>
            <SectionHeader icon={<CheckCircle size={16} />} title="Tool Calls Over Time" tooltip="MCP tool invocation trend" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="toolGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmt} />} />
                  <Area type="monotone" dataKey="toolCalls" name="Tool Calls" stroke="#06b6d4" fill="url(#toolGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Provider Health Grid ───────────────────────────────── */}
      {providerMetrics.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<Activity size={16} />} title="Provider Health" tooltip="Real-time status of each LLM provider based on success rates" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {providerMetrics.map((p) => {
              const pct = parseFloat(p.successRate) || 0;
              const status = pct >= 99 ? 'Healthy' : pct >= 95 ? 'Degraded' : 'Unhealthy';
              return (
                <div
                  key={p.provider}
                  className="rounded-lg p-3 flex flex-col gap-1.5"
                  style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                      {p.provider.replace(/-/g, ' ')}
                    </span>
                    <AdminStatusBadge status={status.toLowerCase()} size="sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Requests</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(p.totalRequests)}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Latency</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.avgLatencyMs}ms</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cost</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>${p.totalCost}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </AdminCard>
      )}

      {/* ── Performance KPIs ───────────────────────────────────── */}
      {performanceKPIs && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* TTFT + Response Time */}
          <AdminCard>
            <SectionHeader icon={<Clock size={16} />} title="Latency Percentiles" tooltip={TIPS.ttft} />
            <PercentileRow label="Time to First Token" avg={performanceKPIs.avgTTFT} p50={performanceKPIs.p50TTFT} p95={performanceKPIs.p95TTFT} p99={performanceKPIs.p99TTFT} goodBelow={500} />
            <PercentileRow label="Total Response Time" avg={performanceKPIs.avgResponseTime} p50={performanceKPIs.p50ResponseTime} p95={performanceKPIs.p95ResponseTime} p99={performanceKPIs.p99ResponseTime} goodBelow={3000} />
          </AdminCard>

          {/* Throughput + Concurrency */}
          <AdminCard>
            <SectionHeader icon={<Zap size={16} />} title="Throughput & Concurrency" tooltip={TIPS.tokensPerSec} />
            <PercentileRow label="Output Speed (tok/s)" avg={performanceKPIs.avgTokensPerSecond} p50={performanceKPIs.p50TokensPerSecond} p95={performanceKPIs.p95TokensPerSecond} unit=" tok/s" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Avg Concurrent</div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{performanceKPIs.avgConcurrentRequests}</div>
              </div>
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Max Concurrent</div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{performanceKPIs.maxConcurrentRequests}</div>
              </div>
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Avg Queue Wait</div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{performanceKPIs.avgQueueWait}ms</div>
              </div>
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cache Hit Rate</div>
                <div className="text-lg font-bold" style={{ color: performanceKPIs.cacheHitRate >= 50 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                  {fmtPct(performanceKPIs.cacheHitRate)}
                </div>
              </div>
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Performance Trend Charts ────────────────────────────── */}
      {chartPerfTrends.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* TTFT Trend */}
          <AdminCard>
            <SectionHeader icon={<Clock size={16} />} title="TTFT Over Time" tooltip="Time to First Token trend — avg and P95 per time bucket. Lower is better for perceived responsiveness." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPerfTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v}ms`} />} />
                  <Line type="monotone" dataKey="avgTTFT" name="Avg TTFT" stroke="#6366f1" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="p95TTFT" name="P95 TTFT" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                  <Line type="monotone" dataKey="p99TTFT" name="P99 TTFT" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Token Throughput Trend */}
          <AdminCard>
            <SectionHeader icon={<Zap size={16} />} title="Token Throughput Over Time" tooltip="Output generation speed (tokens/second) — avg and P95 per time bucket. Higher is better." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPerfTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v} tok/s`} />} />
                  <Line type="monotone" dataKey="avgTokensPerSecond" name="Avg tok/s" stroke="#00D26A" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="p95TokensPerSecond" name="P95 tok/s" stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Latency Breakdown */}
          <AdminCard>
            <SectionHeader icon={<Activity size={16} />} title="Latency Breakdown" tooltip="Input processing time (time to first token) vs total end-to-end latency. The gap represents output generation time." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartPerfTrends}>
                  <defs>
                    <linearGradient id="totalLatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="inputLatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v}ms`} />} />
                  <Area type="monotone" dataKey="avgTotalLatency" name="Total Latency" stroke="#6366f1" fill="url(#totalLatGrad)" strokeWidth={2} connectNulls />
                  <Area type="monotone" dataKey="avgTTFT" name="Input Processing (TTFT)" stroke="#f59e0b" fill="url(#inputLatGrad)" strokeWidth={2} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Streaming Performance */}
          <AdminCard>
            <SectionHeader icon={<TrendingUp size={16} />} title="Streaming Chunk Latency" tooltip="Average time between streamed output chunks (ms per token). Lower means smoother streaming experience." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPerfTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v}ms/tok`} />} />
                  <Line type="monotone" dataKey="avgChunkLatency" name="Avg Chunk Latency" stroke="#a855f7" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="p95ChunkLatency" name="P95 Chunk Latency" stroke="#ec4899" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Model Comparison Charts ────────────────────────────── */}
      {modelBreakdown.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Model cost bar chart */}
          <AdminCard>
            <SectionHeader icon={<DollarSign size={16} />} title="Cost by Model" tooltip={TIPS.modelUsage} />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelBreakdown.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} width={75} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmtUsd} />} />
                  <Bar dataKey="cost" name="Cost" radius={[0, 4, 4, 0]}>
                    {modelBreakdown.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Model latency bar chart */}
          {performanceKPIs && performanceKPIs.modelLatencyByModel.length > 0 && (
            <AdminCard>
              <SectionHeader icon={<Clock size={16} />} title="Latency by Model" tooltip={TIPS.modelLatency} />
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceKPIs.modelLatencyByModel.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                    <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} width={75} />
                    <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmtMs} />} />
                    <Bar dataKey="avgLatency" name="Avg Latency" radius={[0, 4, 4, 0]}>
                      {performanceKPIs.modelLatencyByModel.slice(0, 8).map((m, i) => (
                        <Cell key={i} fill={m.avgLatency > 3000 ? '#ef4444' : m.avgLatency > 1000 ? '#f59e0b' : '#00D26A'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Error Rate by Model ────────────────────────────────── */}
      {performanceKPIs && performanceKPIs.errorRateByModel.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<XCircle size={16} />} title="Error Rates by Model" tooltip={TIPS.errorRate} />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {performanceKPIs.errorRateByModel.map((m) => {
              const status = m.errorRate < 1 ? 'healthy' : m.errorRate < 5 ? 'degraded' : 'unhealthy';
              return (
                <div key={m.model} className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}>
                  <div className="text-xs font-medium truncate mb-1" style={{ color: 'var(--text-secondary)' }}>{m.model}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold" style={{ color: m.errorRate < 1 ? 'var(--color-success)' : m.errorRate < 5 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                      {fmtPct(m.errorRate)}
                    </span>
                    <AdminStatusBadge status={status} size="sm" showDot={false} />
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{fmt(m.totalRequests)} requests</div>
                </div>
              );
            })}
          </div>
        </AdminCard>
      )}

      {/* ── Provider Cost Table ─────────────────────────────────── */}
      {providerMetrics.length > 0 && (
        <AdminCard>
          <SectionHeader
            icon={<DollarSign size={16} />}
            title="Provider Cost Breakdown"
            tooltip={TIPS.providerCost}
            extra={<span className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>Total: ${providerTotalCost}</span>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">Provider</th>
                  <th className="text-right pb-2 font-medium">Requests</th>
                  <th className="text-right pb-2 font-medium">
                    <span className="inline-flex items-center gap-1">Success <InfoTooltip content="Percentage of non-error responses" size={12} /></span>
                  </th>
                  <th className="text-right pb-2 font-medium">Prompt Tok</th>
                  <th className="text-right pb-2 font-medium">Completion Tok</th>
                  <th className="text-right pb-2 font-medium">Latency</th>
                  <th className="text-right pb-2 font-medium">Tok/s</th>
                  <th className="text-right pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {providerMetrics.map((p) => {
                  const pct = parseFloat(p.successRate) || 0;
                  return (
                    <tr key={p.provider} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                      <td className="py-2.5 font-medium capitalize" style={{ color: 'var(--text-primary)' }}>{p.provider.replace(/-/g, ' ')}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(p.totalRequests)}</td>
                      <td className="py-2.5 text-right">
                        <span style={{ color: pct >= 95 ? 'var(--color-success)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                          {p.successRate}%
                        </span>
                      </td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(p.promptTokens)}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(p.completionTokens)}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{p.avgLatencyMs}ms</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{p.avgTokensPerSecond}</td>
                      <td className="py-2.5 text-right font-semibold" style={{ color: 'var(--color-success)' }}>${p.totalCost}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* ── Top Users by Cost ──────────────────────────────────── */}
      {filteredUsers.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<Users size={16} />} title="Top Users by Cost" tooltip={TIPS.userCost} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">User</th>
                  <th className="text-right pb-2 font-medium">Queries</th>
                  <th className="text-right pb-2 font-medium">Tokens</th>
                  <th className="text-right pb-2 font-medium">Tool Calls</th>
                  <th className="text-right pb-2 font-medium">Avg Response</th>
                  <th className="text-right pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.slice(0, 10).map((u) => (
                  <tr key={u.userId} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                    <td className="py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{u.email}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(u.totalQueries)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(u.totalTokens)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(u.toolCalls)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{u.avgResponseTime}ms</td>
                    <td className="py-2.5 text-right font-semibold" style={{ color: 'var(--color-success)' }}>{fmtUsd(u.estimatedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* ── MCP Tool Stats ─────────────────────────────────────── */}
      {filteredTools.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<CheckCircle size={16} />} title="MCP Tool Statistics" tooltip={TIPS.toolStats} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">Tool</th>
                  <th className="text-left pb-2 font-medium">Server</th>
                  <th className="text-right pb-2 font-medium">Calls</th>
                  <th className="text-right pb-2 font-medium">Success</th>
                  <th className="text-right pb-2 font-medium">Avg Time</th>
                  <th className="text-right pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredTools.slice(0, 15).map((t) => {
                  const sr = t.successRate ?? 0;
                  return (
                    <tr key={t.toolName} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                      <td className="py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{t.toolName}</td>
                      <td className="py-2" style={{ color: 'var(--text-secondary)' }}>{t.serverName}</td>
                      <td className="py-2 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(t.totalCalls)}</td>
                      <td className="py-2 text-right">
                        <span style={{ color: sr >= 95 ? 'var(--color-success)' : sr >= 80 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                          {fmtPct(sr)}
                        </span>
                      </td>
                      <td className="py-2 text-right" style={{ color: 'var(--text-primary)' }}>{t.avgExecutionTime}ms</td>
                      <td className="py-2 text-right" style={{ color: 'var(--color-success)' }}>{fmtUsd(t.estimatedCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
    </div>
  );
};

export default LLMPerformanceMetrics;
