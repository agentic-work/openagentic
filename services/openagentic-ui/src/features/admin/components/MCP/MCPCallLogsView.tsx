import React, { useState, useEffect } from 'react';
// Basic UI icons from lucide
import {
  Search, Filter, ChevronDown, ChevronRight, Eye, Download, Calendar,
  File, Copy, Check, Brain
} from '@/shared/icons';
// Custom badass OpenAgentic icons
import {
  Activity, CheckCircle, XCircle, Timer as Clock, RefreshCw, User,
  Server, Zap, Database, Cpu
} from '../Shared/AdminIcons';
import { useAuth } from '../../../../app/providers/AuthContext';
import { onKeyActivate } from '@/utils/a11y';
import { PageHeader, LogRow, type LogSeverity } from '../../primitives-v2';

interface MCPCallLog {
  id: string;
  toolName: string;
  serverId: string;
  method?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  status: 'success' | 'error' | 'timeout';
  executionTime: number;
  requestSize?: number;
  responseSize?: number;
  input: any;
  output?: any;
  error?: string;
  timestamp: string;
  modelUsed?: string;       // LLM model that triggered the tool call
  modelProvider?: string;   // LLM provider (vertex-ai, ollama, etc.)
}

interface MCPCallLogsStats {
  totalCalls: number;
  recentCalls24h: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: string;
  avgExecutionTime: number;
  totalRequestSize?: number;
  totalResponseSize?: number;
  topTools: Array<{
    toolId: string;
    toolName: string;
    serverId?: string;
    count: number;
  }>;
  topServers?: Array<{
    serverId: string;
    count: number;
  }>;
  topUsers?: Array<{
    userId: string;
    userName?: string;
    userEmail?: string;
    count: number;
  }>;
}

interface MCPCallLogsViewProps {
  theme: string;
}

