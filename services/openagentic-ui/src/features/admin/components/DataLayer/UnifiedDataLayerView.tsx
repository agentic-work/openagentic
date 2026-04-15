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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Database,
  Server,
  Zap,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Activity,
  ChevronDown,
  ChevronRight,
  Search,
  Trash,
  Eye,
  Clock,
  Shield,
  Settings,
} from '../Shared/AdminIcons';
import { Layers, HardDrive, Users } from '@/shared/icons';
import { apiRequest } from '@/utils/api';

// =============================================================================
// Types
// =============================================================================

interface RedisMetrics {
  memory: {
    used: number;
    peak: number;
    total: number;
    fragmentation_ratio: number;
  };
  keys: number;
  hit_rate: number;
  hits: number;
  misses: number;
  clients: number;
  commands_per_sec: number;
  evicted_keys: number;
  eviction_policy: string;
  aof_enabled: boolean;
  rdb_last_save: string | null;
  connected: boolean;
  uptime_seconds: number;
  version: string;
}

interface MilvusMetrics {
  collections: number;
  queries: number;
  latency: number;
  inserts: number;
  connected: boolean;
  mode: string;
  healthy: boolean;
  minio_connected: boolean;
}

interface MilvusCollection {
  name: string;
  rowCount: number;
  description?: string;
  dimension?: number;
  indexType?: string;
  metricType?: string;
  status?: 'loaded' | 'released' | 'error';
  schema?: Array<{
    name: string;
    type: string;
    is_primary?: boolean;
    description?: string;
  }>;
}

interface MCPToolsStatus {
  indexing: {
    lastIndexTime: string | null;
    lastIndexSuccess: boolean;
    lastIndexError: string | null;
    totalToolsIndexed: number;
  };
  milvus: {
    exists: boolean;
    rowCount: number;
    error?: string;
  };
  redis: {
    serverCounts: Record<string, number>;
    totalServers: number;
  };
  mcpProxy: {
    totalTools: number;
    servers: Array<{ serverId: string; toolCount: number }>;
  };
  inSync: boolean;
}

type TabId = 'cache' | 'collections' | 'diagnostics' | 'user-usage';
type AutoRefreshInterval = 0 | 10 | 30 | 60;

interface VectorUsageData {
  pgvectorTotals: {
    userMemories: number;
    toolResultCache: number;
    verifiedToolResults: number;
    toolSuccessRecords: number;
    queryEmbeddingCache: number;
    userVectorCollections: number;
  };
  milvusCollections: Array<{
    name: string;
    rowCount: number;
    dimension?: number;
    indexType?: string;
  }>;
  milvusTotalRows: number;
  milvusTotalCollections: number;
  vectorCollections: Array<{
    id: string;
    user_id: string;
    name: string;
    description?: string;
    collection_type?: string;
    dimensions?: number;
    total_entries: number;
    created_at: string;
    updated_at: string;
  }>;
  perUserUsage: Array<{
    userId: string;
    email: string;
    name: string;
    memories: number;
    memorySizeBytes: number;
    toolCache: number;
    verifiedResults: number;
    successRecords: number;
    vectorCollections: number;
    totalVectorEntries: number;
    total: number;
  }>;
}

interface UnifiedDataLayerViewProps {
  theme: string;
}

// =============================================================================
// Helpers
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString();
}

function hitRateColor(rate: number): string {
  if (rate >= 90) return 'var(--color-success, #00D26A)';
  if (rate >= 70) return 'var(--color-warning, #eab308)';
  return 'var(--color-error, #ef4444)';
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'loaded':
      return 'bg-green-500/20 text-green-400 border border-green-500/30';
    case 'released':
      return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
    case 'error':
      return 'bg-red-500/20 text-red-400 border border-red-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border border-gray-500/30';
  }
}

// =============================================================================
// Sub-components
// =============================================================================

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
}> = ({ icon, label, value, subtext, color }) => (
  <div
    className="glass-card p-4 flex flex-col gap-2"
    style={{
      background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
    }}
  >
    <div className="flex items-center gap-2 text-text-secondary text-xs font-medium uppercase tracking-wider">
      {icon}
      {label}
    </div>
    <div className="text-2xl font-bold text-text-primary" style={color ? { color } : undefined}>
      {value}
    </div>
    {subtext && <div className="text-xs text-text-tertiary">{subtext}</div>}
  </div>
);

