/**
 * Dashboard Overview Component
 *
 * Grafana-style metrics dashboard with beautiful time-series graphs
 * Features:
 * - Real-time metrics from the platform
 * - Time range selector (1h, 6h, 12h, 24h, 7d, 30d, 90d)
 * - Theme-aware styling using CSS variables
 * - Service status indicators
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, MessageSquare, Zap, DollarSign,
  Image, Wrench, TrendingUp, Activity, Clock, Database,
  GitBranch, Gauge, UserCheck, Terminal, Brain, Key,
  GitMerge, Bot, Server, AlertTriangle, CheckCircle, XCircle, Play
} from '@/shared/icons';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { apiRequest } from '../../../../utils/api';
import { useTheme } from '../../../../contexts/ThemeContext';
import {
  LLMSankeyModal,
  SankeyChartHost,
  buildSankeyData,
  formatTokensCompact,
} from '../LLM/LLMSankeyModal';
import { AdminMetricCard, AdminFilterBar, InfoTooltip } from '../Shared';
import { PageHeader } from '../../primitives-v2';

interface DashboardOverviewProps {
  theme: string; // Kept for backwards compat but we use resolvedTheme from context
}

interface MetricsData {
  summary: {
    totalUsers: number;
    activeUsers: number;
    totalSessions: number;
    sessionChange: number;
    totalMessages: number;
    messageChange: number;
    totalTokens: number;
    totalCost: number;
    totalImages: number;
    totalMcpCalls: number;
    totalEmbeddings: number;
    contextWindowAvgUtil?: number;
    // Code Mode metrics
    totalCodeTokens?: number;
    totalCodeCost?: number;
    totalCodeMessages?: number;
    totalCodeSessions?: number;
    // Workflow metrics
    totalWorkflowExecutions?: number;
    totalWorkflows?: number;
    activeWorkflows?: number;
    workflowSuccessRate?: number;
    // Agent metrics
    totalAgentExecutions?: number;
    agentTotalTokens?: number;
    agentTotalCost?: number;
    // API metrics
    totalApiRequests?: number;
    apiErrorRate?: number;
    apiAvgResponseTime?: number;
    // Distribution / breakdown wires for "API & Rate Limits" tab
    responseTimeDistribution?: { bucket: string; count: number }[];
    topEndpoints?: { endpoint: string; count: number }[];
    authMethods?: { method: string; count: number }[];
    sessionDuration?: { bucket: string; count: number }[];
  };
  timeSeries: {
    sessions: { timestamp: string; value: number }[];
    messages: { timestamp: string; value: number }[];
    tokenUsage: { timestamp: string; value: number }[];
    images: { timestamp: string; value: number }[];
    embeddings: { timestamp: string; value: number }[];
    contextUtilization?: { timestamp: string; value: number }[];
    // Code Mode token usage
    codeTokenUsage?: { timestamp: string; value: number }[];
    // Workflow/Agent/API time series
    workflowExecutions?: { timestamp: string; value: number }[];
    agentExecutions?: { timestamp: string; value: number }[];
    apiRequests?: { timestamp: string; value: number }[];
    codeSessions?: { timestamp: string; value: number }[];
  };
  modelUsage: { model: string; count: number; tokens: number; cost: number }[];
  costByModel: { model: string; data: { timestamp: string; value: number }[] }[];
  mcpToolUsage: { tool: string; count: number }[];
  // NEW: Per-user usage
  perUserUsage?: {
    userId: string;
    email: string;
    name: string;
    sessions: number;
    messages: number;
    tokens: number;
    cost: number;
    lastActive: string;
  }[];
  // NEW: Per-user time series
  perUserTimeSeries?: {
    userId: string;
    name: string;
    data: { timestamp: string; value: number }[];
  }[];
  // Pricing source breakdown
  pricingSourceBreakdown?: {
    source: string;
    count: number;
    totalCost: number;
  }[];
  // NEW: Context window metrics
  contextWindowMetrics?: {
    sessionsWithData: number;
    avgUtilization: number;
    maxUtilization: number;
    highUtilizationCount: number;
    totalContextTokens: number;
    avgTokensPerSession: number;
  };
  // NEW: Openagentic CLI metrics
  openagenticMetrics?: {
    totalRequests: number;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalThinkingTokens: number;
    totalCost: number;
    uniqueApiKeys: number;
  };
  openagenticTimeSeries?: {
    requests: { timestamp: string; value: number }[];
    tokens: { timestamp: string; value: number }[];
    cost: { timestamp: string; value: number }[];
  };
  openagenticByApiKey?: {
    apiKeyId: string;
    keyName: string;
    userName: string;
    userEmail: string;
    requests: number;
    tokens: number;
    thinkingTokens: number;
    cost: number;
  }[];
  openagenticModelUsage?: {
    model: string;
    count: number;
    tokens: number;
    cost: number;
    thinkingTokens: number;
  }[];
  // Workflow metrics
  workflowMetrics?: {
    statusCounts: { completed: number; failed: number; running: number; pending: number };
    avgDurationMs: number;
    successRate: number;
    totalWorkflows: number;
    activeWorkflows: number;
  };
  // Agent metrics
  agentMetrics?: {
    statusCounts: { completed: number; failed: number; running: number };
    byAgent: { name: string; count: number; tokens: number; cost: number; avgTime: number }[];
  };
  // API request metrics
  apiMetrics?: {
    totalRequests: number;
    errorCount: number;
    errorRate: number;
    avgResponseTime: number;
    bySource: { source: string; count: number }[];
  };
  // Token usage by source (multi-line chart)
  tokensBySource?: { model: string; data: { timestamp: string; value: number }[] }[];
  tokenTotalsBySource?: Record<string, number>;
  // Per-user token usage by source
  perUserTokensBySource?: {
    userId: string; email: string; name: string;
    chat: number; code: number; flows: number; total: number;
  }[];
}

const TIME_RANGES = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '12h', label: '12h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' }
];

type DashboardTab = 'overview' | 'usage' | 'cost' | 'mcp' | 'flows' | 'infra' | 'api' | 'openagentic';

const DASHBOARD_TABS: { id: DashboardTab; label: string; icon: any }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'usage', label: 'Usage & Tokens', icon: Zap },
  { id: 'cost', label: 'Cost Analysis', icon: DollarSign },
  { id: 'flows', label: 'Flows & Agents', icon: GitMerge },
  { id: 'mcp', label: 'MCP & Tools', icon: Wrench },
  { id: 'api', label: 'API & Limits', icon: Key },
  { id: 'infra', label: 'Infrastructure', icon: Database },
  { id: 'openagentic', label: 'Openagentic', icon: Terminal },
];

// Named export wrapped with React.memo to prevent unnecessary re-renders
export const DashboardOverview: React.FC<DashboardOverviewProps> = React.memo(({ theme: _theme }) => {
  const { resolvedTheme, accentColor } = useTheme();
  const [timeRange, setTimeRange] = useState('24h');
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isSankeyModalOpen, setIsSankeyModalOpen] = useState(false);
  const [dashTab, setDashTab] = useState<DashboardTab>('overview');
  const [searchTerm, setSearchTerm] = useState('');

  // Use resolvedTheme which handles 'system' preference correctly
  const isDark = resolvedTheme === 'dark';

  // Generate chart colors using CSS variables - no hardcoded colors
  const chartColors = useMemo(() => {
    // Return CSS variable references - actual colors come from theme
    return [
      'var(--color-primary)',
      'var(--color-secondary)',
      'var(--lava-color-1, var(--color-primary))',
      'var(--lava-color-2, var(--color-secondary))',
      'var(--accent-info)'
    ];
  }, []);

  // All colors use CSS variables - no hardcoded values
  const colors = useMemo(() => ({
    // Use CSS variables for accent colors
    primary: 'var(--color-primary)',
    primaryRgb: '', // Not needed when using CSS variables with color-mix
    secondary: 'var(--color-secondary)',
    // Background colors - Terminal Glass surface tokens
    cardBg: 'var(--glass-bg)',
    cardBorder: 'var(--glass-border)',
    cardHover: 'var(--ctl-surf-hover)',
    // Text colors - use CSS variables
    textPrimary: 'var(--color-text)',
    textSecondary: 'var(--color-textSecondary)',
    textMuted: 'var(--color-textMuted)',
    // Chart colors - use CSS variables
    gridLine: 'var(--ap-chart-grid, color-mix(in srgb, var(--color-text) 8%, transparent))',
    axisLine: 'var(--color-textMuted)',
    axisTick: 'var(--color-textSecondary)',
    // Tooltip - Terminal Glass surface
    tooltipBg: 'var(--glass-bg)',
    tooltipBorder: 'var(--color-border)',
    tooltipShadow: 'var(--color-shadow)',
    // Status colors - use CSS variables
    success: 'var(--color-success)',
    danger: 'var(--color-error)',
    // Chart gradient colors
    chartColors
  }), [chartColors]);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // /api/admin/dashboard/metrics is removed in OSS.
      // Use /api/admin/dashboard/counts (7 plain integers) instead.
      const response = await apiRequest('/admin/dashboard/counts');

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard counts');
      }

      const data = await response.json();
      // Map counts → MetricsData shape so the rest of the component works.
      // Fields not in the counts response are zeroed out / empty arrays.
      const mapped: MetricsData = {
        summary: {
          totalUsers: data.users ?? 0,
          activeUsers: 0,
          totalSessions: data.chats ?? 0,
          sessionChange: 0,
          totalMessages: data.messages ?? 0,
          messageChange: 0,
          totalTokens: 0,
          totalCost: 0,
          totalImages: 0,
          totalMcpCalls: 0,
          totalEmbeddings: 0,
          totalWorkflowExecutions: data.flowRuns ?? 0,
          totalWorkflows: data.workflows ?? 0,
          activeWorkflows: 0,
          workflowSuccessRate: 0,
          totalAgentExecutions: data.agentRuns ?? 0,
          agentTotalTokens: 0,
          agentTotalCost: 0,
          totalApiRequests: data.llmRequests ?? 0,
          apiErrorRate: 0,
          apiAvgResponseTime: 0,
        },
        timeSeries: {
          sessions: [],
          messages: [],
          tokenUsage: [],
          images: [],
          embeddings: [],
        },
        modelUsage: [],
        costByModel: [],
        mcpToolUsage: [],
      };
      setMetrics(mapped);
      setLastRefresh(new Date());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (timeRange.includes('h')) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (timeRange === '7d') {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            background: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
            borderRadius: '8px',
            padding: '8px 12px',
            boxShadow: colors.tooltipShadow
          }}
        >
          <p style={{ color: colors.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '4px' }}>
            {formatTimestamp(label)}
          </p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: colors.textPrimary, fontSize: '13px', fontWeight: 600 }}>
              {entry.name}: {formatNumber(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Stat card — delegates to shared AdminMetricCard
  const StatCard = ({
    icon: Icon,
    label,
    value,
    subValue,
    change,
    tooltip
  }: {
    icon: any;
    label: string;
    value: string | number;
    subValue?: string;
    change?: number;
    tooltip?: string;
  }) => (
    <AdminMetricCard
      label={label}
      value={typeof value === 'number' ? formatNumber(value) : value}
      subtext={subValue}
      icon={<Icon size={18} />}
      trend={change !== undefined ? {
        value: Math.abs(Number(change.toFixed(1))),
        direction: change >= 0 ? 'up' : 'down'
      } : undefined}
      tooltip={tooltip}
      loading={loading && !metrics}
    />
  );

  // Area chart component
  const MetricChart = ({
    title,
    data,
    dataKey = 'value',
    chartColor = colors.chartColors[0]
  }: {
    title: string;
    data: any[];
    dataKey?: string;
    chartColor?: string;
  }) => (
    <div
      className="rounded-xl p-4"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.cardBorder}`,
        backdropFilter: 'blur(8px)'
      }}
    >
      <h3 className="text-sm font-medium mb-4" style={{ color: colors.textSecondary }}>{title}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`gradient-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity={0.4} />
                <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridLine} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTimestamp}
              tick={{ fill: colors.axisTick, fontSize: 10 }}
              axisLine={{ stroke: colors.axisLine }}
              tickLine={{ stroke: colors.axisLine }}
            />
            <YAxis
              tickFormatter={formatNumber}
              tick={{ fill: colors.axisTick, fontSize: 10 }}
              axisLine={{ stroke: colors.axisLine }}
              tickLine={{ stroke: colors.axisLine }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={chartColor}
              strokeWidth={2}
              fill={`url(#gradient-${title.replace(/\s/g, '')})`}
              name={title}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // Line chart for multi-series data
  const MultiLineChart = ({
    title,
    series
  }: {
    title: string;
    series: { model: string; data: any[] }[];
  }) => {
    const mergedData = useMemo(() => {
      const dataMap = new Map<string, any>();
      for (const s of series) {
        for (const point of s.data) {
          if (!dataMap.has(point.timestamp)) {
            dataMap.set(point.timestamp, { timestamp: point.timestamp });
          }
          dataMap.get(point.timestamp)[s.model] = point.value;
        }
      }
      return Array.from(dataMap.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    }, [series]);

    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.cardBorder}`,
          backdropFilter: 'blur(8px)'
        }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: colors.textSecondary }}>{title}</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.gridLine} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTimestamp}
                tick={{ fill: colors.axisTick, fontSize: 10 }}
                axisLine={{ stroke: colors.axisLine }}
                tickLine={{ stroke: colors.axisLine }}
              />
              <YAxis
                tickFormatter={(v) => `$${v.toFixed(2)}`}
                tick={{ fill: colors.axisTick, fontSize: 10 }}
                axisLine={{ stroke: colors.axisLine }}
                tickLine={{ stroke: colors.axisLine }}
              />
              <Tooltip content={<CustomTooltip />} />
              {series.map((s, i) => (
                <Line
                  key={s.model}
                  type="monotone"
                  dataKey={s.model}
                  stroke={colors.chartColors[i % colors.chartColors.length]}
                  strokeWidth={2}
                  dot={false}
                  name={s.model}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          {series.map((s, i) => (
            <div key={s.model} className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: colors.chartColors[i % colors.chartColors.length] }}
              />
              <span className="text-xs" style={{ color: colors.textMuted }}>{s.model}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // LLM Model Usage — INLINE LIVE SANKEY (B'-12).
  // Was: horizontal BarChart with "Click to explore" pill that
  // opened the modal. User: "make THIS graph in Dashboard overview a
  // LIVE fucking sankey with ALL REAL DATA - LLM Model Usage - and
  // ditch the CLICK TO EXPLORE". Card now embeds the same sankey
  // engine the modal uses, fed the same metrics.modelUsage payload,
  // height-shrunk to 320px to fit the dashboard grid.
  const ModelUsageChart = ({
    data,
  }: {
    data: { model: string; count: number; tokens?: number; cost: number }[];
    onTitleClick?: () => void; // legacy prop tolerated by callers; ignored
  }) => {
    const modelUsage = data.map((d) => ({
      model: d.model,
      count: d.count ?? 0,
      tokens: (d as any).tokens ?? 0,
      cost: d.cost ?? 0,
    }));
    const sankeyData = buildSankeyData(modelUsage);
    const sankeyColors = {
      background: 'var(--color-background)',
      cardBg: 'var(--glass-bg)',
      glassBg: 'var(--glass-bg)',
      border: 'var(--glass-border)',
      textPrimary: 'var(--color-text)',
      textSecondary: 'var(--color-textSecondary)',
      textMuted: 'var(--color-textMuted)',
      accent: 'var(--color-primary)',
    };
    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.cardBorder}`,
          backdropFilter: 'blur(8px)'
        }}
      >
        <h3
          className="text-sm font-medium mb-3"
          style={{ color: colors.textSecondary }}
        >
          LLM Model Usage
        </h3>
        <SankeyChartHost
          modelUsage={modelUsage}
          sankeyData={sankeyData}
          colors={sankeyColors}
          isDark={resolvedTheme === 'dark'}
          formatTokens={formatTokensCompact}
          height={320}
          flush
        />
      </div>
    );
  };

  // Provider / Model usage histogram — horizontal bars sorted by call count.
  // Complement to the sankey (which shows flow): this surfaces RAW VOLUME per
  // model + cost-per-call inline, so operators can spot expensive low-volume
  // models or high-volume cheap ones at a glance.
  const ProviderModelHistogram = ({
    data,
  }: {
    data: { model: string; count: number; tokens?: number; cost: number }[];
  }) => {
    const top = [...(data || [])]
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 8)
      .map((d) => ({
        model: d.model,
        count: d.count || 0,
        tokens: (d as any).tokens || 0,
        cost: d.cost || 0,
      }));
    if (top.length === 0) {
      return (
        <div
          className="rounded-xl p-4"
          style={{
            background: colors.cardBg,
            border: `1px solid ${colors.cardBorder}`,
            backdropFilter: 'blur(8px)',
          }}
        >
          <h3 className="text-sm font-medium mb-3" style={{ color: colors.textSecondary }}>
            Provider / Model Usage
          </h3>
          <p className="text-xs" style={{ color: colors.textMuted }}>
            No model usage in window — try widening the time range.
          </p>
        </div>
      );
    }
    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.cardBorder}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <h3
          className="text-sm font-medium mb-3 flex items-center gap-2"
          style={{ color: colors.textSecondary }}
        >
          Provider / Model Usage
          <InfoTooltip content="Top 8 models by request count. Bar = calls, label shows total cost in window." />
        </h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top} layout="vertical" margin={{ left: 60, right: 40 }}>
              <CartesianGrid horizontal={false} stroke={colors.cardBorder} strokeOpacity={0.4} />
              <XAxis type="number" stroke={colors.textMuted} fontSize={10} />
              <YAxis
                type="category"
                dataKey="model"
                stroke={colors.textMuted}
                fontSize={10}
                width={140}
                tick={{ fill: colors.textPrimary }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const r = payload[0].payload as { model: string; count: number; tokens: number; cost: number };
                  return (
                    <div
                      style={{
                        background: colors.tooltipBg,
                        border: `1px solid ${colors.tooltipBorder}`,
                        borderRadius: '8px',
                        padding: '8px 12px',
                        boxShadow: colors.tooltipShadow,
                      }}
                    >
                      <p style={{ color: colors.textPrimary, fontWeight: 600, fontSize: '13px' }}>{r.model}</p>
                      <p style={{ color: colors.textSecondary, fontSize: 'var(--text-xs)' }}>{formatNumber(r.count)} calls</p>
                      <p style={{ color: colors.textSecondary, fontSize: 'var(--text-xs)' }}>{formatNumber(r.tokens)} tokens</p>
                      <p style={{ color: colors.textSecondary, fontSize: 'var(--text-xs)' }}>${r.cost.toFixed(2)}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" radius={[0, 1, 1, 0]}>
                {top.map((_, i) => (
                  <Cell key={`pmh-${i}`} fill={colors.chartColors[i % colors.chartColors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  // Generic donut/ring chart for {label, count}[] payloads. Renders an
  // explicit empty state when the data is missing or all-zero so the
  // panel reads "no calls in window" instead of going blank — the
  // user's complaint that the rings "don't work" was the empty payload.
  const RingChart = ({
    title,
    tooltip,
    data,
    valueLabel = 'calls',
    emptyHint = 'No data in selected time range — try widening the window.',
  }: {
    title: string;
    tooltip: string;
    data: { name: string; count: number }[];
    valueLabel?: string;
    emptyHint?: string;
  }) => {
    const slices = (data || []).filter((d) => (d.count || 0) > 0).slice(0, 5);
    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.cardBorder}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: colors.textSecondary }}>
          {title}
          <InfoTooltip content={tooltip} />
        </h3>
        {slices.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2 text-center" style={{ color: colors.textMuted, fontSize: 12 }}>
            <Activity size={28} style={{ opacity: 0.3 }} />
            <p style={{ maxWidth: 240 }}>{emptyHint}</p>
          </div>
        ) : (
          <div className="h-48 flex items-center">
            <ResponsiveContainer width="50%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="count"
                  nameKey="name"
                >
                  {slices.map((_, i) => (
                    <Cell key={`cell-${i}`} fill={colors.chartColors[i % colors.chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div style={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: '8px', padding: '8px 12px', boxShadow: colors.tooltipShadow }}>
                          <p style={{ color: colors.textPrimary, fontWeight: 600, fontSize: '13px' }}>{payload[0].name}</p>
                          <p style={{ color: colors.textSecondary, fontSize: 'var(--text-xs)' }}>{payload[0].value} {valueLabel}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {slices.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.chartColors[i % colors.chartColors.length] }} />
                    <span className="text-xs truncate max-w-[120px]" style={{ color: colors.textMuted }}>{item.name}</span>
                  </div>
                  <span className="text-xs font-medium" style={{ color: colors.textPrimary }}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Adapters preserving the legacy call sites. MCPToolChart is also called
  // from the MCP & Tools tab below, so keep the old prop shape.
  const MCPToolChart = ({ data }: { data: { tool: string; count: number }[] }) => (
    <RingChart
      title="MCP Tool Usage"
      tooltip="Most frequently called MCP tools across all chat sessions in the selected time range."
      data={(data || []).map((d) => ({ name: d.tool, count: d.count }))}
      valueLabel="calls"
      emptyHint="No MCP tool calls yet — make a request that uses tools to populate this."
    />
  );

  const AgentUsageChart = ({ data }: { data: { name: string; count: number }[] }) => (
    <RingChart
      title="Agent Usage"
      tooltip="Most frequently invoked agents across workflows + flows in the selected time range."
      data={data}
      valueLabel="runs"
      emptyHint="No agent runs in window — flows / workflows haven't dispatched any agents yet."
    />
  );

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          crumbs={['Admin', 'Overview']}
          title="Dashboard Overview"
          explainer="Real-time system performance metrics across all platform modes: Chat, Code, Flows, and Agents."
        />
        <div className="p-8 text-center">
          <Activity size={48} className="mx-auto mb-4" style={{ color: colors.danger }} />
          <h3 className="text-lg font-medium mb-2" style={{ color: colors.textPrimary }}>Failed to load metrics</h3>
          <p className="mb-4" style={{ color: colors.textSecondary }}>{error}</p>
          <button
            onClick={fetchMetrics}
            className="px-4 py-2 rounded-lg transition-colors"
            style={{ background: colors.primary, color: 'var(--color-text)' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Overview']}
        title="Dashboard Overview"
        explainer="Real-time system performance metrics across all platform modes: Chat, Code, Flows, and Agents."
        actions={[
          { label: 'Refresh', onClick: fetchMetrics },
        ]}
      />

      {/* Filter bar */}
      <div className="space-y-3">
        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          timeRangeOptions={TIME_RANGES}
          onRefresh={fetchMetrics}
          refreshing={loading}
        />
      </div>

      {/* Loading State */}
      {loading && !metrics && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-12 h-12 border-4 rounded-full animate-spin"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-primary) 20%, transparent)',
                borderTopColor: colors.primary
              }}
            />
            <p style={{ color: colors.textSecondary }}>Loading metrics...</p>
          </div>
        </div>
      )}

      {metrics && (
        <>
          {/*
            Tab Bar — moved to TOP of dashboard content (B'-10).
            Uses the v3 admin shell signature: uppercase 11px tracked
            telemetry typography, hairline 1px border below, sticky to
            the scroll container so it stays reachable from any depth.
          */}
          <div
            className="aw-dash-tabs"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              padding: '0 4px',
              borderBottom: '1px solid var(--glass-border)',
              background: 'var(--ctl-surf)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              position: 'sticky',
              top: 0,
              zIndex: 5,
              overflowX: 'auto',
            }}
          >
            {DASHBOARD_TABS
              .filter(tab => tab.id !== 'openagentic' || (metrics.openagenticMetrics?.totalRequests ?? 0) > 0)
              .map((tab) => {
                const TabIcon = tab.icon;
                const isActive = dashTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setDashTab(tab.id)}
                    style={{
                      appearance: 'none',
                      background: 'none',
                      border: 0,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-v3-tele, var(--font-v3-body, inherit))',
                      fontSize: 11,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      padding: '10px 14px',
                      color: isActive ? 'var(--accent, var(--color-primary))' : 'var(--fg-3, var(--text-tertiary))',
                      position: 'relative',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <TabIcon size={12} />
                    {tab.label}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: 14,
                          right: 14,
                          bottom: -1,
                          height: 1,
                          background: 'var(--accent, var(--color-primary))',
                        }}
                      />
                    )}
                  </button>
                );
              })}
          </div>

          {/* Primary Stats: All Platform Modes */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard icon={Users} label="Total Users" value={metrics.summary.totalUsers} subValue={`${metrics.summary.activeUsers} active`} />
            <StatCard icon={MessageSquare} label="Chat Sessions" value={metrics.summary.totalSessions} change={metrics.summary.sessionChange} />
            <StatCard icon={Activity} label="Messages" value={metrics.summary.totalMessages} change={metrics.summary.messageChange} />
            <StatCard icon={Terminal} label="Code Sessions" value={metrics.summary.totalCodeSessions || 0} subValue={`${metrics.summary.totalCodeMessages || 0} requests`} />
            <StatCard icon={GitMerge} label="Flow Executions" value={metrics.summary.totalWorkflowExecutions || 0} subValue={`${metrics.summary.workflowSuccessRate || 0}% success`} />
            <StatCard icon={Bot} label="Agent Runs" value={metrics.summary.totalAgentExecutions || 0} subValue={metrics.summary.agentTotalCost ? `$${metrics.summary.agentTotalCost.toFixed(2)}` : undefined} />
          </div>

          {/* Secondary Stats: Tokens, Cost, Infrastructure */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard icon={Zap} label="Chat Tokens" value={metrics.summary.totalTokens} />
            <StatCard icon={GitBranch} label="Code Tokens" value={metrics.summary.totalCodeTokens || 0} />
            <StatCard icon={DollarSign} label="Total Cost" value={`$${((metrics.summary.totalCost || 0) + (metrics.summary.totalCodeCost || 0) + (metrics.summary.agentTotalCost || 0)).toFixed(2)}`} subValue={`Chat $${(metrics.summary.totalCost || 0).toFixed(2)} | Code $${(metrics.summary.totalCodeCost || 0).toFixed(2)}`} />
            <StatCard icon={Server} label="API Requests" value={metrics.summary.totalApiRequests || 0} subValue={`${metrics.summary.apiAvgResponseTime || 0}ms avg`} />
            <StatCard icon={Wrench} label="MCP Tool Calls" value={metrics.summary.totalMcpCalls} />
            <StatCard icon={Image} label="Images Generated" value={metrics.summary.totalImages} />
            <div
              className="rounded-xl p-4 flex items-center justify-between"
              style={{
                background: colors.cardBg,
                border: `1px solid ${colors.cardBorder}`,
                backdropFilter: 'blur(8px)'
              }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-success) 10%, transparent)' }}>
                  <Clock size={18} style={{ color: colors.success }} />
                </div>
                <div>
                  <div className="text-sm" style={{ color: colors.textPrimary }}>Last Updated</div>
                  <div className="text-xs" style={{ color: colors.textSecondary }}>
                    {lastRefresh.toLocaleTimeString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: colors.success }} />
                <span className="text-xs" style={{ color: colors.success }}>Live</span>
              </div>
            </div>
          </div>

          {/* (Tab bar moved to top — see above; legacy second copy removed in B'-10.) */}

          {/* === TAB: Overview — All Platform Activity === */}
          {dashTab === 'overview' && (
            <div className="space-y-4">
              {/* AT-A-GLANCE VISUALIZATIONS — the most important graphs surface first.
                  Per user direction: cards are secondary; sankey + MCP ring + per-model
                  histogram are what operators look at to read system state. */}

              {/* LLM Model Usage — full-width inline sankey */}
              <ModelUsageChart data={metrics.modelUsage} />

              {/* Provider / Model Usage — line graph (timeseries by model)
                  matches the visual language of the other timeseries cards
                  on this tab instead of the prior bar histogram. */}
              <MultiLineChart title="Cost by Model" series={metrics.costByModel} />

              {/* 2-column: MCP Tool Usage ring + Agent Usage ring */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <MCPToolChart data={metrics.mcpToolUsage} />
                <AgentUsageChart data={(metrics.agentMetrics?.byAgent ?? []).map(a => ({ name: a.name, count: a.count }))} />
              </div>

              {/* Row 1: Activity charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <MetricChart title="Chat Sessions" data={metrics.timeSeries.sessions} chartColor={colors.chartColors[0]} />
                <MetricChart title="Messages" data={metrics.timeSeries.messages} chartColor={colors.chartColors[1]} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {metrics.timeSeries.codeSessions && (
                  <MetricChart title="Code Mode Sessions" data={metrics.timeSeries.codeSessions} chartColor="var(--color-secondary)" />
                )}
                {metrics.timeSeries.workflowExecutions && (
                  <MetricChart title="Workflow Executions" data={metrics.timeSeries.workflowExecutions} chartColor="var(--color-warning)" />
                )}
              </div>

              {/* Token Usage by Source — combined multi-line chart */}
              {metrics.tokensBySource && metrics.tokensBySource.length > 0 && (
                <div>
                  <MultiLineChart
                    title="Token Usage by Source"
                    series={metrics.tokensBySource.map(s => ({
                      model: s.model === 'chat' ? 'Chat' : s.model === 'code' ? 'Code Mode' : s.model === 'flows' ? 'Flows & Agents' : s.model === 'api' ? 'API' : s.model,
                      data: s.data,
                    }))}
                  />
                  {/* Source totals legend — always show all sources */}
                  {metrics.tokenTotalsBySource && (
                    <div className="flex flex-wrap gap-3 mt-2">
                      {Object.entries(metrics.tokenTotalsBySource)
                        .map(([source, total]) => (
                          <span
                            key={source}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                            style={{
                              background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                              color: colors.textPrimary,
                              border: `1px solid ${colors.cardBorder}`
                            }}
                          >
                            {source === 'chat' ? 'Chat' : source === 'code' ? 'Code Mode' : source === 'flows' ? 'Flows & Agents' : source === 'api' ? 'API' : source}:
                            <strong>{formatNumber(total)}</strong> tokens
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              )}
              {/* Fallback if tokensBySource not available */}
              {(!metrics.tokensBySource || metrics.tokensBySource.length === 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricChart title="Token Usage (Chat)" data={metrics.timeSeries.tokenUsage} chartColor={colors.chartColors[2]} />
                  {metrics.timeSeries.codeTokenUsage && (
                    <MetricChart title="Token Usage (Code)" data={metrics.timeSeries.codeTokenUsage} chartColor="var(--color-secondary)" />
                  )}
                </div>
              )}

              {/* Per-User Token Usage by Source */}
              {metrics.perUserTokensBySource && (
                <div
                  className="rounded-xl p-4"
                  style={{
                    background: colors.cardBg,
                    border: `1px solid ${colors.cardBorder}`,
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <h3 className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: colors.textSecondary }}>
                    <Users size={16} />
                    Token Usage by User &amp; Feature
                    <InfoTooltip content="Token consumption broken down by user and platform feature (Chat, Code Mode, Flows)." />
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.cardBorder}` }}>
                          <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>User</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Chat</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Code Mode</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Flows</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.perUserTokensBySource.map((user, index) => {
                          const maxTokens = metrics.perUserTokensBySource![0]?.total || 1;
                          return (
                            <tr
                              key={user.userId}
                              style={{
                                borderBottom: index < metrics.perUserTokensBySource!.length - 1 ? `1px solid ${colors.cardBorder}` : 'none'
                              }}
                            >
                              <td className="py-2 px-3">
                                <div style={{ color: colors.textPrimary }} className="font-medium truncate max-w-[200px]">
                                  {user.name || 'Unknown'}
                                </div>
                                <div className="text-xs truncate max-w-[200px]" style={{ color: colors.textMuted }}>
                                  {user.email}
                                </div>
                              </td>
                              <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                                {formatNumber(user.chat)}
                              </td>
                              <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                                {formatNumber(user.code)}
                              </td>
                              <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                                {formatNumber(user.flows)}
                              </td>
                              <td className="text-right py-2 px-3">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--color-text) 10%, transparent)' }}>
                                    <div
                                      className="h-full rounded-full"
                                      style={{
                                        width: `${Math.round((user.total / maxTokens) * 100)}%`,
                                        background: colors.primary,
                                      }}
                                    />
                                  </div>
                                  <span className="font-medium" style={{ color: colors.primary }}>
                                    {formatNumber(user.total)}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === TAB: Usage & Tokens === */}
          {dashTab === 'usage' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <MetricChart title="Chat Token Usage" data={metrics.timeSeries.tokenUsage} chartColor={colors.chartColors[2]} />
                {metrics.timeSeries.codeTokenUsage && (
                  <MetricChart title="Code Mode Token Usage" data={metrics.timeSeries.codeTokenUsage} chartColor="var(--color-secondary)" />
                )}
              </div>
              <ModelUsageChart
                data={metrics.modelUsage}
                onTitleClick={() => setIsSankeyModalOpen(true)}
              />
              <MultiLineChart title="Cost by Model" series={metrics.costByModel} />
            </div>
          )}

          {/* === TAB: Cost Analysis === */}
          {dashTab === 'cost' && (
            <div className="space-y-4">
              {/* Pricing Source Badges */}
              {metrics.pricingSourceBreakdown && (
                <div className="flex flex-wrap gap-2">
                  {metrics.pricingSourceBreakdown.map((ps) => {
                    const isEstimated = ps.source === 'fallback' || ps.source === 'unknown';
                    return (
                      <span
                        key={ps.source}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                        style={{
                          background: isEstimated
                            ? 'color-mix(in srgb, var(--color-warning) 15%, transparent)'
                            : 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                          color: isEstimated
                            ? 'var(--ap-warn)'
                            : 'var(--color-success)',
                          border: `1px solid ${isEstimated ? 'color-mix(in srgb, var(--color-warning, var(--ap-warn)) 30%, transparent)' : 'color-mix(in srgb, var(--color-success) 30%, transparent)'}`,
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{
                          background: isEstimated ? 'var(--ap-warn)' : 'var(--color-success)',
                        }} />
                        {ps.source}: {ps.count} requests (${ps.totalCost.toFixed(2)})
                        {isEstimated && ' — estimated'}
                      </span>
                    );
                  })}
                </div>
              )}
              {/* Per-User Usage Table */}
              {metrics.perUserUsage && (
                <div
                  className="rounded-xl p-4"
                  style={{
                    background: colors.cardBg,
                    border: `1px solid ${colors.cardBorder}`,
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textSecondary }}>
                      <UserCheck size={16} />
                      Top Users by Cost
                      <InfoTooltip content="Users ranked by total LLM spend across all modes within the selected time range." />
                    </h3>
                    <span className="text-xs" style={{ color: colors.textMuted }}>
                      {metrics.perUserUsage.length} users
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.cardBorder}` }}>
                          <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>User</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Sessions</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Messages</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Tokens</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Cost</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Last Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.perUserUsage.slice(0, 10).map((user, index) => (
                          <tr
                            key={user.userId}
                            style={{
                              borderBottom: index < 9 ? `1px solid ${colors.cardBorder}` : 'none'
                            }}
                          >
                            <td className="py-2 px-3">
                              <div style={{ color: colors.textPrimary }} className="font-medium truncate max-w-[200px]">
                                {user.name || 'Unknown'}
                              </div>
                              <div className="text-xs truncate max-w-[200px]" style={{ color: colors.textMuted }}>
                                {user.email}
                              </div>
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                              {user.sessions}
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                              {formatNumber(user.messages)}
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                              {formatNumber(user.tokens)}
                            </td>
                            <td className="text-right py-2 px-3 font-medium" style={{ color: colors.primary }}>
                              ${user.cost.toFixed(2)}
                            </td>
                            <td className="text-right py-2 px-3 text-xs" style={{ color: colors.textMuted }}>
                              {new Date(user.lastActive).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Per-User Cost Time Series */}
              {metrics.perUserTimeSeries && (
                <MultiLineChart
                  title="Cost by User (Top 10)"
                  series={metrics.perUserTimeSeries.map(u => ({ model: u.name, data: u.data }))}
                />
              )}

              {/* Sankey trigger button */}
              <button
                onClick={() => setIsSankeyModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                  color: colors.primary,
                  border: `1px solid ${colors.cardBorder}`
                }}
              >
                <TrendingUp size={14} />
                Open LLM Cost Sankey Diagram
              </button>
            </div>
          )}

          {/* === TAB: Flows & Agents === */}
          {dashTab === 'flows' && (
            <div className="space-y-4">
              {/* Workflow Status Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <StatCard icon={GitMerge} label="Total Workflows" value={metrics.workflowMetrics?.totalWorkflows || 0} subValue={`${metrics.workflowMetrics?.activeWorkflows || 0} active`} />
                <StatCard icon={Play} label="Executions" value={metrics.summary.totalWorkflowExecutions || 0} />
                <StatCard icon={CheckCircle} label="Completed" value={metrics.workflowMetrics?.statusCounts?.completed || 0} />
                <StatCard icon={XCircle} label="Failed" value={metrics.workflowMetrics?.statusCounts?.failed || 0} />
                <StatCard icon={Clock} label="Avg Duration" value={`${((metrics.workflowMetrics?.avgDurationMs || 0) / 1000).toFixed(1)}s`} subValue={`${metrics.workflowMetrics?.successRate || 0}% success rate`} />
              </div>

              {/* Workflow Execution Chart */}
              {metrics.timeSeries.workflowExecutions && (
                <MetricChart title="Workflow Executions Over Time" data={metrics.timeSeries.workflowExecutions} chartColor="var(--color-warning)" />
              )}

              {/* Agent Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={Bot} label="Agent Runs" value={metrics.summary.totalAgentExecutions || 0} />
                <StatCard icon={CheckCircle} label="Agent Completed" value={metrics.agentMetrics?.statusCounts?.completed || 0} />
                <StatCard icon={XCircle} label="Agent Failed" value={metrics.agentMetrics?.statusCounts?.failed || 0} />
                <StatCard icon={DollarSign} label="Agent Cost" value={`$${(metrics.summary.agentTotalCost || 0).toFixed(2)}`} subValue={`${formatNumber(metrics.summary.agentTotalTokens || 0)} tokens`} />
              </div>

              {/* Agent Execution Chart */}
              {metrics.timeSeries.agentExecutions && (
                <MetricChart title="Agent Executions Over Time" data={metrics.timeSeries.agentExecutions} chartColor="var(--color-error)" />
              )}

              {/* Agent Usage Table */}
              {metrics.agentMetrics?.byAgent && (
                <div
                  className="rounded-xl p-4"
                  style={{
                    background: colors.cardBg,
                    border: `1px solid ${colors.cardBorder}`,
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <h3 className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: colors.textSecondary }}>
                    <Bot size={16} />
                    Agent Usage Breakdown
                    <InfoTooltip content="Per-agent execution stats including run count, token usage, cost, and average execution time." />
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.cardBorder}` }}>
                          <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Agent</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Runs</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Tokens</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Cost</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Avg Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.agentMetrics.byAgent.map((agent, index) => (
                          <tr key={agent.name} style={{ borderBottom: index < metrics.agentMetrics!.byAgent.length - 1 ? `1px solid ${colors.cardBorder}` : 'none' }}>
                            <td className="py-2 px-3 font-medium" style={{ color: colors.textPrimary }}>{agent.name}</td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>{agent.count}</td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>{formatNumber(agent.tokens)}</td>
                            <td className="text-right py-2 px-3 font-medium" style={{ color: colors.primary }}>${agent.cost.toFixed(2)}</td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textMuted }}>{(agent.avgTime / 1000).toFixed(1)}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {(!metrics.summary.totalWorkflowExecutions && !metrics.summary.totalAgentExecutions) && (
                <div
                  className="rounded-xl p-8 text-center"
                  style={{ background: colors.cardBg, border: `1px solid ${colors.cardBorder}` }}
                >
                  <GitMerge size={32} className="mx-auto mb-2" style={{ color: colors.textMuted }} />
                  <p style={{ color: colors.textSecondary }}>No workflow or agent executions in this time range</p>
                  <p className="text-xs mt-1" style={{ color: colors.textMuted }}>Create workflows in Flows mode or trigger agents from Chat</p>
                </div>
              )}
            </div>
          )}

          {/* === TAB: MCP & Tools === */}
          {dashTab === 'mcp' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {metrics.mcpToolUsage.length > 0 ? (
                <MCPToolChart data={metrics.mcpToolUsage} />
              ) : (
                <div
                  className="rounded-xl p-8 text-center col-span-2"
                  style={{ background: colors.cardBg, border: `1px solid ${colors.cardBorder}` }}
                >
                  <Wrench size={32} className="mx-auto mb-2" style={{ color: colors.textMuted }} />
                  <p style={{ color: colors.textSecondary }}>No MCP tool usage in this time range</p>
                </div>
              )}
            </div>
          )}

          {/* === TAB: Infrastructure === */}
          {dashTab === 'infra' && (
            <div className="space-y-4">
              {/* API Request Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={Server} label="Total API Requests" value={metrics.apiMetrics?.totalRequests || 0} />
                <StatCard icon={AlertTriangle} label="Errors" value={metrics.apiMetrics?.errorCount || 0} subValue={`${metrics.apiMetrics?.errorRate || 0}% error rate`} />
                <StatCard icon={Clock} label="Avg Response Time" value={`${metrics.apiMetrics?.avgResponseTime || 0}ms`} />
                <StatCard icon={Database} label="Embeddings Stored" value={metrics.summary.totalEmbeddings || 0} />
              </div>

              {/* API Requests Chart */}
              {metrics.timeSeries.apiRequests && (
                <MetricChart title="API Requests Over Time" data={metrics.timeSeries.apiRequests} chartColor="var(--accent-info)" />
              )}

              {/* API Source Breakdown */}
              {metrics.apiMetrics?.bySource && (
                <div
                  className="rounded-xl p-4"
                  style={{ background: colors.cardBg, border: `1px solid ${colors.cardBorder}` }}
                >
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: colors.textSecondary }}>
                    <Server size={16} />
                    Requests by Source
                    <InfoTooltip content="API request volume grouped by client source (UI, CLI, API keys, webhooks)." />
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {metrics.apiMetrics.bySource.map((s) => (
                      <span
                        key={s.source}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                        style={{
                          background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                          color: colors.textPrimary,
                          border: `1px solid ${colors.cardBorder}`
                        }}
                      >
                        {s.source}: <strong>{formatNumber(s.count)}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {metrics.timeSeries.images && (
                  <MetricChart title="Images Generated" data={metrics.timeSeries.images} chartColor="var(--color-secondary)" />
                )}
                {metrics.timeSeries.embeddings && (
                  <MetricChart title="Embeddings Stored" data={metrics.timeSeries.embeddings} chartColor="var(--accent-info)" />
                )}
              </div>

              {/* Context Utilization */}
              {metrics.timeSeries.contextUtilization && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricChart
                    title="Context Window Utilization %"
                    data={metrics.timeSeries.contextUtilization}
                    chartColor="var(--color-warning)"
                  />
                  <div
                    className="rounded-xl p-4"
                    style={{
                      background: colors.cardBg,
                      border: `1px solid ${colors.cardBorder}`,
                      backdropFilter: 'blur(8px)'
                    }}
                  >
                    <h3 className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: colors.textSecondary }}>
                      Context Window Summary
                      <InfoTooltip content="How much of the LLM context window is being used across sessions. High utilization may trigger auto-compaction." />
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
                        <div className="text-2xl font-bold" style={{ color: colors.primary }}>
                          {metrics.contextWindowMetrics?.sessionsWithData || 0}
                        </div>
                        <div className="text-xs" style={{ color: colors.textMuted }}>Sessions Tracked</div>
                      </div>
                      <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)' }}>
                        <div className="text-2xl font-bold" style={{ color: 'var(--color-warning)' }}>
                          {(metrics.contextWindowMetrics?.maxUtilization || 0).toFixed(1)}%
                        </div>
                        <div className="text-xs" style={{ color: colors.textMuted }}>Max Utilization</div>
                      </div>
                      <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, transparent)' }}>
                        <div className="text-2xl font-bold" style={{ color: 'var(--color-error)' }}>
                          {metrics.contextWindowMetrics?.highUtilizationCount || 0}
                        </div>
                        <div className="text-xs" style={{ color: colors.textMuted }}>High Usage (≥80%)</div>
                      </div>
                      <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-success) 10%, transparent)' }}>
                        <div className="text-2xl font-bold" style={{ color: 'var(--color-success)' }}>
                          {formatNumber(metrics.contextWindowMetrics?.avgTokensPerSession || 0)}
                        </div>
                        <div className="text-xs" style={{ color: colors.textMuted }}>Avg Tokens/Session</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === TAB: API & Rate Limits === */}
          {dashTab === 'api' && (
            <div className="space-y-4">
              {/* API Metric Cards — REAL DATA ONLY (B'-10).
                  Previously contained fabricated trends (12, -0.1) +
                  hardcoded fallbacks (`* 12`, `|| 137`). Now strict —
                  reads only api-surfaced fields; missing values render
                  '—' not a fabrication. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <AdminMetricCard
                  label="API Requests"
                  value={metrics.summary.totalApiRequests != null ? metrics.summary.totalApiRequests.toLocaleString() : '—'}
                  icon={<Key size={18} />}
                  subtext={`${timeRange} period`}
                />
                <AdminMetricCard
                  label="Error Rate"
                  value={metrics.summary.apiErrorRate != null ? `${metrics.summary.apiErrorRate.toFixed(1)}%` : '—'}
                  icon={<AlertTriangle size={18} />}
                  subtext="4xx + 5xx responses"
                />
                <AdminMetricCard
                  label="Avg Response"
                  value={metrics.summary.apiAvgResponseTime != null ? `${metrics.summary.apiAvgResponseTime.toFixed(0)}ms` : '—'}
                  icon={<Clock size={18} />}
                  subtext="p50 latency"
                />
                <AdminMetricCard
                  label="Rate Limited (429)"
                  value={(metrics.summary as any).rateLimited429 != null ? String((metrics.summary as any).rateLimited429) : '—'}
                  icon={<Gauge size={18} />}
                  subtext="Blocked requests"
                />
              </div>

              {/* API Requests Over Time Chart — REAL DATA ONLY (B'-10).
                  Previous fallback fabricated values via `s.value * 8 +
                  Math.random()*20`; that violated the no-mock-data rule.
                  When the timeseries is missing, surface an empty-state
                  pointing operators at the underlying endpoint. */}
              <div className="rounded-lg p-4" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-card-shadow)' }}>
                <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                  API Requests Over Time
                </h3>
                {metrics.timeSeries.apiRequests && metrics.timeSeries.apiRequests.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={metrics.timeSeries.apiRequests}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="timestamp" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                        tickFormatter={(v: string) => { try { const d = new Date(v); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; } catch { return v; } }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 8,
                          fontSize: 12,
                          color: 'var(--text-primary)',
                        }}
                      />
                      <Area type="monotone" dataKey="value" stroke="var(--ap-accent)" fill="var(--ap-accent)" fillOpacity={0.08} strokeWidth={2} name="Requests" />
                      <Area type="monotone" dataKey="errors" stroke="var(--ap-err)" fill="var(--ap-err)" fillOpacity={0.15} strokeWidth={1.5} name="Errors" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    no api-request timeseries — wire <code>timeSeries.apiRequests</code> in <code>/api/admin/dashboard/metrics</code>
                  </div>
                )}
              </div>

              {/* Two charts side by side */}
              <div className="grid grid-cols-2 gap-4">
                {/* Response Time Distribution — REAL DATA ONLY (B'-10).
                    Previously hardcoded a 6-bucket histogram. Now uses
                    metrics.summary.responseTimeDistribution if the api
                    surfaces it; otherwise renders an empty-state. */}
                <div className="rounded-lg p-4" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-card-shadow)' }}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Response Time (ms)
                  </h3>
                  {Array.isArray(metrics.summary.responseTimeDistribution)
                    && metrics.summary.responseTimeDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={metrics.summary.responseTimeDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" fill="var(--ap-accent)" radius={[3, 3, 0, 0]} name="Requests" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', padding: 8 }}>
                      no response-time histogram — wire <code>summary.responseTimeDistribution</code> in <code>/api/admin/dashboard/metrics</code>
                    </div>
                  )}
                </div>

                {/* Requests by Endpoint — REAL DATA ONLY (B'-10).
                    Previously hardcoded 5 endpoints. Wires to /admin/api-requests/top-endpoints
                    which the metrics endpoint may surface as summary.topEndpoints. */}
                <div className="rounded-lg p-4" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-card-shadow)' }}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Top Endpoints
                  </h3>
                  {Array.isArray(metrics.summary.topEndpoints)
                    && metrics.summary.topEndpoints.length > 0 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={metrics.summary.topEndpoints} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                        <YAxis dataKey="endpoint" type="category" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} width={80} />
                        <Tooltip contentStyle={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" fill="var(--ap-ok)" radius={[0, 3, 3, 0]} name="Requests" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', padding: 8 }}>
                      no top-endpoints data — wire <code>summary.topEndpoints</code> in <code>/api/admin/dashboard/metrics</code>
                    </div>
                  )}
                </div>
              </div>

              {/* Status codes breakdown — REAL DATA ONLY (B'-10).
                  Previously 5 hardcoded percentages. Pulls from
                  metrics.summary.statusCodes when available. */}
              <div className="rounded-lg p-4" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-card-shadow)' }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>HTTP Status Codes</h3>
                {Array.isArray((metrics.summary as any).statusCodes)
                  && (metrics.summary as any).statusCodes.length > 0 ? (
                  <div className="grid grid-cols-5 gap-3">
                    {((metrics.summary as any).statusCodes as Array<{ code: string; pct: number; color?: string; label?: string }>).map((s) => (
                      <div key={s.code} className="text-center p-3 rounded-lg" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
                        <div className="text-lg font-bold" style={{ color: s.color ?? 'var(--ap-accent)' }}>{s.pct}%</div>
                        <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{s.code}</div>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{s.label ?? ''}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    no http-status-code breakdown — wire <code>summary.statusCodes</code> in <code>/api/admin/dashboard/metrics</code>
                  </div>
                )}
              </div>

              {/* Auth & Session Metrics — REAL DATA ONLY (B'-10).
                  Previously contained hardcoded fallbacks (`|| 5`,
                  `* 12`, fake auth-method math). Now strictly uses
                  fields the api surfaces; missing values render '—'. */}
              <div className="rounded-lg p-4" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-card-shadow)' }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Authentication & Sessions</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {[
                    { label: 'Active Sessions', value: metrics.summary.activeUsers, icon: <UserCheck size={16} />, color: 'var(--color-success)' },
                    { label: 'Logins (24h)', value: (metrics.summary as any).logins24h ?? metrics.summary.totalSessions, icon: <Key size={16} />, color: 'var(--color-primary)' },
                    { label: 'Failed Logins', value: (metrics.summary as any).failedLogins24h, icon: <AlertTriangle size={16} />, color: 'var(--color-error)' },
                    { label: 'Token Validations', value: (metrics.summary as any).tokenValidations24h ?? metrics.summary.totalApiRequests, icon: <CheckCircle size={16} />, color: 'var(--color-info, var(--color-primary))' },
                  ].map(m => (
                    <div key={m.label} className="p-3 rounded-lg" style={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span style={{ color: m.color }}>{m.icon}</span>
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                      </div>
                      <div className="text-xl font-bold" style={{ color: m.color }}>
                        {typeof m.value === 'number' ? m.value.toLocaleString() : (m.value ?? '—')}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {/* Auth Method Breakdown — wires to summary.authMethods */}
                  <div>
                    <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Auth Method</h4>
                    {Array.isArray(metrics.summary.authMethods)
                      && metrics.summary.authMethods.length > 0 ? (
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={metrics.summary.authMethods}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                          <XAxis dataKey="method" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                          <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                          <Tooltip contentStyle={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="count" fill="var(--ap-accent)" radius={[3, 3, 0, 0]} name="Authentications" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'center' }}>
                        no auth-method breakdown — wire <code>summary.authMethods</code>
                      </div>
                    )}
                  </div>
                  {/* Session Duration — wires to summary.sessionDuration */}
                  <div>
                    <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Session Duration</h4>
                    {Array.isArray(metrics.summary.sessionDuration)
                      && metrics.summary.sessionDuration.length > 0 ? (
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={metrics.summary.sessionDuration}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                          <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                          <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                          <Tooltip contentStyle={{ background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="count" fill="var(--ap-ok)" radius={[3, 3, 0, 0]} name="Sessions" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'center' }}>
                        no session-duration breakdown — wire <code>summary.sessionDuration</code>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* === TAB: Openagentic === */}
          {dashTab === 'openagentic' && metrics.openagenticMetrics && (
            <div className="space-y-4">
              {/* Openagentic Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                <StatCard
                  icon={Terminal}
                  label="CLI Requests"
                  value={metrics.openagenticMetrics.totalRequests}
                  subValue={`${metrics.openagenticMetrics.uniqueApiKeys} API keys`}
                />
                <StatCard
                  icon={Zap}
                  label="CLI Tokens"
                  value={metrics.openagenticMetrics.totalTokens}
                  subValue={`In: ${formatNumber(metrics.openagenticMetrics.totalPromptTokens)} | Out: ${formatNumber(metrics.openagenticMetrics.totalCompletionTokens)}`}
                />
                <StatCard
                  icon={Brain}
                  label="Thinking Tokens"
                  value={metrics.openagenticMetrics.totalThinkingTokens}
                  subValue={metrics.openagenticMetrics.totalThinkingTokens > 0 ? 'Extended thinking enabled' : 'No thinking used'}
                />
                <StatCard
                  icon={DollarSign}
                  label="CLI Cost"
                  value={`$${metrics.openagenticMetrics.totalCost.toFixed(2)}`}
                />
                <StatCard
                  icon={Key}
                  label="Active API Keys"
                  value={metrics.openagenticMetrics.uniqueApiKeys}
                />
              </div>

              {/* Openagentic Time Series Charts */}
              {metrics.openagenticTimeSeries && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <MetricChart
                    title="CLI Requests Over Time"
                    data={metrics.openagenticTimeSeries.requests}
                    chartColor="var(--color-secondary)"
                  />
                  <MetricChart
                    title="CLI Token Usage Over Time"
                    data={metrics.openagenticTimeSeries.tokens}
                    chartColor="var(--color-primary)"
                  />
                </div>
              )}

              {/* Openagentic API Key Usage Table */}
              {metrics.openagenticByApiKey && (
                <div
                  className="rounded-xl p-4"
                  style={{
                    background: colors.cardBg,
                    border: `1px solid ${colors.cardBorder}`,
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textSecondary }}>
                      <Key size={16} />
                      CLI Usage by API Key
                      <InfoTooltip content="Openagentic CLI usage broken down by developer API key, showing tokens and cost per key." />
                    </h3>
                    <span className="text-xs" style={{ color: colors.textMuted }}>
                      {metrics.openagenticByApiKey.length} keys
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.cardBorder}` }}>
                          <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>API Key</th>
                          <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>User</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Requests</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Tokens</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Thinking</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.openagenticByApiKey.slice(0, 10).map((key, index) => (
                          <tr
                            key={key.apiKeyId}
                            style={{
                              borderBottom: index < Math.min(9, metrics.openagenticByApiKey!.length - 1) ? `1px solid ${colors.cardBorder}` : 'none'
                            }}
                          >
                            <td className="py-2 px-3">
                              <div style={{ color: colors.textPrimary }} className="font-medium truncate max-w-[150px]">
                                {key.keyName}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <div style={{ color: colors.textSecondary }} className="truncate max-w-[150px]">
                                {key.userName || key.userEmail}
                              </div>
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                              {formatNumber(key.requests)}
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                              {formatNumber(key.tokens)}
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: key.thinkingTokens > 0 ? 'var(--color-secondary)' : colors.textMuted }}>
                              {key.thinkingTokens > 0 ? formatNumber(key.thinkingTokens) : '-'}
                            </td>
                            <td className="text-right py-2 px-3 font-medium" style={{ color: colors.primary }}>
                              ${key.cost.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Openagentic Model Usage */}
              {metrics.openagenticModelUsage && (
                <div
                  className="rounded-xl p-4"
                  style={{
                    background: colors.cardBg,
                    border: `1px solid ${colors.cardBorder}`,
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <h3 className="text-sm font-medium mb-4 flex items-center gap-2" style={{ color: colors.textSecondary }}>
                    CLI Model Usage
                    <InfoTooltip content="LLM models used by the Openagentic CLI, including thinking token consumption." />
                  </h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metrics.openagenticModelUsage.slice(0, 6)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke={colors.gridLine} horizontal={false} />
                        <XAxis
                          type="number"
                          tickFormatter={formatNumber}
                          tick={{ fill: colors.axisTick, fontSize: 10 }}
                          axisLine={{ stroke: colors.axisLine }}
                        />
                        <YAxis
                          type="category"
                          dataKey="model"
                          width={120}
                          tick={{ fill: colors.axisTick, fontSize: 10 }}
                          axisLine={{ stroke: colors.axisLine }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const d = payload[0].payload;
                              return (
                                <div
                                  style={{
                                    background: colors.tooltipBg,
                                    border: `1px solid ${colors.tooltipBorder}`,
                                    borderRadius: '8px',
                                    padding: '8px 12px',
                                    boxShadow: colors.tooltipShadow
                                  }}
                                >
                                  <p style={{ color: colors.textPrimary, fontWeight: 600, fontSize: '13px' }}>{d.model}</p>
                                  <p style={{ color: colors.textSecondary, fontSize: 'var(--text-xs)' }}>Requests: {formatNumber(d.count)}</p>
                                  <p style={{ color: colors.textSecondary, fontSize: 'var(--text-xs)' }}>Tokens: {formatNumber(d.tokens)}</p>
                                  {d.thinkingTokens > 0 && (
                                    <p style={{ color: 'var(--color-secondary)', fontSize: 'var(--text-xs)' }}>Thinking: {formatNumber(d.thinkingTokens)}</p>
                                  )}
                                  <p style={{ color: colors.primary, fontSize: 'var(--text-xs)' }}>Cost: ${d.cost.toFixed(2)}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="count" fill="var(--color-secondary)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* LLM Sankey Modal */}
      <LLMSankeyModal
        isOpen={isSankeyModalOpen}
        onClose={() => setIsSankeyModalOpen(false)}
        modelUsage={metrics?.modelUsage || []}
        timeRange={timeRange}
      />
    </div>
  );
});

// DashboardOverview display name for debugging
DashboardOverview.displayName = 'DashboardOverview';

export default DashboardOverview;
