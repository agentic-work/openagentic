/**
 * DataSection - Full-panel data browser with tabs:
 * 1. Data Sources (reusable connections with schema explorer)
 * 2. MCP Tools (grouped by server, draggable)
 * 3. Object Storage (MinIO buckets & folders)
 * 4. Collections (Milvus/pgvector/Redis browser + file upload)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Upload,
  X,
  Plus,
  Wrench,
  FolderOpen,
  File,
  HardDrive,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import { DataSourceForm } from './DataSourceForm';
import { SchemaExplorer, SchemaTable } from './SchemaExplorer';

/* ---------- Types ---------- */

interface DataSource {
  id: string;
  name: string;
  type: string;
  status?: 'connected' | 'untested' | 'failed';
  schema_cache?: { tables?: SchemaTable[] };
  config?: any;
}

interface MCPServer {
  name: string;
  status?: string;
  tools: Array<{ name: string; description?: string }>;
}

interface DataCollection {
  name: string;
  store: 'milvus' | 'pgvector' | 'redis';
  entity_count?: number;
  field_count?: number;
  schema?: any;
}

interface StoreStatus {
  store: 'milvus' | 'pgvector' | 'redis';
  status: 'connected' | 'configured' | 'disconnected';
  collections: DataCollection[];
}

interface MinioBucket {
  name: string;
  creationDate?: string;
}

interface MinioObject {
  key: string;
  size?: number;
  lastModified?: string;
  isFolder?: boolean;
}

export interface DataSectionProps {
  getAuthHeaders?: () => Record<string, string>;
  mcpServers?: MCPServer[];
}

/* ---------- Constants ---------- */

const storeLabels: Record<string, string> = {
  milvus: 'Milvus (Vector)',
  pgvector: 'pgvector (SQL+Vector)',
  redis: 'Redis (Cache)',
};

const storeColors: Record<string, string> = {
  milvus: '#9c27b0',
  pgvector: '#2196f3',
  redis: '#ef5350',
};

const statusColors: Record<string, string> = {
  connected: '#22c55e',
  configured: '#ff9800',
  untested: '#ff9800',
  disconnected: '#ef5350',
  failed: '#ef5350',
};

const dsTypeInfo: Record<string, { text: string; color: string }> = {
  postgres: { text: 'PostgreSQL', color: '#336791' },
  postgresql: { text: 'PostgreSQL', color: '#336791' },
  mysql: { text: 'MySQL', color: '#4479a1' },
  rest_api: { text: 'REST API', color: '#61affe' },
  rest: { text: 'REST API', color: '#61affe' },
  s3: { text: 'S3 / MinIO', color: '#e25444' },
  redis: { text: 'Redis', color: '#dc382d' },
  graphql: { text: 'GraphQL', color: '#e535ab' },
  milvus: { text: 'Milvus', color: '#9c27b0' },
};

type TabKey = 'sources' | 'mcp' | 'storage' | 'collections';

const ACCEPTED_TYPES = '.pdf,.txt,.csv,.json,.md,.markdown';
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/* ---------- Helpers ---------- */

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/* ---------- Main Component ---------- */

