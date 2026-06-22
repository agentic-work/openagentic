import React, { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, Play, HardDrive, Info, MessageSquare } from '@/shared/icons';
import {
  Server, RefreshCw, Cpu, AlertCircle, CheckCircle, Loader2
} from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OllamaHost {
  id: string;
  name: string;
  displayName: string;
  host: string;
  enabled: boolean;
  priority: number;
  status: 'connected' | 'disconnected' | 'unknown';
  modelCount: number;
  runningCount: number;
  chatModel: string;
  lastSync: string | null;
  hostModels: string[];
  error?: string;
}

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface RunningModel {
  name: string;
  size: number;
  digest: string;
  expiresAt?: string;
  sizeVram?: number;
}

interface SyncResult {
  providerId: string;
  providerName: string;
  host: string;
  status: 'synced' | 'unreachable' | 'error';
  modelsOnHost: string[];
  modelsAdded: string[];
  modelsRemoved: string[];
  lastSync: string;
  error?: string;
}

interface OllamaManagementViewProps {
  theme?: 'light' | 'dark';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatTimeAgo = (dateStr: string | null): string => {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(dateStr).toLocaleDateString();
};

// Ollama llama SVG icon
const OllamaLogo: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <img
    src="https://ollama.com/public/ollama.png"
    alt="Ollama"
    width={size}
    height={size}
    style={{ borderRadius: 4, backgroundColor: 'var(--ap-fg-0)', padding: 2, objectFit: 'contain' }}
  />
);

// ─── Component ───────────────────────────────────────────────────────────────

