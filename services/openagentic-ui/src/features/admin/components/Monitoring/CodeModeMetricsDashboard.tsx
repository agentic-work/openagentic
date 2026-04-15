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
 * CodeMode Enhanced Metrics Dashboard
 *
 * Comprehensive real-time metrics for CodeMode/AWCode sessions.
 * Features:
 * - Live WebSocket streaming for system metrics
 * - Per-session detailed metrics (CPU, memory, network I/O, disk I/O, tokens, storage)
 * - System-wide aggregated view
 * - Recharts time-series charts for CPU, memory, tokens, and storage
 * - Per-user breakdown with cost attribution
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu, HardDrive, Network, Database, Zap, Users, Clock, Activity,
  ArrowUpRight, ArrowDownRight, RefreshCw, Wifi, WifiOff, DollarSign,
  TrendingUp, BarChart3, AlertTriangle, CheckCircle, XCircle, Server,
  FileText, Download, Upload
} from '@/shared/icons';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminCard } from '../Shared/AdminCard';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { apiRequest } from '@/utils/api';

// ── Chart Colors ────────────────────────────────────────────────────────
const COLORS = {
  primary: '#6366f1',
  success: '#00D26A',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
};

// ── Types matching the backend ──────────────────────────────────────────

interface EnhancedProcessMetrics {
  cpu: number;
  memory: number;
  memoryMB: number;
  elapsed: number;
  networkRx: number;
  networkTx: number;
  diskReadBytes: number;
  diskWriteBytes: number;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface StorageUsage {
  totalBytes: number;
  fileCount: number;
  largestFile: { path: string; size: number } | null;
}

interface EnhancedSessionMetrics extends EnhancedProcessMetrics {
  tokenUsage: TokenUsage;
  storageUsage: StorageUsage | null;
}

interface SessionWithMetrics {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  status: string;
  model: string;
  workspacePath: string;
  createdAt: string;
  lastActivity: string;
  currentActivity?: string;
  enhancedMetrics: EnhancedSessionMetrics | null;
}

interface SystemMetrics {
  totalSessions: number;
  activeSessions: number;
  totalCpu: number;
  totalMemoryMB: number;
  totalNetworkRx: number;
  totalNetworkTx: number;
  totalDiskRead: number;
  totalDiskWrite: number;
  totalTokens: number;
  totalStorageBytes: number;
  database?: {
    totalTokensRecorded: number;
    totalStorageRecorded: number;
  };
}

interface TimeSeriesPoint {
  time: string;
  cpu: number;
  memoryMB: number;
  tokens: number;
}

interface CodeModeMetricsDashboardProps {
  theme?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatNumber = (num: number): string => {
  return num.toLocaleString();
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  }).format(amount);
};

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

// ── Chart Tooltip ───────────────────────────────────────────────────────

const ChartTip: React.FC<{
  active?: boolean;
  payload?: any[];
  label?: string;
  valueFormatter?: (v: number) => string;
}> = ({ active, payload, label, valueFormatter = String }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--color-surfaceSecondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-semibold">{valueFormatter(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ── Section Header ──────────────────────────────────────────────────────

const SectionHead: React.FC<{
  icon: React.ReactNode;
  title: string;
  tooltip?: string;
  extra?: React.ReactNode;
}> = ({ icon, title, tooltip, extra }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tooltip && <InfoTooltip content={tooltip} />}
    {extra && <div className="ml-auto">{extra}</div>}
  </div>
);

// ── Live Status Indicator ───────────────────────────────────────────────

