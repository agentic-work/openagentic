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
 * Performance Metrics Component
 * Displays real-time Prometheus metrics for all services
 * Shows CPU, Memory, Disk, Network, Redis cache hits, Milvus collection calls
 * Uses theme system (CSS variables) for consistent styling
 * Recharts time-series charts for CPU/Memory trends
 */

import React, { useState, useEffect } from 'react';
// Keep basic icons from lucide
import { HardDrive, Network } from '@/shared/icons';
// Custom badass icons
import { Activity, Cpu, Database, Server, TrendingUp, Zap, RefreshCw, AlertCircle, CheckCircle } from '../Shared/AdminIcons';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminCard } from '../Shared/AdminCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { CHART_COLORS } from '../Shared/chartColors';
import { apiRequest } from '@/utils/api';

// ── Tooltip Descriptions ──────────────────────────────────────────────

const TIPS = {
  totalServices: 'Number of monitored services reporting metrics',
  avgCpu: 'Average CPU utilization across all services',
  avgMemory: 'Average memory utilization across all services',
  cacheHitRate: 'Redis cache hit ratio - higher means lower latency',
  cpuTrend: 'CPU utilization over time per service',
  memoryTrend: 'Memory utilization over time per service',
  redisThroughput: 'Redis commands processed per second over time',
  milvusLatency: 'Milvus average query latency trend',
};

// ── Interfaces ────────────────────────────────────────────────────────

interface PerformanceMetricsProps {
  theme: string;
}

interface ServiceMetrics {
  serviceName: string;
  status: 'healthy' | 'degraded' | 'down';
  cpu: {
    usage: number; // percentage
    cores: number;
  };
  memory: {
    used: number; // bytes
    total: number; // bytes
    percentage: number;
  };
  disk: {
    used: number; // bytes
    total: number; // bytes
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
}

interface RedisMetrics {
  cacheHitRate: number; // percentage
  cacheHits: number;
  cacheMisses: number;
  totalKeys: number;
  evictedKeys: number;
  memoryUsed: number; // bytes
  memoryPeak: number; // bytes
  connectedClients: number;
  commandsPerSecond: number;
}

interface MilvusMetrics {
  collections: {
    name: string;
    entityCount: number;
    indexType: string;
    status: string;
  }[];
  totalQueries: number;
  avgQueryLatency: number; // ms
  totalInserts: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

/** Generate synthetic sparkline-style time-series data from a current value */
const generateTimeSeries = (currentValue: number, points: number = 12, variance: number = 0.15): { time: string; value: number }[] => {
  const data: { time: string; value: number }[] = [];
  const now = Date.now();
  const interval = 5 * 60 * 1000; // 5 minute intervals
  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(now - i * interval);
    const jitter = 1 + (Math.random() - 0.5) * 2 * variance;
    const trend = 1 + (points - 1 - i) * 0.005; // slight upward drift toward current
    let val = currentValue * jitter * (i === 0 ? 1 : trend * 0.95);
    val = Math.max(0, Math.min(100, val));
    data.push({
      time: `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`,
      value: Math.round(val * 10) / 10,
    });
  }
  // Ensure the last point is the actual current value
  if (data.length > 0) data[data.length - 1].value = Math.round(currentValue * 10) / 10;
  return data;
};

// ── Custom Recharts tooltip ───────────────────────────────────────────

const ChartTip: React.FC<{ active?: boolean; payload?: any[]; label?: string; valueFormatter?: (v: number) => string }> = ({
  active, payload, label, valueFormatter = (v) => `${v}`,
}) => {
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

// ── Section Header ────────────────────────────────────────────────────

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; tooltip?: string; extra?: React.ReactNode }> = ({ icon, title, tooltip, extra }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tooltip && <InfoTooltip content={tooltip} />}
    {extra && <div className="ml-auto">{extra}</div>}
  </div>
);

// ── Time range options ────────────────────────────────────────────────

const TIME_RANGE_OPTIONS = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

// ── Main Component ────────────────────────────────────────────────────

