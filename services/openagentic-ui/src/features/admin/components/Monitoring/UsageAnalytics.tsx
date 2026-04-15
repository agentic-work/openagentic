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
 * Usage Analytics - GCP Cloud Monitoring-style Dashboard
 *
 * Comprehensive usage tracking: sessions, tokens, cost, tool calls, per-user breakdown.
 * Uses Recharts for time series and shared admin design system components.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, MessageSquare, ChevronDown, ChevronUp, Key,
  Image, FileText, Wrench, Eye, Code
} from '@/shared/icons';
import {
  Activity, TrendingUp, Zap, DollarSign, Database,
  AlertCircle as AlertTriangle, CheckCircle, Timer as Clock, Cpu, Server
} from '../Shared/AdminIcons';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminCard } from '../Shared/AdminCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { AdminStatusBadge } from '../Shared/AdminStatusBadge';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { CHART_COLORS } from '../Shared/chartColors';
import { apiRequest } from '@/utils/api';

// ── Interfaces ────────────────────────────────────────────────────────

interface UsageAnalyticsProps { theme: string }

interface UserUsageData {
  userId: string; userName: string; userEmail: string;
  totalSessions: number; totalMessages: number;
  tokensInput: number; tokensOutput: number; totalTokens: number;
  estimatedCost: number; apiCalls: number; mcpToolCalls: number;
  imagesGenerated: number; filesCreated: number;
  avgResponseTime: number; visionModelUsage: number;
  errorRate: number; cacheHitRate: number;
  apiKeyUsage: { keyName: string; callCount: number; lastUsed: string }[];
  endpointBreakdown: { endpoint: string; count: number }[];
  models: { modelName: string; count: number; tokens: number; cost: number }[];
  lastActive: string;
}

interface AggregateStats {
  totalUsers: number; totalSessions: number; totalMessages: number;
  totalTokens: number; totalCost: number;
  tokensInput: number; tokensOutput: number;
  totalApiCalls: number; totalMcpToolCalls: number;
  totalImagesGenerated: number; totalFilesCreated: number;
  avgResponseTime: number; totalVisionUsage: number;
  totalErrorRate: number; totalSuccessRate: number;
  cacheHitRate: number; avgTokensPerSecond: number;
  p95Latency: number; p99Latency: number;
  totalToolCalls: number; uniqueMcpTools: number;
}

interface TimeSeriesData {
  date: string; requests: number; tokens: number;
  cost: number; errors: number; avgLatency: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const TIME_RANGES = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
];

const SORT_OPTIONS = ['tokens', 'cost', 'messages', 'sessions', 'errors'] as const;
type SortKey = typeof SORT_OPTIONS[number];

// ── Helpers ───────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtK = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};
const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtDate = (s: string) => s ? s.split('-').slice(1).join('/') : '';

// ── Chart tooltip ─────────────────────────────────────────────────────

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

const SectionHead: React.FC<{ icon: React.ReactNode; title: string; tip?: string; extra?: React.ReactNode }> = ({ icon, title, tip, extra }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tip && <InfoTooltip content={tip} />}
    {extra && <div className="ml-auto">{extra}</div>}
  </div>
);

// ── Small stat cell ───────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: string | number; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="rounded p-2" style={{ backgroundColor: warn ? 'color-mix(in srgb, var(--color-error) 8%, var(--color-surfaceSecondary))' : 'var(--color-surfaceSecondary)' }}>
    <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
    <div className="text-sm font-bold" style={{ color: warn ? 'var(--color-error)' : 'var(--text-primary)' }}>{value}</div>
  </div>
);

// ══════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════

