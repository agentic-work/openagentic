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
 * LLM Provider Management — Enterprise Admin Portal
 *
 * Thin shell: state management, CRUD handlers, and layout.
 * Sub-components handle individual UI sections.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus } from '@/shared/icons';
import {
  Server, XCircle, RefreshCw, Zap, DollarSign, Activity,
} from '../../Shared/AdminIcons';
import { SlideInPanel } from '../../Shared/SlideInPanel';
import { apiRequest } from '@/utils/api';
import { emitModelsChanged } from '@/utils/modelSync';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { AdminMetricCard } from '../../Shared/AdminMetricCard';
import { AdminFilterBar } from '../../Shared/AdminFilterBar';

import {
  type ViewMode, type DbProvider, type HealthInfo, type MetricsInfo,
  type ProviderDefaultConfig,
  PROVIDER_META, btnPrimary,
} from './types';
import { ToastContainer, useToast } from './ToastSystem';
import { ProviderFormPanel } from './ProviderFormPanel';
import { ProviderCard, EmptyProviderState } from './ProviderCard';
import { CapabilityMatrix } from './CapabilityMatrix';
import { EmbeddingProviderSection } from './EmbeddingProviderSection';
import { CredentialRotationModal } from './CredentialRotationModal';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface LLMProviderManagementProps {
  theme: string;
}

