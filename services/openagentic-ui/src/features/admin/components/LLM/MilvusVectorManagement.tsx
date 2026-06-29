/**
 * Milvus Vector Management Component
 *
 * Provides admin interface for:
 * - MCP Tools semantic cache status and reindexing
 * - Milvus collection statistics
 * - Attu iframe for advanced database management
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Database, CheckCircle, XCircle, AlertCircle,
  Server, Zap, Terminal, ExternalLink
} from '../Shared/AdminIcons';
import { useAuth } from '../../../../app/providers/AuthContext';

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

interface MilvusCollection {
  name: string;
  rowCount: number;
  description?: string;
  indexType?: string;
  dimension?: number;
  metricType?: string;
}

interface MilvusVectorManagementProps {
  theme?: string;
}

export const MilvusVectorManagement: React.FC<MilvusVectorManagementProps> = ({ theme = 'dark' }) => {
  const { getAccessToken } = useAuth();
  const [activeTab, setActiveTab] = useState<'tools' | 'collections' | 'attu'>('tools');

  // MCP Tools state
  const [toolsStatus, setToolsStatus] = useState<MCPToolsStatus | null>(null);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<{ success: boolean; message: string; duration?: number } | null>(null);

  // Collections state
  const [collections, setCollections] = useState<MilvusCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);

  // Fetch MCP Tools status
  const fetchToolsStatus = useCallback(async () => {
    try {
      setToolsLoading(true);
      setToolsError(null);

      const token = await getAccessToken();
      const response = await fetch('/api/admin/mcp/tools/status', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.status === 'success') {
        setToolsStatus(result);
      } else {
        throw new Error(result.error || 'Failed to fetch MCP tools status');
      }
    } catch (err: any) {
      setToolsError(err.message || 'Failed to load MCP tools status');
    } finally {
      setToolsLoading(false);
    }
  }, [getAccessToken]);

  // Fetch Milvus collections
  const fetchCollections = useCallback(async () => {
    try {
      setCollectionsLoading(true);
      setCollectionsError(null);

      const token = await getAccessToken();
      const response = await fetch('/api/admin/system/milvus/collections', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const result = await response.json();
      setCollections(result.collections || []);
    } catch (err: any) {
      setCollectionsError(err.message || 'Failed to load collections');
    } finally {
      setCollectionsLoading(false);
    }
  }, [getAccessToken]);

  // Trigger MCP tools reindex
  const handleReindex = async () => {
    try {
      setReindexing(true);
      setReindexResult(null);

      const token = await getAccessToken();
      const response = await fetch('/api/admin/mcp/tools/reindex', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (response.ok && result.status === 'success') {
        setReindexResult({
          success: true,
          message: `Successfully indexed ${result.toolsIndexed} tools`,
          duration: result.duration
        });
        // Refresh status after reindex
        await fetchToolsStatus();
      } else {
        setReindexResult({
          success: false,
          message: result.message || result.error || 'Reindex failed'
        });
      }
    } catch (err: any) {
      setReindexResult({
        success: false,
        message: err.message || 'Failed to reindex'
      });
    } finally {
      setReindexing(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'tools') {
      fetchToolsStatus();
    } else if (activeTab === 'collections') {
      fetchCollections();
    }
  }, [activeTab, fetchToolsStatus, fetchCollections]);

  // Auto-refresh tools status every 30 seconds
  useEffect(() => {
    if (activeTab === 'tools') {
      const interval = setInterval(fetchToolsStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchToolsStatus]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const getSyncStatusIcon = (inSync: boolean) => {
    return inSync ? (
      <CheckCircle className="w-5 h-5 ap-text-success" />
    ) : (
      <AlertCircle className="w-5 h-5 ap-text-warning" />
    );
  };

  // Tab button component
  const TabButton: React.FC<{ id: 'tools' | 'collections' | 'attu'; label: string; icon: React.ReactNode }> = ({ id, label, icon }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
        activeTab === id
          ? 'bg-primary-500 text-on-accent'
          : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2 text-text-primary flex items-center gap-3">
            <Database size={28} className="text-primary-500" />
            Milvus Vector Management
          </h2>
          <p className="text-text-secondary">
            Manage MCP tool semantic cache, view collections, and access Attu admin interface
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-4">
        <TabButton id="tools" label="MCP Tool Cache" icon={<Zap size={18} />} />
        <TabButton id="collections" label="Collections" icon={<Database size={18} />} />
        <TabButton id="attu" label="Attu Admin" icon={<Terminal size={18} />} />
      </div>

      {/* MCP Tools Tab */}
      {activeTab === 'tools' && (
        <div className="space-y-6">
          {/* Status Header with Reindex Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-text-primary">MCP Tools Semantic Cache</h3>
              {toolsStatus && getSyncStatusIcon(toolsStatus.inSync)}
              {toolsStatus && (
                <span className={`text-sm ${toolsStatus.inSync ? 'ap-text-success' : 'ap-text-warning'}`}>
                  {toolsStatus.inSync ? 'In Sync' : 'Out of Sync'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchToolsStatus}
                disabled={toolsLoading}
                className="p-2 rounded-lg bg-surface-secondary hover:bg-surface-hover transition-colors"
                title="Refresh Status"
              >
                <RefreshCw size={18} className={toolsLoading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={handleReindex}
                disabled={reindexing}
                className="px-4 py-2 rounded-lg bg-primary-500 text-on-accent hover:bg-primary-600 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {reindexing ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    Reindexing...
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    Reindex Tools
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Reindex Result Alert */}
          {reindexResult && (
            <div className={`p-4 rounded-lg border ${
              reindexResult.success
                ? 'bg-success-500/10 border-success-500/30'
                : 'bg-error-500/10 border-error-500/30'
            }`}>
              <div className="flex items-center gap-2">
                {reindexResult.success ? (
                  <CheckCircle className="w-5 h-5 ap-text-success" />
                ) : (
                  <XCircle className="w-5 h-5 ap-text-error" />
                )}
                <span className={reindexResult.success ? 'ap-text-success' : 'ap-text-error'}>
                  {reindexResult.message}
                  {reindexResult.duration ? ` (${reindexResult.duration}ms)` : null}
                </span>
              </div>
            </div>
          )}

          {/* Loading State */}
          {toolsLoading && !toolsStatus && (
            <div className="flex items-center justify-center p-12">
              <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          )}

          {/* Error State */}
          {toolsError && (
            <div className="p-4 rounded-lg bg-error-500/10 border border-error-500/30">
              <div className="flex items-center gap-2 ap-text-error">
                <XCircle className="w-5 h-5" />
                <span>{toolsError}</span>
              </div>
            </div>
          )}

          {/* Status Content */}
          {toolsStatus && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Indexing Status Card */}
              <div className="p-6 rounded-xl bg-surface-secondary border border-border">
                <h4 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <Zap size={20} className="ap-text-info" />
                  Indexing Status
                </h4>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Last Index Time:</span>
                    <span className="text-text-primary font-medium">
                      {formatDate(toolsStatus.indexing.lastIndexTime)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">Last Index Status:</span>
                    <span className={`flex items-center gap-2 ${
                      toolsStatus.indexing.lastIndexSuccess ? 'ap-text-success' : 'ap-text-error'
                    }`}>
                      {toolsStatus.indexing.lastIndexSuccess ? (
                        <><CheckCircle size={16} /> Success</>
                      ) : (
                        <><XCircle size={16} /> Failed</>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Tools Indexed:</span>
                    <span className="text-text-primary font-bold text-lg">
                      {formatNumber(toolsStatus.indexing.totalToolsIndexed)}
                    </span>
                  </div>
                  {toolsStatus.indexing.lastIndexError && (
                    <div className="mt-3 p-3 rounded-lg bg-error-500/10 ap-text-error text-sm">
                      Error: {toolsStatus.indexing.lastIndexError}
                    </div>
                  )}
                </div>
              </div>

              {/* Milvus Stats Card */}
              <div className="p-6 rounded-xl bg-surface-secondary border border-border">
                <h4 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <Database size={20} className="text-primary-500" />
                  Milvus Collection: mcp_tools_cache
                </h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">Collection Exists:</span>
                    <span className={`flex items-center gap-2 ${
                      toolsStatus.milvus.exists ? 'ap-text-success' : 'ap-text-error'
                    }`}>
                      {toolsStatus.milvus.exists ? (
                        <><CheckCircle size={16} /> Yes</>
                      ) : (
                        <><XCircle size={16} /> No</>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Row Count:</span>
                    <span className="text-text-primary font-bold text-lg">
                      {formatNumber(toolsStatus.milvus.rowCount)}
                    </span>
                  </div>
                  {toolsStatus.milvus.error && (
                    <div className="mt-3 p-3 rounded-lg bg-error-500/10 ap-text-error text-sm">
                      Error: {toolsStatus.milvus.error}
                    </div>
                  )}
                </div>
              </div>

              {/* MCP Proxy Tools Card */}
              <div className="p-6 rounded-xl bg-surface-secondary border border-border lg:col-span-2">
                <h4 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <Server size={20} className="ap-text-warning" />
                  MCP Proxy Tools ({formatNumber(toolsStatus.mcpProxy.totalTools)} total)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {toolsStatus.mcpProxy.servers.map((server) => (
                    <div
                      key={server.serverId}
                      className="p-3 rounded-lg bg-surface-primary border border-border"
                    >
                      <div className="text-sm font-medium text-text-primary mb-1">
                        {server.serverId}
                      </div>
                      <div className="text-2xl font-bold text-primary-500">
                        {server.toolCount}
                      </div>
                      <div className="text-xs text-text-secondary">tools</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collections Tab */}
      {activeTab === 'collections' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text-primary">Milvus Collections</h3>
            <button
              onClick={fetchCollections}
              disabled={collectionsLoading}
              className="p-2 rounded-lg bg-surface-secondary hover:bg-surface-hover transition-colors"
              title="Refresh Collections"
            >
              <RefreshCw size={18} className={collectionsLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {collectionsLoading && (
            <div className="flex items-center justify-center p-12">
              <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          )}

          {collectionsError && (
            <div className="p-4 rounded-lg bg-error-500/10 border border-error-500/30">
              <div className="flex items-center gap-2 ap-text-error">
                <XCircle className="w-5 h-5" />
                <span>{collectionsError}</span>
              </div>
            </div>
          )}

          {!collectionsLoading && collections.length === 0 && (
            <div className="p-12 text-center text-text-secondary">
              <Database size={48} className="mx-auto mb-4 opacity-50" />
              <p>No collections found in Milvus</p>
            </div>
          )}

          {collections.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary border-b border-border">
                    <th className="pb-3 font-semibold">Collection Name</th>
                    <th className="pb-3 font-semibold text-right">Row Count</th>
                    <th className="pb-3 font-semibold text-right">Dimension</th>
                    <th className="pb-3 font-semibold">Index Type</th>
                    <th className="pb-3 font-semibold">Metric Type</th>
                  </tr>
                </thead>
                <tbody>
                  {collections.map((collection) => (
                    <tr key={collection.name} className="border-b border-border/50">
                      <td className="py-3">
                        <div className="font-mono text-text-primary">{collection.name}</div>
                        {collection.description && (
                          <div className="text-xs text-text-secondary mt-1">{collection.description}</div>
                        )}
                      </td>
                      <td className="py-3 text-right font-medium text-text-primary">
                        {formatNumber(collection.rowCount || 0)}
                      </td>
                      <td className="py-3 text-right text-text-secondary">
                        {collection.dimension || '-'}
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-1 text-xs rounded-full bg-primary-500/10 text-primary-500">
                          {collection.indexType || 'AUTO'}
                        </span>
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-1 text-xs rounded-full bg-info-500/10 ap-text-info">
                          {collection.metricType || 'IP'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Attu Admin Tab */}
      {activeTab === 'attu' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Attu - Milvus Admin Interface</h3>
              <p className="text-sm text-text-secondary mt-1">
                Full-featured Milvus administration interface for advanced operations
              </p>
            </div>
            <a
              href={(import.meta.env.VITE_ATTU_URL as string) || '/attu/'}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-primary-500 text-on-accent hover:bg-primary-600 transition-colors flex items-center gap-2"
            >
              <ExternalLink size={18} />
              Open in New Window
            </a>
          </div>

          <div className="glass-card rounded-lg overflow-hidden" style={{ minHeight: '700px' }}>
            <iframe
              src={(import.meta.env.VITE_ATTU_URL as string) || '/attu/'}
              className="w-full h-full border-0"
              style={{ minHeight: '700px' }}
              title="Attu - Milvus Admin"
              allow="clipboard-read; clipboard-write"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default MilvusVectorManagement;
