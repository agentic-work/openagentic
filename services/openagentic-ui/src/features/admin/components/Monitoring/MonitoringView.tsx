/**
 * Monitoring & Logs - MCP tool execution and LLM usage metrics
 *
 * Recharts bar charts for top tools and models, AdminMetricCard summary,
 * AdminFilterBar for time range, debug tools section for admin actions.
 */

import React, { useState, useEffect } from 'react';
import { Terminal, Trash2, Database, Play } from '@/shared/icons';
import {
  Activity, Zap, TrendingUp, Timer as Clock, RefreshCw,
  AlertCircle, CheckCircle, DollarSign, Cpu, XCircle
} from '../Shared/AdminIcons';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminCard } from '../Shared/AdminCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { CHART_COLORS } from '../Shared/chartColors';
import { apiRequest } from '@/utils/api';

// ── Interfaces ────────────────────────────────────────────────────────

interface MonitoringViewProps {
  theme: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const TIME_RANGES = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

// ── Helpers ───────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');

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

// ── Component ─────────────────────────────────────────────────────────

export const MonitoringView: React.FC<MonitoringViewProps> = ({ theme }) => {
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24h');
  const [searchTerm, setSearchTerm] = useState('');
  const [mcpMetrics, setMcpMetrics] = useState<any>(null);
  const [llmMetrics, setLlmMetrics] = useState<any>(null);

  // Debug tools state
  const [debugLoading, setDebugLoading] = useState<{ [key: string]: boolean }>({});
  const [debugResults, setDebugResults] = useState<{ [key: string]: { success: boolean; message: string } | null }>({});

  const fetchMetrics = async () => {
    try {
      setLoading(true);

      const [mcpRes, llmRes] = await Promise.all([
        apiRequest(`/admin/metrics/mcp?timeRange=${timeRange}`),
        apiRequest(`/admin/metrics/llm?timeRange=${timeRange}`)
      ]);

      if (mcpRes.ok) {
        const data = await mcpRes.json();
        setMcpMetrics(data);
      }

      if (llmRes.ok) {
        const data = await llmRes.json();
        setLlmMetrics(data);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [timeRange]);

  // Debug tool handlers
  const runDebugAction = async (action: string, endpoint: string, method: string = 'POST', body?: any) => {
    setDebugLoading(prev => ({ ...prev, [action]: true }));
    setDebugResults(prev => ({ ...prev, [action]: null }));
    try {
      const response = await apiRequest(endpoint, {
        method,
        ...(body && { body: JSON.stringify(body) })
      });
      const data = await response.json().catch(() => ({}));
      setDebugResults(prev => ({
        ...prev,
        [action]: {
          success: response.ok,
          message: response.ok ? (data.message || 'Action completed successfully') : (data.error || 'Action failed')
        }
      }));
    } catch (err: any) {
      setDebugResults(prev => ({
        ...prev,
        [action]: { success: false, message: err.message || 'Request failed' }
      }));
    } finally {
      setDebugLoading(prev => ({ ...prev, [action]: false }));
    }
  };

  const debugActions = [
    {
      id: 'reindex-mcp',
      label: 'Reindex MCP Tools',
      description: 'Force reindex all MCP tools from connected servers',
      icon: Database,
      endpoint: '/admin/debug/force-index-mcp-tools',
      method: 'POST'
    },
    {
      id: 'clear-tiered-fc',
      label: 'Clear Tiered FC Cache',
      description: 'Clear the tiered function calling decision cache',
      icon: Trash2,
      endpoint: '/admin/tiered-fc/clear-cache',
      method: 'POST'
    },
    {
      id: 'clear-permissions',
      label: 'Clear Permissions Cache',
      description: 'Clear the user permissions cache',
      icon: Trash2,
      endpoint: '/admin/permissions/cache/clear',
      method: 'POST'
    },
    {
      id: 'test-tool-calling',
      label: 'Test Tool Calling',
      description: 'Run a diagnostic test of MCP tool calling',
      icon: Play,
      endpoint: '/admin/debug/test-tool-calling',
      method: 'POST'
    }
  ];

  // Prepare chart data for top tools
  const toolChartData = mcpMetrics?.toolPerformance
    ?.slice(0, 10)
    .map((tool: any) => ({
      name: tool.toolName.length > 20 ? tool.toolName.slice(0, 18) + '...' : tool.toolName,
      fullName: tool.toolName,
      calls: tool.totalCalls,
      successRate: tool.successRate,
      avgTime: tool.avgExecutionTime,
    })) || [];

  // Prepare chart data for top models
  const modelChartData = llmMetrics?.topModels
    ?.slice(0, 10)
    .map((model: any) => ({
      name: model.model.length > 20 ? model.model.slice(0, 18) + '...' : model.model,
      fullName: model.model,
      tokens: model.totalTokens,
      calls: model.count,
      cost: Number(model.cost) || 0,
    })) || [];

  if (loading && !mcpMetrics && !llmMetrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--color-text)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Filter Bar */}
      <div>
        <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Monitoring & Logs
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          MCP tool execution and LLM usage metrics
        </p>
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

      {/* MCP Metrics */}
      {mcpMetrics && (
        <div className="space-y-4">
          <SectionHead
            icon={<Zap className="w-5 h-5" />}
            title="MCP Tool Execution"
            tip="Aggregated MCP tool call metrics for the selected time range"
          />

          {/* MCP Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <AdminMetricCard
              label="Total Calls"
              value={fmt(mcpMetrics.summary.totalCalls)}
              icon={<Activity className="w-4 h-4" />}
              tooltip="Total number of MCP tool invocations"
            />
            <AdminMetricCard
              label="Success Rate"
              value={`${mcpMetrics.summary.successRate}%`}
              subtext={`${fmt(mcpMetrics.summary.successfulCalls)} ok / ${fmt(mcpMetrics.summary.failedCalls)} failed`}
              icon={<CheckCircle className="w-4 h-4" />}
              tooltip="Percentage of tool calls that completed successfully"
            />
            <AdminMetricCard
              label="Avg Execution Time"
              value={`${mcpMetrics.summary.avgExecutionTime}ms`}
              icon={<Clock className="w-4 h-4" />}
              tooltip="Mean execution time across all tool calls"
            />
            <AdminMetricCard
              label="Failed Calls"
              value={fmt(mcpMetrics.summary.failedCalls)}
              icon={<AlertCircle className="w-4 h-4" />}
              tooltip="Total tool calls that returned an error"
            />
          </div>

          {/* Top Tools Bar Chart */}
          {toolChartData.length > 0 && (
            <AdminCard>
              <SectionHead
                icon={<Zap className="w-4 h-4" />}
                title="Top Tools by Call Count"
                tip="Most frequently invoked MCP tools"
              />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={toolChartData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" width={150} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}>
                          <div className="font-medium mb-1">{d?.fullName}</div>
                          <div>Calls: <span className="font-semibold">{fmt(d?.calls)}</span></div>
                          <div>Success: <span className="font-semibold">{d?.successRate}%</span></div>
                          <div>Avg time: <span className="font-semibold">{d?.avgTime}ms</span></div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="calls" name="Calls" radius={[0, 4, 4, 0]} fill={CHART_COLORS[0]} />
                </BarChart>
              </ResponsiveContainer>
            </AdminCard>
          )}
        </div>
      )}

      {/* LLM Metrics */}
      {llmMetrics && (
        <div className="space-y-4">
          <SectionHead
            icon={<Cpu className="w-5 h-5" />}
            title="LLM Usage"
            tip="Token consumption and cost metrics for all LLM providers"
          />

          {/* LLM Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <AdminMetricCard
              label="Total Messages"
              value={fmt(llmMetrics.summary.totalMessages)}
              icon={<Activity className="w-4 h-4" />}
              tooltip="Total LLM completion requests"
            />
            <AdminMetricCard
              label="Total Tokens"
              value={fmt(llmMetrics.summary.totalTokens)}
              subtext={`${fmt(llmMetrics.summary.totalTokensInput)} in / ${fmt(llmMetrics.summary.totalTokensOutput)} out`}
              icon={<TrendingUp className="w-4 h-4" />}
              tooltip="Combined input and output tokens across all providers"
            />
            <AdminMetricCard
              label="Total Cost"
              value={`$${llmMetrics.summary.totalCost}`}
              icon={<DollarSign className="w-4 h-4" />}
              tooltip="Estimated total LLM spend"
            />
            <AdminMetricCard
              label="Avg Per Message"
              value={fmt(llmMetrics.summary.avgTokensPerMessage)}
              subtext={`tokens \u00B7 $${llmMetrics.summary.avgCostPerMessage}`}
              icon={<Activity className="w-4 h-4" />}
              tooltip="Average tokens and cost per completion request"
            />
          </div>

          {/* Top Models Bar Chart */}
          {modelChartData.length > 0 && (
            <AdminCard>
              <SectionHead
                icon={<Cpu className="w-4 h-4" />}
                title="Top Models by Token Usage"
                tip="LLM models ranked by total token consumption"
              />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={modelChartData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" width={150} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}>
                          <div className="font-medium mb-1">{d?.fullName}</div>
                          <div>Tokens: <span className="font-semibold">{fmt(d?.tokens)}</span></div>
                          <div>Calls: <span className="font-semibold">{fmt(d?.calls)}</span></div>
                          <div>Cost: <span className="font-semibold">${d?.cost.toFixed(4)}</span></div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="tokens" name="Tokens" radius={[0, 4, 4, 0]} fill={CHART_COLORS[1]} />
                </BarChart>
              </ResponsiveContainer>
            </AdminCard>
          )}
        </div>
      )}

      {/* Debug Tools Section */}
      <AdminCard>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-warning) 15%, transparent)' }}>
            <Terminal size={24} style={{ color: 'var(--ap-warning)' }} />
          </div>
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Debug Tools</h3>
            <p style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
              Administrative actions for system maintenance and debugging
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {debugActions.map(action => {
            const ActionIcon = action.icon;
            const isLoading = debugLoading[action.id];
            const result = debugResults[action.id];
            return (
              <div
                key={action.id}
                className="p-4 rounded-lg border"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surfaceSecondary)' }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <ActionIcon size={18} style={{ color: 'var(--color-primary)' }} />
                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>{action.label}</span>
                    </div>
                    <p className="text-sm mb-3" style={{ color: 'var(--color-textSecondary)' }}>
                      {action.description}
                    </p>
                    {result && (
                      <div className="text-sm flex items-center gap-1" style={{ color: result.success ? 'var(--ap-success)' : 'var(--ap-error)' }}>
                        {result.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {result.message}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => runDebugAction(action.id, action.endpoint, action.method)}
                    disabled={isLoading}
                    className="px-3 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors flex items-center gap-2 shrink-0"
                  >
                    {isLoading ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    Run
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </AdminCard>
    </div>
  );
};