const LiveIndicator: React.FC<{ connected: boolean }> = ({ connected }) => (
  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
    connected ? 'bg-success-500/20 ap-text-success' : 'bg-surface-secondary/20 text-text-tertiary'
  }`}>
    {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
    {connected ? 'Live' : 'Disconnected'}
  </div>
);

// ── Session Row Component ───────────────────────────────────────────────

const SessionMetricsRow: React.FC<{
  session: SessionWithMetrics;
  expanded: boolean;
  onToggle: () => void;
}> = ({ session, expanded, onToggle }) => {
  const metrics = session.enhancedMetrics;

  const statusConfig = {
    running: { color: 'ap-text-success', bg: 'bg-success-500/20', icon: <CheckCircle size={14} /> },
    idle: { color: 'ap-text-warning', bg: 'bg-warning-500/20', icon: <Clock size={14} /> },
    stopped: { color: 'text-text-tertiary', bg: 'bg-surface-secondary/20', icon: <XCircle size={14} /> },
    error: { color: 'ap-text-error', bg: 'bg-error-500/20', icon: <AlertTriangle size={14} /> },
  };

  const config = statusConfig[session.status as keyof typeof statusConfig] || statusConfig.stopped;

  return (
    <div className="border-b border-white/5 last:border-0">
      <div
        className="p-4 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-4"
        onClick={onToggle}
      >
        {/* Status */}
        <div className={`p-1.5 rounded-lg ${config.bg}`}>
          {config.icon}
        </div>

        {/* User & Model */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-text-primary truncate">
            {session.userName || session.userEmail || session.userId}
          </p>
          <p className="text-xs text-text-secondary">{session.model}</p>
        </div>

        {/* CPU */}
        <div className="w-20 text-center">
          <p className="text-sm font-mono text-primary-500">
            {metrics?.cpu?.toFixed(1) || '0.0'}%
          </p>
          <p className="text-xs text-text-tertiary">CPU</p>
        </div>

        {/* Memory */}
        <div className="w-24 text-center">
          <p className="text-sm font-mono ap-text-info">
            {metrics?.memoryMB?.toFixed(0) || '0'} MB
          </p>
          <p className="text-xs text-text-tertiary">Memory</p>
        </div>

        {/* Network */}
        <div className="w-32 text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-mono">
            <span className="ap-text-success flex items-center gap-1">
              <Download size={10} />
              {formatBytes(metrics?.networkRx || 0)}
            </span>
          </div>
          <p className="text-xs text-text-tertiary">Network In</p>
        </div>

        {/* Tokens */}
        <div className="w-28 text-center">
          <p className="text-sm font-mono ap-text-warning">
            {formatNumber(metrics?.tokenUsage?.totalTokens || 0)}
          </p>
          <p className="text-xs text-text-tertiary">Tokens</p>
        </div>

        {/* Cost */}
        <div className="w-24 text-center">
          <p className="text-sm font-mono ap-text-warning">
            {formatCurrency(metrics?.tokenUsage?.estimatedCost || 0)}
          </p>
          <p className="text-xs text-text-tertiary">Cost</p>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && metrics && (
        <div className="px-4 pb-4 grid grid-cols-6 gap-4 bg-white/5">
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Network Out</p>
            <p className="text-sm font-mono text-primary-500 flex items-center gap-1">
              <Upload size={12} />
              {formatBytes(metrics.networkTx)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Disk Read</p>
            <p className="text-sm font-mono ap-text-success">
              {formatBytes(metrics.diskReadBytes)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Disk Write</p>
            <p className="text-sm font-mono ap-text-error">
              {formatBytes(metrics.diskWriteBytes)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Input Tokens</p>
            <p className="text-sm font-mono text-text-primary">
              {formatNumber(metrics.tokenUsage?.inputTokens || 0)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Output Tokens</p>
            <p className="text-sm font-mono text-text-primary">
              {formatNumber(metrics.tokenUsage?.outputTokens || 0)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Storage</p>
            <p className="text-sm font-mono text-text-primary">
              {metrics.storageUsage ? formatBytes(metrics.storageUsage.totalBytes) : 'N/A'}
            </p>
            {metrics.storageUsage && (
              <p className="text-xs text-text-tertiary">
                {metrics.storageUsage.fileCount} files
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Shared Axis Props ───────────────────────────────────────────────────

const axisProps = {
  tick: { fill: 'var(--text-tertiary)', fontSize: 11 },
  axisLine: { stroke: 'var(--color-border)' },
  tickLine: false as const,
};

const gridProps = {
  strokeDasharray: '3 3',
  stroke: 'var(--color-border)',
  strokeOpacity: 0.5,
};

// Maximum history points retained for time-series ring buffers
const MAX_HISTORY = 60;

// ── Main Dashboard Component ────────────────────────────────────────────

export const CodeModeMetricsDashboard: React.FC<CodeModeMetricsDashboardProps> = ({ theme }) => {
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [sessions, setSessions] = useState<SessionWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [timeSeriesHistory, setTimeSeriesHistory] = useState<TimeSeriesPoint[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Append a time-series point from the current system metrics snapshot
  const appendTimeSeriesPoint = useCallback((sm: SystemMetrics) => {
    const now = new Date();
    const label = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setTimeSeriesHistory((prev) => {
      const next = [...prev, { time: label, cpu: sm.totalCpu, memoryMB: sm.totalMemoryMB, tokens: sm.totalTokens }];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, []);

  // Fetch enhanced metrics via REST API
  const fetchMetrics = useCallback(async () => {
    try {
      const [systemRes, sessionsRes] = await Promise.all([
        apiRequest('/admin/code/metrics/system'),
        apiRequest('/admin/code/sessions/metrics/enhanced'),
      ]);

      if (systemRes.ok) {
        const systemData = await systemRes.json();
        setSystemMetrics(systemData);
        appendTimeSeriesPoint(systemData);
      }

      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json();
        setSessions(sessionsData.sessions || []);
      }

      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, [appendTimeSeriesPoint]);

  // Connect to live metrics WebSocket
  const connectWebSocket = useCallback(async () => {
    try {
      const response = await apiRequest('/admin/code/metrics/websocket');

      if (!response.ok) {
        console.warn('Could not get metrics WebSocket URL');
        return;
      }

      const { url } = await response.json();
      if (!url) return;

      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[Metrics WS] Connected');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'system_metrics') {
            setSystemMetrics(data.data);
            appendTimeSeriesPoint(data.data);
          }
        } catch (err) {
          console.error('[Metrics WS] Parse error:', err);
        }
      };

      ws.onclose = () => {
        console.log('[Metrics WS] Disconnected');
        setWsConnected(false);
      };

      ws.onerror = (err) => {
        console.error('[Metrics WS] Error:', err);
        setWsConnected(false);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[Metrics WS] Connection error:', err);
    }
  }, [appendTimeSeriesPoint]);

  // Initial fetch and WebSocket connection
  useEffect(() => {
    fetchMetrics();
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchMetrics, connectWebSocket]);

  // Auto-refresh sessions (WebSocket only updates system metrics)
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, [fetchMetrics, autoRefresh]);

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  // Derive per-session storage breakdown for bar chart
  const storageBreakdown = sessions
    .filter((s) => s.enhancedMetrics?.storageUsage && s.enhancedMetrics.storageUsage.totalBytes > 0)
    .map((s) => ({
      name: s.userName || s.userEmail || s.userId.slice(0, 8),
      bytes: s.enhancedMetrics!.storageUsage!.totalBytes,
      files: s.enhancedMetrics!.storageUsage!.fileCount,
      label: formatBytes(s.enhancedMetrics!.storageUsage!.totalBytes),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);

  // Compute sparklines from time-series history
  const cpuSparkline = timeSeriesHistory.map((p) => p.cpu);
  const memSparkline = timeSeriesHistory.map((p) => p.memoryMB);
  const tokenSparkline = timeSeriesHistory.map((p) => p.tokens);

  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
        <p className="text-text-secondary">Loading enhanced metrics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <BarChart3 size={20} className="text-primary-500" />
            CodeMode Enhanced Metrics
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Real-time resource monitoring with network I/O, disk I/O, token usage, and cost tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator connected={wsConnected} />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-border-hover"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchMetrics}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 transition-colors"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="glass-card p-4 border border-error/30 bg-error-500/10">
          <div className="flex items-center gap-2 ap-text-error">
            <AlertTriangle size={18} />
            <span className="font-medium">Error: {error}</span>
          </div>
        </div>
      )}

      {/* ── System Overview — AdminMetricCard Grid ────────────────────── */}
      {systemMetrics && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <AdminMetricCard
            label="Active Sessions"
            value={systemMetrics.activeSessions}
            subtext={`${systemMetrics.totalSessions} total`}
            icon={<Activity size={20} />}
            sparklineData={cpuSparkline.length > 1 ? undefined : undefined}
            tooltip="Currently running CodeMode sessions"
          />
          <AdminMetricCard
            label="Total CPU"
            value={`${systemMetrics.totalCpu.toFixed(1)}%`}
            icon={<Cpu size={20} />}
            sparklineData={cpuSparkline.length > 1 ? cpuSparkline : undefined}
            tooltip="Aggregate CPU usage across all sessions"
          />
          <AdminMetricCard
            label="Total Memory"
            value={`${systemMetrics.totalMemoryMB.toFixed(0)} MB`}
            icon={<Server size={20} />}
            sparklineData={memSparkline.length > 1 ? memSparkline : undefined}
            tooltip="Aggregate memory footprint across all session pods"
          />
          <AdminMetricCard
            label="Network I/O"
            value={formatBytes(systemMetrics.totalNetworkRx + systemMetrics.totalNetworkTx)}
            subtext={`In ${formatBytes(systemMetrics.totalNetworkRx)} / Out ${formatBytes(systemMetrics.totalNetworkTx)}`}
            icon={<Network size={20} />}
            tooltip="Combined inbound + outbound network traffic"
          />
          <AdminMetricCard
            label="Disk I/O"
            value={formatBytes(systemMetrics.totalDiskRead + systemMetrics.totalDiskWrite)}
            subtext={`R: ${formatBytes(systemMetrics.totalDiskRead)} / W: ${formatBytes(systemMetrics.totalDiskWrite)}`}
            icon={<HardDrive size={20} />}
            tooltip="Combined disk read + write across sessions"
          />
          <AdminMetricCard
            label="Total Tokens"
            value={fmt(systemMetrics.totalTokens)}
            subtext={systemMetrics.database ? `DB: ${fmt(systemMetrics.database.totalTokensRecorded)}` : undefined}
            icon={<Zap size={20} />}
            sparklineData={tokenSparkline.length > 1 ? tokenSparkline : undefined}
            tooltip="Cumulative LLM token consumption"
          />
        </div>
      )}

      {/* ── Time-Series Charts ───────────────────────────────────────── */}
      {timeSeriesHistory.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* CPU Over Time */}
          <AdminCard>
            <SectionHead
              icon={<Cpu size={16} />}
              title="CPU Usage Over Time"
              tooltip="Aggregate CPU % sampled every refresh interval"
            />
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={timeSeriesHistory} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="time" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                  <RechartsTooltip content={<ChartTip valueFormatter={(v: number) => `${v.toFixed(1)}%`} />} />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU %"
                    stroke={COLORS.primary}
                    strokeWidth={2}
                    fill="url(#cpuGrad)"
                    dot={false}
                    animationDuration={300}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Memory Over Time */}
          <AdminCard>
            <SectionHead
              icon={<Server size={16} />}
              title="Memory Usage Over Time"
              tooltip="Aggregate memory in MB sampled every refresh interval"
            />
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={timeSeriesHistory} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="time" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
                  <RechartsTooltip content={<ChartTip valueFormatter={(v: number) => `${v.toFixed(0)} MB`} />} />
                  <Area
                    type="monotone"
                    dataKey="memoryMB"
                    name="Memory"
                    stroke={COLORS.success}
                    strokeWidth={2}
                    fill="url(#memGrad)"
                    dot={false}
                    animationDuration={300}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Token Consumption Trend */}
          <AdminCard>
            <SectionHead
              icon={<Zap size={16} />}
              title="Token Consumption Trend"
              tooltip="Cumulative token count over time"
            />
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={timeSeriesHistory} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="tokGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.amber} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.amber} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="time" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => fmt(v)} />
                  <RechartsTooltip content={<ChartTip valueFormatter={(v: number) => formatNumber(v)} />} />
                  <Area
                    type="monotone"
                    dataKey="tokens"
                    name="Tokens"
                    stroke={COLORS.amber}
                    strokeWidth={2}
                    fill="url(#tokGrad)"
                    dot={false}
                    animationDuration={300}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Storage Breakdown Bar Chart */}
          <AdminCard>
            <SectionHead
              icon={<Database size={16} />}
              title="Storage by Session"
              tooltip="Workspace storage consumed per user session"
            />
            <div style={{ width: '100%', height: 220 }}>
              {storageBreakdown.length > 0 ? (
                <ResponsiveContainer>
                  <BarChart data={storageBreakdown} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis {...axisProps} tickFormatter={(v: number) => formatBytes(v)} />
                    <RechartsTooltip
                      content={<ChartTip valueFormatter={(v: number) => formatBytes(v)} />}
                    />
                    <Bar
                      dataKey="bytes"
                      name="Storage"
                      fill={COLORS.purple}
                      radius={[4, 4, 0, 0]}
                      animationDuration={300}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                    No storage data available
                  </p>
                </div>
              )}
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Cost Tracking Card ───────────────────────────────────────── */}
      {systemMetrics && (
        <AdminCard>
          <SectionHead
            icon={<DollarSign size={16} />}
            title="Cost Tracking"
            tooltip="Estimated LLM cost for active CodeMode sessions"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center py-4">
              <p className="text-3xl font-bold" style={{ color: COLORS.amber }}>
                {formatCurrency(
                  sessions.reduce((acc, s) => acc + (s.enhancedMetrics?.tokenUsage?.estimatedCost || 0), 0)
                )}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Estimated Total Cost
              </p>
            </div>
            <div className="text-center py-4">
              <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {sessions.filter((s) => s.enhancedMetrics?.tokenUsage?.estimatedCost).length}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Sessions with Cost
              </p>
            </div>
            <div className="text-center py-4">
              <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatBytes(systemMetrics.totalStorageBytes)}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Live Session Storage
              </p>
              {systemMetrics.database && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  DB recorded: {formatBytes(systemMetrics.database.totalStorageRecorded)}
                </p>
              )}
            </div>
          </div>
        </AdminCard>
      )}

      {/* ── Session Details Table ────────────────────────────────────── */}
      <AdminCard className="!p-0 overflow-hidden">
        <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <SectionHead
            icon={<Users size={16} />}
            title="Session Details"
            tooltip="Per-session resource utilisation breakdown"
            extra={
              <span
                className="px-2 py-0.5 text-xs rounded-full"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                  color: 'var(--color-primary)',
                }}
              >
                {sessions.length} sessions
              </span>
            }
          />
        </div>

        {sessions.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-secondary)' }}>
            No active sessions with metrics
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {sessions.map((session) => (
              <SessionMetricsRow
                key={session.id}
                session={session}
                expanded={expandedSessions.has(session.id)}
                onToggle={() => toggleSession(session.id)}
              />
            ))}
          </div>
        )}
      </AdminCard>

      {/* ── WebSocket Info ────────────────────────────────────────────── */}
      <AdminCard>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: wsConnected ? 'var(--color-success, #00D26A)' : 'var(--color-border)',
                animation: wsConnected ? 'pulse 2s infinite' : undefined,
              }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>WebSocket Status:</span>
            <span style={{ color: wsConnected ? 'var(--color-success, #00D26A)' : 'var(--text-tertiary)' }}>
              {wsConnected ? 'Connected (2s updates)' : 'Disconnected (REST fallback)'}
            </span>
          </div>
          {!wsConnected && (
            <button
              onClick={connectWebSocket}
              style={{ color: 'var(--color-primary)' }}
              className="hover:underline"
            >
              Retry Connection
            </button>
          )}
        </div>
      </AdminCard>
    </div>
  );
};

export default CodeModeMetricsDashboard;
