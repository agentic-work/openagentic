/**
 * Feedback Analytics View - GCP-style Dashboard
 *
 * User feedback on LLM responses: satisfaction rates, by-model comparison,
 * by-user activity, recent feedback timeline.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ThumbsUp, ThumbsDown, Copy, Users, MessageSquare, RefreshCw
} from '@/shared/icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminCard } from '../Shared/AdminCard';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

// ── Interfaces ────────────────────────────────────────────────────────

interface FeedbackStats {
  totalFeedback: number;
  uniqueMessages: number;
  uniqueUsers: number;
  satisfactionRate: number | null;
  byType: Record<string, number>;
}

interface ModelStats {
  model: string;
  thumbs_up: number;
  thumbs_down: number;
  copy: number;
  total: number;
  satisfactionRate: number | null;
}

interface UserStats {
  userId: string;
  name: string | null;
  email: string | null;
  thumbs_up: number;
  thumbs_down: number;
  copy: number;
  total: number;
}

interface RecentFeedback {
  id: string;
  feedbackType: string;
  rating: number | null;
  comment: string | null;
  model: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string | null };
  message: { id: string; content: string; role: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────

const SectionHead: React.FC<{ icon: React.ReactNode; title: string; tip?: string }> = ({ icon, title, tip }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tip && <InfoTooltip content={tip} />}
  </div>
);

const ChartTip: React.FC<{ active?: boolean; payload?: any[]; label?: string }> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}>
      <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

const TABS = ['overview', 'models', 'users', 'recent'] as const;
type Tab = typeof TABS[number];

const formatDate = (s: string) =>
  new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const feedbackIcon = (type: string) => {
  if (type === 'thumbs_up') return <ThumbsUp size={14} style={{ color: 'var(--color-success)' }} />;
  if (type === 'thumbs_down') return <ThumbsDown size={14} style={{ color: 'var(--color-error)' }} />;
  if (type === 'copy') return <Copy size={14} style={{ color: 'var(--color-primary)' }} />;
  return <MessageSquare size={14} style={{ color: 'var(--text-tertiary)' }} />;
};

// ══════════════════════════════════════════════════════════════════════

export const FeedbackAnalyticsView: React.FC<{ theme?: string }> = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [modelStats, setModelStats] = useState<ModelStats[]>([]);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [recentFeedback, setRecentFeedback] = useState<RecentFeedback[]>([]);
  const [selectedTab, setSelectedTab] = useState<Tab>('overview');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, modelsRes, usersRes, recentRes] = await Promise.all([
        apiRequest('/admin/feedback/stats'),
        apiRequest('/admin/feedback/by-model'),
        apiRequest('/admin/feedback/by-user?limit=10'),
        apiRequest('/admin/feedback/recent?limit=20'),
      ]);

      if (!statsRes.ok || !modelsRes.ok || !usersRes.ok || !recentRes.ok)
        throw new Error('Failed to fetch feedback data');

      const [sd, md, ud, rd] = await Promise.all([statsRes.json(), modelsRes.json(), usersRes.json(), recentRes.json()]);
      setStats(sd);
      setModelStats(md.models || []);
      setUserStats(ud.users || []);
      setRecentFeedback(rd.feedback || []);
    } catch (err: any) {
      console.error('[FeedbackAnalytics]', err);
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <AdminCard className="text-center py-8">
        <p style={{ color: 'var(--color-error)' }}>{error}</p>
        <button onClick={fetchData} className="mt-3 px-4 py-1.5 rounded-md text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)', color: 'var(--color-error)' }}>
          Retry
        </button>
      </AdminCard>
    );
  }

  // Chart data for model comparison
  const modelChartData = modelStats.map((m) => ({
    model: m.model.length > 20 ? m.model.slice(0, 18) + '...' : m.model,
    'Thumbs Up': m.thumbs_up,
    'Thumbs Down': m.thumbs_down,
    Copies: m.copy,
  }));

  return (
    <div className="space-y-5">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Monitoring', 'Feedback']}
        title="Feedback Analytics"
        explainer="User satisfaction and response quality tracking across LLM responses."
        actions={[
          { label: 'Refresh', onClick: fetchData },
        ]}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <AdminMetricCard
          label="Total Feedback"
          value={stats?.totalFeedback ?? 0}
          icon={<MessageSquare size={16} />}
          tooltip="Total feedback events (thumbs up, thumbs down, copies)"
        />
        <AdminMetricCard
          label="Satisfaction Rate"
          value={stats?.satisfactionRate != null ? `${stats.satisfactionRate}%` : 'N/A'}
          icon={<ThumbsUp size={16} />}
          tooltip="Percentage of positive feedback (thumbs up / (thumbs up + thumbs down))"
        />
        <AdminMetricCard
          label="Messages Rated"
          value={stats?.uniqueMessages ?? 0}
          icon={<MessageSquare size={16} />}
          tooltip="Unique messages that received feedback"
        />
        <AdminMetricCard
          label="Active Reviewers"
          value={stats?.uniqueUsers ?? 0}
          icon={<Users size={16} />}
          tooltip="Users who have given feedback"
        />
      </div>

      {/* Feedback type breakdown */}
      <AdminCard>
        <SectionHead icon={<ThumbsUp size={16} />} title="Feedback Distribution" tip="Breakdown of feedback by type" />
        <div className="flex gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <ThumbsUp size={16} style={{ color: 'var(--color-success)' }} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Thumbs Up:</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{stats?.byType?.thumbs_up || 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThumbsDown size={16} style={{ color: 'var(--color-error)' }} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Thumbs Down:</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{stats?.byType?.thumbs_down || 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <Copy size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Copies:</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{stats?.byType?.copy || 0}</span>
          </div>
        </div>
      </AdminCard>

      {/* Model satisfaction bar chart */}
      {modelChartData.length > 0 && (
        <AdminCard>
          <SectionHead icon={<ThumbsUp size={16} />} title="Feedback by Model" tip="Comparison of positive/negative feedback across models" />
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="model" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                <RechartsTooltip content={<ChartTip />} />
                <Bar dataKey="Thumbs Up" fill="var(--color-success)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Thumbs Down" fill="var(--ap-err)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Copies" fill="var(--ap-accent)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AdminCard>
      )}

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className="px-4 py-2 text-sm font-medium transition-colors capitalize"
            style={{
              color: selectedTab === tab ? 'var(--color-primary)' : 'var(--text-secondary)',
              borderBottom: selectedTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {selectedTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AdminCard>
            <SectionHead icon={<ThumbsUp size={16} />} title="Top Rated Models" tip="Models ranked by satisfaction rate" />
            <div className="space-y-2">
              {modelStats.slice(0, 5).map((m) => (
                <div key={m.model} className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <span className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>{m.model}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs" style={{ color: 'var(--color-success)' }}>{m.thumbs_up}</span>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>/</span>
                    <span className="text-xs" style={{ color: 'var(--color-error)' }}>{m.thumbs_down}</span>
                    {m.satisfactionRate != null && (
                      <span className="text-xs ml-1 font-semibold" style={{ color: m.satisfactionRate >= 70 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                        ({m.satisfactionRate}%)
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {modelStats.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>No data yet</p>}
            </div>
          </AdminCard>
          <AdminCard>
            <SectionHead icon={<Users size={16} />} title="Most Active Reviewers" tip="Users who give the most feedback" />
            <div className="space-y-2">
              {userStats.slice(0, 5).map((u) => (
                <div key={u.userId} className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{u.name || u.email || 'Unknown'}</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{u.total} reviews</span>
                </div>
              ))}
              {userStats.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>No data yet</p>}
            </div>
          </AdminCard>
        </div>
      )}

      {/* Models tab */}
      {selectedTab === 'models' && (
        <AdminCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">Model</th>
                  <th className="text-center pb-2 font-medium"><ThumbsUp size={14} className="inline" /></th>
                  <th className="text-center pb-2 font-medium"><ThumbsDown size={14} className="inline" /></th>
                  <th className="text-center pb-2 font-medium"><Copy size={14} className="inline" /></th>
                  <th className="text-center pb-2 font-medium">Total</th>
                  <th className="text-center pb-2 font-medium">Satisfaction</th>
                </tr>
              </thead>
              <tbody>
                {modelStats.map((m) => (
                  <tr key={m.model} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                    <td className="py-2 font-mono" style={{ color: 'var(--text-primary)' }}>{m.model}</td>
                    <td className="py-2 text-center" style={{ color: 'var(--color-success)' }}>{m.thumbs_up}</td>
                    <td className="py-2 text-center" style={{ color: 'var(--color-error)' }}>{m.thumbs_down}</td>
                    <td className="py-2 text-center" style={{ color: 'var(--color-primary)' }}>{m.copy}</td>
                    <td className="py-2 text-center font-semibold" style={{ color: 'var(--text-primary)' }}>{m.total}</td>
                    <td className="py-2 text-center">
                      {m.satisfactionRate != null ? (
                        <span style={{ color: m.satisfactionRate >= 70 ? 'var(--color-success)' : m.satisfactionRate >= 50 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                          {m.satisfactionRate}%
                        </span>
                      ) : <span style={{ color: 'var(--text-tertiary)' }}>-</span>}
                    </td>
                  </tr>
                ))}
                {modelStats.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6" style={{ color: 'var(--text-tertiary)' }}>No model feedback data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* Users tab */}
      {selectedTab === 'users' && (
        <AdminCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">User</th>
                  <th className="text-center pb-2 font-medium"><ThumbsUp size={14} className="inline" /></th>
                  <th className="text-center pb-2 font-medium"><ThumbsDown size={14} className="inline" /></th>
                  <th className="text-center pb-2 font-medium"><Copy size={14} className="inline" /></th>
                  <th className="text-center pb-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {userStats.map((u) => (
                  <tr key={u.userId} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                    <td className="py-2">
                      <div style={{ color: 'var(--text-primary)' }}>{u.name || 'Unknown'}</div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{u.email}</div>
                    </td>
                    <td className="py-2 text-center" style={{ color: 'var(--color-success)' }}>{u.thumbs_up}</td>
                    <td className="py-2 text-center" style={{ color: 'var(--color-error)' }}>{u.thumbs_down}</td>
                    <td className="py-2 text-center" style={{ color: 'var(--color-primary)' }}>{u.copy}</td>
                    <td className="py-2 text-center font-semibold" style={{ color: 'var(--text-primary)' }}>{u.total}</td>
                  </tr>
                ))}
                {userStats.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6" style={{ color: 'var(--text-tertiary)' }}>No user feedback data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* Recent tab */}
      {selectedTab === 'recent' && (
        <div className="space-y-2">
          {recentFeedback.map((fb) => (
            <AdminCard key={fb.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {feedbackIcon(fb.feedbackType)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {fb.user.name || fb.user.email || 'Unknown'}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        gave {fb.feedbackType.replace('_', ' ')}
                      </span>
                    </div>
                    {fb.model && <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>Model: {fb.model}</span>}
                  </div>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{formatDate(fb.createdAt)}</span>
              </div>
              {fb.comment && (
                <div className="mt-2 p-2 rounded text-sm" style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--text-secondary)' }}>
                  &ldquo;{fb.comment}&rdquo;
                </div>
              )}
              {fb.message && (
                <div className="mt-2 p-2 rounded text-xs line-clamp-2" style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--text-tertiary)' }}>
                  {fb.message.content}
                </div>
              )}
            </AdminCard>
          ))}
          {recentFeedback.length === 0 && (
            <AdminCard className="text-center py-8">
              <p style={{ color: 'var(--text-tertiary)' }}>No feedback entries yet</p>
            </AdminCard>
          )}
        </div>
      )}
    </div>
  );
};

export default FeedbackAnalyticsView;
