/**
 * FlowsKpiDashboard — KPI dashboard for OpenAgentic Flows.
 *
 * Covers AC K1-K10:
 *   K1  Summary tiles: Total Executions, Success Rate, Avg Cost, p95 Latency + delta
 *   K2  Time-window selector: 1h / 6h / 24h / 7d / 30d / 90d
 *   K3  Line chart: executions over time
 *   K4  Line chart: cost over time
 *   K5  Bar chart: top 10 failing nodes
 *   K6  Bar chart: top 10 expensive flows
 *   K7  Click flow row → onFlowSelect(flowId)
 *   K8  Loading: skeleton metric tiles + chart placeholders
 *   K9  Error: message + Retry button
 *  K10  Empty: "No executions in the last X" message
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { fetchKpis, type KpiWindow, type FlowsKpiData } from '../../services/flowsAdminApi';
import { PageHeader } from '../../primitives-v2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowsKpiDashboardProps {
  /** Called when the user clicks an expensive flow row. */
  onFlowSelect?: (flowId: string) => void;
  theme?: 'dark' | 'light';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = {
  primary: 'var(--ap-accent)',
  success: 'var(--ap-ok)',
  warning: 'var(--ap-warn)',
  error: 'var(--ap-err)',
};

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-xs font-semibold uppercase tracking-widest mb-2"
      style={{ color: 'var(--text-tertiary)' }}
    >
      {children}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Chart skeleton placeholder
