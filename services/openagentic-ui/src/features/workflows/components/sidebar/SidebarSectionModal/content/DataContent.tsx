/**
 * DataContent — Data Stores: create/manage vector collections, upload
 * documents for RAG search, and browse collections. Backed by the un-gated
 * /workflows/data/collections + /workflows/data/upload endpoints.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, Search, Upload, Database, ChevronRight } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import {
  inputClass, inputStyle, tableHeaderClass, tableHeaderStyle,
  tableCellClass, tableCellStyle, StatusDot,
} from '../sectionShared';

interface DataCollection {
  name?: string;
  store?: string;
  documentCount?: number;
  entity_count?: number;
  updatedAt?: string;
}

interface DataStore {
  store?: string;
  type?: string;
  status?: string;
  collections?: DataCollection[];
  tables?: string[];
}

interface UserDocument {
  id: string;
  name: string;
  type: string;
  createdAt: string;
}

export const DataContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [stores, setStores] = useState<DataStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);
  const [uploadCollection, setUploadCollection] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Create collection state
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creating, setCreating] = useState(false);

  // User documents from backend
  const [userDocuments, setUserDocuments] = useState<UserDocument[]>([]);

  const fetchStores = useCallback(async () => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint('/workflows/data/collections'), { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.stores) {
          setStores(data.stores);
        } else if (Array.isArray(data)) {
          const grouped: Record<string, DataCollection[]> = {};
          data.forEach((col: DataCollection) => {
            const store = col.store || 'pgvector';
            if (!grouped[store]) grouped[store] = [];
            grouped[store].push(col);
          });
          setStores(Object.entries(grouped).map(([store, collections]) => ({
            store, status: 'connected', collections,
          })));
        } else {
          const result: DataStore[] = [];
          for (const key of ['milvus', 'pgvector', 'redis']) {
            if (data[key]) result.push({ store: key, status: data[key].status || 'configured', collections: data[key].collections || [] });
          }
          setStores(result);
        }
        // Capture user documents if available
        if (data.documents) {
          setUserDocuments(data.documents);
        }
      }
    } catch { /* silently handle */ }
    finally { setLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  // File upload handler
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExts = ['txt', 'csv', 'json', 'md', 'pdf', 'markdown'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!allowedExts.includes(ext)) {
      setUploadResult({ success: false, message: `Unsupported file type: .${ext}. Allowed: ${allowedExts.join(', ')}` });
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(`Uploading ${file.name}...`);
      setUploadResult(null);

      const formData = new FormData();
      formData.append('file', file);
      if (uploadCollection.trim()) {
        formData.append('collectionName', uploadCollection.trim());
      }

      const headers = getAuthHeaders();
      // Remove Content-Type so browser sets multipart boundary automatically
      const hdrs: Record<string, string> = {};
      Object.entries(headers).forEach(([k, v]) => {
        if (k.toLowerCase() !== 'content-type') hdrs[k] = v as string;
      });

      const res = await fetch(workflowEndpoint('/workflows/data/upload'), {
        method: 'POST',
        headers: hdrs,
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setUploadResult({ success: true, message: data.message || `Uploaded ${file.name}: ${data.chunks} chunks` });
        fetchStores();
      } else {
        setUploadResult({ success: false, message: data.error || 'Upload failed' });
      }
    } catch (err) {
      setUploadResult({ success: false, message: err.message || 'Upload failed' });
    } finally {
      setUploading(false);
      setUploadProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [getAuthHeaders, uploadCollection, fetchStores]);

  // Create collection handler
  const handleCreateCollection = useCallback(async () => {
    if (!newCollectionName.trim()) return;
    try {
      setCreating(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint('/workflows/data/collections'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCollectionName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNewCollectionName('');
        setShowCreateCollection(false);
        fetchStores();
      } else {
        alert(data.error || 'Failed to create collection');
      }
    } catch (err) {
      alert(err.message || 'Failed to create collection');
    } finally {
      setCreating(false);
    }
  }, [getAuthHeaders, newCollectionName, fetchStores]);

  const storeLabels: Record<string, string> = { milvus: 'Milvus (Vector)', pgvector: 'pgvector (SQL+Vector)', redis: 'Redis (Cache)' };
  const storeColors: Record<string, string> = { milvus: 'var(--color-accent)', pgvector: 'var(--color-info)', redis: 'var(--color-error)' };
  const statusColors: Record<string, string> = { connected: 'var(--color-success)', configured: 'var(--color-warning)', disconnected: 'var(--color-error)' };

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {stores.length} data store{stores.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCreateCollection(!showCreateCollection)}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--color-surface)]"
            style={{ color: 'var(--color-accent)' }}
            title="Create Collection"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button onClick={fetchStores} disabled={loading} className="p-2 rounded-lg transition-colors hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-text-tertiary)' }}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Create Collection Form */}
      <AnimatePresence>
        {showCreateCollection && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>New Collection</div>
              <input
                type="text"
                value={newCollectionName}
                onChange={e => setNewCollectionName(e.target.value)}
                placeholder="Collection name (e.g. my_documents)"
                className={inputClass}
                style={inputStyle}
                onKeyDown={e => e.key === 'Enter' && handleCreateCollection()}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateCollection}
                  disabled={creating || !newCollectionName.trim()}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => { setShowCreateCollection(false); setNewCollectionName(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-[var(--color-surface-hover)]"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File Upload Section */}
      <div className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Upload File</div>
        <input
          type="text"
          value={uploadCollection}
          onChange={e => setUploadCollection(e.target.value)}
          placeholder="Target collection (optional, auto-generated if empty)"
          className={inputClass}
          style={inputStyle}
        />
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json,.md,.pdf,.markdown"
            onChange={handleFileUpload}
            className="hidden"
            id="data-file-upload"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Uploading...' : 'Choose File'}
          </button>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>.txt, .csv, .json, .md, .pdf</span>
        </div>
        {uploading && uploadProgress && (
          <div className="flex items-center gap-2">
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: 'var(--color-accent)' }}
                initial={{ width: '10%' }}
                animate={{ width: '90%' }}
                transition={{ duration: 10, ease: 'linear' }}
              />
            </div>
            <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{uploadProgress}</span>
          </div>
        )}
        {uploadResult && (
          <div
            className="text-xs px-2 py-1.5 rounded"
            style={{
              backgroundColor: uploadResult.success ? 'color-mix(in srgb, var(--color-success) 10%, transparent)' : 'color-mix(in srgb, var(--color-error) 10%, transparent)',
              color: uploadResult.success ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {uploadResult.message}
          </div>
        )}
      </div>

      {/* Simple filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        <input type="text" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} placeholder="Filter collections..." className={`${inputClass} pl-9`} style={inputStyle} />
      </div>

      {loading && stores.length === 0 ? (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading data stores...</div>
      ) : stores.length === 0 ? (
        <div className="py-8 text-center">
          <Database className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No data stores found</span>
        </div>
      ) : (
        <div className="space-y-3">
          {stores.map((store: DataStore) => {
            const storeKey = store.store || store.type;
            const base: DataCollection[] = store.collections || store.tables?.map((t: string) => ({ name: t })) || [];
            const collections = base.filter((c) =>
              !filterQuery || c.name?.toLowerCase().includes(filterQuery.toLowerCase())
            );
            return (
              <div key={storeKey} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {/* Store header */}
                <button
                  onClick={() => setExpandedStore(expandedStore === storeKey ? null : storeKey)}
                  className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-surface)]"
                  style={{ backgroundColor: 'var(--color-surface)' }}
                >
                  <Database className="w-5 h-5 flex-shrink-0" style={{ color: storeColors[storeKey] || 'var(--color-fg-subtle)' }} />
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {storeLabels[storeKey] || storeKey}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {collections.length} collection{collections.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot color={statusColors[store.status] || 'var(--color-fg-muted)'} />
                    <span className="text-xs capitalize" style={{ color: statusColors[store.status] || 'var(--color-fg-muted)' }}>
                      {store.status}
                    </span>
                  </div>
                  <motion.div animate={{ rotate: expandedStore === storeKey ? 90 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                  </motion.div>
                </button>

                {/* Collections table */}
                <AnimatePresence>
                  {expandedStore === storeKey && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className={tableHeaderClass} style={tableHeaderStyle}>Collection</th>
                            <th className={tableHeaderClass} style={tableHeaderStyle}>Documents</th>
                            <th className={tableHeaderClass} style={tableHeaderStyle}>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {collections.length === 0 ? (
                            <tr><td colSpan={3} className="px-3 py-4 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No collections</td></tr>
                          ) : (
                            collections.map((col: DataCollection) => (
                              <tr key={col.name} className="transition-colors hover:bg-[var(--color-surface)]">
                                <td className={tableCellClass} style={tableCellStyle}>
                                  <span className="font-medium">{col.name}</span>
                                </td>
                                <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-secondary)' }}>
                                  {col.documentCount !== undefined ? col.documentCount.toLocaleString() : col.entity_count !== undefined ? col.entity_count.toLocaleString() : '-'}
                                </td>
                                <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-tertiary)' }}>
                                  {col.updatedAt ? new Date(col.updatedAt).toLocaleDateString() : '-'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* User Documents Section */}
      {userDocuments.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Your Documents ({userDocuments.length})
          </div>
          <div className="space-y-1">
            {userDocuments.map((doc: UserDocument) => (
              <div
                key={doc.id}
                className="glass-card glass-row-hover flex items-center gap-3 px-3 py-2"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-accent-soft)' }}>
                  <Database className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {doc.name}
                  </div>
                  <div className="text-[11px] flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
                    <span>{doc.type}</span>
                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
