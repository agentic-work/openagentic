import React, { useState, useEffect } from 'react';
// Custom badass icons
import { Database, RefreshCw, CheckCircle, XCircle, AlertCircle, Server, Loader } from '../Shared/AdminIcons';
import { apiRequest } from '../../../../utils/api';

interface MCPToolsStatus {
  status: string;
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
    servers: Array<{
      serverId: string;
      toolCount: number;
    }>;
  };
  inSync: boolean;
}

interface MCPToolsViewProps {
  theme: string;
}

export const MCPToolsView: React.FC<MCPToolsViewProps> = ({ theme }) => {
  const [status, setStatus] = useState<MCPToolsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      const httpResponse = await apiRequest('/api/admin/mcp/tools/status');
      const response = await httpResponse.json();

      // Check if response has the expected structure
      if (!response || !response.mcpProxy) {
        throw new Error('Invalid response format from API');
      }

      setStatus(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP tools status');
      console.error('Error fetching MCP tools status:', err);
      setStatus(null); // Clear invalid status
    } finally {
      setLoading(false);
    }
  };

  const handleReindex = async () => {
    try {
      setReindexing(true);
      setError(null);

      await apiRequest('/api/admin/mcp/tools/reindex', {
        method: 'POST',
        body: JSON.stringify({}) // Add empty body to satisfy Content-Type
      });

      // Wait a moment then refresh status
      setTimeout(fetchStatus, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reindex MCP tools');
      console.error('Error reindexing MCP tools:', err);
    } finally {
      setReindexing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (success: boolean) => {
    return success ? (
      <CheckCircle className="w-5 h-5 ap-text-success" />
    ) : (
      <XCircle className="w-5 h-5 ap-text-error" />
    );
  };

  const getSyncStatusIcon = (inSync: boolean) => {
    if (inSync) {
      return <CheckCircle className="w-6 h-6 ap-text-success" />;
    }
    return <AlertCircle className="w-6 h-6 ap-text-warning" />;
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 ap-text-error">
          <XCircle className="w-6 h-6" />
          <div>
            <h3 className="font-semibold">Failed to Load MCP Tools Status</h3>
            <p className="text-sm text-text-secondary">{error}</p>
          </div>
        </div>
        <button
          onClick={fetchStatus}
          className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">
            MCP Tools Cache
          </h2>
          <p className="text-text-secondary">
            Monitor and manage the MCP tools cache in Milvus vector database
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              color: 'var(--color-text)'
            }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleReindex}
            disabled={reindexing}
            className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {reindexing ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Reindexing...
              </>
            ) : (
              <>
                <Database className="w-4 h-4" />
                Reindex Tools
              </>
            )}
          </button>
        </div>
      </div>

      {error && status && (
        <div className="glass-card p-4 border-l-4 border-warning">
          <div className="flex items-center gap-3 ap-text-warning">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {status && (
        <>
          {/* Sync Status Card */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-text-primary">Cache Status</h3>
              {getSyncStatusIcon(status.inSync)}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs text-text-secondary mb-1">MCP Proxy Tools</div>
                <div className="text-2xl font-bold text-text-primary">{status.mcpProxy?.totalTools || 0}</div>
                <div className="text-xs text-text-secondary mt-1">Available tools</div>
              </div>

              <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs text-text-secondary mb-1">Milvus Indexed</div>
                <div className="text-2xl font-bold text-text-primary">{status.milvus?.rowCount || 0}</div>
                <div className="text-xs text-text-secondary mt-1">
                  {status.milvus?.exists ? 'In collection' : 'Collection missing'}
                </div>
              </div>

              <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs text-text-secondary mb-1">Sync Status</div>
                <div className="text-2xl font-bold text-text-primary">
                  {status.inSync ? 'In Sync' : 'Out of Sync'}
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  {status.inSync ? 'All tools indexed' : 'Reindex needed'}
                </div>
              </div>
            </div>
          </div>

          {/* Indexing History Card */}
          <div className="glass-card p-6">
            <h3 className="text-xl font-semibold text-text-primary mb-4">Last Indexing Operation</h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Status:</span>
                <div className="flex items-center gap-2">
                  {getStatusIcon(status.indexing?.lastIndexSuccess || false)}
                  <span className="font-medium text-text-primary">
                    {status.indexing?.lastIndexSuccess ? 'Success' : 'Failed'}
                  </span>
                </div>
              </div>

              {status.indexing?.lastIndexTime && (
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Last Index Time:</span>
                  <span className="font-medium text-text-primary">
                    {new Date(status.indexing.lastIndexTime).toLocaleString()}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Tools Indexed:</span>
                <span className="font-medium text-text-primary">
                  {status.indexing?.totalToolsIndexed || 0}
                </span>
              </div>

              {status.indexing?.lastIndexError && (
                <div className="mt-4 p-3 rounded-lg bg-error-500/10 border border-error/20">
                  <div className="text-xs font-medium ap-text-error mb-1">Error Details</div>
                  <div className="text-sm ap-text-error">{status.indexing.lastIndexError}</div>
                </div>
              )}
            </div>
          </div>

          {/* Tools by Server Card */}
          <div className="glass-card p-6">
            <h3 className="text-xl font-semibold text-text-primary mb-4">
              Tools by MCP Server ({status.mcpProxy.servers.length} servers)
            </h3>

            <div className="space-y-3">
              {status.mcpProxy.servers.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                  <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No MCP servers configured</p>
                </div>
              ) : (
                status.mcpProxy.servers
                  .sort((a, b) => b.toolCount - a.toolCount)
                  .map((server) => {
                    const cachedCount = status.redis.serverCounts[server.serverId] || 0;
                    const isInSync = cachedCount === server.toolCount;

                    return (
                      <div
                        key={server.serverId}
                        className="flex items-center justify-between p-4 rounded-lg border"
                        style={{
                          backgroundColor: 'var(--color-surfaceSecondary)',
                          borderColor: 'var(--color-border)'
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <Server className="w-5 h-5 text-primary-500" />
                          <div>
                            <div className="font-medium text-text-primary">{server.serverId}</div>
                            <div className="text-xs text-text-secondary">
                              {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-sm font-medium text-text-primary">
                              {cachedCount} cached
                            </div>
                            <div className="text-xs text-text-secondary">
                              {isInSync ? 'In sync' : 'Out of sync'}
                            </div>
                          </div>
                          {isInSync ? (
                            <CheckCircle className="w-5 h-5 ap-text-success" />
                          ) : (
                            <AlertCircle className="w-5 h-5 ap-text-warning" />
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* Milvus Collection Details */}
          <div className="glass-card p-6">
            <h3 className="text-xl font-semibold text-text-primary mb-4">Milvus Collection Details</h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Collection Name:</span>
                <span className="font-mono text-sm text-text-primary">mcp_tools_cache</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Collection Exists:</span>
                <div className="flex items-center gap-2">
                  {status.milvus.exists ? (
                    <CheckCircle className="w-4 h-4 ap-text-success" />
                  ) : (
                    <XCircle className="w-4 h-4 ap-text-error" />
                  )}
                  <span className="font-medium text-text-primary">
                    {status.milvus.exists ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Total Vectors:</span>
                <span className="font-medium text-text-primary">{status.milvus.rowCount}</span>
              </div>

              {status.milvus.error && (
                <div className="mt-4 p-3 rounded-lg bg-error-500/10 border border-error/20">
                  <div className="text-xs font-medium ap-text-error mb-1">Collection Error</div>
                  <div className="text-sm ap-text-error">{status.milvus.error}</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