export const MCPCallLogsView: React.FC<MCPCallLogsViewProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [logs, setLogs] = useState<MCPCallLog[]>([]);
  const [stats, setStats] = useState<MCPCallLogsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [serverFilter, setServerFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '50'
      });

      if (statusFilter) {
        params.append('status', statusFilter);
      }

      if (serverFilter) {
        params.append('serverName', serverFilter);
      }

      if (searchTerm) {
        params.append('toolName', searchTerm);
      }

      const [logsRes, statsRes] = await Promise.all([
        fetch(`/api/admin/mcp-logs?${params}`, {
          headers: {
            ...getAuthHeaders()
          }
        }),
        fetch('/api/admin/mcp-logs/stats', {
          headers: {
            ...getAuthHeaders()
          }
        })
      ]);

      if (!logsRes.ok) throw new Error('Failed to fetch logs');
      if (!statsRes.ok) throw new Error('Failed to fetch stats');

      const logsData = await logsRes.json();
      const statsData = await statsRes.json();

      setLogs(logsData.logs);
      setTotalPages(logsData.pagination.totalPages);
      setStats(statsData);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
      console.error('Error fetching MCP logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [currentPage, statusFilter, serverFilter, searchTerm]);

  // Copy JSON to clipboard
  const copyToClipboard = async (data: any, id: string) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Format bytes to human readable
  const formatBytes = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const toggleLog = (id: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedLogs(newExpanded);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 ap-text-success" />;
      case 'error':
        return <XCircle className="w-5 h-5 ap-text-error" />;
      case 'timeout':
        return <Clock className="w-5 h-5 ap-text-warning" />;
      default:
        return <Activity className="w-5 h-5 text-text-secondary500" />;
    }
  };

  const mapSeverity = (status: string): LogSeverity => {
    switch (status) {
      case 'success': return 'ok';
      case 'error':   return 'err';
      case 'timeout': return 'warn';
      default:        return 'info';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const downloadLogsAsJSON = () => {
    const dataStr = JSON.stringify(logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mcp-logs-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 ap-text-error">
          <XCircle className="w-6 h-6" />
          <div>
            <h3 className="font-semibold">Failed to Load Logs</h3>
            <p className="text-sm text-text-secondary">{error}</p>
          </div>
        </div>
        <button
          onClick={fetchLogs}
          className="mt-4 px-4 py-2 bg-primary-500 text-on-accent rounded-lg hover:bg-primary-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'MCP', 'Call Logs']}
        title="MCP Call Logs"
        explainer="Complete request/response audit stream for every MCP tool execution. Filter, expand, and export raw JSON for triage."
        actions={[
          { label: 'Export JSON', onClick: downloadLogsAsJSON },
          { label: 'Refresh', onClick: fetchLogs, primary: true },
        ]}
        sticky
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary-500/10">
                <Activity className="w-5 h-5 text-primary-500" />
              </div>
              <div>
                <div className="text-sm text-text-secondary">Total Calls</div>
                <div className="text-2xl font-bold text-text-primary">{stats.totalCalls.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success-500/10">
                <CheckCircle className="w-5 h-5 ap-text-success" />
              </div>
              <div>
                <div className="text-sm text-text-secondary">Success Rate</div>
                <div className="text-2xl font-bold text-text-primary">{stats.successRate}%</div>
              </div>
            </div>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info-500/10">
                <Zap className="w-5 h-5 ap-text-info" />
              </div>
              <div>
                <div className="text-sm text-text-secondary">Avg Exec Time</div>
                <div className="text-2xl font-bold text-text-primary">{stats.avgExecutionTime}ms</div>
              </div>
            </div>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning-500/10">
                <Calendar className="w-5 h-5 ap-text-warning" />
              </div>
              <div>
                <div className="text-sm text-text-secondary">Last 24h</div>
                <div className="text-2xl font-bold text-text-primary">{stats.recentCalls24h.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex gap-4 items-center">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                placeholder="Search by tool name..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 rounded-lg border"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>
          </div>
          <div>
            <select
              value={serverFilter}
              onChange={(e) => {
                setServerFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-4 py-2 rounded-lg border"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            >
              <option value="">All Servers</option>
              {stats?.topServers?.map(s => (
                <option key={s.serverId} value={s.serverId}>{s.serverId}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-4 py-2 rounded-lg border"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            >
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="timeout">Timeout</option>
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          {logs.length === 0 ? (
            <div className="p-12 text-center">
              <Activity className="w-12 h-12 mx-auto mb-4 text-text-secondary" />
              <h3 className="text-lg font-semibold text-text-primary mb-2">No Logs Found</h3>
              <p className="text-text-secondary">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-2 p-4">
              {logs.map((log) => {
                const isExpanded = expandedLogs.has(log.id);
                const sourceLabel = log.userEmail || log.userName || 'system';
                const sourceAccent = Boolean(log.userEmail || log.userName);
                const message = (
                  <span className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontWeight: 600, color: 'var(--ap-fg-1, var(--fg-1))' }}>{log.toolName}</span>
                    <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {log.serverId}</span>
                    {log.method && (
                      <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {log.method}</span>
                    )}
                    {log.modelUsed && (
                      <span
                        style={{ color: 'var(--ap-ok, var(--ok))', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        <Brain className="w-3 h-3" />
                        {log.modelUsed}
                      </span>
                    )}
                  </span>
                );
                const meta = (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{log.executionTime}ms</span>
                    {(log.requestSize || log.responseSize) ? (
                      <span>{formatBytes(log.requestSize)} / {formatBytes(log.responseSize)}</span>
                    ) : null}
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </span>
                );
                return (
                  <div
                    key={log.id}
                    className="rounded-lg overflow-hidden"
                    style={{
                      backgroundColor: 'var(--color-surfaceSecondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {/* Unified log row */}
                    <div
                      onClick={() => toggleLog(log.id)}
                      onKeyDown={onKeyActivate(() => toggleLog(log.id))}
                      style={{ cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                    >
                      <LogRow
                        severity={mapSeverity(log.status)}
                        timestamp={formatTimestamp(log.timestamp)}
                        source={sourceLabel}
                        sourceAccent={sourceAccent}
                        message={message}
                        meta={meta}
                      />
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="border-t p-4 space-y-4" style={{ borderColor: 'var(--color-border)' }}>
                        {/* User & Execution Info */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
                            <div className="text-text-secondary text-xs mb-1">User</div>
                            <div className="font-medium text-text-primary">
                              {log.userName || 'Anonymous'}
                            </div>
                            {log.userEmail && (
                              <div className="text-xs text-text-secondary truncate" title={log.userEmail}>
                                {log.userEmail}
                              </div>
                            )}
                            {log.userId && (
                              <div className="text-xs font-mono text-text-secondary truncate mt-1" title={log.userId}>
                                ID: {log.userId.slice(0, 12)}...
                              </div>
                            )}
                          </div>
                          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
                            <div className="text-text-secondary text-xs mb-1">Server</div>
                            <div className="font-medium text-text-primary">{log.serverId}</div>
                            {log.method && (
                              <div className="text-xs text-text-secondary">{log.method}</div>
                            )}
                          </div>
                          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
                            <div className="text-text-secondary text-xs mb-1">Execution</div>
                            <div className="font-medium text-text-primary">{log.executionTime}ms</div>
                            <div className={`text-xs font-semibold ${
                              log.status === 'success' ? 'ap-text-success' :
                              log.status === 'error' ? 'ap-text-error' : 'ap-text-warning'
                            }`}>
                              {log.status.toUpperCase()}
                            </div>
                          </div>
                          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
                            <div className="text-text-secondary text-xs mb-1">Data Size</div>
                            <div className="text-text-primary">
                              <span className="text-xs">Request:</span> <span className="font-medium">{formatBytes(log.requestSize)}</span>
                            </div>
                            <div className="text-text-primary">
                              <span className="text-xs">Response:</span> <span className="font-medium">{formatBytes(log.responseSize)}</span>
                            </div>
                          </div>
                          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
                            <div className="text-text-secondary text-xs mb-1 flex items-center gap-1">
                              <Brain className="w-3 h-3" />
                              Model Used
                            </div>
                            <div className="font-medium text-text-primary">
                              {log.modelUsed || 'Unknown'}
                            </div>
                            {log.modelProvider && (
                              <div className="text-xs text-text-secondary">{log.modelProvider}</div>
                            )}
                          </div>
                        </div>

                        {/* Request JSON */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                              <File className="w-4 h-4 text-primary-500" />
                              Request Parameters
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(log.input, `req-${log.id}`);
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)] transition-colors"
                              title="Copy Request JSON"
                            >
                              {copiedId === `req-${log.id}` ? (
                                <><Check className="w-3 h-3 ap-text-success" /> Copied!</>
                              ) : (
                                <><Copy className="w-3 h-3" /> Copy</>
                              )}
                            </button>
                          </div>
                          <pre className="p-3 rounded-lg overflow-x-auto text-xs max-h-64" style={{
                            backgroundColor: 'var(--color-surface)',
                            color: 'var(--color-text)'
                          }}>
                            {JSON.stringify(log.input, null, 2) || '{}'}
                          </pre>
                        </div>

                        {/* Response JSON */}
                        {log.output && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                                <File className="w-4 h-4 ap-text-success" />
                                Response Data
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(log.output, `res-${log.id}`);
                                }}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)] transition-colors"
                                title="Copy Response JSON"
                              >
                                {copiedId === `res-${log.id}` ? (
                                  <><Check className="w-3 h-3 ap-text-success" /> Copied!</>
                                ) : (
                                  <><Copy className="w-3 h-3" /> Copy</>
                                )}
                              </button>
                            </div>
                            <pre className="p-3 rounded-lg overflow-x-auto text-xs max-h-96" style={{
                              backgroundColor: 'var(--color-surface)',
                              color: 'var(--color-text)'
                            }}>
                              {JSON.stringify(log.output, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Error */}
                        {log.error && (
                          <div>
                            <div className="flex items-center gap-2 text-sm font-semibold ap-text-error mb-2">
                              <XCircle className="w-4 h-4" />
                              Error Details
                            </div>
                            <pre className="p-3 rounded-lg overflow-x-auto text-xs bg-error-500/10 ap-text-error">
                              {log.error}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              color: 'var(--color-text)'
            }}
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-primary">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              color: 'var(--color-text)'
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