export const OllamaManagementView: React.FC<OllamaManagementViewProps> = () => {
  // State
  const [hosts, setHosts] = useState<OllamaHost[]>([]);
  const [activeHostId, setActiveHostId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'models' | 'metrics'>('models');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [runningModels, setRunningModels] = useState<RunningModel[]>([]);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pullModelName, setPullModelName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [selectedModelInfo, setSelectedModelInfo] = useState<{ name: string; info: any } | null>(null);
  const [testState, setTestState] = useState<{ model: string; response: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeHost = hosts.find(h => h.id === activeHostId);

  // ─── Data Fetching ─────────────────────────────────────────────────────

  const fetchHosts = useCallback(async () => {
    try {
      const response = await apiRequest('/api/admin/ollama/hosts');
      const data = await response.json();
      if (data.success) {
        setHosts(data.hosts);
        // Auto-select first host if none selected
        if (!activeHostId && data.hosts.length > 0) {
          setActiveHostId(data.hosts[0].id);
        }
      }
    } catch (err: any) {
      setError(`Failed to load hosts: ${err.message}`);
    }
  }, [activeHostId]);

  const fetchModels = useCallback(async (hostId: string) => {
    try {
      const response = await apiRequest(`/api/admin/ollama/models?providerId=${hostId}`);
      const data = await response.json();
      if (data.success) setModels(data.models);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const fetchRunning = useCallback(async (hostId: string) => {
    try {
      const response = await apiRequest(`/api/admin/ollama/running?providerId=${hostId}`);
      const data = await response.json();
      if (data.success) setRunningModels(data.models);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await apiRequest('/api/admin/ollama/sync/status');
      const data = await response.json();
      if (data.success) setSyncResults(data.results);
    } catch { /* non-fatal */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await fetchHosts();
    if (activeHostId) {
      await Promise.all([fetchModels(activeHostId), fetchRunning(activeHostId)]);
    }
    await fetchSyncStatus();
    setLoading(false);
  }, [fetchHosts, fetchModels, fetchRunning, fetchSyncStatus, activeHostId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Refresh models when active host changes
  useEffect(() => {
    if (activeHostId) {
      fetchModels(activeHostId);
      fetchRunning(activeHostId);
    }
  }, [activeHostId, fetchModels, fetchRunning]);

  // ─── Actions ───────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    try {
      const url = activeHostId
        ? `/api/admin/ollama/sync?providerId=${activeHostId}`
        : '/api/admin/ollama/sync';
      const response = await apiRequest(url, { method: 'POST' });
      const data = await response.json();
      if (data.success) setSyncResults(data.results);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handlePull = async () => {
    if (!pullModelName.trim() || !activeHostId) return;
    setPulling(true);
    setError(null);
    try {
      const response = await apiRequest('/api/admin/ollama/pull', {
        method: 'POST',
        body: JSON.stringify({ model: pullModelName, providerId: activeHostId }),
      });
      const data = await response.json();
      if (data.success) {
        setPullModelName('');
        await refresh();
      } else {
        setError(data.error || 'Failed to pull model');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPulling(false);
    }
  };

  const handleDelete = async (modelName: string) => {
    if (!activeHostId) return;
    try {
      const response = await apiRequest(
        `/api/admin/ollama/models/${encodeURIComponent(modelName)}?providerId=${activeHostId}`,
        { method: 'DELETE' }
      );
      const data = await response.json();
      if (data.success) await refresh();
      else setError(data.error || 'Failed to delete');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleModelInfo = async (modelName: string) => {
    if (!activeHostId) return;
    try {
      const response = await apiRequest(
        `/api/admin/ollama/models/${encodeURIComponent(modelName)}/info?providerId=${activeHostId}`
      );
      const data = await response.json();
      if (data.success) setSelectedModelInfo({ name: modelName, info: data.info });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTestGenerate = async (modelName: string) => {
    if (!activeHostId) return;
    setTesting(true);
    setTestState(null);
    try {
      const response = await apiRequest('/api/admin/ollama/generate', {
        method: 'POST',
        body: JSON.stringify({ model: modelName, prompt: 'Hello! Briefly describe yourself.', providerId: activeHostId }),
      });
      const data = await response.json();
      if (data.success) setTestState({ model: modelName, response: data.response });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────

  const activeSyncResult = syncResults.find(r => r.providerId === activeHostId);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        crumbs={['Admin', 'LLM', 'Ollama']}
        title="Ollama Hosts"
        explainer={`${hosts.length} host${hosts.length !== 1 ? 's' : ''} configured · Auto-sync every 60s.`}
        actions={[
          { label: syncing ? 'Syncing...' : 'Sync Now', primary: true, onClick: handleSync, disabled: syncing },
          { label: 'Refresh', onClick: refresh, disabled: loading },
        ]}
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-err)_30%,transparent)] rounded-lg">
          <AlertCircle className="w-4 h-4 text-err flex-shrink-0" />
          <span className="text-err text-sm flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-err hover:text-err">&times;</button>
        </div>
      )}

      {/* Host Tabs */}
      {hosts.length > 0 && (
        <div className="flex gap-2 border-b border-border-hover pb-2 overflow-x-auto">
          {hosts.map(host => (
            <button
              key={host.id}
              onClick={() => setActiveHostId(host.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm transition-colors whitespace-nowrap ${
                activeHostId === host.id
                  ? 'bg-surface-hover text-[var(--color-text)] border-b-2'
                  : 'text-text-secondary hover:text-[var(--color-text)] hover:bg-surface-hover/50'
              }`}
              style={activeHostId === host.id ? { borderBottomColor: 'var(--ap-accent)' } : undefined}
            >
              <span className={`w-2 h-2 rounded-full ${
                host.status === 'connected' ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-err)]'
              }`} />
              <OllamaLogo size={16} />
              <span className="font-medium">{host.displayName || host.name}</span>
              <span className="text-xs opacity-60">{host.modelCount} models</span>
            </button>
          ))}
        </div>
      )}

      {/* No hosts */}
      {hosts.length === 0 && !loading && (
        <div className="text-center py-12 text-text-secondary">
          <Server className="w-12 h-12 mx-auto mb-4 opacity-40" />
          <p className="text-lg">No Ollama hosts configured</p>
          <p className="text-sm mt-1">Add an Ollama provider in Provider Management to get started.</p>
        </div>
      )}

      {/* Active Host Content */}
      {activeHost && (
        <>
          {/* Host Status Bar */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface border border-border-hover">
            <div className="flex items-center gap-4">
              {activeHost.status === 'connected' ? (
                <CheckCircle className="w-5 h-5 text-ok" />
              ) : (
                <AlertCircle className="w-5 h-5 text-err" />
              )}
              <div>
                <span className="text-[var(--color-text)] text-sm font-medium">{activeHost.host}</span>
                <span className="text-text-secondary text-xs ml-3">
                  Priority: {activeHost.priority} &middot; Chat model: <code style={{ color: 'var(--ap-accent)' }}>{activeHost.chatModel || 'auto'}</code>
                </span>
              </div>
            </div>
            <div className="flex gap-6 text-center">
              <div>
                <div className="text-lg font-bold text-[var(--color-text)]">{activeHost.modelCount}</div>
                <div className="text-xs text-text-secondary">Models</div>
              </div>
              <div>
                <div className="text-lg font-bold text-[var(--color-text)]">{activeHost.runningCount}</div>
                <div className="text-xs text-text-secondary">Running</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Last sync</div>
                <div className="text-sm" style={{ color: 'var(--ap-accent)' }}>{formatTimeAgo(activeHost.lastSync)}</div>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex gap-1 bg-surface-hover/30 rounded-lg p-1 w-fit">
            {(['models', 'metrics'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-surface text-[var(--color-text)]'
                    : 'text-text-secondary hover:text-[var(--color-text)]'
                }`}
              >
                {tab === 'models' ? 'Models' : 'Metrics & Sync'}
              </button>
            ))}
          </div>

          {/* ─── Models Tab ─────────────────────────────────────────────── */}
          {activeTab === 'models' && (
            <div className="space-y-4">
              {/* Pull Model */}
              <div className="p-4 rounded-lg border bg-surface border-border-hover">
                <h3 className="font-medium mb-2 text-[var(--color-text)] text-sm">Pull New Model</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pullModelName}
                    onChange={(e) => setPullModelName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePull()}
                    placeholder="e.g., llama3.2, codellama, mistral"
                    className="flex-1 px-3 py-2 rounded-lg border text-sm
                      bg-surface-hover border-border-hover text-[var(--color-text)] placeholder-gray-500"
                  />
                  <button
                    onClick={handlePull}
                    disabled={pulling || !pullModelName.trim()}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                      pulling || !pullModelName.trim()
                        ? 'bg-[var(--color-fg-subtle)] cursor-not-allowed text-on-accent'
                        : ''
                    }`}
                    style={
                      pulling || !pullModelName.trim()
                        ? undefined
                        : { background: 'var(--ap-accent)', color: 'var(--ap-fg-on-accent)' }
                    }
                  >
                    {pulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {pulling ? 'Pulling...' : 'Pull'}
                  </button>
                </div>
              </div>

              {/* Running Models */}
              {runningModels.length > 0 && (
                <div className="p-4 rounded-lg border bg-surface border-border-hover">
                  <h3 className="font-medium mb-2 flex items-center gap-2 text-[var(--color-text)] text-sm">
                    <Cpu className="w-4 h-4 text-ok" />
                    Running ({runningModels.length})
                  </h3>
                  <div className="space-y-1.5">
                    {runningModels.map((m) => (
                      <div key={m.digest} className="flex items-center justify-between p-2.5 rounded bg-[color-mix(in_srgb,var(--color-ok)_5%,transparent)] border border-[color-mix(in_srgb,var(--color-ok)_20%,transparent)]">
                        <div>
                          <span className="font-medium text-[var(--color-text)] text-sm">{m.name}</span>
                          <span className="text-xs text-text-secondary ml-3">
                            VRAM: {formatBytes(m.sizeVram || 0)} &middot; Size: {formatBytes(m.size)}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-ok text-xs">
                          <Play className="w-3 h-3" /> Active
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Models */}
              <div className="p-4 rounded-lg border bg-surface border-border-hover">
                <h3 className="font-medium mb-2 flex items-center gap-2 text-[var(--color-text)] text-sm">
                  <HardDrive className="w-4 h-4" />
                  Available Models ({models.length})
                </h3>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--ap-accent)' }} />
                  </div>
                ) : models.length === 0 ? (
                  <div className="text-center py-8 text-text-secondary text-sm">
                    No models on this host. Pull a model to get started.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {models.map((m) => {
                      const isRunning = runningModels.some(r => r.name === m.name);
                      return (
                        <div key={m.digest} className="flex items-center justify-between p-2.5 rounded bg-surface-hover">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[var(--color-text)] text-sm">{m.name}</span>
                              {isRunning && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-ok)_20%,transparent)] text-ok">RUNNING</span>
                              )}
                              {m.details?.parameter_size && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--ap-accent-soft)', color: 'var(--ap-accent)' }}>
                                  {m.details.parameter_size}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-text-secondary mt-0.5">
                              {formatBytes(m.size)}
                              {m.details?.quantization_level && ` · ${m.details.quantization_level}`}
                              {m.details?.family && ` · ${m.details.family}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleModelInfo(m.name)} className="p-1.5 rounded hover:bg-surface-secondary text-text-secondary hover:text-[var(--color-text)]" title="Info">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleTestGenerate(m.name)} disabled={testing} className="p-1.5 rounded hover:bg-surface-secondary text-text-secondary hover:text-[var(--color-text)]" title="Test">
                              <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(m.name)} className="p-1.5 rounded hover:bg-[color-mix(in_srgb,var(--color-err)_20%,transparent)] text-text-secondary hover:text-err" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Metrics Tab ────────────────────────────────────────────── */}
          {activeTab === 'metrics' && (
            <div className="space-y-4">
              {/* Sync Status */}
              <div className="p-4 rounded-lg border bg-surface border-border-hover">
                <h3 className="font-medium mb-3 text-[var(--color-text)] text-sm">Sync Status</h3>
                {syncResults.length === 0 ? (
                  <p className="text-text-secondary text-sm">No sync results yet. Click "Sync Now" to trigger.</p>
                ) : (
                  <div className="space-y-2">
                    {syncResults.map(r => (
                      <div key={r.providerId} className={`p-3 rounded border ${
                        r.status === 'synced' ? 'border-[color-mix(in_srgb,var(--color-ok)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_5%,transparent)]' :
                        'border-[color-mix(in_srgb,var(--color-err)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-err)_5%,transparent)]'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {r.status === 'synced' ? (
                              <CheckCircle className="w-4 h-4 text-ok" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-err" />
                            )}
                            <span className="text-[var(--color-text)] text-sm font-medium">{r.providerName}</span>
                            <span className="text-text-secondary text-xs">{r.host}</span>
                          </div>
                          <span className="text-xs text-text-secondary">{formatTimeAgo(r.lastSync)}</span>
                        </div>
                        <div className="mt-2 flex gap-4 text-xs">
                          <span className="text-text-secondary">
                            Models on host: <span className="text-[var(--color-text)]">{r.modelsOnHost?.length || 0}</span>
                          </span>
                          {r.modelsAdded.length > 0 && (
                            <span className="text-ok">+{r.modelsAdded.length} added: {r.modelsAdded.join(', ')}</span>
                          )}
                          {r.modelsRemoved.length > 0 && (
                            <span className="text-err">-{r.modelsRemoved.length} removed: {r.modelsRemoved.join(', ')}</span>
                          )}
                          {r.error && <span className="text-err">{r.error}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* VRAM / Running Details */}
              <div className="p-4 rounded-lg border bg-surface border-border-hover">
                <h3 className="font-medium mb-3 text-[var(--color-text)] text-sm flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  GPU / Running Models
                </h3>
                {runningModels.length === 0 ? (
                  <p className="text-text-secondary text-sm">No models currently loaded in memory.</p>
                ) : (
                  <div className="space-y-3">
                    {runningModels.map(m => {
                      const vramPct = m.size > 0 ? Math.round(((m.sizeVram || 0) / m.size) * 100) : 0;
                      return (
                        <div key={m.digest} className="p-3 rounded bg-surface-hover">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[var(--color-text)] text-sm font-medium">{m.name}</span>
                            <span className="text-xs text-text-secondary">
                              {formatBytes(m.sizeVram || 0)} VRAM / {formatBytes(m.size)} total
                            </span>
                          </div>
                          {/* VRAM bar */}
                          <div className="h-2 bg-[var(--color-fg-subtle)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${Math.min(vramPct, 100)}%`, background: 'var(--ap-accent)' }}
                            />
                          </div>
                          <div className="flex justify-between mt-1 text-[10px] text-text-secondary">
                            <span>{vramPct}% GPU offloaded</span>
                            {m.expiresAt && <span>Expires: {new Date(m.expiresAt).toLocaleTimeString()}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Host Models Summary */}
              <div className="p-4 rounded-lg border bg-surface border-border-hover">
                <h3 className="font-medium mb-3 text-[var(--color-text)] text-sm">All Hosts Overview</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {hosts.map(h => (
                    <div key={h.id} className="p-3 rounded bg-surface-hover border border-border-hover">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full ${h.status === 'connected' ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-err)]'}`} />
                        <span className="text-[var(--color-text)] text-sm font-medium">{h.name}</span>
                      </div>
                      <div className="text-xs text-text-secondary space-y-0.5">
                        <div>Host: <code style={{ color: 'var(--ap-accent)' }}>{h.host}</code></div>
                        <div>Models: {h.modelCount} &middot; Running: {h.runningCount}</div>
                        <div>Priority: {h.priority} &middot; Last sync: {formatTimeAgo(h.lastSync)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── Model Info Panel ──────────────────────────────────────── */}
          {selectedModelInfo && (
            <div className="p-4 rounded-lg border bg-surface border-border-hover">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[var(--color-text)] text-sm font-medium">Model Info: {selectedModelInfo.name}</h3>
                <button onClick={() => setSelectedModelInfo(null)} className="text-text-secondary hover:text-[var(--color-text)] text-sm">Close</button>
              </div>
              <pre className="text-xs p-3 rounded overflow-auto max-h-80 bg-background text-text-secondary">
                {JSON.stringify(selectedModelInfo.info, null, 2)}
              </pre>
            </div>
          )}

          {/* Test Response */}
          {testState && (
            <div className="p-4 rounded-lg border bg-surface border-border-hover">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[var(--color-text)] text-sm font-medium">Test: {testState.model}</h3>
                <button onClick={() => setTestState(null)} className="text-text-secondary hover:text-[var(--color-text)] text-sm">Close</button>
              </div>
              <div className="p-3 rounded bg-background text-text-secondary text-sm">{testState.response}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