const UsageAnalytics: React.FC<UsageAnalyticsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [userUsage, setUserUsage] = useState<UserUsageData[]>([]);
  const [aggregateStats, setAggregateStats] = useState<AggregateStats | null>(null);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('7d');
  const [sortBy, setSortBy] = useState<SortKey>('tokens');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiRequest(`/admin/analytics/usage?timeRange=${timeRange}`);
      if (res.ok) {
        const data = await res.json();
        setUserUsage(data.users || []);
        setAggregateStats(data.aggregate || null);
        setTimeSeriesData(data.timeSeries || []);
      }
    } catch (e) {
      console.error('Failed to fetch usage analytics:', e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Sort + filter users
  const users = [...userUsage]
    .filter((u) => !searchTerm || u.userName.toLowerCase().includes(searchTerm.toLowerCase()) || u.userEmail.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      const map: Record<SortKey, (u: UserUsageData) => number> = {
        tokens: (u) => u.totalTokens,
        cost: (u) => u.estimatedCost,
        messages: (u) => u.totalMessages,
        sessions: (u) => u.totalSessions,
        errors: (u) => u.errorRate,
      };
      return map[sortBy](b) - map[sortBy](a);
    });

  // Chart-ready time series
  const chartData = timeSeriesData.map((d) => ({ ...d, label: fmtDate(d.date) }));

  // ── Loading ───────────────────────────────────────────────────────

  if (loading && !aggregateStats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Usage Analytics</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Platform-wide usage, cost, and performance tracking
          </p>
        </div>
        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          timeRangeOptions={TIME_RANGES}
          onRefresh={fetchData}
          refreshing={loading}
        />
      </div>

      {/* ── Primary KPI cards ──────────────────────────────────── */}
      {aggregateStats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <AdminMetricCard label="Active Users" value={fmt(aggregateStats.totalUsers)} icon={<Users size={16} />} tooltip="Unique users in the selected time window" />
          <AdminMetricCard label="Messages" value={fmtK(aggregateStats.totalMessages)} subtext={`${fmt(aggregateStats.totalSessions)} sessions`} icon={<MessageSquare size={16} />} tooltip="Total chat messages sent" />
          <AdminMetricCard label="API Calls" value={fmtK(aggregateStats.totalApiCalls)} subtext={`${(aggregateStats.avgResponseTime || 0).toFixed(0)}ms avg`} icon={<Activity size={16} />} tooltip="Total LLM API calls" />
          <AdminMetricCard label="Tokens" value={fmtK(aggregateStats.totalTokens)} subtext={`${fmtK(aggregateStats.tokensInput)} in / ${fmtK(aggregateStats.tokensOutput)} out`} icon={<Zap size={16} />} tooltip="Total prompt + completion tokens" />
          <AdminMetricCard label="Total Cost" value={fmtUsd(aggregateStats.totalCost)} icon={<DollarSign size={16} />} tooltip="Estimated total cost across all providers" />
          <AdminMetricCard
            label="Success Rate"
            value={fmtPct(aggregateStats.totalSuccessRate)}
            subtext={`${fmtPct(aggregateStats.totalErrorRate)} errors`}
            icon={aggregateStats.totalErrorRate > 5 ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
            tooltip="Percentage of successful (non-error) requests"
          />
        </div>
      )}

      {/* ── Secondary KPIs ─────────────────────────────────────── */}
      {aggregateStats && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <AdminMetricCard label="MCP Tools" value={fmtK(aggregateStats.totalMcpToolCalls)} subtext={`${aggregateStats.uniqueMcpTools} unique`} icon={<Wrench size={16} />} tooltip="Total MCP tool invocations" />
          <AdminMetricCard label="Images" value={fmt(aggregateStats.totalImagesGenerated)} icon={<Image size={16} />} tooltip="Images generated via Bedrock Nova Canvas" />
          <AdminMetricCard label="Files" value={fmt(aggregateStats.totalFilesCreated)} icon={<FileText size={16} />} tooltip="Files created in Code Mode" />
          <AdminMetricCard label="Vision" value={fmt(aggregateStats.totalVisionUsage || 0)} icon={<Eye size={16} />} tooltip="Vision model requests (image analysis)" />
          <AdminMetricCard label="P95 Latency" value={`${aggregateStats.p95Latency.toFixed(0)}ms`} subtext={`P99: ${aggregateStats.p99Latency.toFixed(0)}ms`} icon={<Clock size={16} />} tooltip="95th percentile response latency" />
          <AdminMetricCard label="Cache Hit" value={fmtPct(aggregateStats.cacheHitRate)} icon={<Database size={16} />} tooltip="Tool result cache hit rate" />
          <AdminMetricCard label="Tok/sec" value={aggregateStats.avgTokensPerSecond.toFixed(1)} icon={<Cpu size={16} />} tooltip="Average output generation speed" />
        </div>
      )}

      {/* ── Time Series Charts ─────────────────────────────────── */}
      {chartData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Requests + Errors */}
          <AdminCard>
            <SectionHead icon={<Activity size={16} />} title="Requests & Errors" tip="Daily request volume with error overlay" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <RechartsTooltip content={<ChartTip vFmt={fmt} />} />
                  <Bar dataKey="requests" name="Requests" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="errors" name="Errors" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Tokens + Cost */}
          <AdminCard>
            <SectionHead icon={<Zap size={16} />} title="Tokens & Cost" tip="Daily token consumption with cost overlay" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="usageTokenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis yAxisId="tokens" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={fmtK} />
                  <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `$${v}`} />
                  <RechartsTooltip content={<ChartTip vFmt={(v) => String(v)} />} />
                  <Area yAxisId="tokens" type="monotone" dataKey="tokens" name="Tokens" stroke="#f59e0b" fill="url(#usageTokenGrad)" strokeWidth={2} />
                  <Area yAxisId="cost" type="monotone" dataKey="cost" name="Cost ($)" stroke="#00D26A" fill="none" strokeWidth={2} strokeDasharray="5 3" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Latency */}
          <AdminCard className="lg:col-span-2">
            <SectionHead icon={<Clock size={16} />} title="Average Latency" tip="Daily average response latency" />
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                  <RechartsTooltip content={<ChartTip vFmt={(v) => `${v.toFixed(0)}ms`} />} />
                  <Area type="monotone" dataKey="avgLatency" name="Avg Latency" stroke="#06b6d4" fill="url(#latGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Sort Controls ──────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Sort by:</span>
          <div className="flex items-center rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => setSortBy(opt)}
                className="px-2.5 py-1 text-xs font-medium capitalize transition-colors"
                style={{
                  backgroundColor: sortBy === opt ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: sortBy === opt ? '#fff' : 'var(--text-secondary)',
                  borderRight: '1px solid var(--color-border)',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{users.length} users</span>
      </div>

      {/* ── Per-User Cards ─────────────────────────────────────── */}
      {users.length === 0 ? (
        <AdminCard className="text-center py-12">
          <Activity size={40} style={{ color: 'var(--text-tertiary)', margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--text-secondary)' }}>No usage data for the selected time range</p>
        </AdminCard>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const expanded = expandedUserId === u.userId;
            return (
              <AdminCard key={u.userId} className="hover:shadow-md transition-shadow">
                {/* User header */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)' }}
                  >
                    <Users size={14} style={{ color: 'var(--color-primary)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{u.userName}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{u.userEmail}</div>
                  </div>
                  <button
                    onClick={() => setExpandedUserId(expanded ? null : u.userId)}
                    className="p-1.5 rounded-md transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {/* Quick stats grid */}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-1.5">
                  <Stat label="Sessions" value={fmt(u.totalSessions)} />
                  <Stat label="Messages" value={fmt(u.totalMessages)} />
                  <Stat label="API Calls" value={fmt(u.apiCalls || 0)} />
                  <Stat label="MCP Tools" value={fmt(u.mcpToolCalls || 0)} />
                  <Stat label="Tokens" value={fmtK(u.totalTokens)} />
                  <Stat label="Images" value={fmt(u.imagesGenerated || 0)} />
                  <Stat label="Files" value={fmt(u.filesCreated || 0)} />
                  <Stat label="Vision" value={fmt(u.visionModelUsage || 0)} />
                  <Stat label="Cost" value={fmtUsd(u.estimatedCost)} />
                  <Stat label="Latency" value={`${(u.avgResponseTime || 0).toFixed(0)}ms`} />
                  <Stat label="Error" value={fmtPct(u.errorRate)} warn={u.errorRate > 5} />
                  <Stat label="Cache" value={fmtPct(u.cacheHitRate)} />
                </div>

                {/* Expanded details */}
                {expanded && (
                  <div className="mt-4 pt-4 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                    {/* Token breakdown */}
                    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Token Breakdown</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Input</div>
                          <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(u.tokensInput)}</div>
                        </div>
                        <div>
                          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Output</div>
                          <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(u.tokensOutput)}</div>
                        </div>
                        <div>
                          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Total</div>
                          <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(u.totalTokens)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Model usage */}
                    {u.models?.length > 0 && (
                      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Model Usage</div>
                        <div className="space-y-1">
                          {u.models.map((m, i) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded text-xs" style={{ backgroundColor: 'var(--color-surface)' }}>
                              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{m.modelName}</span>
                              <div className="flex items-center gap-3">
                                <span style={{ color: 'var(--text-secondary)' }}>{fmt(m.count)} uses</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{fmtK(m.tokens)} tok</span>
                                <span className="font-medium" style={{ color: 'var(--color-success)' }}>{fmtUsd(m.cost)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* API Key usage */}
                    {u.apiKeyUsage?.length > 0 && (
                      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                          <Key size={12} /> API Key Usage
                        </div>
                        <div className="space-y-1">
                          {u.apiKeyUsage.map((k, i) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded text-xs" style={{ backgroundColor: 'var(--color-surface)' }}>
                              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{k.keyName}</span>
                              <div className="flex items-center gap-3">
                                <span style={{ color: 'var(--text-secondary)' }}>{fmt(k.callCount)} calls</span>
                                <span style={{ color: 'var(--text-tertiary)' }}>Last: {new Date(k.lastUsed).toLocaleDateString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Endpoint breakdown */}
                    {u.endpointBreakdown?.length > 0 && (
                      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                          <Server size={12} /> Endpoint Breakdown
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {u.endpointBreakdown.map((ep, i) => (
                            <div key={i} className="p-2 rounded text-xs" style={{ backgroundColor: 'var(--color-surface)' }}>
                              <div style={{ color: 'var(--text-tertiary)' }}>{ep.endpoint}</div>
                              <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(ep.count)} calls</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </AdminCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UsageAnalytics;
