/**
 * Embedding Metrics Component
 * Displays embedding usage statistics: request counts, tokens, costs, and latency
 * Data sourced from /api/admin/analytics/embeddings endpoint
 *
 * Uses Recharts for visualizations and shared admin design-system components.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, Zap, DollarSign, TrendingUp,
  Timer as Clock
} from '../Shared/AdminIcons';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminCard } from '../Shared/AdminCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { CHART_COLORS } from '../Shared/chartColors';
import { useAuth } from '../../../../app/providers/AuthContext';
import { PageHeader } from '../../primitives-v2';

// ── Constants ─────────────────────────────────────────────────────────

const TIME_RANGES = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

const METRIC_TOOLTIPS = {
  totalRequests: 'Total number of embedding API requests made',
  totalTokens: 'Total tokens processed for embedding generation',
  totalCost: 'Estimated cost based on embedding model pricing',
  avgLatency: 'Average time to generate embeddings in milliseconds',
  byProvider: 'Embedding usage breakdown by provider (Azure, Vertex AI, Bedrock, etc.)',
  byModel: 'Embedding usage breakdown by specific model',
  dailyTrend: 'Daily embedding request count over the selected time range',
};

// ── Interfaces ────────────────────────────────────────────────────────

interface EmbeddingMetricsProps {
  theme?: string;
}

interface EmbeddingData {
  summary: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    avgLatencyMs: number;
  };
  byProvider: Array<{
    provider: string;
    requests: number;
    tokens: number;
    cost: number;
    avgLatencyMs: number;
  }>;
  byModel: Array<{
    model: string;
    requests: number;
    tokens: number;
    cost: number;
    avgLatencyMs: number;
  }>;
  dailyTrend: Array<{
    date: string;
    count: number;
  }>;
}

// ── Reusable sub-components ───────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────

const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

const formatCost = (cost: number) => {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};

const shortDate = (d: string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Main Component ────────────────────────────────────────────────────

const EmbeddingMetrics: React.FC<EmbeddingMetricsProps> = ({ theme = 'dark' }) => {
  const { getAccessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EmbeddingData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [timeRange, setTimeRange] = useState('7d');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();
      const response = await fetch('/api/admin/analytics/embeddings', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.success) {
        setData(result.embeddings);
        setLastUpdated(new Date());
      } else {
        throw new Error(result.error || 'Failed to fetch embedding metrics');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load embedding metrics');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          crumbs={['Admin', 'Monitoring', 'Embeddings']}
          title="Embedding Metrics"
          explainer="Token usage, request volume, and latency across all embedding deployments."
        />
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 rounded w-1/3" style={{ backgroundColor: 'var(--color-border)' }} />
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 rounded" style={{ backgroundColor: 'var(--color-border)' }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg p-4" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, var(--color-surface))', border: '1px solid var(--color-error)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
          <button
            onClick={fetchData}
            className="mt-2 text-sm underline"
            style={{ color: 'var(--color-error)' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const summary = data?.summary || { totalRequests: 0, totalTokens: 0, totalCost: 0, avgLatencyMs: 0 };

  // Filter provider/model lists by search term
  const filteredProviders = (data?.byProvider || []).filter(p =>
    !searchTerm || p.provider.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredModels = (data?.byModel || []).filter(m =>
    !searchTerm || m.model.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Prepare chart data for daily trend
  const trendData = (data?.dailyTrend || []).map(d => ({
    date: shortDate(d.date),
    Requests: d.count,
  }));

  // Prepare chart data for provider breakdown (bar chart)
  const providerChartData = filteredProviders.map(p => ({
    name: p.provider,
    Requests: p.requests,
    Tokens: p.tokens,
  }));

  // Prepare chart data for model breakdown (bar chart)
  const modelChartData = filteredModels.map(m => ({
    name: m.model.length > 24 ? m.model.slice(0, 22) + '...' : m.model,
    fullName: m.model,
    Requests: m.requests,
    Cost: m.cost,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Monitoring', 'Embeddings']}
        title="Embedding Metrics"
        explainer="Embedding usage statistics: request counts, tokens, costs, and latency."
        actions={[
          { label: 'Refresh', onClick: fetchData },
        ]}
      />

      {/* Filter Bar */}
      <AdminFilterBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        timeRangeOptions={TIME_RANGES}
        onRefresh={fetchData}
        refreshing={loading}
        extraFilters={
          lastUpdated ? (
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          ) : undefined
        }
      />

      {/* Summary Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Total Requests"
          value={formatNumber(summary.totalRequests)}
          icon={<Zap size={20} />}
          tooltip={METRIC_TOOLTIPS.totalRequests}
          sparklineData={data?.dailyTrend?.map(d => d.count)}
        />
        <AdminMetricCard
          label="Total Tokens"
          value={formatNumber(summary.totalTokens)}
          icon={<Activity size={20} />}
          tooltip={METRIC_TOOLTIPS.totalTokens}
        />
        <AdminMetricCard
          label="Total Cost"
          value={formatCost(summary.totalCost)}
          icon={<DollarSign size={20} />}
          tooltip={METRIC_TOOLTIPS.totalCost}
        />
        <AdminMetricCard
          label="Avg Latency"
          value={`${summary.avgLatencyMs}ms`}
          icon={<Clock size={20} />}
          tooltip={METRIC_TOOLTIPS.avgLatency}
        />
      </div>

      {/* Daily Trend Area Chart */}
      {trendData.length > 0 && (
        <AdminCard>
          <SectionHead
            icon={<TrendingUp size={18} />}
            title="Daily Embedding Trend"
            tip={METRIC_TOOLTIPS.dailyTrend}
          />
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="embedTrendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ap-accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--ap-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={formatNumber} />
                <RechartsTooltip content={<ChartTip vFmt={v => formatNumber(v)} />} />
                <Area
                  type="monotone"
                  dataKey="Requests"
                  stroke="var(--ap-accent)"
                  strokeWidth={2}
                  fill="url(#embedTrendGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--ap-accent)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </AdminCard>
      )}

      {/* Provider Breakdown Bar Chart + Table */}
      {filteredProviders.length > 0 && (
        <AdminCard>
          <SectionHead
            icon={<Activity size={18} />}
            title="By Provider"
            tip={METRIC_TOOLTIPS.byProvider}
          />

          {/* Bar chart */}
          {providerChartData.length > 0 && (
            <div style={{ width: '100%', height: 200 }} className="mb-4">
              <ResponsiveContainer>
                <BarChart data={providerChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={formatNumber} />
                  <RechartsTooltip content={<ChartTip vFmt={v => formatNumber(v)} />} />
                  <Bar dataKey="Requests" radius={[4, 4, 0, 0]} maxBarSize={48}>
                    {providerChartData.map((_entry, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detail table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--color-border)' }} className="text-left">
                  <th className="pb-2">Provider</th>
                  <th className="pb-2 text-right">Requests</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {filteredProviders.map((provider, idx) => (
                  <tr key={provider.provider} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                    <td className="py-2 font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                      {provider.provider}
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(provider.requests)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(provider.tokens)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--ap-ok)' }}>{formatCost(provider.cost)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{provider.avgLatencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* Model Breakdown Bar Chart + Table */}
      {filteredModels.length > 0 && (
        <AdminCard>
          <SectionHead
            icon={<TrendingUp size={18} />}
            title="By Model"
            tip={METRIC_TOOLTIPS.byModel}
          />

          {/* Bar chart */}
          {modelChartData.length > 0 && (
            <div style={{ width: '100%', height: 200 }} className="mb-4">
              <ResponsiveContainer>
                <BarChart data={modelChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={formatNumber} />
                  <RechartsTooltip content={<ChartTip vFmt={v => formatNumber(v)} />} />
                  <Bar dataKey="Requests" radius={[4, 4, 0, 0]} maxBarSize={48}>
                    {modelChartData.map((_entry, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detail table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--color-border)' }} className="text-left">
                  <th className="pb-2">Model</th>
                  <th className="pb-2 text-right">Requests</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((model, idx) => (
                  <tr key={model.model} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                    <td className="py-2 font-medium font-mono text-xs flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                      {model.model}
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(model.requests)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(model.tokens)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--ap-ok)' }}>{formatCost(model.cost)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-secondary)' }}>{model.avgLatencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* Empty State */}
      {(!data?.byProvider || data.byProvider.length === 0) &&
       (!data?.byModel || data.byModel.length === 0) && (
        <div className="p-8 text-center" style={{ color: 'var(--text-secondary)' }}>
          <Zap size={48} className="mx-auto mb-4 opacity-50" />
          <p>No embedding data available yet.</p>
          <p className="text-sm mt-2">
            Embedding metrics will appear once embedding requests are logged.
          </p>
        </div>
      )}
    </div>
  );
};

export default EmbeddingMetrics;
