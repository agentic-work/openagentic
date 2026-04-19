/**
 * Synth Usage Statistics View
 *
 * Displays usage analytics and cost tracking for Synth.
 * Clicking any row opens a detail modal showing full LLM output, code, errors, and user info.
 * Uses Recharts for daily usage/cost and risk distribution charts.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChartIcon, TrendingUpIcon, DollarIcon, ClockIcon, RefreshIcon
} from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';
import { X, Code, AlertCircle, Check, Clock, User, Zap } from '@/shared/icons';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { AdminCard } from '../Shared/AdminCard';
import { CHART_COLORS } from '../Shared/chartColors';

// ── Interfaces ────────────────────────────────────────────────────────

interface UsageStats {
  totalSyntheses: number;
  successfulSyntheses: number;
  failedSyntheses: number;
  totalCostUsd: number;
  avgExecutionMs: number;
  riskBreakdown: Record<string, number>;
  topCapabilities: Array<{ name: string; count: number }>;
  dailyUsage: Array<{ date: string; count: number; cost: number }>;
}

interface SynthesisHistory {
  toolId: string;
  userId: string;
  userEmail: string;
  intent: string;
  success: boolean;
  riskLevel: string;
  executionTimeMs: number;
  costUsd: number;
  createdAt: string;
}

interface SynthDetail {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  intent: string;
  sessionId: string | null;
  capabilities: string[];
  capabilitiesUsed: string[];
  code: string | null;
  explanation: string | null;
  riskLevel: string;
  riskReasoning: string | null;
  status: string;
  result: any;
  error: string | null;
  dryRun: boolean;
  approvalRequired: boolean;
  ssoProvider: string | null;
  synthesisTimeMs: number | null;
  executionTimeMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  ttftMs: number | null;
  createdAt: string;
  completedAt: string | null;
  approval: {
    id: string;
    status: string;
    approverEmail: string | null;
    approverName: string | null;
    reason: string | null;
    createdAt: string;
    resolvedAt: string | null;
  } | null;
}

interface SynthUsageStatsViewProps {
  theme: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const RISK_COLOR_MAP: Record<string, string> = {
  low: 'var(--color-success)',
  medium: 'var(--color-warning)',
  high: 'var(--color-error)',
  critical: 'var(--color-secondary)',
};

const TIME_RANGE_OPTIONS = [
  { value: '7', label: '7d' },
  { value: '14', label: '14d' },
  { value: '30', label: '30d' },
];

// ── Helpers ───────────────────────────────────────────────────────────

const fmtDate = (s: string) => {
  if (!s) return '';
  const parts = s.split('-');
  return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : s;
};

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);

// ── Chart Tooltip ─────────────────────────────────────────────────────

const ChartTip: React.FC<{
  active?: boolean;
  payload?: any[];
  label?: string;
  vFmt?: (v: number) => string;
}> = ({ active, payload, label, vFmt = String }) => {
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
      <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-semibold">{vFmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ── Section Header ────────────────────────────────────────────────────

const SectionHead: React.FC<{
  icon: React.ReactNode;
  title: string;
  tip?: string;
  extra?: React.ReactNode;
}> = ({ icon, title, tip, extra }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
      {title}
    </h3>
    {tip && <InfoTooltip content={tip} />}
    {extra && <div className="ml-auto">{extra}</div>}
  </div>
);

// ══════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════

export const SynthUsageStatsView: React.FC<SynthUsageStatsViewProps> = ({ theme }) => {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [history, setHistory] = useState<SynthesisHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState('7');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SynthDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, historyRes] = await Promise.all([
        apiRequest(`/api/admin/synth/stats?days=${days}`),
        apiRequest('/api/admin/synth/history?limit=50'),
      ]);

      if (!statsRes.ok) throw new Error('Failed to fetch stats');
      if (!historyRes.ok) throw new Error('Failed to fetch history');

      const statsData = await statsRes.json();
      const historyData = await historyRes.json();

      setStats(statsData.stats);
      setHistory(historyData.history || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await apiRequest(`/api/admin/synth/history/${id}`);
      if (!res.ok) throw new Error('Failed to fetch detail');
      const data = await res.json();
      setDetail(data.synthesis);
    } catch (err: any) {
      console.error('Failed to fetch synth detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
  };

  // ── Derived data ────────────────────────────────────────────────────

  const successRate = useMemo(() => {
    if (!stats || stats.totalSyntheses === 0) return 0;
    return (stats.successfulSyntheses / stats.totalSyntheses) * 100;
  }, [stats]);

  const costPerSynth = useMemo(() => {
    if (!stats || stats.totalSyntheses === 0) return 0;
    return stats.totalCostUsd / stats.totalSyntheses;
  }, [stats]);

  const riskPieData = useMemo(() => {
    if (!stats?.riskBreakdown) return [];
    return Object.entries(stats.riskBreakdown).map(([level, count]) => ({
      name: level.charAt(0).toUpperCase() + level.slice(1),
      value: count,
      color: RISK_COLOR_MAP[level] || CHART_COLORS[4],
    }));
  }, [stats]);

  const dailyChartData = useMemo(() => {
    if (stats?.dailyUsage && stats.dailyUsage.length > 0) {
      return stats.dailyUsage.map((d) => ({
        date: fmtDate(d.date),
        count: d.count,
        cost: d.cost,
      }));
    }
    // Derive from recent history if API doesn't supply daily data
    if (history.length === 0) return [];
    const byDate: Record<string, { count: number; cost: number }> = {};
    history.forEach((h) => {
      const d = (h.createdAt || '').split('T')[0];
      if (!byDate[d]) byDate[d] = { count: 0, cost: 0 };
      byDate[d].count += 1;
      byDate[d].cost += h.costUsd || 0;
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: fmtDate(date), count: v.count, cost: v.cost }));
  }, [stats, history]);

  const filteredHistory = useMemo(() => {
    if (!searchTerm) return history;
    const q = searchTerm.toLowerCase();
    return history.filter(
      (h) =>
        h.userEmail?.toLowerCase().includes(q) ||
        h.intent?.toLowerCase().includes(q) ||
        h.riskLevel?.toLowerCase().includes(q)
    );
  }, [history, searchTerm]);

  const isDark = theme === 'dark';
  const modalBg = isDark ? 'bg-gray-800' : 'bg-white';
  const cardBg = isDark ? 'bg-gray-800' : 'bg-gray-50';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  const textColor = isDark ? 'text-gray-100' : 'text-gray-900';

  // ── Loading / Error ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshIcon size={32} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, var(--color-surface))',
            border: '1px solid var(--color-error)',
            color: 'var(--color-error)',
          }}
        >
          Error: {error}
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <AdminFilterBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        timeRange={days}
        onTimeRangeChange={setDays}
        timeRangeOptions={TIME_RANGE_OPTIONS}
        onRefresh={fetchData}
        refreshing={loading}
      />

      {/* Metric Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <AdminMetricCard
            label="Total Syntheses"
            value={stats.totalSyntheses.toLocaleString()}
            subtext={`${stats.successfulSyntheses} successful, ${stats.failedSyntheses} failed`}
            icon={<TrendingUpIcon size={20} />}
            tooltip="Total number of Synth synthesis operations in the selected period"
            sparklineData={dailyChartData.map((d) => d.count)}
          />
          <AdminMetricCard
            label="Success Rate"
            value={`${successRate.toFixed(1)}%`}
            subtext={`${stats.failedSyntheses} failures`}
            icon={<BarChartIcon size={20} />}
            tooltip="Percentage of syntheses that completed successfully"
          />
          <AdminMetricCard
            label="Avg Execution Time"
            value={`${stats.avgExecutionMs.toFixed(0)}ms`}
            subtext="Mean synthesis + execution time"
            icon={<ClockIcon size={20} />}
            tooltip="Average end-to-end execution time across all syntheses"
          />
          <AdminMetricCard
            label="Cost / Synthesis"
            value={fmtUsd(costPerSynth)}
            subtext={`Total: ${fmtUsd(stats.totalCostUsd)}`}
            icon={<DollarIcon size={20} />}
            tooltip="Average LLM cost per synthesis operation"
            sparklineData={dailyChartData.map((d) => d.cost)}
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily Usage & Cost Chart */}
        {dailyChartData.length > 0 && (
          <AdminCard className="lg:col-span-2">
            <SectionHead
              icon={<BarChartIcon size={18} />}
              title="Daily Usage & Cost"
              tip="Synthesis count and estimated LLM cost per day"
            />
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={dailyChartData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--color-border)' }}
                  />
                  <YAxis
                    yAxisId="count"
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <YAxis
                    yAxisId="cost"
                    orientation="right"
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  />
                  <RechartsTooltip
                    content={
                      <ChartTip
                        vFmt={(v: number) =>
                          typeof v === 'number' && v < 1 ? fmtUsd(v) : v.toLocaleString()
                        }
                      />
                    }
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="count"
                    name="Syntheses"
                    fill={CHART_COLORS[0]}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={32}
                  />
                  <Area
                    yAxisId="cost"
                    type="monotone"
                    dataKey="cost"
                    name="Cost"
                    stroke={CHART_COLORS[1]}
                    fill={`${CHART_COLORS[1]}20`}
                    strokeWidth={2}
                    dot={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>
        )}

        {/* Risk Distribution Pie */}
        {riskPieData.length > 0 && (
          <AdminCard>
            <SectionHead
              icon={<AlertCircle size={18} />}
              title="Risk Distribution"
              tip="Breakdown of syntheses by assessed risk level"
            />
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={riskPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }: any) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {riskPieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    content={<ChartTip vFmt={(v: number) => v.toLocaleString()} />}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {riskPieData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {entry.name}: {entry.value}
                  </span>
                </div>
              ))}
            </div>
          </AdminCard>
        )}

        {/* Fallback when no chart data at all */}
        {dailyChartData.length === 0 && riskPieData.length === 0 && (
          <AdminCard className="lg:col-span-3">
            <div
              className="text-center py-8 text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No chart data available for the selected period.
            </div>
          </AdminCard>
        )}
      </div>

      {/* Recent Syntheses Table */}
      <AdminCard>
        <SectionHead
          icon={<Zap size={18} />}
          title="Recent Syntheses"
          tip="Click any row to view full synthesis details including LLM output and code"
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['User', 'Intent', 'Risk', 'Status', 'Time', 'Cost'].map((h) => (
                  <th
                    key={h}
                    className="text-left p-2 text-xs font-medium"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredHistory.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center p-4 text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {searchTerm ? 'No matching syntheses' : 'No synthesis history yet'}
                  </td>
                </tr>
              ) : (
                filteredHistory.map((item) => (
                  <tr
                    key={item.toolId}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      backgroundColor:
                        selectedId === item.toolId
                          ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))'
                          : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (selectedId !== item.toolId) {
                        e.currentTarget.style.backgroundColor =
                          'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedId !== item.toolId) {
                        e.currentTarget.style.backgroundColor = '';
                      }
                    }}
                    onClick={() => fetchDetail(item.toolId)}
                  >
                    <td className="p-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                      {item.userEmail || item.userId}
                    </td>
                    <td
                      className="p-2 text-sm max-w-xs truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {item.intent}
                    </td>
                    <td className="p-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: `${RISK_COLOR_MAP[item.riskLevel] || CHART_COLORS[4]}18`,
                          color: RISK_COLOR_MAP[item.riskLevel] || CHART_COLORS[4],
                        }}
                      >
                        {item.riskLevel}
                      </span>
                    </td>
                    <td className="p-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: item.success
                            ? 'color-mix(in srgb, var(--color-success) 15%, transparent)'
                            : 'color-mix(in srgb, var(--color-error) 15%, transparent)',
                          color: item.success ? 'var(--color-success)' : 'var(--color-error)',
                        }}
                      >
                        {item.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td className="p-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {item.executionTimeMs}ms
                    </td>
                    <td className="p-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      ${item.costUsd?.toFixed(4) || '0.0000'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>

      {/* Detail Modal */}
      {selectedId && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={closeDetail}
        >
          <div
            className={`${modalBg} ${textColor} rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border ${borderColor}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              className={`sticky top-0 ${modalBg} border-b ${borderColor} p-4 flex items-center justify-between z-10`}
            >
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Zap size={20} className="text-blue-500" />
                Synthesis Detail
              </h3>
              <button onClick={closeDetail} className="p-1 rounded hover:bg-gray-500/20">
                <X size={20} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-8 flex items-center justify-center">
                <RefreshIcon size={32} className="animate-spin text-blue-500" />
              </div>
            ) : detail ? (
              <div className="p-4 space-y-4">
                {/* User & Status */}
                <div className="grid grid-cols-2 gap-4">
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                      <User size={14} /> User
                    </div>
                    <p className="font-medium">{detail.userName || detail.userEmail}</p>
                    <p className="text-sm text-gray-500">{detail.userEmail}</p>
                    <p className="text-xs text-gray-400 mt-1">ID: {detail.userId}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                      <Clock size={14} /> Status & Timing
                    </div>
                    <p className="font-medium">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm ${
                          detail.status === 'completed'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            : detail.status === 'failed'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                        }`}
                      >
                        {detail.status === 'completed' ? (
                          <Check size={12} />
                        ) : (
                          <AlertCircle size={12} />
                        )}
                        {detail.status}
                      </span>
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Created: {new Date(detail.createdAt).toLocaleString()}
                    </p>
                    {detail.completedAt && (
                      <p className="text-sm text-gray-500">
                        Completed: {new Date(detail.completedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Intent */}
                <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                  <p className="text-sm text-gray-500 mb-1">Intent</p>
                  <p className="font-medium">{detail.intent}</p>
                </div>

                {/* Metrics Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-center`}>
                    <p className="text-xs text-gray-500">Risk</p>
                    <p
                      className={`font-bold ${
                        detail.riskLevel === 'low'
                          ? 'text-green-500'
                          : detail.riskLevel === 'medium'
                            ? 'text-yellow-500'
                            : detail.riskLevel === 'high'
                              ? 'text-orange-500'
                              : 'text-red-500'
                      }`}
                    >
                      {detail.riskLevel}
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-center`}>
                    <p className="text-xs text-gray-500">Cost</p>
                    <p className="font-bold">${detail.costUsd.toFixed(4)}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-center`}>
                    <p className="text-xs text-gray-500">Synthesis</p>
                    <p className="font-bold">{detail.synthesisTimeMs ?? '\u2014'}ms</p>
                  </div>
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-center`}>
                    <p className="text-xs text-gray-500">Execution</p>
                    <p className="font-bold">{detail.executionTimeMs ?? '\u2014'}ms</p>
                  </div>
                </div>

                {/* Token Usage */}
                {(detail.inputTokens || detail.outputTokens || detail.ttftMs) && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-center`}>
                      <p className="text-xs text-gray-500">Input Tokens</p>
                      <p className="font-bold">
                        {detail.inputTokens?.toLocaleString() ?? '\u2014'}
                      </p>
                    </div>
                    <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-center`}>
                      <p className="text-xs text-gray-500">Output Tokens</p>
                      <p className="font-bold">
                        {detail.outputTokens?.toLocaleString() ?? '\u2014'}
                      </p>
                    </div>
                    <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-center`}>
                      <p className="text-xs text-gray-500">TTFT</p>
                      <p className="font-bold">{detail.ttftMs ?? '\u2014'}ms</p>
                    </div>
                  </div>
                )}

                {/* Risk Reasoning */}
                {detail.riskReasoning && (
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                    <p className="text-sm text-gray-500 mb-1">Risk Reasoning</p>
                    <p className="text-sm">{detail.riskReasoning}</p>
                  </div>
                )}

                {/* LLM Explanation */}
                {detail.explanation && (
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                    <p className="text-sm text-gray-500 mb-1">LLM Explanation</p>
                    <p className="text-sm whitespace-pre-wrap">{detail.explanation}</p>
                  </div>
                )}

                {/* Synthesized Code */}
                {detail.code && (
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                      <Code size={14} /> Synthesized Code
                    </div>
                    <pre
                      className={`text-sm overflow-x-auto p-3 rounded ${isDark ? 'bg-gray-900' : 'bg-gray-100'} max-h-96`}
                    >
                      <code>{detail.code}</code>
                    </pre>
                  </div>
                )}

                {/* Execution Result */}
                {detail.result !== null && detail.result !== undefined && (
                  <div
                    className={`p-3 rounded-lg border ${
                      detail.status === 'completed'
                        ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                        : `${cardBg} ${borderColor}`
                    }`}
                  >
                    <p className="text-sm text-gray-500 mb-1">Execution Result</p>
                    <pre
                      className={`text-sm overflow-x-auto p-3 rounded ${isDark ? 'bg-gray-900' : 'bg-gray-100'} max-h-96`}
                    >
                      <code>
                        {typeof detail.result === 'string'
                          ? detail.result
                          : JSON.stringify(detail.result, null, 2)}
                      </code>
                    </pre>
                  </div>
                )}

                {/* Error */}
                {detail.error && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-1">
                      <AlertCircle size={14} /> Error
                    </div>
                    <pre className="text-sm text-red-700 dark:text-red-300 overflow-x-auto whitespace-pre-wrap">
                      {detail.error}
                    </pre>
                  </div>
                )}

                {/* Approval Info */}
                {detail.approval && (
                  <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                    <p className="text-sm text-gray-500 mb-2">Approval</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">Status: </span>
                        <span
                          className={`font-medium ${
                            detail.approval.status === 'approved'
                              ? 'text-green-500'
                              : detail.approval.status === 'rejected'
                                ? 'text-red-500'
                                : 'text-yellow-500'
                          }`}
                        >
                          {detail.approval.status}
                        </span>
                      </div>
                      {detail.approval.approverEmail && (
                        <div>
                          <span className="text-gray-500">Approver: </span>
                          <span>
                            {detail.approval.approverName || detail.approval.approverEmail}
                          </span>
                        </div>
                      )}
                      {detail.approval.reason && (
                        <div className="col-span-2">
                          <span className="text-gray-500">Reason: </span>
                          <span>{detail.approval.reason}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Capabilities & Metadata */}
                <div className="grid grid-cols-2 gap-3">
                  {detail.capabilities?.length > 0 && (
                    <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                      <p className="text-xs text-gray-500 mb-1">Requested Capabilities</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.capabilities.map((c) => (
                          <span
                            key={c}
                            className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.capabilitiesUsed?.length > 0 && (
                    <div className={`p-3 rounded-lg ${cardBg} border ${borderColor}`}>
                      <p className="text-xs text-gray-500 mb-1">Capabilities Used</p>
                      <div className="flex flex-wrap gap-1">
                        {detail.capabilitiesUsed.map((c) => (
                          <span
                            key={c}
                            className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* SSO Provider & Session */}
                <div className={`p-3 rounded-lg ${cardBg} border ${borderColor} text-sm`}>
                  <div className="flex gap-6">
                    {detail.ssoProvider && (
                      <div>
                        <span className="text-gray-500">SSO: </span>
                        <span className="font-medium">{detail.ssoProvider}</span>
                      </div>
                    )}
                    {detail.sessionId && (
                      <div>
                        <span className="text-gray-500">Session: </span>
                        <span className="font-mono text-xs">{detail.sessionId}</span>
                      </div>
                    )}
                    {detail.dryRun && (
                      <div>
                        <span className="text-yellow-500 font-medium">Dry Run</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                Failed to load synthesis detail
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SynthUsageStatsView;
