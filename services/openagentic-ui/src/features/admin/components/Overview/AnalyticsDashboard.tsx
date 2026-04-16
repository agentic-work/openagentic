import React, { useState, useEffect } from 'react';
// Keep basic/UI icons from lucide
import { Users, Calendar, BarChart, ChevronDown, ChevronUp } from '@/shared/icons';
// Custom badass icons
import { DollarSign, Zap, TrendingUp, Timer as Clock, Cpu, Activity, AlertCircle } from '../Shared/AdminIcons';
import { apiEndpoint, getApiKey } from '@/utils/api';

interface SystemAnalytics {
  totalSpend: number;
  totalRequests: number;
  totalUsers: number;
  topModels: Array<{
    model: string;
    requests: number;
    spend: number;
  }>;
  topUsers: Array<{
    userId: string;
    spend: number;
    requests: number;
  }>;
}

interface UserSpendSummary {
  userId: string;
  totalSpend: number;
  totalRequests: number;
  totalTokens: number;
  lastActivity: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    is_admin: boolean;
  };
}

interface UserDetailedAnalytics {
  user: {
    id: string;
    email: string;
    name: string | null;
    is_admin: boolean;
    created_at: string;
  };
  analytics: {
    cost: {
      userId: string;
      totalSpend: number;
      totalRequests: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      modelBreakdown: Array<{
        model: string;
        spend: number;
        requests: number;
        tokens: number;
      }>;
      dateRange: {
        start: string;
        end: string;
      };
    };
    models: Array<{
      model: string;
      requests: number;
      successfulRequests: number;
      failedRequests: number;
      avgTokensPerRequest: number;
      totalCost: number;
    }>;
    tokens: {
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      avgTokensPerRequest: number;
      cacheHits: number;
      cacheHitRate: number;
    };
    daily: Array<{
      date: string;
      spend: number;
      requests: number;
      tokens: number;
      models: string[];
    }>;
  };
}