const HitRateBar: React.FC<{ rate: number; label?: string }> = ({ rate, label }) => (
  <div className="w-full">
    {label && <div className="text-xs text-text-secondary mb-1">{label}</div>}
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(rate, 100)}%`,
            backgroundColor: hitRateColor(rate),
          }}
        />
      </div>
      <span className="text-sm font-bold min-w-[3rem] text-right" style={{ color: hitRateColor(rate) }}>
        {rate.toFixed(1)}%
      </span>
    </div>
  </div>
);

const ConnectionBadge: React.FC<{ connected: boolean; label: string }> = ({ connected, label }) => (
  <div className="flex items-center gap-2">
    {connected ? (
      <CheckCircle size={14} className="text-green-400" />
    ) : (
      <XCircle size={14} className="text-red-400" />
    )}
    <span className={`text-sm ${connected ? 'text-green-400' : 'text-red-400'}`}>{label}</span>
  </div>
);

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="flex items-start gap-3 mb-4">
    <div className="p-2 rounded-lg bg-primary-500/10">{icon}</div>
    <div>
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  </div>
);

const LoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div className="flex items-center justify-center h-40">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
    <span className="ml-3 text-text-secondary">{message}</span>
  </div>
);

const ErrorBanner: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="glass-card p-4 border border-red-500/30 bg-red-500/5 flex items-center justify-between">
    <div className="flex items-center gap-2 text-red-400">
      <XCircle size={16} />
      <span className="text-sm">{message}</span>
    </div>
    {onRetry && (
      <button
        onClick={onRetry}
        className="text-xs px-3 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
      >
        Retry
      </button>
    )}
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const UnifiedDataLayerView: React.FC<UnifiedDataLayerViewProps> = ({ theme }) => {
  const [activeTab, setActiveTab] = useState<TabId>('cache');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<AutoRefreshInterval>(30);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Data states
  const [redisMetrics, setRedisMetrics] = useState<RedisMetrics | null>(null);
  const [milvusMetrics, setMilvusMetrics] = useState<MilvusMetrics | null>(null);
  const [collections, setCollections] = useState<MilvusCollection[]>([]);
  const [mcpToolsStatus, setMcpToolsStatus] = useState<MCPToolsStatus | null>(null);

  // Loading / error states
  const [redisLoading, setRedisLoading] = useState(false);
  const [milvusLoading, setMilvusLoading] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [redisError, setRedisError] = useState<string | null>(null);
  const [milvusError, setMilvusError] = useState<string | null>(null);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  // Vector usage state (user breakdown)
  const [vectorUsage, setVectorUsage] = useState<VectorUsageData | null>(null);
  const [vectorUsageLoading, setVectorUsageLoading] = useState(false);
  const [vectorUsageError, setVectorUsageError] = useState<string | null>(null);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userSortField, setUserSortField] = useState<'total' | 'memories' | 'toolCache' | 'email'>('total');

  // Reindex state
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<{ success: boolean; message: string } | null>(null);

  // Collection expansion state
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());

  // Sparkline data for Redis commands/sec
  const sparklineRef = useRef<number[]>([]);

  // ---------------------------------------------------------------------------
  // Data Fetchers
  // ---------------------------------------------------------------------------

  const fetchRedisMetrics = useCallback(async () => {
    try {
      setRedisLoading(true);
      setRedisError(null);
      const res = await apiRequest('/admin/metrics/redis');
      if (!res.ok) throw new Error(`Redis metrics: ${res.statusText}`);
      const data = await res.json();
      const metrics = data.metrics || data;
      setRedisMetrics(metrics);
      // Track sparkline data
      if (metrics?.commands_per_sec != null) {
        sparklineRef.current = [...sparklineRef.current.slice(-19), metrics.commands_per_sec];
      }
    } catch (err: any) {
      setRedisError(err.message || 'Failed to fetch Redis metrics');
    } finally {
      setRedisLoading(false);
    }
  }, []);

  const fetchMilvusMetrics = useCallback(async () => {
    try {
      setMilvusLoading(true);
      setMilvusError(null);
      const res = await apiRequest('/admin/metrics/milvus');
      if (!res.ok) throw new Error(`Milvus metrics: ${res.statusText}`);
      const data = await res.json();
      const raw = data.metrics || data;
      // Normalize API shape: collections may be an array, UI expects a count
      const collections = Array.isArray(raw.collections) ? raw.collections : [];
      setMilvusMetrics({
        ...raw,
        collections: collections.length,
        inserts: raw.totalInserts ?? raw.inserts ?? 0,
        latency: raw.avgQueryLatency ?? raw.latency ?? 0,
        connected: raw.connected ?? true,
        healthy: raw.healthy ?? true,
        mode: raw.mode || 'Standalone',
        minio_connected: raw.minio_connected ?? true,
        _collections: collections, // preserve raw for other uses
      });
    } catch (err: any) {
      setMilvusError(err.message || 'Failed to fetch Milvus metrics');
    } finally {
      setMilvusLoading(false);
    }
  }, []);

  const fetchCollections = useCallback(async () => {
    try {
      setCollectionsLoading(true);
      setCollectionsError(null);
      const res = await apiRequest('/admin/system/milvus/collections');
      if (!res.ok) throw new Error(`Collections: ${res.statusText}`);
      const data = await res.json();
      setCollections(data.collections || []);
    } catch (err: any) {
      setCollectionsError(err.message || 'Failed to fetch collections');
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  const fetchMCPToolsStatus = useCallback(async () => {
    try {
      setMcpLoading(true);
      setMcpError(null);
      const res = await apiRequest('/admin/mcp/tools/status');
      if (!res.ok) throw new Error(`MCP tools status: ${res.statusText}`);
      const data = await res.json();
      if (data.status === 'success' || data.indexing) {
        setMcpToolsStatus(data);
      } else {
        throw new Error(data.error || 'Failed to fetch MCP tools status');
      }
    } catch (err: any) {
      setMcpError(err.message || 'Failed to fetch MCP tools status');
    } finally {
      setMcpLoading(false);
    }
  }, []);

  const handleReindex = useCallback(async () => {
    try {
      setReindexing(true);
      setReindexResult(null);
      const res = await apiRequest('/admin/mcp/tools/reindex', { method: 'POST' });
      const data = await res.json();
      if (res.ok && (data.status === 'success' || data.toolsIndexed != null)) {
        setReindexResult({
          success: true,
          message: `Indexed ${data.toolsIndexed ?? 0} tools${data.duration ? ` in ${data.duration}ms` : ''}`,
        });
        await fetchMCPToolsStatus();
      } else {
        setReindexResult({
          success: false,
          message: data.message || data.error || 'Reindex failed',
        });
      }
    } catch (err: any) {
      setReindexResult({ success: false, message: err.message || 'Reindex failed' });
    } finally {
      setReindexing(false);
    }
  }, [fetchMCPToolsStatus]);

  const fetchVectorUsage = useCallback(async () => {
    try {
      setVectorUsageLoading(true);
      setVectorUsageError(null);
      const res = await apiRequest('/admin/metrics/vector-usage');
      if (!res.ok) throw new Error(`Vector usage: ${res.statusText}`);
      const data = await res.json();
      if (data.success) {
        setVectorUsage(data);
      } else {
        throw new Error(data.error || 'Failed to fetch vector usage');
      }
    } catch (err: any) {
      setVectorUsageError(err.message || 'Failed to fetch vector usage');
    } finally {
      setVectorUsageLoading(false);
    }
  }, []);

  // Fetch all data needed for the active tab
  const fetchDataForTab = useCallback(
    async (tab: TabId) => {
      const promises: Promise<void>[] = [];
      switch (tab) {
        case 'cache':
          promises.push(fetchRedisMetrics(), fetchMilvusMetrics(), fetchMCPToolsStatus(), fetchVectorUsage());
          break;
        case 'collections':
          promises.push(fetchCollections(), fetchMilvusMetrics());
          break;
        case 'diagnostics':
          promises.push(fetchRedisMetrics(), fetchMilvusMetrics(), fetchMCPToolsStatus());
          break;
        case 'user-usage':
          promises.push(fetchVectorUsage());
          break;
      }
      await Promise.allSettled(promises);
      setLastUpdated(new Date());
    },
    [fetchRedisMetrics, fetchMilvusMetrics, fetchCollections, fetchMCPToolsStatus, fetchVectorUsage],
  );

  // Initial fetch on tab change
  useEffect(() => {
    fetchDataForTab(activeTab);
  }, [activeTab, fetchDataForTab]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshInterval === 0) return;
    const id = setInterval(() => fetchDataForTab(activeTab), autoRefreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefreshInterval, activeTab, fetchDataForTab]);

  // Collection expand/collapse toggle
  const toggleCollection = (name: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Sparkline renderer (inline SVG)
  // ---------------------------------------------------------------------------
  const renderSparkline = (data: number[], width = 120, height = 32) => {
    if (data.length < 2) return null;
    const max = Math.max(...data, 1);
    const points = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (v / max) * height;
        return `${x},${y}`;
      })
      .join(' ');
    return (
      <svg width={width} height={height} className="opacity-70">
        <defs>
          <linearGradient id="sparkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <polyline
          points={points}
          fill="none"
          stroke="url(#sparkGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Fill area under line */}
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill="url(#sparkGrad)"
          opacity="0.15"
        />
      </svg>
    );
  };

  // ---------------------------------------------------------------------------
  // Tab: Cache Overview
  // ---------------------------------------------------------------------------
  const renderCacheOverview = () => {
    const isLoading = redisLoading || milvusLoading || mcpLoading;

    return (
      <div className="space-y-8">
        {/* L1 - Redis Cache */}
        <div>
          <SectionHeader
            icon={<Zap size={20} className="text-amber-400" />}
            title="L1 - Redis Cache"
            description="In-memory key-value cache for session state, rate limits, and hot data"
          />
          {redisError ? (
            <ErrorBanner message={redisError} onRetry={fetchRedisMetrics} />
          ) : redisLoading && !redisMetrics ? (
            <LoadingSpinner message="Loading Redis metrics..." />
          ) : redisMetrics ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <StatCard
                  icon={<Activity size={14} />}
                  label="Hit Rate"
                  value={`${(redisMetrics.hit_rate ?? 0).toFixed(1)}%`}
                  color={hitRateColor(redisMetrics.hit_rate ?? 0)}
                  subtext={`${formatNumber(redisMetrics.hits ?? 0)} hits / ${formatNumber(redisMetrics.misses ?? 0)} misses`}
                />
                <StatCard
                  icon={<HardDrive size={14} />}
                  label="Memory Used"
                  value={formatBytes(redisMetrics.memory?.used ?? 0)}
                  subtext={`Peak: ${formatBytes(redisMetrics.memory?.peak ?? 0)}`}
                />
                <StatCard
                  icon={<Database size={14} />}
                  label="Total Keys"
                  value={formatNumber(redisMetrics.keys ?? 0)}
                  subtext={`${formatNumber(redisMetrics.evicted_keys ?? 0)} evicted`}
                />
                <StatCard
                  icon={<Server size={14} />}
                  label="Clients"
                  value={redisMetrics.clients ?? 0}
                />
                <div
                  className="glass-card p-4 flex flex-col gap-2"
                  style={{
                    background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
                  }}
                >
                  <div className="flex items-center gap-2 text-text-secondary text-xs font-medium uppercase tracking-wider">
                    <Zap size={14} />
                    Cmds/sec
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {formatNumber(redisMetrics.commands_per_sec ?? 0)}
                  </div>
                  {renderSparkline(sparklineRef.current)}
                </div>
              </div>
              <HitRateBar rate={redisMetrics.hit_rate ?? 0} label="Cache Hit Rate" />
            </div>
          ) : (
            <div className="glass-card p-6 text-center text-text-secondary">
              No Redis data available
            </div>
          )}
        </div>

        {/* L2 - pgvector Cache */}
        <div>
          <SectionHeader
            icon={<Database size={20} className="text-blue-400" />}
            title="L2 - pgvector Cache"
            description="Local ACID-compliant cache for tool results, verified outputs, and success records"
          />
          <div
            className="glass-card p-6"
            style={{
              background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {([
                { table: 'tool_result_cache', key: 'toolResultCache' as const, desc: 'Caches raw MCP tool call results' },
                { table: 'verified_tool_results', key: 'verifiedToolResults' as const, desc: 'Verified/validated tool outputs' },
                { table: 'tool_success_records', key: 'toolSuccessRecords' as const, desc: 'Successful tool invocations' },
              ]).map(({ table, key, desc }) => (
                <div key={table} className="p-4 rounded-lg bg-surface-secondary/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Database size={14} className="text-blue-400" />
                    <span className="text-sm font-mono font-medium text-text-primary">{table}</span>
                  </div>
                  <p className="text-xs text-text-tertiary mb-2">{desc}</p>
                  {vectorUsage ? (
                    <div className="text-lg font-bold font-mono text-text-primary">
                      {formatNumber(vectorUsage.pgvectorTotals[key])}
                      <span className="text-xs font-normal text-text-tertiary ml-1">rows</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-text-tertiary text-xs">
                      <AlertCircle size={12} />
                      <span>Switch to User Usage tab to load stats</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* L3 - Milvus Vector Cache */}
        <div>
          <SectionHeader
            icon={<Layers size={20} className="text-purple-400" />}
            title="L3 - Milvus Vector Cache"
            description="Semantic vector cache for MCP tools, embeddings, and historical archive"
          />
          {mcpError && !milvusError ? (
            <ErrorBanner message={mcpError} onRetry={fetchMCPToolsStatus} />
          ) : milvusError ? (
            <ErrorBanner message={milvusError} onRetry={fetchMilvusMetrics} />
          ) : (mcpLoading || milvusLoading) && !mcpToolsStatus && !milvusMetrics ? (
            <LoadingSpinner message="Loading Milvus metrics..." />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  icon={<Database size={14} />}
                  label="Collections"
                  value={milvusMetrics?.collections ?? 0}
                />
                <StatCard
                  icon={<Activity size={14} />}
                  label="Total Queries"
                  value={formatNumber(milvusMetrics?.queries ?? 0)}
                />
                <StatCard
                  icon={<Clock size={14} />}
                  label="Avg Latency"
                  value={`${(milvusMetrics?.latency ?? 0).toFixed(1)}ms`}
                />
                <StatCard
                  icon={<Zap size={14} />}
                  label="Tools Indexed"
                  value={mcpToolsStatus?.indexing?.totalToolsIndexed ?? 0}
                  subtext={
                    mcpToolsStatus?.inSync
                      ? 'In sync with MCP proxy'
                      : 'Out of sync'
                  }
                  color={mcpToolsStatus?.inSync ? undefined : 'var(--color-warning, #eab308)'}
                />
              </div>

              {/* Reindex controls */}
              <div
                className="glass-card p-4 flex items-center justify-between"
                style={{
                  background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {mcpToolsStatus?.inSync ? (
                      <CheckCircle size={16} className="text-green-400" />
                    ) : (
                      <AlertCircle size={16} className="text-yellow-400" />
                    )}
                    <span className="text-sm text-text-primary font-medium">
                      MCP Tool Semantic Cache
                    </span>
                  </div>
                  {mcpToolsStatus?.indexing?.lastIndexTime && (
                    <span className="text-xs text-text-tertiary">
                      Last indexed: {formatDate(mcpToolsStatus.indexing.lastIndexTime)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {reindexResult && (
                    <span
                      className={`text-xs ${reindexResult.success ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {reindexResult.message}
                    </span>
                  )}
                  <button
                    onClick={handleReindex}
                    disabled={reindexing}
                    className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                  >
                    <RefreshCw size={14} className={reindexing ? 'animate-spin' : ''} />
                    {reindexing ? 'Reindexing...' : 'Reindex Tools'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Tab: Vector Collections
  // ---------------------------------------------------------------------------
  const renderVectorCollections = () => {
    return (
      <div className="space-y-8">
        {/* Milvus Collections */}
        <div>
          <SectionHeader
            icon={<Database size={20} className="text-purple-400" />}
            title="Milvus Collections"
            description="Browse, inspect, and manage all Milvus vector collections"
          />
          {collectionsError ? (
            <ErrorBanner message={collectionsError} onRetry={fetchCollections} />
          ) : collectionsLoading && collections.length === 0 ? (
            <LoadingSpinner message="Loading collections..." />
          ) : collections.length === 0 ? (
            <div className="glass-card p-8 text-center text-text-secondary">
              No Milvus collections found
            </div>
          ) : (
            <div className="glass-card overflow-hidden border border-border/50">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-surface-secondary/50 border-b border-border/50 text-xs text-text-tertiary font-medium uppercase tracking-wider">
                <div className="col-span-1" />
                <div className="col-span-3">Collection</div>
                <div className="col-span-2 text-right">Rows</div>
                <div className="col-span-1 text-right">Dim</div>
                <div className="col-span-2">Index Type</div>
                <div className="col-span-1">Metric</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-1">Actions</div>
              </div>

              {/* Table rows */}
              {collections.map((col) => {
                const isExpanded = expandedCollections.has(col.name);
                return (
                  <React.Fragment key={col.name}>
                    <div
                      className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-border/30 hover:bg-surface-secondary/30 transition-colors cursor-pointer items-center"
                      onClick={() => toggleCollection(col.name)}
                    >
                      <div className="col-span-1 flex items-center">
                        {isExpanded ? (
                          <ChevronDown size={16} className="text-text-tertiary" />
                        ) : (
                          <ChevronRight size={16} className="text-text-tertiary" />
                        )}
                      </div>
                      <div className="col-span-3">
                        <div className="flex items-center gap-2">
                          <Database size={14} className="text-purple-400" />
                          <span className="text-sm font-mono font-medium text-text-primary">
                            {col.name}
                          </span>
                        </div>
                        {col.description && (
                          <div className="text-xs text-text-tertiary mt-1">{col.description}</div>
                        )}
                      </div>
                      <div className="col-span-2 text-right text-sm font-mono text-text-primary">
                        {formatNumber(col.rowCount)}
                      </div>
                      <div className="col-span-1 text-right text-sm font-mono text-text-secondary">
                        {col.dimension ?? '-'}
                      </div>
                      <div className="col-span-2">
                        <span className="text-xs px-2 py-1 rounded bg-surface-secondary text-text-secondary font-mono">
                          {col.indexType || 'N/A'}
                        </span>
                      </div>
                      <div className="col-span-1">
                        <span className="text-xs text-text-secondary font-mono">
                          {col.metricType || 'N/A'}
                        </span>
                      </div>
                      <div className="col-span-1">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClasses(col.status || 'loaded')}`}
                        >
                          {col.status || 'loaded'}
                        </span>
                      </div>
                      <div className="col-span-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          title="Browse"
                          className="p-1.5 rounded hover:bg-surface-secondary transition-colors text-text-tertiary hover:text-text-primary"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          title="Delete"
                          className="p-1.5 rounded hover:bg-red-500/10 transition-colors text-text-tertiary hover:text-red-400"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded schema details */}
                    {isExpanded && (
                      <div className="px-12 py-4 bg-surface-secondary/20 border-b border-border/30">
                        {col.schema && col.schema.length > 0 ? (
                          <div>
                            <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3">
                              Schema Fields
                            </h4>
                            <div className="grid grid-cols-3 gap-2">
                              {col.schema.map((field) => (
                                <div
                                  key={field.name}
                                  className="flex items-center gap-2 text-sm p-2 rounded bg-surface-secondary/50"
                                >
                                  <span className="font-mono text-text-primary">{field.name}</span>
                                  <span className="text-xs text-text-tertiary">({field.type})</span>
                                  {field.is_primary && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-400 font-medium">
                                      PK
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-text-tertiary flex items-center gap-2">
                            <AlertCircle size={14} />
                            Schema details not available. Expand the admin API to return field metadata.
                          </div>
                        )}
                        <div className="mt-3 flex gap-4 text-xs text-text-tertiary">
                          <span>
                            Rows: <span className="font-mono text-text-secondary">{formatNumber(col.rowCount)}</span>
                          </span>
                          {col.dimension && (
                            <span>
                              Dimension: <span className="font-mono text-text-secondary">{col.dimension}</span>
                            </span>
                          )}
                          {col.indexType && (
                            <span>
                              Index: <span className="font-mono text-text-secondary">{col.indexType}</span>
                            </span>
                          )}
                          {col.metricType && (
                            <span>
                              Metric: <span className="font-mono text-text-secondary">{col.metricType}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* pgvector Tables */}
        <div>
          <SectionHeader
            icon={<Database size={20} className="text-blue-400" />}
            title="pgvector Tables"
            description="PostgreSQL tables with vector columns for local ACID-compliant cache"
          />
          <div
            className="glass-card p-6"
            style={{
              background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {([
                { table: 'tool_result_cache', key: 'toolResultCache' as const, desc: 'Caches raw MCP tool call results for deduplication', dimApprox: 1536 },
                { table: 'verified_tool_results', key: 'verifiedToolResults' as const, desc: 'Stores verified/validated tool outputs for trusted reuse', dimApprox: 1536 },
                { table: 'tool_success_records', key: 'toolSuccessRecords' as const, desc: 'Tracks successful tool invocations for reliability scoring', dimApprox: null },
              ]).map(({ table, key, desc, dimApprox }) => (
                <div key={table} className="p-4 rounded-lg bg-surface-secondary/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Database size={14} className="text-blue-400" />
                    <span className="text-sm font-mono font-medium text-text-primary">{table}</span>
                  </div>
                  <p className="text-xs text-text-tertiary mb-3">{desc}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-tertiary">Rows:</span>
                    {vectorUsage ? (
                      <span className="text-text-primary font-mono font-bold">
                        {formatNumber(vectorUsage.pgvectorTotals[key])}
                      </span>
                    ) : (
                      <span className="text-text-secondary flex items-center gap-1">
                        <AlertCircle size={10} />
                        Load User Usage tab
                      </span>
                    )}
                  </div>
                  {dimApprox && (
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-text-tertiary">Approx. Dimension:</span>
                      <span className="text-text-secondary font-mono">{dimApprox}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Tab: Diagnostics
  // ---------------------------------------------------------------------------
  const renderDiagnostics = () => {
    return (
      <div className="space-y-8">
        {/* Redis Diagnostics */}
        <div>
          <SectionHeader
            icon={<Zap size={20} className="text-amber-400" />}
            title="Redis Diagnostics"
            description="Connection health, memory fragmentation, persistence, and eviction"
          />
          {redisError ? (
            <ErrorBanner message={redisError} onRetry={fetchRedisMetrics} />
          ) : !redisMetrics ? (
            <LoadingSpinner message="Loading Redis diagnostics..." />
          ) : (
            <div
              className="glass-card p-6"
              style={{
                background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Connection */}
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Connection
                  </h4>
                  <ConnectionBadge connected={redisMetrics.connected} label={redisMetrics.connected ? 'Connected' : 'Disconnected'} />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Version</span>
                    <span className="font-mono text-text-secondary">{redisMetrics.version || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Uptime</span>
                    <span className="font-mono text-text-secondary">{formatUptime(redisMetrics.uptime_seconds ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Active Clients</span>
                    <span className="font-mono text-text-secondary">{redisMetrics.clients ?? 0}</span>
                  </div>
                </div>

                {/* Memory */}
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Memory
                  </h4>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Used</span>
                    <span className="font-mono text-text-secondary">{formatBytes(redisMetrics.memory?.used ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Peak</span>
                    <span className="font-mono text-text-secondary">{formatBytes(redisMetrics.memory?.peak ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Fragmentation</span>
                    <span
                      className="font-mono"
                      style={{
                        color:
                          (redisMetrics.memory?.fragmentation_ratio ?? 1) > 1.5
                            ? 'var(--color-warning, #eab308)'
                            : 'var(--color-text-secondary)',
                      }}
                    >
                      {(redisMetrics.memory?.fragmentation_ratio ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Eviction */}
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Eviction
                  </h4>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Policy</span>
                    <span className="font-mono text-text-secondary text-xs">{redisMetrics.eviction_policy || 'noeviction'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Evicted Keys</span>
                    <span className="font-mono text-text-secondary">{formatNumber(redisMetrics.evicted_keys ?? 0)}</span>
                  </div>
                </div>

                {/* Persistence */}
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Persistence
                  </h4>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">AOF</span>
                    <span className={`font-mono ${redisMetrics.aof_enabled ? 'text-green-400' : 'text-text-tertiary'}`}>
                      {redisMetrics.aof_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">RDB Last Save</span>
                    <span className="font-mono text-text-secondary text-xs">
                      {redisMetrics.rdb_last_save ? formatDate(redisMetrics.rdb_last_save) : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Milvus Diagnostics */}
        <div>
          <SectionHeader
            icon={<Layers size={20} className="text-purple-400" />}
            title="Milvus Diagnostics"
            description="Deployment mode, health status, and dependency connectivity"
          />
          {milvusError ? (
            <ErrorBanner message={milvusError} onRetry={fetchMilvusMetrics} />
          ) : !milvusMetrics ? (
            <LoadingSpinner message="Loading Milvus diagnostics..." />
          ) : (
            <div
              className="glass-card p-6"
              style={{
                background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Mode */}
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Deployment
                  </h4>
                  <div className="flex items-center gap-2">
                    <Server size={16} className="text-purple-400" />
                    <span className="text-sm font-medium text-text-primary capitalize">
                      {milvusMetrics.mode || 'Standalone'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Collections</span>
                    <span className="font-mono text-text-secondary">{milvusMetrics.collections ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Total Inserts</span>
                    <span className="font-mono text-text-secondary">{formatNumber(milvusMetrics.inserts ?? 0)}</span>
                  </div>
                </div>

                {/* Health */}
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Health
                  </h4>
                  <ConnectionBadge connected={milvusMetrics.connected} label={milvusMetrics.connected ? 'Connected' : 'Disconnected'} />
                  <ConnectionBadge connected={milvusMetrics.healthy} label={milvusMetrics.healthy ? 'Healthy' : 'Unhealthy'} />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-tertiary">Avg Query Latency</span>
                    <span className="font-mono text-text-secondary">{(milvusMetrics.latency ?? 0).toFixed(1)}ms</span>
                  </div>
                </div>

                {/* Dependencies */}
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    Dependencies
                  </h4>
                  <ConnectionBadge
                    connected={milvusMetrics.minio_connected}
                    label={`MinIO ${milvusMetrics.minio_connected ? 'Connected' : 'Disconnected'}`}
                  />
                  <div className="text-xs text-text-tertiary mt-2">
                    MinIO provides object storage backing for Milvus data segments and indexes.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* pgvector Diagnostics */}
        <div>
          <SectionHeader
            icon={<Database size={20} className="text-blue-400" />}
            title="pgvector Diagnostics"
            description="PostgreSQL extension health, connection pool, and version"
          />
          <div
            className="glass-card p-6"
            style={{
              background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Connection Pool
                </h4>
                <div className="flex items-center gap-2 text-text-tertiary text-sm">
                  <AlertCircle size={14} />
                  <span>Managed by Prisma ORM</span>
                </div>
                <p className="text-xs text-text-tertiary">
                  Connection pool statistics are managed internally by the Prisma client.
                  Enable Prisma metrics for detailed pool utilization.
                </p>
              </div>
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Extension
                </h4>
                <div className="flex items-center gap-2 text-text-tertiary text-sm">
                  <AlertCircle size={14} />
                  <span>Connect to check version</span>
                </div>
                <p className="text-xs text-text-tertiary">
                  pgvector extension version will be available when the admin API
                  exposes PostgreSQL extension metadata. Expected: pgvector 0.5+.
                </p>
              </div>
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Tables
                </h4>
                <div className="space-y-1 text-sm">
                  {['tool_result_cache', 'verified_tool_results', 'tool_success_records'].map((t) => (
                    <div key={t} className="flex items-center gap-2">
                      <Database size={12} className="text-blue-400" />
                      <span className="font-mono text-text-secondary text-xs">{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Auto-Refresh Control */}
        <div
          className="glass-card p-4 flex items-center justify-between"
          style={{
            background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)',
          }}
        >
          <div className="flex items-center gap-3">
            <Settings size={16} className="text-text-tertiary" />
            <span className="text-sm text-text-primary font-medium">Auto-Refresh</span>
          </div>
          <div className="flex items-center gap-2">
            {([0, 10, 30, 60] as AutoRefreshInterval[]).map((interval) => (
              <button
                key={interval}
                onClick={() => setAutoRefreshInterval(interval)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  autoRefreshInterval === interval
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
                }`}
              >
                {interval === 0 ? 'Off' : `${interval}s`}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Tab: User Usage
  // ---------------------------------------------------------------------------
  const renderUserUsage = () => {
    if (vectorUsageError) {
      return <ErrorBanner message={vectorUsageError} onRetry={fetchVectorUsage} />;
    }
    if (vectorUsageLoading && !vectorUsage) {
      return <LoadingSpinner message="Loading vector usage by user..." />;
    }
    if (!vectorUsage) {
      return (
        <div className="glass-card p-8 text-center text-text-secondary">
          No vector usage data available
        </div>
      );
    }

    // Filter and sort users
    const filteredUsers = vectorUsage.perUserUsage
      .filter(u =>
        !userSearchTerm ||
        u.email.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
        u.name.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
        u.userId.toLowerCase().includes(userSearchTerm.toLowerCase())
      )
      .sort((a, b) => {
        if (userSortField === 'email') return a.email.localeCompare(b.email);
        return (b[userSortField] ?? 0) - (a[userSortField] ?? 0);
      });

    return (
      <div className="space-y-8">
        {/* Global Totals Summary */}
        <div>
          <SectionHeader
            icon={<Database size={20} className="text-blue-400" />}
            title="Storage Totals"
            description="Aggregate row counts across pgvector and Milvus"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <StatCard
              icon={<Database size={14} />}
              label="User Memories"
              value={formatNumber(vectorUsage.pgvectorTotals.userMemories)}
              subtext="pgvector"
              color="var(--color-info, #3b82f6)"
            />
            <StatCard
              icon={<Zap size={14} />}
              label="Tool Cache"
              value={formatNumber(vectorUsage.pgvectorTotals.toolResultCache)}
              subtext="pgvector"
            />
            <StatCard
              icon={<CheckCircle size={14} />}
              label="Verified Results"
              value={formatNumber(vectorUsage.pgvectorTotals.verifiedToolResults)}
              subtext="pgvector"
              color="var(--color-success, #00D26A)"
            />
            <StatCard
              icon={<Activity size={14} />}
              label="Success Records"
              value={formatNumber(vectorUsage.pgvectorTotals.toolSuccessRecords)}
              subtext="pgvector"
            />
            <StatCard
              icon={<Layers size={14} />}
              label="Milvus Collections"
              value={vectorUsage.milvusTotalCollections}
              subtext={`${formatNumber(vectorUsage.milvusTotalRows)} total rows`}
              color="var(--color-primary)"
            />
            <StatCard
              icon={<Search size={14} />}
              label="Query Cache"
              value={formatNumber(vectorUsage.pgvectorTotals.queryEmbeddingCache)}
              subtext="pgvector"
            />
          </div>
        </div>

        {/* Milvus Collections Breakdown */}
        {vectorUsage.milvusCollections.length > 0 && (
          <div>
            <SectionHeader
              icon={<Layers size={20} className="text-purple-400" />}
              title="Milvus Collections"
              description="Per-collection row counts and dimensions"
            />
            <div className="glass-card overflow-hidden border border-border/50">
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-surface-secondary/50 border-b border-border/50 text-xs text-text-tertiary font-medium uppercase tracking-wider">
                <div className="col-span-5">Collection</div>
                <div className="col-span-3 text-right">Rows</div>
                <div className="col-span-2 text-right">Dimension</div>
                <div className="col-span-2 text-right">% of Total</div>
              </div>
              {vectorUsage.milvusCollections
                .sort((a, b) => b.rowCount - a.rowCount)
                .map(col => (
                  <div
                    key={col.name}
                    className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border/30 hover:bg-surface-secondary/30 transition-colors items-center"
                  >
                    <div className="col-span-5 flex items-center gap-2">
                      <Database size={14} className="text-purple-400" />
                      <span className="text-sm font-mono text-text-primary">{col.name}</span>
                    </div>
                    <div className="col-span-3 text-right text-sm font-mono text-text-primary">
                      {formatNumber(col.rowCount)}
                    </div>
                    <div className="col-span-2 text-right text-sm font-mono text-text-secondary">
                      {col.dimension ?? '-'}
                    </div>
                    <div className="col-span-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-surface-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${vectorUsage.milvusTotalRows > 0 ? (col.rowCount / vectorUsage.milvusTotalRows * 100) : 0}%`,
                              backgroundColor: 'var(--color-primary)',
                            }}
                          />
                        </div>
                        <span className="text-xs text-text-tertiary font-mono w-10 text-right">
                          {vectorUsage.milvusTotalRows > 0
                            ? `${(col.rowCount / vectorUsage.milvusTotalRows * 100).toFixed(1)}%`
                            : '0%'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Per-User Vector Usage */}
        <div>
          <SectionHeader
            icon={<Users size={20} className="text-cyan-400" />}
            title="Usage by User"
            description="Per-user breakdown of vector storage across pgvector and Milvus"
          />

          {/* Search + Sort */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                placeholder="Search by email, name, or user ID..."
                value={userSearchTerm}
                onChange={(e) => setUserSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <select
              value={userSortField}
              onChange={(e) => setUserSortField(e.target.value as any)}
              className="px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="total">Sort by Total</option>
              <option value="memories">Sort by Memories</option>
              <option value="toolCache">Sort by Tool Cache</option>
              <option value="email">Sort by Email</option>
            </select>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="glass-card p-8 text-center text-text-secondary">
              {userSearchTerm ? 'No users match your search' : 'No per-user data available'}
            </div>
          ) : (
            <div className="glass-card overflow-hidden border border-border/50">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-2 px-6 py-3 bg-surface-secondary/50 border-b border-border/50 text-xs text-text-tertiary font-medium uppercase tracking-wider">
                <div className="col-span-3">User</div>
                <div className="col-span-1 text-right">Memories</div>
                <div className="col-span-1 text-right">Size</div>
                <div className="col-span-1 text-right">Tool Cache</div>
                <div className="col-span-1 text-right">Verified</div>
                <div className="col-span-1 text-right">Success</div>
                <div className="col-span-1 text-right">Vec Colls</div>
                <div className="col-span-1 text-right">Vec Entries</div>
                <div className="col-span-2 text-right">Total Items</div>
              </div>

              {/* Table rows */}
              {filteredUsers.slice(0, 50).map((user) => (
                <div
                  key={user.userId}
                  className="grid grid-cols-12 gap-2 px-6 py-3 border-b border-border/30 hover:bg-surface-secondary/30 transition-colors items-center"
                >
                  <div className="col-span-3">
                    <div className="text-sm text-text-primary truncate">{user.email}</div>
                    <div className="text-xs text-text-tertiary truncate">{user.name !== 'unknown' ? user.name : user.userId.slice(0, 12)}</div>
                  </div>
                  <div className="col-span-1 text-right text-sm font-mono text-text-primary">
                    {formatNumber(user.memories)}
                  </div>
                  <div className="col-span-1 text-right text-xs font-mono text-text-secondary">
                    {formatBytes(user.memorySizeBytes)}
                  </div>
                  <div className="col-span-1 text-right text-sm font-mono text-text-primary">
                    {formatNumber(user.toolCache)}
                  </div>
                  <div className="col-span-1 text-right text-sm font-mono text-text-primary">
                    {formatNumber(user.verifiedResults)}
                  </div>
                  <div className="col-span-1 text-right text-sm font-mono text-text-primary">
                    {formatNumber(user.successRecords)}
                  </div>
                  <div className="col-span-1 text-right text-sm font-mono text-text-secondary">
                    {user.vectorCollections}
                  </div>
                  <div className="col-span-1 text-right text-sm font-mono text-text-secondary">
                    {formatNumber(user.totalVectorEntries)}
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-sm font-mono font-bold text-text-primary">
                      {formatNumber(user.total)}
                    </span>
                    {/* Proportional bar */}
                    <div className="w-full h-1.5 bg-surface-secondary rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${filteredUsers[0]?.total > 0 ? (user.total / filteredUsers[0].total * 100) : 0}%`,
                          background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))',
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}

              {filteredUsers.length > 50 && (
                <div className="px-6 py-3 text-center text-xs text-text-tertiary">
                  Showing 50 of {filteredUsers.length} users
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Vector Collections */}
        {vectorUsage.vectorCollections.length > 0 && (
          <div>
            <SectionHeader
              icon={<Database size={20} className="text-green-400" />}
              title="User Vector Collections"
              description="Custom user-created vector collections in pgvector"
            />
            <div className="glass-card overflow-hidden border border-border/50">
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-surface-secondary/50 border-b border-border/50 text-xs text-text-tertiary font-medium uppercase tracking-wider">
                <div className="col-span-3">Collection Name</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-2">Owner</div>
                <div className="col-span-1 text-right">Entries</div>
                <div className="col-span-1 text-right">Dims</div>
                <div className="col-span-3">Created</div>
              </div>
              {vectorUsage.vectorCollections.slice(0, 50).map((vc) => {
                const owner = vectorUsage.perUserUsage.find(u => u.userId === vc.user_id);
                return (
                  <div
                    key={vc.id}
                    className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border/30 hover:bg-surface-secondary/30 transition-colors items-center"
                  >
                    <div className="col-span-3">
                      <div className="text-sm font-mono text-text-primary">{vc.name}</div>
                      {vc.description && (
                        <div className="text-xs text-text-tertiary truncate">{vc.description}</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs px-2 py-1 rounded bg-surface-secondary text-text-secondary">
                        {vc.collection_type || 'general'}
                      </span>
                    </div>
                    <div className="col-span-2 text-xs text-text-secondary truncate">
                      {owner?.email || vc.user_id.slice(0, 12)}
                    </div>
                    <div className="col-span-1 text-right text-sm font-mono text-text-primary">
                      {formatNumber(vc.total_entries)}
                    </div>
                    <div className="col-span-1 text-right text-sm font-mono text-text-secondary">
                      {vc.dimensions ?? '-'}
                    </div>
                    <div className="col-span-3 text-xs text-text-tertiary">
                      {formatDate(vc.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Tab navigation
  // ---------------------------------------------------------------------------
  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'cache', label: 'Cache Overview', icon: <Zap size={18} /> },
    { id: 'collections', label: 'Vector Collections', icon: <Database size={18} /> },
    { id: 'user-usage', label: 'User Usage', icon: <Users size={18} /> },
    { id: 'diagnostics', label: 'Diagnostics', icon: <Activity size={18} /> },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2 text-text-primary flex items-center gap-3">
            <Layers size={28} className="text-primary-500" />
            Unified Data Layer
          </h2>
          <p className="text-text-secondary">
            Manage all caching tiers: Redis (L1), pgvector (L2), and Milvus (L3) from one panel
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-tertiary">
            Updated: {lastUpdated.toLocaleTimeString()}
          </span>
          <button
            onClick={() => fetchDataForTab(activeTab)}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2 border-b border-border pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-primary-500 text-white'
                : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'cache' && renderCacheOverview()}
      {activeTab === 'collections' && renderVectorCollections()}
      {activeTab === 'user-usage' && renderUserUsage()}
      {activeTab === 'diagnostics' && renderDiagnostics()}
    </div>
  );
};

export default UnifiedDataLayerView;
