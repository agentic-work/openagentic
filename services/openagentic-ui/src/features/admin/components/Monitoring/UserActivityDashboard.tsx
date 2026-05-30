/**
 * User Activity Dashboard - GCP Cloud Monitoring-style
 *
 * Live presence monitoring, per-user resource usage, cost-by-provider chart,
 * and activity trend. Uses Recharts and shared admin design system components.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Users, Search, RefreshCw, X, Activity, DollarSign, MessageSquare
} from '@/shared/icons';
import {
  User, AlertTriangle, Cpu
} from '../Shared/AdminIcons';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { parseNDJSONStream } from '@/utils/ndjsonStream';
import { AdminCard } from '../Shared/AdminCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { CHART_COLORS } from '../Shared/chartColors';
import { apiRequest } from '@/utils/api';
import SlideInPanel, {
  SlideInPanelSection,
} from '@/shared/components/SlideInPanel';
import { PageHeader, LogRow } from '../../primitives-v2';

// ── Interfaces ────────────────────────────────────────────────────────

interface ActivitySummary {
  onlineCount: number;
  activeChatSessions: number;
  activeCodeSessions: number;
  totalUsers: number;
  newUsersToday: number;
  todayTokens: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
    requestCount: number;
    byProvider: { provider: string; totalTokens: number; totalCost: number; requestCount: number }[];
  };
  topUsers: { userId: string; email: string; name: string | null; isAdmin: boolean; totalTokens: number; totalCost: number; requestCount: number }[];
}

interface LiveUser {
  userId: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  avatarUrl?: string | null;
  lastAccessed: string;
  sessionCount: number;
  activityType: string;
  activeChatSessions?: { id: string; title: string; model: string; updatedAt: string }[];
  codeMode?: { status: string; podName: string; lastAccessed: string | null } | null;
}

interface UserUsageDetail {
  user: { id: string; email: string; name: string | null; isAdmin: boolean; codeEnabled: boolean };
  tokenUsage: { totalTokens: number; totalCost: number; byProvider: { provider: string; totalTokens: number; totalCost: number }[]; byModel: { model: string; totalTokens: number; totalCost: number }[] };
  chatSessions: { totalSessions: number; totalMessages: number; totalTokens: number; totalCost: number; recent: { id: string; title: string; model: string; messageCount: number; totalCost: number; isActive: boolean; updatedAt: string }[] };
  queryAudit: { recent: { id: string; queryType: string; intent: string; mcpServer: string | null; modelUsed: string; success: boolean; responseTimeMs: number; createdAt: string }[] };
  codeMode: { status: string; podName: string; storageUsedMb: number; storageQuotaMb: number } | null;
}

// ── Constants ─────────────────────────────────────────────────────────

const TIME_RANGES = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
];

// ── Helpers ───────────────────────────────────────────────────────────

const formatCost = (cost: number) => `$${cost.toFixed(4)}`;
const formatTokens = (tokens: number) =>
  tokens >= 1000000
    ? `${(tokens / 1000000).toFixed(1)}M`
    : tokens >= 1000
      ? `${(tokens / 1000).toFixed(1)}K`
      : String(tokens);

// ── Reusable sub-components (match admin view pattern) ───────────────

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

// ── Main Component ───────────────────────────────────────────────────

const UserActivityDashboard: React.FC<{ theme?: string }> = () => {
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [liveUsers, setLiveUsers] = useState<LiveUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [timeRange, setTimeRange] = useState('24h');

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userUsage, setUserUsage] = useState<UserUsageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, liveRes] = await Promise.all([
        apiRequest('/admin/user-activity/summary'),
        apiRequest('/admin/user-activity/live'),
      ]);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        setLiveUsers(liveData.users || []);
      }
      if (!summaryRes.ok && !liveRes.ok) {
        setError('User activity endpoints returned errors. Check API logs.');
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch user activity:', err);
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // v0.6.7: NDJSON stream via shared parser. Falls back to polling on error.
  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    let pollFallback: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const streamUrl = token
          ? `/api/admin/user-activity/stream?token=${encodeURIComponent(token)}`
          : '/api/admin/user-activity/stream';
        const resp = await fetch(streamUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/x-ndjson' },
          credentials: 'include',
          signal: abort.signal,
        });
        for await (const event of parseNDJSONStream<{ type: string; users?: unknown[] }>(resp)) {
          if (event.type === 'presence_update' && Array.isArray(event.users)) {
            setLiveUsers(event.users as typeof liveUsers);
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.warn('[UserActivity] NDJSON stream failed — falling back to polling', err);
        pollFallback = setInterval(fetchData, 15000);
      }
    })();

    return () => {
      abort.abort();
      if (pollFallback) clearInterval(pollFallback);
    };
  }, [fetchData]);

  const handleUserClick = async (userId: string) => {
    setSelectedUserId(userId);
    setShowDetail(true);
    setDetailLoading(true);
    try {
      const res = await apiRequest(`/admin/user-activity/${userId}/usage`);
      if (res.ok) {
        const data = await res.json();
        setUserUsage(data);
      }
    } catch (err) {
      console.error('Failed to fetch user usage:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const getStatusColor = (activityType: string) => {
    switch (activityType) {
      case 'chatting': return 'var(--color-success, var(--color-success))';
      case 'code_mode': return 'var(--color-primary)';
      case 'browsing': return 'var(--color-warning)';
      default: return 'var(--color-text-secondary)';
    }
  };

  const getActivityLabel = (activityType: string) => {
    switch (activityType) {
      case 'chatting': return 'Chatting';
      case 'code_mode': return 'Code Mode';
      case 'browsing': return 'Browsing';
      default: return 'Idle';
    }
  };

  const filteredUsers = liveUsers.filter(u => {
    if (!searchTerm) return true;
    return u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.name?.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // ── Chart data derived from summary ─────────────────────────────────

  const providerChartData = useMemo(() => {
    if (!summary?.todayTokens?.byProvider) return [];
    return summary.todayTokens.byProvider.map(p => ({
      name: p.provider,
      cost: parseFloat(p.totalCost.toFixed(4)),
      tokens: p.totalTokens,
      requests: p.requestCount,
    }));
  }, [summary]);

  // Synthesise an activity-type breakdown for the area chart from live users
  const activityTrendData = useMemo(() => {
    if (!filteredUsers.length) return [];
    const counts: Record<string, number> = { chatting: 0, code_mode: 0, browsing: 0, idle: 0 };
    filteredUsers.forEach(u => {
      const key = counts[u.activityType] !== undefined ? u.activityType : 'idle';
      counts[key] = (counts[key] || 0) + 1;
    });
    // Return as single-point snapshot (area chart needs at least one entry)
    return [
      { label: 'Now', chatting: counts.chatting, code_mode: counts.code_mode, browsing: counts.browsing, idle: counts.idle },
    ];
  }, [filteredUsers]);

  // ── Loading state ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)' }} />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Monitoring', 'User Activity']}
        title="User Activity"
        explainer="Live presence monitoring, per-user resource usage, cost-by-provider breakdown, and an activity-trend snapshot. Click a user for the full usage panel."
        actions={[
          { label: 'Refresh', onClick: fetchData, primary: true, disabled: loading },
        ]}
        sticky
      />

      {/* Filter bar */}
      <AdminFilterBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        timeRangeOptions={TIME_RANGES}
        onRefresh={fetchData}
        refreshing={loading}
      />

      {error && (
        <div className="p-4 rounded-lg" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" style={{ color: 'rgb(239,68,68)' }} />
            <span style={{ color: 'rgb(248,113,113)' }}>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto p-1 rounded" style={{ color: 'rgb(248,113,113)' }}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Summary Metric Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <AdminMetricCard
            label="Online Now"
            value={summary.onlineCount}
            icon={<Users className="h-5 w-5" />}
            tooltip="Users currently connected to the platform"
            subtext={`${summary.totalUsers} total users`}
          />
          <AdminMetricCard
            label="Active Chats"
            value={summary.activeChatSessions}
            icon={<MessageSquare className="h-5 w-5" />}
            tooltip="Open chat sessions with recent activity"
          />
          <AdminMetricCard
            label="Code Sessions"
            value={summary.activeCodeSessions}
            icon={<Cpu className="h-5 w-5" />}
            tooltip="Running code-mode pods"
          />
          <AdminMetricCard
            label="Tokens Today"
            value={formatTokens(summary.todayTokens?.totalTokens || 0)}
            icon={<Activity className="h-5 w-5" />}
            tooltip="Total prompt + completion tokens consumed today"
            subtext={`${summary.todayTokens?.requestCount || 0} requests`}
          />
          <AdminMetricCard
            label="Cost Today"
            value={formatCost(summary.todayTokens?.totalCost || 0)}
            icon={<DollarSign className="h-5 w-5" />}
            tooltip="Estimated LLM spend today across all providers"
          />
        </div>
      )}

      {/* Charts row: Cost by Provider + Activity Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost by Provider - Bar Chart */}
        {providerChartData.length > 0 && (
          <AdminCard>
            <SectionHead
              icon={<DollarSign className="h-5 w-5" />}
              title="Cost by Provider"
              tip="Today's estimated cost broken down by LLM provider"
            />
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={providerChartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} />
                  <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} tickFormatter={(v: number) => `$${v}`} />
                  <RechartsTooltip content={<ChartTip vFmt={(v: number) => formatCost(v)} />} />
                  <Bar dataKey="cost" name="Cost" radius={[4, 4, 0, 0]}>
                    {providerChartData.map((_entry, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Provider detail pills below chart */}
            <div className="flex flex-wrap gap-2 mt-3">
              {summary?.todayTokens?.byProvider?.map((p, idx) => (
                <span key={p.provider} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs" style={{ backgroundColor: `color-mix(in srgb, ${CHART_COLORS[idx % CHART_COLORS.length]} 12%, transparent)`, color: CHART_COLORS[idx % CHART_COLORS.length] }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                  {p.provider}: {formatTokens(p.totalTokens)} tok / {p.requestCount} req
                </span>
              ))}
            </div>
          </AdminCard>
        )}

        {/* Activity Breakdown - Area Chart */}
        {activityTrendData.length > 0 && (
          <AdminCard>
            <SectionHead
              icon={<Activity className="h-5 w-5" />}
              title="Activity Breakdown"
              tip="Current distribution of user activity types"
            />
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={activityTrendData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} />
                  <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={{ stroke: 'var(--color-border)' }} allowDecimals={false} />
                  <RechartsTooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="chatting" name="Chatting" stackId="1" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.3} />
                  <Area type="monotone" dataKey="code_mode" name="Code Mode" stackId="1" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.3} />
                  <Area type="monotone" dataKey="browsing" name="Browsing" stackId="1" stroke={CHART_COLORS[2]} fill={CHART_COLORS[2]} fillOpacity={0.3} />
                  <Area type="monotone" dataKey="idle" name="Idle" stackId="1" stroke={CHART_COLORS[4]} fill={CHART_COLORS[4]} fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { key: 'chatting', label: 'Chatting', color: CHART_COLORS[1] },
                { key: 'code_mode', label: 'Code Mode', color: CHART_COLORS[0] },
                { key: 'browsing', label: 'Browsing', color: CHART_COLORS[2] },
                { key: 'idle', label: 'Idle', color: CHART_COLORS[4] },
              ].map(item => (
                <span key={item.key} className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}: {activityTrendData[0]?.[item.key as keyof typeof activityTrendData[0]] ?? 0}
                </span>
              ))}
            </div>
          </AdminCard>
        )}
      </div>

      {/* Live Presence Grid */}
      <AdminCard>
        <SectionHead
          icon={<Activity className="h-5 w-5" />}
          title={`Live Presence (${filteredUsers.length})`}
          tip="Real-time view of connected users and their current activity"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredUsers.length === 0 ? (
            <div className="col-span-full text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No active users at the moment.</p>
            </div>
          ) : (
            filteredUsers.map(user => (
              <button
                key={user.userId}
                onClick={() => handleUserClick(user.userId)}
                className="text-left p-3 rounded-lg transition-all hover:scale-[1.02]"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary, var(--color-bg-surface))',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-medium" style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--color-primary)' }}>
                      {(user.name || user.email || '?')[0].toUpperCase()}
                    </div>
                    <div
                      className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2"
                      style={{ backgroundColor: getStatusColor(user.activityType), borderColor: 'var(--color-surface, var(--color-bg))' }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {user.name || user.email?.split('@')[0]}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{user.email}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: `color-mix(in srgb, ${getStatusColor(user.activityType)} 15%, transparent)`, color: getStatusColor(user.activityType) }}>
                    {getActivityLabel(user.activityType)}
                  </span>
                  {(user.activeChatSessions?.length || 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> {user.activeChatSessions!.length}
                    </span>
                  )}
                  {user.codeMode && (
                    <span className="flex items-center gap-1">
                      <Cpu className="h-3 w-3" /> Code
                    </span>
                  )}
                  {user.isAdmin && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: 'rgb(234,179,8)' }}>
                      Admin
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </AdminCard>

      {/* Top Users Today */}
      {summary?.topUsers && summary.topUsers.length > 0 && (
        <AdminCard>
          <SectionHead
            icon={<DollarSign className="h-5 w-5" />}
            title="Top 10 Users Today"
            tip="Highest token consumers and cost drivers today"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left py-2 px-4 font-medium" style={{ color: 'var(--text-secondary)' }}>#</th>
                  <th className="text-left py-2 px-4 font-medium" style={{ color: 'var(--text-secondary)' }}>User</th>
                  <th className="text-right py-2 px-4 font-medium" style={{ color: 'var(--text-secondary)' }}>Tokens</th>
                  <th className="text-right py-2 px-4 font-medium" style={{ color: 'var(--text-secondary)' }}>Cost</th>
                  <th className="text-right py-2 px-4 font-medium" style={{ color: 'var(--text-secondary)' }}>Requests</th>
                </tr>
              </thead>
              <tbody>
                {summary.topUsers.map((user, i) => (
                  <tr key={user.userId} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                    <td className="py-2 px-4" style={{ color: 'var(--text-secondary)' }}>{i + 1}</td>
                    <td className="py-2 px-4">
                      <button onClick={() => handleUserClick(user.userId)} className="hover:underline text-left" style={{ color: 'var(--color-primary)' }}>
                        {user.name || user.email}
                      </button>
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{formatTokens(user.totalTokens)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{formatCost(user.totalCost)}</td>
                    <td className="py-2 px-4 text-right font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{user.requestCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* Per-User Detail Panel */}
      <SlideInPanel
        isOpen={showDetail}
        onClose={() => { setShowDetail(false); setSelectedUserId(null); setUserUsage(null); }}
        title="User Usage Details"
        subtitle={userUsage?.user?.email || selectedUserId || ''}
        width="lg"
        icon={<User className="h-5 w-5" />}
      >
        {detailLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)' }} />
          </div>
        ) : userUsage ? (
          <>
            <SlideInPanelSection title="Token Usage">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total Tokens</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatTokens(userUsage.tokenUsage.totalTokens)}</p>
                </div>
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total Cost</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCost(userUsage.tokenUsage.totalCost)}</p>
                </div>
              </div>

              {userUsage.tokenUsage.byProvider?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>By Provider</p>
                  {userUsage.tokenUsage.byProvider.map(p => (
                    <div key={p.provider} className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary, var(--color-surface))' }}>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{p.provider}</span>
                      <div className="text-right">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatTokens(p.totalTokens)} tokens</span>
                        <span className="text-xs ml-3" style={{ color: 'var(--text-secondary)' }}>{formatCost(p.totalCost)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {userUsage.tokenUsage.byModel?.length > 0 && (
                <div className="space-y-2 mt-3">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>By Model</p>
                  {userUsage.tokenUsage.byModel.map(m => (
                    <div key={m.model} className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary, var(--color-surface))' }}>
                      <span className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{m.model}</span>
                      <div className="text-right">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatTokens(m.totalTokens)} tokens</span>
                        <span className="text-xs ml-3" style={{ color: 'var(--text-secondary)' }}>{formatCost(m.totalCost)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SlideInPanelSection>

            <SlideInPanelSection title="Chat Activity">
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Sessions</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{userUsage.chatSessions.totalSessions}</p>
                </div>
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Messages</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{userUsage.chatSessions.totalMessages}</p>
                </div>
              </div>
              {userUsage.chatSessions.recent?.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {userUsage.chatSessions.recent.slice(0, 10).map(s => (
                    <div key={s.id} className="flex items-center justify-between p-2 rounded text-xs" style={{ backgroundColor: 'var(--color-surfaceSecondary, var(--color-surface))', border: '1px solid var(--color-border)' }}>
                      <div className="flex-1 min-w-0">
                        <p className="truncate" style={{ color: 'var(--text-primary)' }}>{s.title || 'Untitled'}</p>
                        <p style={{ color: 'var(--text-tertiary)' }}>{s.model} &middot; {s.messageCount} msgs</p>
                      </div>
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{
                        backgroundColor: s.isActive ? 'rgba(34,197,94,0.15)' : 'rgba(100,100,100,0.15)',
                        color: s.isActive ? 'rgb(34,197,94)' : 'var(--text-tertiary)',
                      }}>{s.isActive ? 'active' : 'ended'}</span>
                    </div>
                  ))}
                </div>
              )}
            </SlideInPanelSection>

            {userUsage.queryAudit?.recent?.length > 0 && (
              <SlideInPanelSection title="Recent Activity">
                <div className="max-h-60 overflow-y-auto" style={{ border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  {userUsage.queryAudit.recent.slice(0, 20).map(q => {
                    const message = (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--ap-fg-1, var(--fg-1))' }}>{q.intent || q.queryType}</span>
                        {q.mcpServer && (
                          <span style={{ color: 'var(--ap-accent, var(--accent))' }}>· {q.mcpServer}</span>
                        )}
                      </span>
                    );
                    const meta = (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{q.responseTimeMs}ms</span>
                        <span style={{ color: q.success ? 'var(--ap-ok, var(--ok))' : 'var(--ap-err, var(--err))' }}>
                          {q.success ? 'OK' : 'FAIL'}
                        </span>
                      </span>
                    );
                    return (
                      <LogRow
                        key={q.id}
                        severity={q.success ? 'ok' : 'err'}
                        timestamp={new Date(q.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        source={q.modelUsed || q.queryType}
                        sourceAccent={false}
                        message={message}
                        meta={meta}
                      />
                    );
                  })}
                </div>
              </SlideInPanelSection>
            )}

            {userUsage.codeMode && (
              <SlideInPanelSection title="Code Mode">
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Status</span>
                    <span className="px-2 py-0.5 rounded text-xs" style={{
                      backgroundColor: userUsage.codeMode.status === 'ready' ? 'rgba(34,197,94,0.15)' : 'rgba(100,100,100,0.15)',
                      color: userUsage.codeMode.status === 'ready' ? 'rgb(34,197,94)' : 'var(--text-secondary)',
                    }}>{userUsage.codeMode.status}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Pod</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{userUsage.codeMode.podName}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Storage</span>
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{userUsage.codeMode.storageUsedMb}MB / {userUsage.codeMode.storageQuotaMb}MB</span>
                  </div>
                </div>
              </SlideInPanelSection>
            )}
          </>
        ) : (
          <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
            No usage data available for this user.
          </div>
        )}
      </SlideInPanel>
    </div>
  );
};

export default UserActivityDashboard;