export const AnalyticsDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [systemAnalytics, setSystemAnalytics] = useState<SystemAnalytics | null>(null);
  const [usersSummary, setUsersSummary] = useState<UserSpendSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetailedAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = getApiKey();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      // Fetch system-wide analytics and users summary in parallel
      const [systemRes, usersRes] = await Promise.all([
        fetch(apiEndpoint('/admin/analytics/system'), { headers }),
        fetch(apiEndpoint('/admin/analytics/users/summary'), { headers })
      ]);

      if (!systemRes.ok || !usersRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      const systemData = await systemRes.json();
      const usersData = await usersRes.json();

      setSystemAnalytics(systemData.analytics);
      setUsersSummary(usersData.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
      console.error('Analytics fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserDetails = async (userId: string) => {
    try {
      const token = getApiKey();
      const response = await fetch(
        apiEndpoint(`/admin/analytics/users/${userId}/complete`),
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch user details');
      }

      const data = await response.json();
      setUserDetails(data);
      setSelectedUser(userId);
    } catch (err) {
      console.error('Error fetching user details:', err);
    }
  };

  const toggleRowExpand = (userId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
      if (selectedUser === userId) {
        setSelectedUser(null);
        setUserDetails(null);
      }
    } else {
      newExpanded.add(userId);
      fetchUserDetails(userId);
    }
    setExpandedRows(newExpanded);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(Math.round(num));
  };

  const StatCard = ({
    title,
    value,
    icon: Icon,
    color,
    subtitle
  }: {
    title: string;
    value: string | number;
    icon: any;
    color: string;
    subtitle?: string;
  }) => (
    <div className="glass-card p-6 hover:shadow-lg transition-all duration-150 ease-out">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className={`p-3 rounded-lg ${color}`}>
              <Icon size={24} className="text-white" />
            </div>
            <h3 className="text-sm font-medium text-text-secondary">{title}</h3>
          </div>
          <p className="text-3xl font-bold text-text-primary mb-1">{value}</p>
          {subtitle && (
            <p className="text-sm text-text-secondary">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        <span className="ml-4 text-lg text-text-secondary">Loading analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-lg ap-bg-error border border-error dark:ap-bg-error/20 dark:border-error">
        <div className="flex items-center gap-3">
          <AlertCircle className="ap-text-error dark:ap-text-error" size={24} />
          <div>
            <p className="ap-text-error dark:ap-text-error font-medium">Error loading analytics</p>
            <p className="text-sm ap-text-error dark:ap-text-error mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold mb-2 text-text-primary">Usage Analytics</h2>
        <p className="text-text-secondary">
          Real-time cost tracking, model usage, and performance metrics
        </p>
      </div>

      {/* System-wide Stats */}
      {systemAnalytics && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Total Spend"
              value={formatCurrency(systemAnalytics.totalSpend)}
              icon={DollarSign}
              color="bg-success-500"
              subtitle="All time system cost"
            />
            <StatCard
              title="Total Requests"
              value={formatNumber(systemAnalytics.totalRequests)}
              icon={Activity}
              color="bg-primary-500"
              subtitle="API calls processed"
            />
            <StatCard
              title="Active Users"
              value={systemAnalytics.totalUsers}
              icon={Users}
              color="bg-info-500"
              subtitle="Users with activity"
            />
            <StatCard
              title="Average Cost/Request"
              value={formatCurrency(systemAnalytics.totalSpend / systemAnalytics.totalRequests || 0)}
              icon={TrendingUp}
              color="bg-warning-500"
              subtitle="Per request cost"
            />
          </div>

          {/* Top Models */}
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold mb-4 text-text-primary flex items-center gap-2">
              <Cpu size={20} />
              Top Models by Usage
            </h3>
            <div className="space-y-3">
              {(systemAnalytics.topModels || []).slice(0, 5).map((model, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary hover:bg-surface-secondary/80 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center font-bold text-sm">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">{model.model}</p>
                      <p className="text-sm text-text-secondary">{formatNumber(model.requests)} requests</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-text-primary">{formatCurrency(model.spend)}</p>
                    <p className="text-xs text-text-secondary">
                      {formatCurrency(model.spend / model.requests)}/req
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Users Summary Table */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold mb-4 text-text-primary flex items-center gap-2">
          <Users size={20} />
          Per-User Cost Breakdown
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">User</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-text-secondary">Total Spend</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-text-secondary">Requests</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-text-secondary">Tokens</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-text-secondary">Avg Cost/Req</th>
                <th className="text-right py-3 px-4 text-sm font-semibold text-text-secondary">Last Activity</th>
                <th className="text-center py-3 px-4 text-sm font-semibold text-text-secondary">Details</th>
              </tr>
            </thead>
            <tbody>
              {usersSummary
                .sort((a, b) => b.totalSpend - a.totalSpend)
                .map((userSpend) => (
                  <React.Fragment key={userSpend.userId}>
                    <tr className="border-b border-border hover:bg-surface-secondary/30 transition-colors">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-text-primary">
                            {userSpend.user?.name || userSpend.user?.email || 'Unknown'}
                          </p>
                          <p className="text-xs text-text-secondary">{userSpend.user?.email}</p>
                          {userSpend.user?.is_admin && (
                            <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded-full bg-info-500 text-white">
                              Admin
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-bold ap-text-success dark:ap-text-success">
                          {formatCurrency(userSpend.totalSpend)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-text-primary">
                        {formatNumber(userSpend.totalRequests)}
                      </td>
                      <td className="py-3 px-4 text-right text-text-primary">
                        {formatNumber(userSpend.totalTokens)}
                      </td>
                      <td className="py-3 px-4 text-right text-text-primary">
                        {formatCurrency(userSpend.totalSpend / userSpend.totalRequests || 0)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 text-text-secondary text-sm">
                          <Clock size={14} />
                          {new Date(userSpend.lastActivity).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => toggleRowExpand(userSpend.userId)}
                          className="p-2 rounded-lg hover:bg-primary-500/10 transition-colors text-primary-500"
                        >
                          {expandedRows.has(userSpend.userId) ? (
                            <ChevronUp size={18} />
                          ) : (
                            <ChevronDown size={18} />
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded User Details */}
                    {expandedRows.has(userSpend.userId) && userDetails?.user?.id === userSpend.userId && (
                      <tr>
                        <td colSpan={7} className="py-4 px-4 bg-surface-primary/50">
                          <div className="space-y-4">
                            {/* Token Stats */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                              <div className="p-4 rounded-lg bg-surface-secondary">
                                <p className="text-xs text-text-secondary mb-1">Total Tokens</p>
                                <p className="text-xl font-bold text-text-primary">
                                  {formatNumber(userDetails.analytics.tokens.totalTokens)}
                                </p>
                              </div>
                              <div className="p-4 rounded-lg bg-surface-secondary">
                                <p className="text-xs text-text-secondary mb-1">Prompt Tokens</p>
                                <p className="text-xl font-bold text-text-primary">
                                  {formatNumber(userDetails.analytics.tokens.promptTokens)}
                                </p>
                              </div>
                              <div className="p-4 rounded-lg bg-surface-secondary">
                                <p className="text-xs text-text-secondary mb-1">Completion Tokens</p>
                                <p className="text-xl font-bold text-text-primary">
                                  {formatNumber(userDetails.analytics.tokens.completionTokens)}
                                </p>
                              </div>
                              <div className="p-4 rounded-lg bg-surface-secondary">
                                <p className="text-xs text-text-secondary mb-1">Cache Hit Rate</p>
                                <p className="text-xl font-bold text-primary-500">
                                  {(userDetails.analytics.tokens.cacheHitRate ?? 0).toFixed(1)}%
                                </p>
                              </div>
                            </div>

                            {/* Model Breakdown */}
                            <div>
                              <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                                <BarChart size={16} />
                                Model Usage Breakdown
                              </h4>
                              <div className="space-y-2">
                                {(userDetails.analytics?.cost?.modelBreakdown || []).map((model, idx) => (
                                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary">
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-text-primary">{model.model}</p>
                                      <p className="text-xs text-text-secondary">
                                        {formatNumber(model.requests)} requests · {formatNumber(model.tokens)} tokens
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-bold ap-text-success dark:ap-text-success">
                                        {formatCurrency(model.spend)}
                                      </p>
                                      <p className="text-xs text-text-secondary">
                                        {formatCurrency(model.spend / model.requests)}/req
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Recent Daily Activity */}
                            {userDetails.analytics.daily.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                                  <Calendar size={16} />
                                  Recent Daily Activity (Last 7 Days)
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                                  {userDetails.analytics.daily.slice(0, 7).map((day, idx) => (
                                    <div key={idx} className="p-3 rounded-lg bg-surface-secondary text-center">
                                      <p className="text-xs text-text-secondary mb-1">
                                        {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      </p>
                                      <p className="text-lg font-bold text-primary-500">
                                        {formatCurrency(day.spend)}
                                      </p>
                                      <p className="text-xs text-text-secondary mt-1">
                                        {formatNumber(day.requests)} req
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
            </tbody>
          </table>
        </div>

        {usersSummary.length === 0 && (
          <div className="text-center py-12">
            <Users size={48} className="mx-auto text-text-secondary/30 mb-4" />
            <p className="text-text-secondary">No user activity data available yet</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
