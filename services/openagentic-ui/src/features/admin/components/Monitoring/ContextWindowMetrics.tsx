/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Context Window Metrics View
 *
 * Displays context window usage metrics per chat session to help administrators
 * monitor how well context window management systems are working.
 * Also shows compaction metrics to track how often compaction occurs and its effectiveness.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts';
import { apiRequest } from '@/utils/api';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminCard } from '../Shared/AdminCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { InfoTooltip } from '../Shared/AdminTooltip';

// ── Chart colors ──────────────────────────────────────────────────────────────
const COLORS = {
  indigo: '#6366f1',
  success: '#00D26A',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
};

// ── Interfaces ────────────────────────────────────────────────────────────────

interface ContextMetrics {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  model: string;
  messageCount: number;
  contextTokensInput: number;
  contextTokensOutput: number;
  contextTokensTotal: number;
  contextWindowSize: number | null;
  contextUtilizationPct: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Statistics {
  averageUtilization: number;
  maxUtilization: number;
  totalSessions: number;
  highUtilizationSessions: number;
}

interface CompactionSummary {
  totalCompactions: number;
  totalTokensFreed: number;
  totalMessagesRemoved: number;
  totalMessagesSummarized: number;
  avgTokensFreedPerCompaction: number;
}

interface CompactionByLevel {
  light: number;
  medium: number;
  aggressive: number;
}

interface DailyCompaction {
  date: string;
  compactions: number;
  tokensFreed: number;
}

interface RecentCompaction {
  sessionId: string;
  level: string;
  tokensFreed: number;
  messagesRemoved: number;
  timestamp: string;
}

interface ActiveSessionsHealth {
  total: number;
  approachingLimit: number;
  needsCompaction: number;
  healthy: number;
}

interface ContextUsageDistribution {
  under50: number;
  from50to70: number;
  from70to85: number;
  from85to95: number;
  over95: number;
}

interface CompactionMetrics {
  summary: CompactionSummary;
  byLevel: CompactionByLevel;
  byDay: DailyCompaction[];
  recentCompactions: RecentCompaction[];
  activeSessions: ActiveSessionsHealth;
  contextUsageDistribution: ContextUsageDistribution;
}

type ViewTab = 'sessions' | 'compaction';

// ── Shared sub-components ─────────────────────────────────────────────────────

/** Custom Recharts tooltip styled with CSS variables */
const ChartTip: React.FC<{ active?: boolean; payload?: any[]; label?: string; vFmt?: (v: number) => string }> = ({
  active, payload, label, vFmt = String,
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}>
      <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
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

/** Consistent section heading */
const SectionHead: React.FC<{ title: string; tooltip?: string }> = ({ title, tooltip }) => (
  <div className="flex items-center gap-2 mb-4">
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tooltip && <InfoTooltip content={tooltip} />}
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

export const ContextWindowMetrics: React.FC = () => {
  const [sessions, setSessions] = useState<ContextMetrics[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  // Compaction metrics state
  const [compactionMetrics, setCompactionMetrics] = useState<CompactionMetrics | null>(null);
  const [compactionLoading, setCompactionLoading] = useState(true);
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('sessions');

  // Filters
  const [sortBy, setSortBy] = useState<'utilization' | 'total_tokens' | 'created_at'>('utilization');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [minUtilization, setMinUtilization] = useState<string>('');
  const [limit, setLimit] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  const [timeRange, setTimeRange] = useState('30d');

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        limit: limit.toString(),
        sortBy,
        sortOrder,
        ...(minUtilization && { minUtilization })
      });

      const response = await apiRequest(`/api/admin/context-metrics?${params}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch context metrics');
      }

      const data = await response.json();
      setSessions(data.sessions);
      setStatistics(data.statistics);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch context metrics');
    } finally {
      setLoading(false);
    }
  }, [limit, sortBy, sortOrder, minUtilization]);

  const fetchCompactionMetrics = useCallback(async () => {
    try {
      setCompactionLoading(true);
      setCompactionError(null);

      const response = await apiRequest('/api/admin/context-metrics/compaction');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch compaction metrics');
      }

      const data = await response.json();
      setCompactionMetrics(data);
    } catch (err: any) {
      setCompactionError(err.message || 'Failed to fetch compaction metrics');
    } finally {
      setCompactionLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    fetchCompactionMetrics();
  }, [fetchCompactionMetrics]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getUtilizationColor = (utilization: number | null): string => {
    if (!utilization) return 'text-text-secondary';
    if (utilization >= 90) return 'ap-text-error font-bold';
    if (utilization >= 70) return 'ap-text-warning font-semibold';
    if (utilization >= 50) return 'ap-text-warning';
    return 'ap-text-success';
  };

  const getUtilizationBadge = (utilization: number | null): string => {
    if (!utilization) return 'bg-surface-secondary text-text-secondary';
    if (utilization >= 90) return 'ap-bg-error/30 ap-text-error';
    if (utilization >= 70) return 'ap-bg-warning/30 ap-text-warning';
    if (utilization >= 50) return 'ap-bg-warning/30 ap-text-warning';
    return 'ap-bg-success/30 ap-text-success';
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat().format(num);
  };

  const fmtK = (num: number): string => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(num);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  const getLevelColor = (level: string): string => {
    switch (level.toLowerCase()) {
      case 'light': return 'ap-bg-success/30 ap-text-success';
      case 'medium': return 'ap-bg-warning/30 ap-text-warning';
      case 'aggressive': return 'ap-bg-error/30 ap-text-error';
      default: return 'bg-surface-secondary text-text-secondary';
    }
  };

  // ── Derived chart data ────────────────────────────────────────────────────

  /** Utilization histogram for the Sessions tab */
  const utilizationHistogram = useMemo(() => {
    if (!sessions.length) return [];
    const buckets = [
      { range: '0-20%', min: 0, max: 20, count: 0, fill: COLORS.success },
      { range: '20-40%', min: 20, max: 40, count: 0, fill: COLORS.success },
      { range: '40-60%', min: 40, max: 60, count: 0, fill: COLORS.indigo },
      { range: '60-80%', min: 60, max: 80, count: 0, fill: COLORS.amber },
      { range: '80-100%', min: 80, max: 100, count: 0, fill: COLORS.red },
    ];
    sessions.forEach((s) => {
      const pct = s.contextUtilizationPct ?? 0;
      const bucket = buckets.find((b) => pct >= b.min && pct < b.max) ?? buckets[buckets.length - 1];
      bucket.count++;
    });
    return buckets;
  }, [sessions]);

  /** Distribution data for the Compaction tab bar chart */
  const distributionChartData = useMemo(() => {
    if (!compactionMetrics) return [];
    const d = compactionMetrics.contextUsageDistribution;
    return [
      { range: '<50%', count: d.under50, fill: COLORS.success },
      { range: '50-70%', count: d.from50to70, fill: COLORS.success },
      { range: '70-85%', count: d.from70to85, fill: COLORS.amber },
      { range: '85-95%', count: d.from85to95, fill: COLORS.amber },
      { range: '>95%', count: d.over95, fill: COLORS.red },
    ];
  }, [compactionMetrics]);

  /** Compaction by Level pie data */
  const levelPieData = useMemo(() => {
    if (!compactionMetrics) return [];
    return [
      { name: 'Light', value: compactionMetrics.byLevel.light, fill: COLORS.success },
      { name: 'Medium', value: compactionMetrics.byLevel.medium, fill: COLORS.amber },
      { name: 'Aggressive', value: compactionMetrics.byLevel.aggressive, fill: COLORS.red },
    ].filter((d) => d.value > 0);
  }, [compactionMetrics]);

  /** Daily compaction data for AreaChart */
  const dailyChartData = useMemo(() => {
    if (!compactionMetrics) return [];
    return compactionMetrics.byDay.slice(-14).map((d) => ({
      date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      compactions: d.compactions,
      tokensFreed: d.tokensFreed,
    }));
  }, [compactionMetrics]);

  /** Filtered sessions for search */
  const filteredSessions = useMemo(() => {
    if (!searchTerm) return sessions;
    const lower = searchTerm.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title?.toLowerCase().includes(lower) ||
        s.userName?.toLowerCase().includes(lower) ||
        s.userEmail?.toLowerCase().includes(lower) ||
        s.model?.toLowerCase().includes(lower),
    );
  }, [sessions, searchTerm]);

  // ── Active session health pie data ────────────────────────────────────────
  const healthPieData = useMemo(() => {
    if (!compactionMetrics) return [];
    const a = compactionMetrics.activeSessions;
    return [
      { name: 'Healthy', value: a.healthy, fill: COLORS.success },
      { name: 'Approaching', value: a.approachingLimit, fill: COLORS.amber },
      { name: 'Needs Compaction', value: a.needsCompaction, fill: COLORS.red },
    ].filter((d) => d.value > 0);
  }, [compactionMetrics]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header + Filter Bar */}
      <div>
        <h2 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Context Window Metrics
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Monitor context window usage and compaction effectiveness across sessions
        </p>
        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          onRefresh={activeTab === 'sessions' ? fetchMetrics : fetchCompactionMetrics}
          refreshing={activeTab === 'sessions' ? loading : compactionLoading}
          extraFilters={
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-2 py-1.5 rounded-md text-xs"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
              >
                <option value="utilization">Sort: Utilization</option>
                <option value="total_tokens">Sort: Tokens</option>
                <option value="created_at">Sort: Date</option>
              </select>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
                className="px-2 py-1.5 rounded-md text-xs"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
              <select
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value))}
                className="px-2 py-1.5 rounded-md text-xs"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
              >
                <option value="25">25 rows</option>
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
                <option value="200">200 rows</option>
              </select>
            </div>
          }
        />
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 rounded-lg p-1" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'sessions'
              ? 'text-white'
              : ''
          }`}
          style={activeTab === 'sessions'
            ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
            : { color: 'var(--text-secondary)' }
          }
        >
          Session Metrics
        </button>
        <button
          onClick={() => setActiveTab('compaction')}
          className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'compaction'
              ? 'text-white'
              : ''
          }`}
          style={activeTab === 'compaction'
            ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
            : { color: 'var(--text-secondary)' }
          }
        >
          Compaction Metrics
        </button>
      </div>

      {/* ═══════════════════ Sessions Tab ═══════════════════ */}
      {activeTab === 'sessions' && (
        <>
          {/* Summary Metric Cards */}
          {statistics && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <AdminMetricCard
                label="Average Utilization"
                value={`${Math.min(100, Math.max(0, statistics.averageUtilization)).toFixed(1)}%`}
                tooltip="Mean context window usage across all tracked sessions"
                subtext={statistics.averageUtilization >= 70 ? 'High average - consider compaction tuning' : 'Within healthy range'}
              />
              <AdminMetricCard
                label="Peak Utilization"
                value={`${Math.min(100, Math.max(0, statistics.maxUtilization)).toFixed(1)}%`}
                tooltip="Highest single-session context window usage"
                subtext={statistics.maxUtilization >= 90 ? 'Near capacity detected' : undefined}
              />
              <AdminMetricCard
                label="Total Sessions"
                value={formatNumber(statistics.totalSessions)}
                tooltip="Number of sessions with context tracking data"
              />
              <AdminMetricCard
                label="High Utilization (>=80%)"
                value={formatNumber(statistics.highUtilizationSessions)}
                tooltip="Sessions using 80% or more of their context window"
                subtext={statistics.totalSessions > 0
                  ? `${((statistics.highUtilizationSessions / statistics.totalSessions) * 100).toFixed(1)}% of sessions`
                  : undefined}
              />
            </div>
          )}

          {/* Utilization Histogram Chart */}
          {!loading && !error && utilizationHistogram.length > 0 && (
            <AdminCard padding="lg">
              <SectionHead
                title="Utilization Distribution"
                tooltip="How sessions are distributed across context window usage buckets"
              />
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={utilizationHistogram} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="range" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <RechartsTooltip content={<ChartTip vFmt={(v) => `${v} sessions`} />} />
                    <Bar dataKey="count" name="Sessions" radius={[4, 4, 0, 0]}>
                      {utilizationHistogram.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AdminCard>
          )}

          {/* Loading/Error States */}
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
              <p className="mt-4" style={{ color: 'var(--text-secondary)' }}>Loading context window metrics...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg p-4" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid var(--color-error)', color: 'var(--color-error)' }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Sessions Table */}
          {!loading && !error && filteredSessions.length > 0 && (
            <AdminCard padding="lg" className="!p-0 overflow-hidden">
              <table className="min-w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Session
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Model
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Messages
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Input Tokens
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Output Tokens
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Total Tokens
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Window Size
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Utilization %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.map((session) => (
                    <tr
                      key={session.id}
                      className="hover:opacity-80 cursor-pointer transition-colors"
                      style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}
                      onClick={() => setSelectedSession(session.id)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium truncate max-w-xs" style={{ color: 'var(--text-primary)' }}>
                          {session.title}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(session.createdAt)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{session.userName}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{session.userEmail}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)' }}>
                        {session.model}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right" style={{ color: 'var(--text-primary)' }}>
                        {session.messageCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right" style={{ color: 'var(--text-secondary)' }}>
                        {formatNumber(session.contextTokensInput)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right" style={{ color: 'var(--text-secondary)' }}>
                        {formatNumber(session.contextTokensOutput)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-right" style={{ color: 'var(--text-primary)' }}>
                        {formatNumber(session.contextTokensTotal)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right" style={{ color: 'var(--text-secondary)' }}>
                        {session.contextWindowSize ? formatNumber(session.contextWindowSize) : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {session.contextUtilizationPct !== null ? (
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getUtilizationBadge(
                              session.contextUtilizationPct
                            )}`}
                          >
                            {session.contextUtilizationPct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>N/A</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminCard>
          )}

          {!loading && !error && filteredSessions.length === 0 && (
            <AdminCard padding="lg" className="text-center py-12">
              <p style={{ color: 'var(--text-secondary)' }}>No sessions found with the current filters.</p>
            </AdminCard>
          )}
        </>
      )}

      {/* ═══════════════════ Compaction Tab ═══════════════════ */}
      {activeTab === 'compaction' && (
        <>
          {/* Loading State */}
          {compactionLoading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
              <p className="mt-4" style={{ color: 'var(--text-secondary)' }}>Loading compaction metrics...</p>
            </div>
          )}

          {/* Error State */}
          {compactionError && (
            <div className="rounded-lg p-4" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid var(--color-error)', color: 'var(--color-error)' }}>
              <strong>Error:</strong> {compactionError}
            </div>
          )}

          {/* Compaction Metrics Content */}
          {!compactionLoading && !compactionError && compactionMetrics && (
            <>
              {/* Summary Metric Cards */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <AdminMetricCard
                  label="Total Compactions"
                  value={formatNumber(compactionMetrics.summary.totalCompactions)}
                  tooltip="Total number of context compaction operations performed"
                />
                <AdminMetricCard
                  label="Tokens Freed"
                  value={fmtK(compactionMetrics.summary.totalTokensFreed)}
                  tooltip="Total tokens reclaimed across all compactions"
                  subtext={`${formatNumber(compactionMetrics.summary.totalTokensFreed)} exact`}
                />
                <AdminMetricCard
                  label="Messages Removed"
                  value={formatNumber(compactionMetrics.summary.totalMessagesRemoved)}
                  tooltip="Total messages pruned during compaction"
                />
                <AdminMetricCard
                  label="Messages Summarized"
                  value={formatNumber(compactionMetrics.summary.totalMessagesSummarized)}
                  tooltip="Messages condensed into summaries instead of removed"
                />
                <AdminMetricCard
                  label="Avg Tokens/Compaction"
                  value={fmtK(Math.round(compactionMetrics.summary.avgTokensFreedPerCompaction))}
                  tooltip="Average tokens freed per compaction event"
                />
              </div>

              {/* Two Column Layout: Health Pie + Level Pie */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Active Session Health */}
                <AdminCard padding="lg">
                  <SectionHead title="Active Session Health" tooltip="Current health status of sessions with context tracking" />
                  <div className="flex items-center gap-6">
                    {/* Pie chart */}
                    {healthPieData.length > 0 && (
                      <div style={{ width: 140, height: 140, flexShrink: 0 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={healthPieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={36}
                              outerRadius={60}
                              strokeWidth={0}
                            >
                              {healthPieData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.fill} />
                              ))}
                            </Pie>
                            <RechartsTooltip content={<ChartTip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {/* Legend / numbers */}
                    <div className="space-y-3 flex-1">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.success }} /> Total Active
                        </span>
                        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                          {formatNumber(compactionMetrics.activeSessions.total)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.success }} /> Healthy (&lt;70%)
                        </span>
                        <span className="text-xl font-bold" style={{ color: COLORS.success }}>
                          {formatNumber(compactionMetrics.activeSessions.healthy)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.amber }} /> Approaching (70-85%)
                        </span>
                        <span className="text-xl font-bold" style={{ color: COLORS.amber }}>
                          {formatNumber(compactionMetrics.activeSessions.approachingLimit)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.red }} /> Needs Compaction (&gt;85%)
                        </span>
                        <span className="text-xl font-bold" style={{ color: COLORS.red }}>
                          {formatNumber(compactionMetrics.activeSessions.needsCompaction)}
                        </span>
                      </div>
                    </div>
                  </div>
                </AdminCard>

                {/* Compaction by Level */}
                <AdminCard padding="lg">
                  <SectionHead title="Compaction by Level" tooltip="Breakdown of compaction operations by severity level" />
                  <div className="flex items-center gap-6">
                    {/* Pie chart */}
                    {levelPieData.length > 0 && (
                      <div style={{ width: 140, height: 140, flexShrink: 0 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={levelPieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={36}
                              outerRadius={60}
                              strokeWidth={0}
                            >
                              {levelPieData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.fill} />
                              ))}
                            </Pie>
                            <RechartsTooltip content={<ChartTip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {/* Legend / numbers */}
                    <div className="space-y-3 flex-1">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.success }} /> Light
                        </span>
                        <span className="text-xl font-bold" style={{ color: COLORS.success }}>
                          {formatNumber(compactionMetrics.byLevel.light)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.amber }} /> Medium
                        </span>
                        <span className="text-xl font-bold" style={{ color: COLORS.amber }}>
                          {formatNumber(compactionMetrics.byLevel.medium)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.red }} /> Aggressive
                        </span>
                        <span className="text-xl font-bold" style={{ color: COLORS.red }}>
                          {formatNumber(compactionMetrics.byLevel.aggressive)}
                        </span>
                      </div>
                    </div>
                  </div>
                </AdminCard>
              </div>

              {/* Context Usage Distribution - BarChart */}
              <AdminCard padding="lg">
                <SectionHead
                  title="Context Usage Distribution"
                  tooltip="How active sessions are distributed across utilization buckets"
                />
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={distributionChartData} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="range" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <RechartsTooltip content={<ChartTip vFmt={(v) => `${v} sessions`} />} />
                      <Bar dataKey="count" name="Sessions" radius={[4, 4, 0, 0]}>
                        {distributionChartData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </AdminCard>

              {/* Compaction Trend AreaChart */}
              {dailyChartData.length > 0 && (
                <AdminCard padding="lg">
                  <SectionHead title="Compaction Trend (Last 14 Days)" tooltip="Daily compaction count and tokens freed over time" />
                  <div style={{ width: '100%', height: 280 }}>
                    <ResponsiveContainer>
                      <AreaChart data={dailyChartData}>
                        <defs>
                          <linearGradient id="gradCompactions" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLORS.indigo} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={COLORS.indigo} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLORS.purple} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={COLORS.purple} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis
                          yAxisId="left"
                          allowDecimals={false}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          label={{ value: 'Compactions', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tickFormatter={fmtK}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          label={{ value: 'Tokens Freed', angle: 90, position: 'insideRight', style: { fill: 'var(--text-tertiary)', fontSize: 11 } }}
                        />
                        <RechartsTooltip content={<ChartTip vFmt={fmtK} />} />
                        <Area yAxisId="left" type="monotone" dataKey="compactions" name="Compactions" stroke={COLORS.indigo} fill="url(#gradCompactions)" strokeWidth={2} />
                        <Area yAxisId="right" type="monotone" dataKey="tokensFreed" name="Tokens Freed" stroke={COLORS.purple} fill="url(#gradTokens)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </AdminCard>
              )}

              {/* Recent Compactions Table */}
              {compactionMetrics.recentCompactions.length > 0 && (
                <AdminCard padding="lg" className="!p-0 overflow-hidden">
                  <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <SectionHead title="Recent Compactions" tooltip="Most recent compaction events across all sessions" />
                  </div>
                  <table className="min-w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                          Session ID
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                          Level
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                          Tokens Freed
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                          Messages Removed
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                          Timestamp
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {compactionMetrics.recentCompactions.map((compaction, idx) => (
                        <tr
                          key={`${compaction.sessionId}-${idx}`}
                          className="hover:opacity-80 transition-colors"
                          style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                              {compaction.sessionId.slice(0, 8)}...
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getLevelColor(compaction.level)}`}>
                              {compaction.level}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium" style={{ color: COLORS.success }}>
                            +{formatNumber(compaction.tokensFreed)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right" style={{ color: 'var(--text-secondary)' }}>
                            {compaction.messagesRemoved}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right" style={{ color: 'var(--text-secondary)' }}>
                            {formatDate(compaction.timestamp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminCard>
              )}
            </>
          )}

          {!compactionLoading && !compactionError && !compactionMetrics && (
            <AdminCard padding="lg" className="text-center py-12">
              <p style={{ color: 'var(--text-secondary)' }}>No compaction data available.</p>
            </AdminCard>
          )}
        </>
      )}
    </div>
  );
};

export default ContextWindowMetrics;
