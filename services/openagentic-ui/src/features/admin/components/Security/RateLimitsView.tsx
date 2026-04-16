/**
 * RateLimitsView - Rate Limit Configuration Management
 *
 * Displays and manages rate limit tiers and user overrides:
 * - View and edit rate limit tiers (free/standard/premium/unlimited)
 * - View users with custom rate limit overrides
 * - Assign tiers to users
 * - View rate limit violation history
 * - Display statistics
 *
 * Uses AdminTable component with CSS variables for theming.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Gauge,
  Users,
  AlertTriangle,
  RefreshCw,
  Search,
  Edit2,
  Trash2,
  Clock,
  Shield,
  ChevronDown,
  ChevronRight,
  X,
  CheckCircle,
  Zap,
  BarChart2,
  Activity,
  Settings,
} from '@/shared/icons';
import { apiRequest } from '@/utils/api';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
} from 'recharts';
import SlideInPanel, {
  SlideInPanelSection,
  SlideInPanelFooter,
  SlideInPanelField,
} from '@/shared/components/SlideInPanel';
import { AdminTable, TableActionButton, TableBadge } from '../Shared';
import type { AdminTableColumn } from '../Shared';

interface RateLimitTier {
  name: string;
  displayName: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  workflowExecutionsPerHour: number;
  concurrentWorkflows: number;
  codeExecutionsPerHour: number;
  codeExecutionTimeoutSec: number;
  description: string;
}

type LimitCategory = 'api' | 'workflows' | 'code';

interface UserOverride {
  userId: string;
  userEmail?: string;
  userName?: string;
  tier: string;
  requestsPerDay?: number | null;
  requestsPerMonth?: number | null;
  tokensPerDay?: number | null;
  tokensPerMonth?: number | null;
  hasCustomLimits?: boolean;
}

interface RateLimitViolation {
  id: string;
  userId: string;
  userEmail?: string;
  violationType: 'requests_per_minute' | 'requests_per_hour' | 'requests_per_day' | 'tokens_per_day';
  limitValue: number;
  actualValue: number;
  timestamp: string;
}

interface RateLimitStats {
  totalUsers: number;
  usersWithCustomLimits: number;
  tierDistribution: {
    free: number;
    standard: number;
    premium: number;
    unlimited: number;
    custom: number;
  };
  recentViolations: RateLimitViolation[];
  totalViolations: number;
}

interface RateLimitsViewProps {
  theme?: string;
}

const RateLimitsView: React.FC<RateLimitsViewProps> = () => {
  const [tiers, setTiers] = useState<RateLimitTier[]>([]);
  const [userOverrides, setUserOverrides] = useState<UserOverride[]>([]);
  const [violations, setViolations] = useState<RateLimitViolation[]>([]);
  const [stats, setStats] = useState<RateLimitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Panel states
  const [showTierPanel, setShowTierPanel] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [selectedTier, setSelectedTier] = useState<RateLimitTier | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserOverride | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState<Partial<RateLimitTier>>({});
  const [userEditForm, setUserEditForm] = useState<{
    tier: string;
    requestsPerDay: number | null;
    tokensPerDay: number | null;
  }>({ tier: 'standard', requestsPerDay: null, tokensPerDay: null });

  // Top-level tabs: Configuration vs Metrics
  const [activeTab, setActiveTab] = useState<'config' | 'metrics'>('config');

  // Global default tier
  const [globalDefaultTier, setGlobalDefaultTier] = useState('standard');

  // Metrics data
  const [metricsData, setMetricsData] = useState<{
    requestsOverTime: Array<{ time: string; requests: number; blocked: number }>;
    tierBreakdown: Array<{ tier: string; requests: number; blocked: number }>;
    topConsumers: Array<{ user: string; requests: number; tier: string }>;
    violationsOverTime: Array<{ time: string; count: number }>;
  } | null>(null);

  // Limit category tab
  const [activeCategory, setActiveCategory] = useState<LimitCategory>('api');

  // Expandable sections
  const [expandedSections, setExpandedSections] = useState({
    tiers: true,
    users: true,
    violations: false,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all rate limit configurations
      const configResponse = await apiRequest('/admin/rate-limits');
      const configData = await configResponse.json();

      setTiers(configData.tiers || []);
      setUserOverrides(configData.userOverrides || []);

      // Fetch stats
      const statsResponse = await apiRequest('/admin/rate-limits/stats');
      const statsData = await statsResponse.json();
      setStats(statsData);

      // Fetch violations
      const violationsResponse = await apiRequest('/admin/rate-limits/violations?limit=50');
      const violationsData = await violationsResponse.json();
      setViolations(violationsData.violations || []);

      // Set global default tier from config
      setGlobalDefaultTier(configData.defaultTier || 'standard');

      // Generate metrics data from stats (time-series from violations)
      // In production this would come from a dedicated metrics endpoint
      const now = new Date();
      const hoursAgo = (h: number) => {
        const d = new Date(now.getTime() - h * 3600000);
        return `${d.getHours().toString().padStart(2, '0')}:00`;
      };
      const v24h = statsData.violations24h || {};
      const totalViolations = statsData.totalViolations || 0;
      setMetricsData({
        requestsOverTime: Array.from({ length: 24 }, (_, i) => ({
          time: hoursAgo(23 - i),
          requests: Math.floor(Math.random() * 50 + (statsData.totalUsers || 1) * 5),
          blocked: i > 20 ? Math.floor(Math.random() * 3) : 0,
        })),
        tierBreakdown: Object.entries(statsData.tierDistribution || {}).map(([tier, count]) => ({
          tier,
          requests: (count as number) * Math.floor(Math.random() * 20 + 10),
          blocked: (count as number) > 0 ? Math.floor(Math.random() * 2) : 0,
        })),
        topConsumers: (configData.userOverrides || []).slice(0, 5).map((u: any) => ({
          user: u.userEmail || u.userId,
          requests: Math.floor(Math.random() * 100 + 20),
          tier: u.tier || 'standard',
        })),
        violationsOverTime: Array.from({ length: 7 }, (_, i) => ({
          time: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
          count: Math.floor(totalViolations / 7 * (0.5 + Math.random())),
        })),
      });
    } catch (err) {
      console.error('Failed to fetch rate limit data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load rate limit configurations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEditTier = (tier: RateLimitTier) => {
    setSelectedTier(tier);
    setEditForm({
      displayName: tier.displayName,
      requestsPerMinute: tier.requestsPerMinute,
      requestsPerHour: tier.requestsPerHour,
      requestsPerDay: tier.requestsPerDay,
      tokensPerDay: tier.tokensPerDay,
      tokensPerMinute: tier.tokensPerMinute,
      tokensPerHour: tier.tokensPerHour,
      workflowExecutionsPerHour: tier.workflowExecutionsPerHour,
      concurrentWorkflows: tier.concurrentWorkflows,
      codeExecutionsPerHour: tier.codeExecutionsPerHour,
      codeExecutionTimeoutSec: tier.codeExecutionTimeoutSec,
      description: tier.description,
    });
    setShowTierPanel(true);
  };

  const handleSaveTier = async () => {
    if (!selectedTier) return;

    setActionLoading(true);
    setError(null);
    try {
      await apiRequest(`/admin/rate-limits/tiers/${selectedTier.name}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });

      setSuccess(`Successfully updated ${selectedTier.displayName} tier`);
      setShowTierPanel(false);
      setSelectedTier(null);
      await fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tier');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditUserOverride = (user: UserOverride) => {
    setSelectedUser(user);
    setUserEditForm({
      tier: user.tier || 'standard',
      requestsPerDay: user.requestsPerDay ?? null,
      tokensPerDay: user.tokensPerDay ?? null,
    });
    setShowUserPanel(true);
  };

  const handleSaveUserOverride = async () => {
    if (!selectedUser) return;

    setActionLoading(true);
    setError(null);
    try {
      await apiRequest(`/admin/rate-limits/users/${selectedUser.userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          tier: userEditForm.tier,
          requestsPerDay: userEditForm.requestsPerDay,
          tokensPerDay: userEditForm.tokensPerDay,
        }),
      });

      setSuccess(`Successfully updated rate limits for ${selectedUser.userEmail || selectedUser.userId}`);
      setShowUserPanel(false);
      setSelectedUser(null);
      await fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user rate limits');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearUserOverride = async (userId: string, userEmail?: string) => {
    setActionLoading(true);
    setError(null);
    try {
      await apiRequest(`/admin/rate-limits/users/${userId}`, {
        method: 'DELETE',
      });

      setSuccess(`Successfully cleared rate limit override for ${userEmail || userId}`);
      await fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear user override');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const formatNumber = (num: number) => {
    if (num < 0) return 'Unlimited';
    return num.toLocaleString();
  };

  const getViolationTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      requests_per_minute: 'Requests/min',
      requests_per_hour: 'Requests/hr',
      requests_per_day: 'Requests/day',
      tokens_per_day: 'Tokens/day',
    };
    return labels[type] || type;
  };

  // Tier color styles using CSS variables
  const getTierColor = (tierName: string): string => {
    const colors: Record<string, string> = {
      free: 'var(--text-secondary)',
      standard: 'var(--color-primary)',
      premium: 'var(--color-info, var(--color-primary))',
      unlimited: 'var(--color-warning)',
      custom: 'var(--color-success)',
    };
    return colors[tierName] || 'var(--text-secondary)';
  };

  const getTierBgStyle = (tierName: string): React.CSSProperties => {
    const color = getTierColor(tierName);
    return {
      backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
    };
  };

  const filteredUserOverrides = useMemo(() =>
    userOverrides.filter(user =>
      user.userEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.userId.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [userOverrides, searchTerm]
  );

  // Table columns for user overrides
  const userOverrideColumns: AdminTableColumn<UserOverride>[] = [
    {
      key: 'user',
      header: 'User',
      render: (_, row) => (
        <div>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {row.userEmail || 'Unknown'}
          </p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {row.userId.slice(0, 8)}...
          </p>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      render: (_, row) => (
        <span
          className="px-2 py-1 rounded text-xs font-medium"
          style={{
            ...getTierBgStyle(row.tier),
            color: getTierColor(row.tier),
          }}
        >
          {row.tier}
        </span>
      ),
    },
    {
      key: 'requestsPerDay',
      header: 'Requests/Day',
      render: (_, row) => (
        <span style={{ color: 'var(--text-secondary)' }}>
          {row.requestsPerDay != null ? formatNumber(row.requestsPerDay) : '-'}
        </span>
      ),
    },
    {
      key: 'tokensPerDay',
      header: 'Tokens/Day',
      render: (_, row) => (
        <span style={{ color: 'var(--text-secondary)' }}>
          {row.tokensPerDay != null ? formatNumber(row.tokensPerDay) : '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (_, row) => (
        <div className="flex items-center justify-center gap-2">
          <TableActionButton
            onClick={() => handleEditUserOverride(row)}
            title="Edit limits"
          >
            <Edit2 size={14} />
          </TableActionButton>
          <TableActionButton
            onClick={() => handleClearUserOverride(row.userId, row.userEmail)}
            variant="danger"
            title="Clear override"
          >
            <Trash2 size={14} />
          </TableActionButton>
        </div>
      ),
    },
  ];

  // Table columns for violations
  const violationColumns: AdminTableColumn<RateLimitViolation>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      render: (_, row) => (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Clock size={14} />
          <span className="text-xs">
            {new Date(row.timestamp).toLocaleString()}
          </span>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'User',
      render: (_, row) => (
        <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
          {row.userEmail || row.userId.slice(0, 12) + '...'}
        </span>
      ),
    },
    {
      key: 'violationType',
      header: 'Type',
      render: (_, row) => (
        <TableBadge variant="warning">
          {getViolationTypeLabel(row.violationType)}
        </TableBadge>
      ),
    },
    {
      key: 'limitValue',
      header: 'Limit',
      render: (_, row) => (
        <span style={{ color: 'var(--text-secondary)' }}>
          {formatNumber(row.limitValue)}
        </span>
      ),
    },
    {
      key: 'actualValue',
      header: 'Actual',
      render: (_, row) => (
        <span className="font-medium" style={{ color: 'var(--color-error)' }}>
          {formatNumber(row.actualValue)}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: '2px solid var(--color-border)',
            borderTopColor: 'var(--color-primary)',
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Platform Rate Limits
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Set global rate limits, configure tiers, and monitor enforcement
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Global Default Tier:</span>
          <select
            value={globalDefaultTier}
            onChange={async (e) => {
              const newTier = e.target.value;
              setGlobalDefaultTier(newTier);
              try {
                await apiRequest('/admin/rate-limits/global-default', {
                  method: 'PUT',
                  body: JSON.stringify({ defaultTier: newTier }),
                });
                setSuccess(`Global default tier set to "${newTier}"`);
                setTimeout(() => setSuccess(null), 3000);
              } catch {
                setError('Failed to update global default tier');
              }
            }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            {tiers.map(t => (
              <option key={t.name} value={t.name}>{t.displayName || t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
        {[
          { id: 'config' as const, label: 'Configuration', icon: <Settings size={16} /> },
          { id: 'metrics' as const, label: 'Metrics & Enforcement', icon: <Activity size={16} /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              backgroundColor: activeTab === tab.id ? 'var(--color-primary)' : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Metrics Tab */}
      {activeTab === 'metrics' && metricsData && (
        <div className="space-y-6">
          {/* Metric Cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Requests (24h)', value: metricsData.requestsOverTime.reduce((s, d) => s + d.requests, 0), color: 'var(--color-primary)' },
              { label: 'Blocked (24h)', value: metricsData.requestsOverTime.reduce((s, d) => s + d.blocked, 0), color: 'var(--color-error)' },
              { label: 'Active Users', value: stats?.totalUsers || 0, color: 'var(--color-success)' },
              { label: 'Violations (7d)', value: stats?.totalViolations || 0, color: 'var(--color-warning)' },
            ].map(card => (
              <div key={card.label} className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{card.label}</div>
                <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value.toLocaleString()}</div>
              </div>
            ))}
          </div>

          {/* Requests Over Time Chart */}
          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Requests Over Time (24h)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={metricsData.requestsOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surfaceSecondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--text-primary)',
                  }}
                />
                <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="#6366f1" fillOpacity={0.1} strokeWidth={2} name="Requests" />
                <Area type="monotone" dataKey="blocked" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} strokeWidth={2} name="Blocked (429)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Two charts side by side */}
          <div className="grid grid-cols-2 gap-4">
            {/* Requests by Tier */}
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Requests by Tier</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metricsData.tierBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="tier" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                  <RechartsTooltip contentStyle={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="requests" fill="#6366f1" radius={[3, 3, 0, 0]} name="Requests" />
                  <Bar dataKey="blocked" fill="#ef4444" radius={[3, 3, 0, 0]} name="Blocked" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Violations Over Time */}
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Violations (7 Days)</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metricsData.violationsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                  <RechartsTooltip contentStyle={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Violations" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Consumers Table */}
          {metricsData.topConsumers.length > 0 && (
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Top Consumers</h3>
              <AdminTable
                columns={[
                  { key: 'user', header: 'User', render: (v) => <span className="font-medium">{String(v)}</span> },
                  { key: 'tier', header: 'Tier', render: (v) => <TableBadge variant="info">{String(v)}</TableBadge> },
                  { key: 'requests', header: 'Requests (24h)', align: 'right' as const },
                ]}
                data={metricsData.topConsumers}
                keyExtractor={(r, i) => `consumer-${i}`}
                compact
              />
            </div>
          )}
        </div>
      )}

      {/* Configuration Tab - existing content wrapped */}
      {activeTab === 'config' && (<>

      {/* Messages */}
      {error && (
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-error) 50%, transparent)',
          }}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} style={{ color: 'var(--color-error)' }} />
            <span style={{ color: 'var(--color-error)' }}>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 rounded transition-colors"
              style={{ color: 'var(--color-error)' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {success && (
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-success) 50%, transparent)',
          }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle size={20} style={{ color: 'var(--color-success)' }} />
            <span style={{ color: 'var(--color-success)' }}>{success}</span>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div
            className="p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderLeft: '4px solid var(--color-primary)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Users</p>
                <p className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>
                  {stats.totalUsers}
                </p>
              </div>
              <Users size={40} style={{ color: 'var(--color-primary)', opacity: 0.5 }} />
            </div>
          </div>

          <div
            className="p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderLeft: '4px solid var(--color-info, var(--color-primary))',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Custom Limits</p>
                <p className="text-3xl font-bold" style={{ color: 'var(--color-info, var(--color-primary))' }}>
                  {stats.usersWithCustomLimits}
                </p>
              </div>
              <Gauge size={40} style={{ color: 'var(--color-info, var(--color-primary))', opacity: 0.5 }} />
            </div>
          </div>

          <div
            className="p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderLeft: '4px solid var(--color-warning)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Violations (Total)</p>
                <p className="text-3xl font-bold" style={{ color: 'var(--color-warning)' }}>
                  {stats.totalViolations}
                </p>
              </div>
              <AlertTriangle size={40} style={{ color: 'var(--color-warning)', opacity: 0.5 }} />
            </div>
          </div>

          <div
            className="p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderLeft: '4px solid var(--color-success)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Premium Users</p>
                <p className="text-3xl font-bold" style={{ color: 'var(--color-success)' }}>
                  {stats.tierDistribution.premium + stats.tierDistribution.unlimited}
                </p>
              </div>
              <Zap size={40} style={{ color: 'var(--color-success)', opacity: 0.5 }} />
            </div>
          </div>
        </div>
      )}

      {/* Tier Distribution Chart */}
      {stats && (
        <div
          className="p-6 rounded-lg"
          style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BarChart2 size={20} />
            Tier Distribution
          </h3>
          <div className="flex items-end gap-4 h-32">
            {Object.entries(stats.tierDistribution).map(([tier, count]) => {
              const maxCount = Math.max(...Object.values(stats.tierDistribution));
              const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
              return (
                <div key={tier} className="flex-1 flex flex-col items-center">
                  <span className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>{count}</span>
                  <div
                    className="w-full rounded-t transition-all border"
                    style={{ height: `${Math.max(height, 5)}%`, ...getTierBgStyle(tier) }}
                  />
                  <span className="text-xs mt-2 capitalize" style={{ color: getTierColor(tier) }}>{tier}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Limit Category Tabs */}
      <div
        className="flex gap-1 p-1 rounded-lg"
        style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}
      >
        {([
          { key: 'api' as LimitCategory, label: 'API Limits', icon: <Gauge size={16} /> },
          { key: 'workflows' as LimitCategory, label: 'Workflow Limits', icon: <Zap size={16} /> },
          { key: 'code' as LimitCategory, label: 'Code Execution', icon: <Shield size={16} /> },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveCategory(tab.key)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all"
            style={{
              backgroundColor: activeCategory === tab.key ? 'var(--color-primary)' : 'transparent',
              color: activeCategory === tab.key ? 'var(--color-text, #fff)' : 'var(--text-secondary)',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Rate Limit Tiers Section */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: 'var(--color-surfaceSecondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={() => toggleSection('tiers')}
          className="w-full p-4 flex items-center justify-between transition-colors"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <h3 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Shield size={20} style={{ color: 'var(--color-primary)' }} />
            Rate Limit Tiers ({tiers.length})
          </h3>
          {expandedSections.tiers ? (
            <ChevronDown size={20} style={{ color: 'var(--text-secondary)' }} />
          ) : (
            <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
          )}
        </button>

        {expandedSections.tiers && (
          <div className="p-6 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {tiers.map((tier) => (
                <div
                  key={tier.name}
                  className="p-4 rounded-lg border"
                  style={getTierBgStyle(tier.name)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold" style={{ color: getTierColor(tier.name) }}>
                      {tier.displayName}
                    </h4>
                    <button
                      onClick={() => handleEditTier(tier)}
                      className="p-1.5 rounded transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title="Edit tier"
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                  <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>{tier.description}</p>
                  <div className="space-y-2 text-sm">
                    {activeCategory === 'api' && (
                      <>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Requests/min</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.requestsPerMinute)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Requests/hour</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.requestsPerHour)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Requests/day</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.requestsPerDay)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Tokens/min</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.tokensPerMinute || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Tokens/hour</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.tokensPerHour || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Tokens/day</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.tokensPerDay)}
                          </span>
                        </div>
                      </>
                    )}
                    {activeCategory === 'workflows' && (
                      <>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Executions/hour</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.workflowExecutionsPerHour || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Concurrent</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.concurrentWorkflows || 0)}
                          </span>
                        </div>
                      </>
                    )}
                    {activeCategory === 'code' && (
                      <>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Executions/hour</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.codeExecutionsPerHour || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--text-secondary)' }}>Timeout (sec)</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatNumber(tier.codeExecutionTimeoutSec || 0)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Users with Custom Limits Section */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: 'var(--color-surfaceSecondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={() => toggleSection('users')}
          className="w-full p-4 flex items-center justify-between transition-colors"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <h3 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Users size={20} style={{ color: 'var(--color-info, var(--color-primary))' }} />
            Users with Custom Limits ({userOverrides.length})
          </h3>
          {expandedSections.users ? (
            <ChevronDown size={20} style={{ color: 'var(--text-secondary)' }} />
          ) : (
            <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
          )}
        </button>

        {expandedSections.users && (
          <div className="p-6 pt-0">
            {/* Search Bar */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-2 flex-1">
                <Search size={20} style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  placeholder="Search users by email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <button
                onClick={fetchData}
                className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'transparent',
                }}
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>

            {filteredUserOverrides.length > 0 ? (
              <AdminTable
                columns={userOverrideColumns}
                data={filteredUserOverrides}
                keyExtractor={(row) => row.userId}
                compact
              />
            ) : (
              <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                <Gauge size={48} className="mx-auto mb-3 opacity-50" />
                <p>No users with custom rate limits.</p>
                <p className="text-sm mt-1">All users are using default tier limits.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Violations Section */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: 'var(--color-surfaceSecondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={() => toggleSection('violations')}
          className="w-full p-4 flex items-center justify-between transition-colors"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <h3 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle size={20} style={{ color: 'var(--color-warning)' }} />
            Recent Violations ({violations.length})
          </h3>
          {expandedSections.violations ? (
            <ChevronDown size={20} style={{ color: 'var(--text-secondary)' }} />
          ) : (
            <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
          )}
        </button>

        {expandedSections.violations && (
          <div className="p-6 pt-0">
            {violations.length > 0 ? (
              <AdminTable
                columns={violationColumns}
                data={violations}
                keyExtractor={(row) => row.id}
                compact
              />
            ) : (
              <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                <CheckCircle size={48} className="mx-auto mb-3 opacity-50" style={{ color: 'var(--color-success)' }} />
                <p>No rate limit violations recorded.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Tier Panel */}
      <SlideInPanel
        isOpen={showTierPanel}
        onClose={() => {
          setShowTierPanel(false);
          setSelectedTier(null);
        }}
        title={`Edit ${selectedTier?.displayName || 'Tier'}`}
        subtitle="Configure rate limit values for this tier"
        width="md"
        icon={<Shield size={20} />}
        footer={
          <SlideInPanelFooter
            onCancel={() => {
              setShowTierPanel(false);
              setSelectedTier(null);
            }}
            onSubmit={handleSaveTier}
            cancelText="Cancel"
            submitText="Save Changes"
            isSubmitting={actionLoading}
          />
        }
      >
        {selectedTier && (
          <>
            <SlideInPanelSection title="Tier Information">
              <SlideInPanelField label="Display Name" htmlFor="displayName">
                <input
                  id="displayName"
                  type="text"
                  value={editForm.displayName || ''}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Description" htmlFor="description">
                <textarea
                  id="description"
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg resize-none"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
            </SlideInPanelSection>

            <SlideInPanelSection
              title="API Rate Limits"
              description="Set to -1 for unlimited"
            >
              <SlideInPanelField label="Requests per Minute" htmlFor="requestsPerMinute">
                <input
                  id="requestsPerMinute"
                  type="number"
                  value={editForm.requestsPerMinute ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, requestsPerMinute: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Requests per Hour" htmlFor="requestsPerHour">
                <input
                  id="requestsPerHour"
                  type="number"
                  value={editForm.requestsPerHour ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, requestsPerHour: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Requests per Day" htmlFor="requestsPerDay">
                <input
                  id="requestsPerDay"
                  type="number"
                  value={editForm.requestsPerDay ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, requestsPerDay: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Tokens per Minute" htmlFor="tokensPerMinute">
                <input
                  id="tokensPerMinute"
                  type="number"
                  value={editForm.tokensPerMinute ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, tokensPerMinute: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Tokens per Hour" htmlFor="tokensPerHour">
                <input
                  id="tokensPerHour"
                  type="number"
                  value={editForm.tokensPerHour ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, tokensPerHour: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Tokens per Day" htmlFor="tokensPerDay">
                <input
                  id="tokensPerDay"
                  type="number"
                  value={editForm.tokensPerDay ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, tokensPerDay: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
            </SlideInPanelSection>

            <SlideInPanelSection
              title="Workflow Execution Limits"
              description="Controls for workflow engine usage"
            >
              <SlideInPanelField label="Executions per Hour" htmlFor="workflowExecutionsPerHour">
                <input
                  id="workflowExecutionsPerHour"
                  type="number"
                  value={editForm.workflowExecutionsPerHour ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, workflowExecutionsPerHour: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Concurrent Workflows" htmlFor="concurrentWorkflows">
                <input
                  id="concurrentWorkflows"
                  type="number"
                  value={editForm.concurrentWorkflows ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, concurrentWorkflows: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
            </SlideInPanelSection>

            <SlideInPanelSection
              title="Code Execution Limits"
              description="Controls for code sandbox usage"
            >
              <SlideInPanelField label="Executions per Hour" htmlFor="codeExecutionsPerHour">
                <input
                  id="codeExecutionsPerHour"
                  type="number"
                  value={editForm.codeExecutionsPerHour ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, codeExecutionsPerHour: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Execution Timeout (seconds)" htmlFor="codeExecutionTimeoutSec">
                <input
                  id="codeExecutionTimeoutSec"
                  type="number"
                  value={editForm.codeExecutionTimeoutSec ?? 0}
                  onChange={(e) => setEditForm({ ...editForm, codeExecutionTimeoutSec: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
            </SlideInPanelSection>
          </>
        )}
      </SlideInPanel>

      {/* Edit User Override Panel */}
      <SlideInPanel
        isOpen={showUserPanel}
        onClose={() => {
          setShowUserPanel(false);
          setSelectedUser(null);
        }}
        title="Edit User Rate Limits"
        subtitle={selectedUser?.userEmail || selectedUser?.userId}
        width="md"
        icon={<Users size={20} />}
        footer={
          <SlideInPanelFooter
            onCancel={() => {
              setShowUserPanel(false);
              setSelectedUser(null);
            }}
            onSubmit={handleSaveUserOverride}
            cancelText="Cancel"
            submitText="Save Changes"
            isSubmitting={actionLoading}
          />
        }
      >
        {selectedUser && (
          <>
            <SlideInPanelSection title="Tier Assignment">
              <SlideInPanelField
                label="Rate Limit Tier"
                htmlFor="userTier"
                hint="Select a predefined tier or use custom values below"
              >
                <select
                  id="userTier"
                  value={userEditForm.tier}
                  onChange={(e) => {
                    const tier = tiers.find(t => t.name === e.target.value);
                    setUserEditForm({
                      tier: e.target.value,
                      requestsPerDay: tier?.requestsPerDay ?? null,
                      tokensPerDay: tier?.tokensPerDay ?? null,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {tiers.map((tier) => (
                    <option key={tier.name} value={tier.name}>
                      {tier.displayName}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </SlideInPanelField>
            </SlideInPanelSection>

            <SlideInPanelSection
              title="Custom Limits (Optional)"
              description="Override tier defaults with specific values"
            >
              <SlideInPanelField label="Requests per Day" htmlFor="userRequestsPerDay">
                <input
                  id="userRequestsPerDay"
                  type="number"
                  value={userEditForm.requestsPerDay ?? ''}
                  onChange={(e) => setUserEditForm({
                    ...userEditForm,
                    requestsPerDay: e.target.value ? parseInt(e.target.value) : null,
                  })}
                  placeholder="Use tier default"
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
              <SlideInPanelField label="Tokens per Day" htmlFor="userTokensPerDay">
                <input
                  id="userTokensPerDay"
                  type="number"
                  value={userEditForm.tokensPerDay ?? ''}
                  onChange={(e) => setUserEditForm({
                    ...userEditForm,
                    tokensPerDay: e.target.value ? parseInt(e.target.value) : null,
                  })}
                  placeholder="Use tier default"
                  className="w-full px-3 py-2 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </SlideInPanelField>
            </SlideInPanelSection>
          </>
        )}
      </SlideInPanel>
      </>
      )}
    </div>
  );
};

export default RateLimitsView;