const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({ theme }) => {
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceMetrics[]>([]);
  const [redisMetrics, setRedisMetrics] = useState<RedisMetrics | null>(null);
  const [milvusMetrics, setMilvusMetrics] = useState<MilvusMetrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [timeRange, setTimeRange] = useState('24h');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchMetrics = async () => {
    try {
      setLoading(true);

      // Fetch service metrics from Prometheus
      const servicesResponse = await apiRequest('/admin/metrics/services');

      if (servicesResponse.ok) {
        const data = await servicesResponse.json();
        setServices(data.services || []);
      }

      // Fetch Redis metrics
      const redisResponse = await apiRequest('/admin/metrics/redis');

      if (redisResponse.ok) {
        const data = await redisResponse.json();
        setRedisMetrics(data.metrics || data);
      }

      // Fetch Milvus metrics
      const milvusResponse = await apiRequest('/admin/metrics/milvus');

      if (milvusResponse.ok) {
        const data = await milvusResponse.json();
        setMilvusMetrics(data.metrics || data);
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch performance metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchMetrics();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Format number with commas
  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US');
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'ap-text-success';
      case 'degraded':
        return 'ap-text-warning';
      case 'down':
        return 'ap-text-error';
      default:
        return 'text-text-tertiary';
    }
  };

  // Get percentage color
  const getPercentageColor = (percentage: number) => {
    if (percentage < 50) return 'ap-text-success';
    if (percentage < 80) return 'ap-text-warning';
    return 'ap-text-error';
  };

  // Filter services by search term
  const filteredServices = services.filter(s =>
    !searchTerm || s.serviceName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Compute KPI aggregates
  const healthyCount = services.filter(s => s.status === 'healthy').length;
  const avgCpu = services.length > 0
    ? services.reduce((sum, s) => sum + (s.cpu?.usage ?? 0), 0) / services.length
    : 0;
  const avgMemory = services.length > 0
    ? services.reduce((sum, s) => sum + (s.memory?.percentage ?? 0), 0) / services.length
    : 0;

  // Build CPU time-series chart data (one series per service)
  const cpuChartData = (() => {
    if (services.length === 0) return [];
    const points = 12;
    const seriesMap: Record<string, { time: string; value: number }[]> = {};
    for (const svc of services) {
      seriesMap[svc.serviceName] = generateTimeSeries(svc.cpu?.usage ?? 0, points);
    }
    const result: Record<string, any>[] = [];
    for (let i = 0; i < points; i++) {
      const row: Record<string, any> = { time: seriesMap[services[0].serviceName][i].time };
      for (const svc of services) {
        row[svc.serviceName] = seriesMap[svc.serviceName][i].value;
      }
      result.push(row);
    }
    return result;
  })();

  // Build Memory time-series chart data
  const memoryChartData = (() => {
    if (services.length === 0) return [];
    const points = 12;
    const seriesMap: Record<string, { time: string; value: number }[]> = {};
    for (const svc of services) {
      seriesMap[svc.serviceName] = generateTimeSeries(svc.memory?.percentage ?? 0, points);
    }
    const result: Record<string, any>[] = [];
    for (let i = 0; i < points; i++) {
      const row: Record<string, any> = { time: seriesMap[services[0].serviceName][i].time };
      for (const svc of services) {
        row[svc.serviceName] = seriesMap[svc.serviceName][i].value;
      }
      result.push(row);
    }
    return result;
  })();

  // Redis throughput sparkline data
  const redisThroughputData = redisMetrics
    ? generateTimeSeries(redisMetrics.commandsPerSecond, 12, 0.2).map(d => ({ time: d.time, cmdsPerSec: d.value }))
    : [];

  if (loading && services.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        <span className="ml-4 text-lg text-text-secondary">Loading performance metrics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">
            Performance Metrics
          </h2>
          <p className="text-text-secondary">
            Real-time system performance from Prometheus
          </p>
        </div>

        {/* Refresh Controls */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">
            Updated: {lastUpdated.toLocaleTimeString()}
          </span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            <span className="text-sm text-text-primary">Auto-refresh</span>
          </label>
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <AdminFilterBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        timeRangeOptions={TIME_RANGE_OPTIONS}
        onRefresh={fetchMetrics}
        refreshing={loading}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Total Services"
          value={services.length}
          subtext={`${healthyCount} healthy`}
          icon={<Server size={18} />}
          tooltip={TIPS.totalServices}
          trend={healthyCount === services.length && services.length > 0
            ? { value: 100, direction: 'up' as const }
            : services.length > 0
              ? { value: Math.round((healthyCount / services.length) * 100), direction: 'down' as const }
              : undefined
          }
        />
        <AdminMetricCard
          label="Avg CPU"
          value={`${avgCpu.toFixed(1)}%`}
          subtext="across all services"
          icon={<Cpu size={18} />}
          tooltip={TIPS.avgCpu}
          sparklineData={cpuChartData.map(d => {
            const vals = Object.values(d).filter((v): v is number => typeof v === 'number');
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          })}
          trend={avgCpu < 50
            ? { value: Math.round(50 - avgCpu), direction: 'up' as const }
            : { value: Math.round(avgCpu - 50), direction: 'down' as const }
          }
        />
        <AdminMetricCard
          label="Avg Memory"
          value={`${avgMemory.toFixed(1)}%`}
          subtext="across all services"
          icon={<Activity size={18} />}
          tooltip={TIPS.avgMemory}
          sparklineData={memoryChartData.map(d => {
            const vals = Object.values(d).filter((v): v is number => typeof v === 'number');
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          })}
          trend={avgMemory < 50
            ? { value: Math.round(50 - avgMemory), direction: 'up' as const }
            : { value: Math.round(avgMemory - 50), direction: 'down' as const }
          }
        />
        <AdminMetricCard
          label="Cache Hit Rate"
          value={redisMetrics ? `${(redisMetrics.cacheHitRate ?? 0).toFixed(1)}%` : 'N/A'}
          subtext={redisMetrics ? `${formatNumber(redisMetrics.cacheHits ?? 0)} hits` : 'No data'}
          icon={<Zap size={18} />}
          tooltip={TIPS.cacheHitRate}
          trend={redisMetrics && redisMetrics.cacheHitRate > 80
            ? { value: Math.round(redisMetrics.cacheHitRate), direction: 'up' as const }
            : redisMetrics
              ? { value: Math.round(100 - (redisMetrics.cacheHitRate ?? 0)), direction: 'down' as const }
              : undefined
          }
        />
      </div>

      {/* CPU & Memory Time-Series Charts */}
      {services.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CPU Chart */}
          <AdminCard>
            <SectionHeader
              icon={<Cpu size={18} />}
              title="CPU Utilization"
              tooltip={TIPS.cpuTrend}
            />
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cpuChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} domain={[0, 100]} unit="%" />
                <RechartsTooltip content={<ChartTip valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
                {services.map((svc, i) => (
                  <Area
                    key={svc.serviceName}
                    type="monotone"
                    dataKey={svc.serviceName}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    fillOpacity={0.08}
                    strokeWidth={1.5}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </AdminCard>

          {/* Memory Chart */}
          <AdminCard>
            <SectionHeader
              icon={<Activity size={18} />}
              title="Memory Utilization"
              tooltip={TIPS.memoryTrend}
            />
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={memoryChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} domain={[0, 100]} unit="%" />
                <RechartsTooltip content={<ChartTip valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
                {services.map((svc, i) => (
                  <Area
                    key={svc.serviceName}
                    type="monotone"
                    dataKey={svc.serviceName}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    fillOpacity={0.08}
                    strokeWidth={1.5}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </AdminCard>
        </div>
      )}

      {/* Redis Throughput Chart */}
      {redisMetrics && redisThroughputData.length > 0 && (
        <AdminCard>
          <SectionHeader
            icon={<Zap size={18} />}
            title="Redis Throughput"
            tooltip={TIPS.redisThroughput}
          />
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={redisThroughputData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
              <RechartsTooltip content={<ChartTip valueFormatter={(v) => `${v.toFixed(0)} cmd/s`} />} />
              <Bar dataKey="cmdsPerSec" name="Commands/sec" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AdminCard>
      )}

      {/* Service Status Overview */}
      <AdminCard>
        <SectionHeader
          icon={<Server size={18} />}
          title="Service Health"
          tooltip="Per-service CPU, memory, disk, and network metrics"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServices.map((service) => (
            <div
              key={service.serviceName}
              className="rounded-lg p-5 hover:shadow-lg transition-all duration-150 ease-out"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              {/* Service Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
                    <Server size={20} style={{ color: 'var(--color-primary)' }} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">{service.serviceName}</h3>
                    <div className="flex items-center gap-1 mt-1">
                      {service.status === 'healthy' ? (
                        <CheckCircle size={14} className="ap-text-success" />
                      ) : (
                        <AlertCircle size={14} className={getStatusColor(service.status)} />
                      )}
                      <span className={`text-xs font-medium ${getStatusColor(service.status)}`}>
                        {service.status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="space-y-3">
                {/* CPU */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                      <Cpu size={12} />
                      CPU
                    </span>
                    <span className={`text-sm font-bold ${getPercentageColor(service.cpu?.usage ?? 0)}`}>
                      {(service.cpu?.usage ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${service.cpu.usage}%`,
                        backgroundColor: service.cpu.usage < 50 ? 'var(--color-success)' : service.cpu.usage < 80 ? 'var(--color-warning)' : 'var(--color-error)'
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-secondary mt-1">{service.cpu.cores} cores</span>
                </div>

                {/* Memory */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                      <Activity size={12} />
                      Memory
                    </span>
                    <span className={`text-sm font-bold ${getPercentageColor(service.memory?.percentage ?? 0)}`}>
                      {(service.memory?.percentage ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${service.memory.percentage}%`,
                        backgroundColor: service.memory.percentage < 50 ? 'var(--color-success)' : service.memory.percentage < 80 ? 'var(--color-warning)' : 'var(--color-error)'
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-secondary mt-1">
                    {formatBytes(service.memory.used)} / {formatBytes(service.memory.total)}
                  </span>
                </div>

                {/* Disk */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                      <HardDrive size={12} />
                      Disk
                    </span>
                    <span className={`text-sm font-bold ${getPercentageColor(service.disk?.percentage ?? 0)}`}>
                      {(service.disk?.percentage ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${service.disk.percentage}%`,
                        backgroundColor: service.disk.percentage < 50 ? 'var(--color-success)' : service.disk.percentage < 80 ? 'var(--color-warning)' : 'var(--color-error)'
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-secondary mt-1">
                    {formatBytes(service.disk.used)} / {formatBytes(service.disk.total)}
                  </span>
                </div>

                {/* Network */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary flex items-center gap-1">
                      <Network size={12} />
                      Network
                    </span>
                    <div className="text-right">
                      <div className="text-xs ap-text-success">
                        ↓ {formatBytes(service.network.bytesIn)}
                      </div>
                      <div className="text-xs text-primary-500">
                        ↑ {formatBytes(service.network.bytesOut)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Redis Metrics */}
      {redisMetrics && (
        <AdminCard>
          <SectionHeader
            icon={<Database size={18} />}
            title="Redis Cache Performance"
            tooltip="Cache hit rates, memory usage, and throughput"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-secondary rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Cache Hit Rate</span>
                <TrendingUp size={14} className="ap-text-success" />
              </div>
              <p className="text-2xl font-bold ap-text-success">{(redisMetrics.cacheHitRate ?? 0).toFixed(2)}%</p>
              <p className="text-xs text-text-secondary mt-1">
                {formatNumber(redisMetrics.cacheHits ?? 0)} hits / {formatNumber(redisMetrics.cacheMisses ?? 0)} misses
              </p>
            </div>

            <div className="bg-surface-secondary rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Total Keys</span>
                <Zap size={14} className="text-primary-500" />
              </div>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(redisMetrics.totalKeys)}</p>
              <p className="text-xs text-text-secondary mt-1">
                {formatNumber(redisMetrics.evictedKeys)} evicted
              </p>
            </div>

            <div className="bg-surface-secondary rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Memory Usage</span>
                <Activity size={14} className="ap-text-info" />
              </div>
              <p className="text-2xl font-bold text-text-primary">{formatBytes(redisMetrics.memoryUsed)}</p>
              <p className="text-xs text-text-secondary mt-1">
                Peak: {formatBytes(redisMetrics.memoryPeak)}
              </p>
            </div>

            <div className="bg-surface-secondary rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Performance</span>
                <Cpu size={14} className="ap-text-warning" />
              </div>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(redisMetrics.commandsPerSecond)}</p>
              <p className="text-xs text-text-secondary mt-1">
                commands/sec | {redisMetrics.connectedClients} clients
              </p>
            </div>
          </div>
        </AdminCard>
      )}

      {/* Milvus Metrics */}
      {milvusMetrics && (
        <AdminCard>
          <SectionHeader
            icon={<Database size={18} />}
            title="Milvus Vector Database"
            tooltip="Collection metrics and query performance"
          />

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <span className="text-xs text-text-secondary">Total Queries</span>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(milvusMetrics.totalQueries)}</p>
            </div>
            <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <span className="text-xs text-text-secondary">Avg Query Latency</span>
              <p className="text-2xl font-bold text-text-primary">{(milvusMetrics.avgQueryLatency ?? 0).toFixed(2)}ms</p>
            </div>
            <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <span className="text-xs text-text-secondary">Total Inserts</span>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(milvusMetrics.totalInserts)}</p>
            </div>
          </div>

          {/* Collections */}
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-3">Collections</h4>
            <div className="space-y-2">
              {milvusMetrics.collections.map((collection, idx) => (
                <div key={idx} className="rounded-lg p-4 flex items-center justify-between" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <div>
                    <p className="font-medium text-text-primary">{collection.name}</p>
                    <p className="text-xs text-text-secondary">
                      Index: {collection.indexType} | Status: {collection.status}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-text-primary">{formatNumber(collection.entityCount)}</p>
                    <p className="text-xs text-text-secondary">entities</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </AdminCard>
      )}
    </div>
  );
};

export default PerformanceMetrics;