export const DataSection: React.FC<DataSectionProps> = ({ mcpServers }) => {
  const { getAuthHeaders } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('sources');

  // Data sources state
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [dsLoading, setDsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expandedDs, setExpandedDs] = useState<Set<string>>(new Set());
  const [probingId, setProbingId] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<Array<{ id: string; name: string }>>([]);

  // MCP state
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  // MinIO state
  const [buckets, setBuckets] = useState<MinioBucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [bucketObjects, setBucketObjects] = useState<Record<string, MinioObject[]>>({});
  const [currentPrefix, setCurrentPrefix] = useState<Record<string, string>>({});

  // Collections state
  const [stores, setStores] = useState<StoreStatus[]>([]);
  const [colLoading, setColLoading] = useState(false);
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  /* ---------- Data Sources API ---------- */

  const fetchDataSources = useCallback(async () => {
    try {
      setDsLoading(true);
      const res = await fetch('/api/data-sources', { credentials: 'include', headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDataSources(Array.isArray(data) ? data : data.sources || data.dataSources || []);
      }
    } catch { /* endpoint may not exist yet */ }
    finally { setDsLoading(false); }
  }, [getAuthHeaders]);

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch(workflowEndpoint('/workflows/secrets'), { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSecrets(Array.isArray(data) ? data : data.secrets || []);
      }
    } catch { /* ignore */ }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchDataSources();
    fetchSecrets();
  }, [fetchDataSources, fetchSecrets]);

  const handleCreateDataSource = useCallback(async (formData: any) => {
    const res = await fetch('/api/data-sources', {
      method: 'POST',
      credentials: 'include',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create' }));
      throw new Error(err.error || err.message || 'Failed to create data source');
    }
    setShowForm(false);
    fetchDataSources();
  }, [getAuthHeaders, fetchDataSources]);

  const handleProbe = useCallback(async (id: string) => {
    setProbingId(id);
    try {
      const res = await fetch(`/api/data-sources/${id}/probe`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (res.ok) fetchDataSources();
    } catch { /* ignore */ }
    finally { setProbingId(null); }
  }, [getAuthHeaders, fetchDataSources]);

  const toggleDs = useCallback((id: string) => {
    setExpandedDs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /* ---------- MCP ---------- */

  const mcpToolCount = useMemo(() => {
    if (!mcpServers?.length) return 0;
    return mcpServers.reduce((sum, s) => sum + (s.tools?.length || 0), 0);
  }, [mcpServers]);

  const toggleServer = useCallback((name: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const handleMcpToolDrag = useCallback((e: React.DragEvent, tool: { name: string; description?: string }, serverName: string) => {
    e.dataTransfer.setData('application/reactflow-node', JSON.stringify({
      type: 'mcp_tool',
      data: { label: tool.name, toolName: tool.name, toolServer: serverName, icon: 'Wrench', color: '#00bcd4' },
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  /* ---------- MinIO / Object Storage ---------- */

  const fetchBuckets = useCallback(async () => {
    try {
      setBucketsLoading(true);
      const res = await fetch('/api/storage/buckets', { credentials: 'include', headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setBuckets(Array.isArray(data) ? data : data.buckets || []);
      }
    } catch { /* endpoint may not exist yet */ }
    finally { setBucketsLoading(false); }
  }, [getAuthHeaders]);

  const fetchBucketObjects = useCallback(async (bucket: string, prefix: string = '') => {
    try {
      const params = new URLSearchParams({ bucket, prefix, delimiter: '/' });
      const res = await fetch(`/api/storage/objects?${params}`, { credentials: 'include', headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const objects: MinioObject[] = [
          ...(data.prefixes || []).map((p: string) => ({ key: p, isFolder: true })),
          ...(data.objects || []).map((o: any) => ({ key: o.key || o.name, size: o.size, lastModified: o.lastModified, isFolder: false })),
        ];
        setBucketObjects(prev => ({ ...prev, [`${bucket}:${prefix}`]: objects }));
      }
    } catch { /* ignore */ }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (activeTab === 'storage') fetchBuckets();
  }, [activeTab, fetchBuckets]);

  const handleExpandBucket = useCallback((bucket: string) => {
    if (expandedBucket === bucket) {
      setExpandedBucket(null);
    } else {
      setExpandedBucket(bucket);
      const prefix = currentPrefix[bucket] || '';
      if (!bucketObjects[`${bucket}:${prefix}`]) {
        fetchBucketObjects(bucket, prefix);
      }
    }
  }, [expandedBucket, currentPrefix, bucketObjects, fetchBucketObjects]);

  const navigateFolder = useCallback((bucket: string, folderPrefix: string) => {
    setCurrentPrefix(prev => ({ ...prev, [bucket]: folderPrefix }));
    if (!bucketObjects[`${bucket}:${folderPrefix}`]) {
      fetchBucketObjects(bucket, folderPrefix);
    }
  }, [bucketObjects, fetchBucketObjects]);

  const navigateUp = useCallback((bucket: string) => {
    const prefix = currentPrefix[bucket] || '';
    const parts = prefix.replace(/\/$/, '').split('/');
    parts.pop();
    const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    setCurrentPrefix(prev => ({ ...prev, [bucket]: parentPrefix }));
    if (!bucketObjects[`${bucket}:${parentPrefix}`]) {
      fetchBucketObjects(bucket, parentPrefix);
    }
  }, [currentPrefix, bucketObjects, fetchBucketObjects]);

  /* ---------- Collections ---------- */

  const fetchCollections = useCallback(async () => {
    try {
      setColLoading(true);
      const res = await fetch(workflowEndpoint('/workflows/data/collections'), { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const grouped: Record<string, DataCollection[]> = {};
          data.forEach((col: DataCollection) => {
            const store = col.store || 'pgvector';
            if (!grouped[store]) grouped[store] = [];
            grouped[store].push(col);
          });
          setStores(Object.entries(grouped).map(([store, collections]) => ({
            store: store as StoreStatus['store'], status: 'connected' as const, collections,
          })));
        } else if (data.stores) {
          setStores(data.stores.map((s: any) => ({
            store: (s.store || s.type || 'pgvector') as StoreStatus['store'],
            status: s.status || 'configured',
            collections: (s.collections || s.tables || []).map((c: any) =>
              typeof c === 'string' ? { name: c, store: s.store || 'pgvector' } : { ...c, store: c.store || s.store || 'pgvector' }
            ),
          })));
        } else {
          const result: StoreStatus[] = [];
          for (const key of ['milvus', 'pgvector', 'redis'] as const) {
            if (data[key]) result.push({ store: key, status: data[key].status || 'configured', collections: data[key].collections || [] });
          }
          setStores(result);
        }
      }
    } catch { /* silently handle */ }
    finally { setColLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (activeTab === 'collections') fetchCollections();
  }, [activeTab, fetchCollections]);

  const toggleStore = useCallback((store: string) => {
    setExpandedStores(prev => {
      const next = new Set(prev);
      next.has(store) ? next.delete(store) : next.add(store);
      return next;
    });
  }, []);

  const handleCollectionDragStart = useCallback((e: React.DragEvent, collection: DataCollection) => {
    e.dataTransfer.setData('application/openagentic-node', JSON.stringify({
      type: 'data_query', data: { label: collection.name, store: collection.store, collection: collection.name },
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (file.size > MAX_FILE_SIZE) { setUploadError(`File too large (${formatBytes(file.size)}). Max 50MB.`); return; }
    setUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(workflowEndpoint('/workflows/data/upload'), {
        method: 'POST', headers: { ...getAuthHeaders() }, body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setUploadProgress(`${file.name}: ${data.chunks || 0} chunks indexed`);
        setTimeout(() => { fetchCollections(); setUploadProgress(null); }, 2000);
      } else {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        setUploadError(err.error || 'Upload failed');
      }
    } catch (err: any) { setUploadError(err.message || 'Upload failed'); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }, [getAuthHeaders, fetchCollections]);

  const totalCollections = useMemo(() => stores.reduce((sum, s) => sum + (s.collections?.length || 0), 0), [stores]);

  /* ---------- Tab counts ---------- */
  const tabDefs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'sources', label: 'Data Sources', count: dataSources.length },
    { key: 'mcp', label: 'MCP Tools', count: mcpToolCount },
    { key: 'storage', label: 'Object Storage', count: buckets.length || undefined },
    { key: 'collections', label: 'Collections', count: totalCollections || undefined },
  ];

  /* ---------- Render ---------- */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>

      {/* ===== TAB BAR ===== */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--color-border, #333)', paddingBottom: '0', flexShrink: 0 }}>
        {tabDefs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? 'var(--color-primary, #2196f3)' : 'var(--color-text-secondary, #999)',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--color-primary, #2196f3)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span style={{
                fontSize: '12px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '10px',
                background: activeTab === tab.key
                  ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)'
                  : 'var(--color-surface, #2a2a2a)',
                color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ===== TAB CONTENT ===== */}
      <div style={{ flex: 1, overflow: 'auto', paddingTop: '16px' }}>

        {/* ---- DATA SOURCES ---- */}
        {activeTab === 'sources' && (
          <div>
            {/* Actions bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
                Connect databases, APIs, and services to use in your flows. Drag any source onto the canvas.
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  onClick={fetchDataSources}
                  disabled={dsLoading}
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' }}
                >
                  <RefreshCw className={`w-4 h-4 ${dsLoading ? 'animate-spin' : ''}`} /> Refresh
                </button>
                <button
                  onClick={() => setShowForm(prev => !prev)}
                  style={{ background: 'var(--color-primary, #2196f3)', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#fff' }}
                >
                  <Plus className="w-4 h-4" /> Add Data Source
                </button>
              </div>
            </div>

            {/* Form */}
            <AnimatePresence>
              {showForm && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{ overflow: 'hidden', marginBottom: '16px' }}
                >
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px', background: 'var(--color-bg-secondary, #1a1a2e)' }}>
                    <DataSourceForm onSubmit={handleCreateDataSource} onCancel={() => setShowForm(false)} secrets={secrets} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Data source grid */}
            {dsLoading && dataSources.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                <RefreshCw className="w-6 h-6 animate-spin" style={{ margin: '0 auto 12px', display: 'block' }} />
                Loading data sources...
              </div>
            ) : dataSources.length === 0 && !showForm ? (
              <div style={{ padding: '60px 40px', textAlign: 'center', border: '2px dashed var(--color-border)', borderRadius: '16px' }}>
                <Database className="w-12 h-12" style={{ margin: '0 auto 16px', display: 'block', color: 'var(--color-text-tertiary, #555)' }} />
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>No data sources configured</div>
                <div style={{ fontSize: '14px', color: 'var(--color-text-tertiary)', maxWidth: '400px', margin: '0 auto' }}>
                  Connect PostgreSQL, MySQL, REST APIs, or other data sources to query from your flows.
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
                {dataSources.map(ds => {
                  const typeInfo = dsTypeInfo[ds.type] || { text: ds.type, color: '#999' };
                  const statusColor = statusColors[ds.status || 'untested'];
                  const statusLabel = ds.status === 'connected' ? 'Connected' : ds.status === 'failed' ? 'Failed' : 'Untested';
                  const isExpanded = expandedDs.has(ds.id);
                  const rawCache = ds.schema_cache;
                  const tables: SchemaTable[] = Array.isArray(rawCache) ? rawCache : rawCache?.tables || [];

                  return (
                    <div
                      key={ds.id}
                      style={{
                        border: '1px solid var(--color-border, #333)',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        background: 'var(--color-bg-secondary, #1a1a2e)',
                        transition: 'border-color 0.15s',
                      }}
                    >
                      {/* Card header */}
                      <div
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData('application/reactflow-node', JSON.stringify({
                            type: 'data_source_query',
                            data: { label: `Query: ${ds.name}`, dataSourceId: ds.id, dataSourceName: ds.name, dataSourceType: ds.type, icon: 'Database', color: typeInfo.color },
                          }));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        style={{ padding: '16px 20px', cursor: 'grab', display: 'flex', alignItems: 'flex-start', gap: '14px' }}
                        onClick={() => toggleDs(ds.id)}
                      >
                        {/* Type badge */}
                        <div style={{
                          width: '44px', height: '44px', borderRadius: '10px', background: typeInfo.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <Database className="w-5 h-5" style={{ color: '#fff' }} />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ds.name}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{typeInfo.text}</div>
                          <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor }} />
                            <span style={{ color: 'var(--color-text-tertiary)' }}>{statusLabel}</span>
                            {tables.length > 0 && (
                              <span style={{ padding: '1px 8px', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                                {tables.length} table{tables.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          <button
                            onClick={e => { e.stopPropagation(); handleProbe(ds.id); }}
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', padding: '8px', transition: 'border-color 0.15s' }}
                            title="Probe schema"
                          >
                            <RefreshCw className={`w-4 h-4 ${probingId === ds.id ? 'animate-spin' : ''}`} style={{ color: 'var(--color-text-secondary)' }} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); toggleDs(ds.id); }}
                            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', cursor: 'pointer', padding: '8px' }}
                            title={isExpanded ? 'Collapse schema' : 'Browse schema'}
                          >
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
                              : <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
                            }
                          </button>
                        </div>
                      </div>

                      {/* Schema explorer */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            style={{ overflow: 'hidden', borderTop: '1px solid var(--color-border)', padding: '12px 20px 16px' }}
                          >
                            {tables.length > 0 ? (
                              <SchemaExplorer tables={tables} dataSourceId={ds.id} dataSourceName={ds.name} />
                            ) : (
                              <div style={{ fontSize: '13px', padding: '16px 0', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                                No schema cached. Click <RefreshCw className="w-3.5 h-3.5 inline-block" style={{ verticalAlign: 'middle' }} /> to probe.
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---- MCP TOOLS ---- */}
        {activeTab === 'mcp' && (
          <div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', marginBottom: '16px' }}>
              MCP tool servers connected to the platform. Drag any tool onto the canvas to create a node.
            </div>

            {!mcpServers?.length ? (
              <div style={{ padding: '60px 40px', textAlign: 'center', border: '2px dashed var(--color-border)', borderRadius: '16px' }}>
                <Wrench className="w-12 h-12" style={{ margin: '0 auto 16px', display: 'block', color: 'var(--color-text-tertiary)' }} />
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>No MCP servers connected</div>
                <div style={{ fontSize: '14px', color: 'var(--color-text-tertiary)' }}>MCP tool servers will appear here when connected.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                {mcpServers.map(server => {
                  const isExpanded = expandedServers.has(server.name);
                  const serverColor = server.status === 'connected' ? '#22c55e' : server.status === 'disconnected' ? '#ef5350' : '#ff9800';

                  return (
                    <div key={server.name} style={{ border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', background: 'var(--color-bg-secondary, #1a1a2e)' }}>
                      <div
                        onClick={() => toggleServer(server.name)}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', cursor: 'pointer', transition: 'background 0.15s' }}
                      >
                        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#00bcd4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Wrench className="w-5 h-5" style={{ color: '#fff' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{server.name}</div>
                          <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: serverColor }} />
                            <span style={{ color: 'var(--color-text-tertiary)' }}>{server.tools?.length || 0} tools</span>
                          </div>
                        </div>
                        {isExpanded ? <ChevronDown className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} /> : <ChevronRight className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />}
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            style={{ overflow: 'hidden', borderTop: '1px solid var(--color-border)', padding: '8px 16px 12px' }}
                          >
                            {(server.tools || []).map(tool => (
                              <div
                                key={tool.name}
                                draggable
                                onDragStart={e => handleMcpToolDrag(e, tool, server.name)}
                                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', cursor: 'grab', transition: 'background 0.1s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface, #2a2a2a)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                title={tool.description || tool.name}
                              >
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#00bcd4', padding: '2px 6px', borderRadius: '4px', background: 'color-mix(in srgb, #00bcd4 12%, transparent)' }}>fn</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name}</div>
                                  {tool.description && <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>{tool.description}</div>}
                                </div>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---- OBJECT STORAGE (MinIO) ---- */}
        {activeTab === 'storage' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
                Browse your MinIO object storage buckets and folders.
              </div>
              <button
                onClick={fetchBuckets}
                disabled={bucketsLoading}
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' }}
              >
                <RefreshCw className={`w-4 h-4 ${bucketsLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {bucketsLoading && buckets.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                <RefreshCw className="w-6 h-6 animate-spin" style={{ margin: '0 auto 12px', display: 'block' }} />
                Loading buckets...
              </div>
            ) : buckets.length === 0 ? (
              <div style={{ padding: '60px 40px', textAlign: 'center', border: '2px dashed var(--color-border)', borderRadius: '16px' }}>
                <HardDrive className="w-12 h-12" style={{ margin: '0 auto 16px', display: 'block', color: 'var(--color-text-tertiary)' }} />
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>No buckets found</div>
                <div style={{ fontSize: '14px', color: 'var(--color-text-tertiary)' }}>MinIO object storage buckets will appear here.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '12px' }}>
                {buckets.map(bucket => {
                  const isExpanded = expandedBucket === bucket.name;
                  const prefix = currentPrefix[bucket.name] || '';
                  const objects = bucketObjects[`${bucket.name}:${prefix}`] || [];

                  return (
                    <div key={bucket.name} style={{ border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', background: 'var(--color-bg-secondary, #1a1a2e)' }}>
                      {/* Bucket header */}
                      <div
                        onClick={() => handleExpandBucket(bucket.name)}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', cursor: 'pointer' }}
                      >
                        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#e25444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <HardDrive className="w-5 h-5" style={{ color: '#fff' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)' }}>{bucket.name}</div>
                          {bucket.creationDate && <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>Created {new Date(bucket.creationDate).toLocaleDateString()}</div>}
                          {prefix && <div style={{ fontSize: '12px', color: 'var(--color-primary)', marginTop: '2px', fontFamily: 'monospace' }}>/{prefix}</div>}
                        </div>
                        {isExpanded ? <ChevronDown className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} /> : <ChevronRight className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />}
                      </div>

                      {/* Bucket contents */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            style={{ overflow: 'hidden', borderTop: '1px solid var(--color-border)', padding: '8px 16px 12px' }}
                          >
                            {/* Navigate up */}
                            {prefix && (
                              <div
                                onClick={() => navigateUp(bucket.name)}
                                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.1s', marginBottom: '4px' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface, #2a2a2a)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              >
                                <ChevronRight className="w-4 h-4" style={{ transform: 'rotate(180deg)', color: 'var(--color-primary)' }} />
                                <span style={{ fontSize: '13px', color: 'var(--color-primary)', fontWeight: 500 }}>.. (up one level)</span>
                              </div>
                            )}

                            {objects.length === 0 ? (
                              <div style={{ fontSize: '13px', padding: '16px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                {bucketsLoading ? 'Loading...' : 'Empty'}
                              </div>
                            ) : objects.map(obj => (
                              <div
                                key={obj.key}
                                onClick={obj.isFolder ? () => navigateFolder(bucket.name, obj.key) : undefined}
                                draggable={!obj.isFolder}
                                onDragStart={!obj.isFolder ? e => {
                                  e.dataTransfer.setData('application/reactflow-node', JSON.stringify({
                                    type: 'data_source_query',
                                    data: { label: `File: ${obj.key.split('/').pop()}`, bucket: bucket.name, objectKey: obj.key, icon: 'File', color: '#e25444' },
                                  }));
                                  e.dataTransfer.effectAllowed = 'copy';
                                } : undefined}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px',
                                  cursor: obj.isFolder ? 'pointer' : 'grab', transition: 'background 0.1s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface, #2a2a2a)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              >
                                {obj.isFolder
                                  ? <FolderOpen className="w-4 h-4" style={{ color: '#ff9800', flexShrink: 0 }} />
                                  : <File className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                                }
                                <span style={{ flex: 1, fontSize: '13px', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {obj.isFolder ? obj.key.replace(prefix, '').replace(/\/$/, '') : obj.key.split('/').pop()}
                                </span>
                                {obj.size !== undefined && !obj.isFolder && (
                                  <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>{formatBytes(obj.size)}</span>
                                )}
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ---- COLLECTIONS ---- */}
        {activeTab === 'collections' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
                Vector stores and caches. Drag collections onto the canvas or upload files to index.
              </div>
              <button
                onClick={fetchCollections}
                disabled={colLoading}
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)' }}
              >
                <RefreshCw className={`w-4 h-4 ${colLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {colLoading && stores.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>Loading collections...</div>
            ) : stores.length === 0 ? (
              <div style={{ padding: '60px 40px', textAlign: 'center', border: '2px dashed var(--color-border)', borderRadius: '16px' }}>
                <Database className="w-12 h-12" style={{ margin: '0 auto 16px', display: 'block', color: 'var(--color-text-tertiary)' }} />
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>No collections found</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                {stores.map(store => (
                  <div key={store.store} style={{ border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden', background: 'var(--color-bg-secondary, #1a1a2e)' }}>
                    <div onClick={() => toggleStore(store.store)} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', cursor: 'pointer' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: storeColors[store.store] || '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Database className="w-5 h-5" style={{ color: '#fff' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)' }}>{storeLabels[store.store] || store.store}</div>
                        <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColors[store.status] || '#999' }} />
                          <span style={{ color: 'var(--color-text-tertiary)' }}>{store.collections?.length || 0} collections</span>
                        </div>
                      </div>
                      {expandedStores.has(store.store) ? <ChevronDown className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} /> : <ChevronRight className="w-5 h-5" style={{ color: 'var(--color-text-secondary)' }} />}
                    </div>

                    <AnimatePresence>
                      {expandedStores.has(store.store) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          style={{ overflow: 'hidden', borderTop: '1px solid var(--color-border)', padding: '8px 16px 12px' }}
                        >
                          {(store.collections || []).map(col => (
                            <div
                              key={col.name}
                              draggable
                              onDragStart={e => handleCollectionDragStart(e, col)}
                              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', cursor: 'grab', transition: 'background 0.1s' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface, #2a2a2a)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <Database className="w-4 h-4" style={{ color: storeColors[col.store] || '#999', flexShrink: 0 }} />
                              <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                {col.entity_count !== undefined && (
                                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
                                    {col.entity_count.toLocaleString()} rows
                                  </span>
                                )}
                                {col.field_count !== undefined && (
                                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
                                    {col.field_count} fields
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            )}

            {/* File upload */}
            <div
              onDrop={e => { e.preventDefault(); e.stopPropagation(); handleFileUpload(e.dataTransfer.files); }}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                marginTop: '20px', border: '2px dashed var(--color-border)', borderRadius: '16px', padding: '32px',
                textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--color-primary) 5%, transparent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} style={{ display: 'none' }} onChange={e => handleFileUpload(e.target.files)} />
              <Upload className="w-8 h-8" style={{ margin: '0 auto 8px', display: 'block', color: 'var(--color-text-tertiary)' }} />
              <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                {uploading ? 'Uploading...' : 'Drop files or click to upload'}
              </div>
              <div style={{ fontSize: '13px', marginTop: '6px', color: 'var(--color-text-tertiary)' }}>
                PDF, TXT, CSV, JSON, Markdown — max 50MB — indexed into Milvus for RAG
              </div>
            </div>

            {uploadProgress && <div style={{ fontSize: '13px', padding: '10px 4px', color: '#22c55e', fontWeight: 500 }}>{uploadProgress}</div>}
            {uploadError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '8px 4px' }}>
                <span style={{ color: '#f44336' }}>{uploadError}</span>
                <button onClick={() => setUploadError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <X className="w-4 h-4" style={{ color: '#f44336' }} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