// ---------------------------------------------------------------------------

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-lg w-full"
      style={{ height, backgroundColor: 'var(--color-border)' }}
      data-testid="chart-skeleton"
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FlowsKpiDashboard({ onFlowSelect, theme: _theme }: FlowsKpiDashboardProps) {
  const [window_, setWindow] = useState<KpiWindow>('24h');
  const [data, setData] = useState<FlowsKpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const load = useCallback(
    async (w: KpiWindow) => {
      setLoading(true);
      setError(null);
      try {
        const kpis = await fetchKpis(w);
        setData(kpis);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(`Failed to load KPI data: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(window_);
  }, [load, window_]);

  const handleWindowChange = useCallback(
    (w: string) => {
      // Only call setWindow; the useEffect watches window_ and calls load().
      setWindow(w as KpiWindow);
    },
    [],
  );

  const handleRefresh = useCallback(() => {
    load(window_);
  }, [load, window_]);

  // -------------------------------------------------------------------------
  // Derived chart data
  // -------------------------------------------------------------------------

  const execChartData = (data?.executions_over_time ?? []).map((v, i) => ({
    label: data?.time_labels?.[i] ?? String(i),
    executions: v,
  }));

  const costChartData = (data?.cost_over_time ?? []).map((v, i) => ({
    label: data?.time_labels?.[i] ?? String(i),
    cost: v,
  }));

  const failingNodesData = (data?.top_failing_nodes ?? []).map((n) => ({
    name: n.nodeId,
    failures: n.failureCount,
  }));

  const expensiveFlowsData = (data?.top_expensive_flows ?? []).map((f) => ({
    name: f.flowName,
    cost: f.totalCostUsd ?? 0,
    id: f.flowId,
  }));

  // -------------------------------------------------------------------------
  // Render: Error state
  // -------------------------------------------------------------------------

  if (!loading && error) {
    return (
      <div className="space-y-4">
        {/* Universal admin chrome — every page wears the same header. */}
        <PageHeader
          crumbs={['Admin', 'Flows', 'KPI Dashboard']}
          title="OpenAgentic Flows · KPIs"
          explainer="Aggregate KPIs for all OpenAgentic Flows: executions, cost, latency, top failures."
          actions={[
            { label: 'Refresh', onClick: handleRefresh },
          ]}
        />

        {/* Filter bar still shown so user can change window */}
        <AdminFilterBar
          searchTerm=""
          onSearchChange={() => {}}
          timeRange={window_}
          onTimeRangeChange={handleWindowChange}
          onRefresh={handleRefresh}
        />
        <div
          className="rounded-lg p-6 text-center"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)',
          }}
        >
          <p className="text-sm mb-3" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
          <button
            onClick={handleRefresh}
            className="px-4 py-1.5 rounded-md text-sm font-medium"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--ap-fg-0)' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Empty state
  // -------------------------------------------------------------------------

  const isEmpty = !loading && data !== null && data.total_executions === 0;

  // -------------------------------------------------------------------------
  // Render: Main
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Flows', 'KPI Dashboard']}
        title="OpenAgentic Flows · KPIs"
        explainer="Aggregate KPIs for all OpenAgentic Flows: executions, cost, latency, top failures."
        actions={[
          { label: 'Refresh', onClick: handleRefresh },
        ]}
      />

      {/* Filter bar */}
      <AdminFilterBar
        searchTerm=""
        onSearchChange={() => {}}
        timeRange={window_}
        onTimeRangeChange={handleWindowChange}
        onRefresh={handleRefresh}
        refreshing={loading}
      />

      {/* Summary tiles — K1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Total Executions"
          value={data ? data.total_executions.toLocaleString() : '—'}
          loading={loading}
          trend={
            data?.delta?.total_executions != null
              ? {
                  value: Math.abs(data.delta.total_executions),
                  direction:
                    data.delta.total_executions > 0
                      ? 'up'
                      : data.delta.total_executions < 0
                        ? 'down'
                        : 'neutral',
                }
              : undefined
          }
        />
        <AdminMetricCard
          label="Success Rate %"
          value={data ? `${(data.success_rate ?? 0).toFixed(1)}%` : '—'}
          loading={loading}
          trend={
            data?.delta?.success_rate != null
              ? {
                  value: Math.abs(data.delta.success_rate),
                  direction:
                    data.delta.success_rate > 0
                      ? 'up'
                      : data.delta.success_rate < 0
                        ? 'down'
                        : 'neutral',
                }
              : undefined
          }
        />
        <AdminMetricCard
          label="Avg Cost/Exec (USD)"
          value={data ? `$${(data.avg_cost_per_execution_usd ?? 0).toFixed(4)}` : '—'}
          loading={loading}
          trend={
            data?.delta?.avg_cost_per_execution_usd != null
              ? {
                  value: Math.abs(data.delta.avg_cost_per_execution_usd),
                  direction:
                    data.delta.avg_cost_per_execution_usd > 0
                      ? 'up'
                      : data.delta.avg_cost_per_execution_usd < 0
                        ? 'down'
                        : 'neutral',
                }
              : undefined
          }
        />
        <AdminMetricCard
          label="P95 Latency (ms)"
          value={data ? `${data.latency_p95_ms}ms` : '—'}
          loading={loading}
          trend={
            data?.delta?.latency_p95_ms != null
              ? {
                  value: Math.abs(data.delta.latency_p95_ms),
                  direction:
                    data.delta.latency_p95_ms > 0
                      ? 'up'
                      : data.delta.latency_p95_ms < 0
                        ? 'down'
                        : 'neutral',
                }
              : undefined
          }
        />
      </div>

      {/* Empty state — K10 */}
      {isEmpty && (
        <div
          className="rounded-lg p-10 text-center"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No executions in the last {window_}. Try a wider window.
          </p>
        </div>
      )}

      {/* Time-series charts — K3 + K4 */}
      {!isEmpty && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Executions over time */}
          <div
            className="rounded-lg p-4"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <SectionHeading>Executions / Hour</SectionHeading>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={execChartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="gradExec" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="executions"
                    stroke={COLORS.primary}
                    fill="url(#gradExec)"
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Cost over time */}
          <div
            className="rounded-lg p-4"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <SectionHeading>Cost / Hour (USD)</SectionHeading>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={costChartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.warning} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={COLORS.warning} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(4)}`, 'Cost']} />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    stroke={COLORS.warning}
                    fill="url(#gradCost)"
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Bar charts — K5 + K6 */}
      {!isEmpty && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top failing nodes */}
          <div
            className="rounded-lg p-4"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <SectionHeading>Top Failing Nodes</SectionHeading>
            {loading ? (
              <ChartSkeleton />
            ) : failingNodesData.length === 0 ? (
              <p className="text-xs py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                No failures recorded.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={failingNodesData}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 60 }}
                >
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip />
                  <Bar dataKey="failures" fill={COLORS.error} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top expensive flows */}
          <div
            className="rounded-lg p-4"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <SectionHeading>Top Expensive Flows</SectionHeading>
            {loading ? (
              <ChartSkeleton />
            ) : expensiveFlowsData.length === 0 ? (
              <p className="text-xs py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                No cost data recorded.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={expensiveFlowsData}
                    layout="vertical"
                    margin={{ top: 4, right: 12, bottom: 4, left: 60 }}
                  >
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) => `$${(v ?? 0).toFixed(2)}`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip formatter={(v: unknown) => [`$${Number(v).toFixed(4)}`, 'Cost (USD)']} />
                    <Bar dataKey="cost" fill={COLORS.warning} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Clickable flow list — K7 */}
                <div className="mt-3 space-y-1">
                  {expensiveFlowsData.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onFlowSelect?.(f.id)}
                      className="w-full text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center justify-between"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          'color-mix(in srgb, var(--color-primary) 8%, transparent)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <span>{f.name}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>${f.cost.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowsKpiDashboard;