export const LLMProviderManagement: React.FC<LLMProviderManagementProps> = ({ theme }) => {
  const confirmHook = useConfirm();
  const toastCtx = useToast();

  // State
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [timeRange, setTimeRange] = useState('24h');

  // Data
  const [dbProviders, setDbProviders] = useState<DbProvider[]>([]);
  const [healthMap, setHealthMap] = useState<Map<string, HealthInfo>>(new Map());
  const [metricsMap, setMetricsMap] = useState<Map<string, MetricsInfo>>(new Map());
  const [providerDefaults, setProviderDefaults] = useState<Record<string, ProviderDefaultConfig>>({});

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<DbProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // Credential rotation
  const [rotatingProvider, setRotatingProvider] = useState<DbProvider | null>(null);
  const [rotating, setRotating] = useState(false);

  // ── Data Fetching ──
  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [dbRes, healthRes, metricsRes, sdkRes] = await Promise.all([
        apiRequest('/admin/llm-providers/database'),
        apiRequest('/admin/llm-providers/health').catch(() => null),
        apiRequest('/admin/llm-providers/metrics').catch(() => null),
        apiRequest('/admin/llm-providers/sdk-options').catch(() => null),
      ]);

      if (dbRes.ok) {
        const data = await dbRes.json();
        setDbProviders(data.providers || []);
      } else {
        const fallback = await apiRequest('/admin/llm-providers');
        if (fallback.ok) { const data = await fallback.json(); setDbProviders(data.providers || []); }
      }

      if (healthRes?.ok) {
        const data = await healthRes.json();
        const map = new Map<string, HealthInfo>();
        (data.providers || []).forEach((h: HealthInfo) => map.set(h.provider, h));
        setHealthMap(map);
      }
      if (metricsRes?.ok) {
        const data = await metricsRes.json();
        const map = new Map<string, MetricsInfo>();
        (data.providers || []).forEach((m: MetricsInfo) => map.set(m.provider, m));
        setMetricsMap(map);
      }
      if (sdkRes?.ok) {
        const data = await sdkRes.json();
        if (data.defaults) setProviderDefaults(data.defaults);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── CRUD ──
  const saveProvider = async (payload: any, isEdit: boolean) => {
    setSaving(true);
    try {
      const url = isEdit && editingProvider ? `/admin/llm-providers/${editingProvider.id}` : '/admin/llm-providers';
      const res = await apiRequest(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json().catch(() => ({ message: res.statusText })); throw new Error(d.message || d.error || `HTTP ${res.status}`); }
      toastCtx.show('success', `Provider "${payload.displayName}" ${isEdit ? 'updated' : 'created'}`);
      setPanelOpen(false); setEditingProvider(null);
      await fetchAll();
    } catch (err) {
      toastCtx.show('error', `Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally { setSaving(false); }
  };

  const deleteProvider = async (provider: DbProvider) => {
    const yes = await confirmHook(`Delete "${provider.display_name}"? This will disable all associated models.`, { variant: 'danger', title: 'Delete Provider' });
    if (!yes) return;
    try {
      const res = await apiRequest(`/admin/llm-providers/${provider.id}?force=true`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toastCtx.show('success', `Provider "${provider.display_name}" deleted`);
      setDbProviders(prev => prev.filter(p => p.id !== provider.id));
      setExpandedId(null); // Collapse any expanded card
      emitModelsChanged('provider-change');
    } catch (err) {
      toastCtx.show('error', `Delete failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  };

  const toggleProvider = async (provider: DbProvider) => {
    try {
      await apiRequest(`/admin/llm-providers/${provider.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !provider.enabled }) });
      toastCtx.show('info', `"${provider.display_name}" ${provider.enabled ? 'disabled' : 'enabled'}`);
      emitModelsChanged('provider-change');
      await fetchAll();
    } catch (err) { toastCtx.show('error', `Toggle failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
  };

  const testProvider = async (name: string) => {
    const prevExpanded = expandedId;
    setTestingProvider(name);
    try {
      const res = await apiRequest(`/admin/llm-providers/${name}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testType: 'basic' }) });
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (res.ok && data) {
        const basic = data.tests?.basic;
        if (basic?.success) toastCtx.show('success', `${name}: Test passed (${basic.latency || '?'}ms)`);
        else toastCtx.show('error', `${name}: ${basic?.error?.substring(0, 100) || 'Test failed'}`);
      } else {
        const errData = !res.ok ? await res.json().catch(() => null) : null;
        toastCtx.show('error', `${name}: ${errData?.message || `HTTP ${res.status}`}`);
      }
    } catch (err) { toastCtx.show('error', `${name}: ${err instanceof Error ? err.message : 'Failed'}`); }
    finally {
      setTestingProvider(null);
      // Restore expanded state in case re-render collapsed the panel
      if (prevExpanded) setExpandedId(prevExpanded);
    }
  };

  const pauseResumeProvider = async (provider: DbProvider, durationMinutes?: number) => {
    const isPaused = provider.provider_config?.paused;
    try {
      if (isPaused) {
        await apiRequest(`/admin/llm-providers/${provider.id}/resume`, { method: 'POST' });
        toastCtx.show('success', `"${provider.display_name}" resumed`);
        // fallthrough to the single emit+fetchAll at the bottom
      } else {
        await apiRequest(`/admin/llm-providers/${provider.id}/pause`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ durationMinutes: durationMinutes || 60 }),
        });
        toastCtx.show('info', `"${provider.display_name}" paused for ${durationMinutes || 60} min`);
      }
      emitModelsChanged('provider-change');
      await fetchAll();
    } catch (err) { toastCtx.show('error', `Pause/resume failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
  };

  const rotateCredentials = async (provider: DbProvider, newCreds: Record<string, string>) => {
    setRotating(true);
    try {
      const res = await apiRequest(`/admin/llm-providers/${provider.id}/rotate-credentials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCreds),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toastCtx.show('success', `Credentials rotated for "${provider.display_name}"`);
      setRotatingProvider(null);
      await fetchAll();
    } catch (err) { toastCtx.show('error', `Rotation failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
    finally { setRotating(false); }
  };

  const updateCapability = async (providerId: string, capability: string, enabled: boolean) => {
    const provider = dbProviders.find(p => p.id === providerId);
    if (!provider) return;
    try {
      const newCaps = { ...provider.capabilities, [capability]: enabled };
      await apiRequest(`/admin/llm-providers/${providerId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capabilities: newCaps }) });
      await fetchAll();
    } catch (err) { toastCtx.show('error', `Capability update failed: ${err instanceof Error ? err.message : 'Unknown'}`); }
  };

  const handleMatrixChange = async (providerId: string, capability: string, role: 'primary' | 'fallback' | 'none') => {
    if (role === 'none') {
      await updateCapability(providerId, capability, false);
    } else {
      await updateCapability(providerId, capability, true);
    }
  };

  // ── Derived ──
  const filteredProviders = useMemo(() => {
    const active = dbProviders.filter(p => !p.deleted_at);
    if (!searchTerm) return active;
    const q = searchTerm.toLowerCase();
    return active.filter(p => p.display_name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.provider_type.includes(q));
  }, [dbProviders, searchTerm]);

  const enabledCount = useMemo(() => dbProviders.filter(p => p.enabled && !p.deleted_at).length, [dbProviders]);
  const healthyCount = useMemo(() => {
    let n = 0;
    dbProviders.forEach(p => { if (healthMap.get(p.name)?.status === 'healthy') n++; });
    return n;
  }, [dbProviders, healthMap]);
  const totalRequests = useMemo(() => { let n = 0; metricsMap.forEach(m => n += (m.totalRequests || 0)); return n; }, [metricsMap]);
  const totalCost = useMemo(() => { let n = 0; metricsMap.forEach(m => n += (m.totalCost || 0)); return n; }, [metricsMap]);

  // ── Loading/Error ──
  if (loading && dbProviders.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
          <RefreshCw size={20} className="animate-spin" /> Loading providers...
        </div>
      </div>
    );
  }

  if (error && dbProviders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <XCircle size={32} className="text-red-400" />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <button onClick={fetchAll} className={btnPrimary}>Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toastCtx.toasts} onDismiss={toastCtx.dismiss} />

      {/* Summary Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <AdminMetricCard label="Providers" value={`${enabledCount}/${dbProviders.filter(p => !p.deleted_at).length}`} icon={<Server size={16} />} tooltip="Enabled / Total configured providers" />
        <AdminMetricCard label="Health" value={`${healthyCount} healthy`} icon={<Activity size={16} />} tooltip="Providers passing health checks" />
        <AdminMetricCard label="Requests" value={totalRequests.toLocaleString()} icon={<Zap size={16} />} tooltip="Total requests across all providers" />
        <AdminMetricCard label="Cost" value={`$${totalCost.toFixed(2)}`} icon={<DollarSign size={16} />} tooltip="Total LLM spend" />
      </div>

      {/* Filter Bar + View Toggle + Add */}
      <div className="flex items-center justify-between gap-3">
        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          onRefresh={fetchAll}
          refreshing={loading}
          extraFilters={
            <div className="flex items-center rounded-md overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--color-border)' }}>
              {([['cards', 'Cards'], ['matrix', 'Matrix']] as [ViewMode, string][]).map(([mode, label]) => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: viewMode === mode ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: viewMode === mode ? '#FFFFFF' : 'var(--text-secondary)',
                    borderRight: '1px solid var(--color-border)',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          }
        />
        <button onClick={() => { setEditingProvider(null); setPanelOpen(true); }} className={btnPrimary}>
          <Plus size={16} className="inline mr-1" /> Add Provider
        </button>
      </div>

      {/* Card View */}
      {viewMode === 'cards' && (
        <div className="space-y-3">
          {filteredProviders.length === 0 ? (
            <EmptyProviderState
              searchTerm={searchTerm}
              onAddProvider={() => { setEditingProvider(null); setPanelOpen(true); }}
            />
          ) : (
            filteredProviders.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                health={healthMap.get(provider.name)}
                metrics={metricsMap.get(provider.name)}
                isExpanded={expandedId === provider.id}
                onToggleExpand={() => setExpandedId(expandedId === provider.id ? null : provider.id)}
                onEdit={() => { setEditingProvider(provider); setPanelOpen(true); }}
                onDelete={() => deleteProvider(provider)}
                onTest={() => testProvider(provider.name)}
                onToggleEnabled={() => toggleProvider(provider)}
                onPauseResume={(dur) => pauseResumeProvider(provider, dur)}
                onRotateCredentials={() => setRotatingProvider(provider)}
                onCapabilityToggle={(cap, en) => updateCapability(provider.id, cap, en)}
                testing={testingProvider === provider.name}
              />
            ))
          )}
        </div>
      )}

      {/* Matrix View */}
      {viewMode === 'matrix' && (
        <CapabilityMatrix providers={filteredProviders} onCapabilityChange={handleMatrixChange} />
      )}

      {/* Embedding Provider Section */}
      <EmbeddingProviderSection providers={dbProviders} toast={toastCtx} />

      {/* Slide-in Panel for Provider Form */}
      <SlideInPanel
        isOpen={panelOpen}
        onClose={() => { setPanelOpen(false); setEditingProvider(null); }}
        title={editingProvider ? `Edit: ${editingProvider.display_name}` : 'Add New Provider'}
        subtitle={editingProvider ? `${PROVIDER_META[editingProvider.provider_type]?.label || editingProvider.provider_type} - Priority ${editingProvider.priority}` : 'Configure a new LLM provider'}
        width="lg">
        <ProviderFormPanel
          provider={editingProvider}
          onSave={saveProvider}
          onCancel={() => { setPanelOpen(false); setEditingProvider(null); }}
          saving={saving}
          providerDefaults={providerDefaults}
        />
      </SlideInPanel>

      {/* Credential Rotation Modal */}
      {rotatingProvider && (
        <CredentialRotationModal
          provider={rotatingProvider}
          onClose={() => setRotatingProvider(null)}
          onRotate={(creds) => rotateCredentials(rotatingProvider, creds)}
          rotating={rotating}
        />
      )}
    </div>
  );
};

export default LLMProviderManagement;
