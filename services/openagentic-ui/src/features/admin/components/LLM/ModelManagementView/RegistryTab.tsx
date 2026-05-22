/**
 * Registry Tab — All configured models with edit/delete/status
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  Search, RefreshCw, ChevronRight, Edit3, Trash2, Check,
  Sliders, Plus,
} from '@/shared/icons';
import { CheckCircle, XCircle } from '../../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';
import { emitModelsChanged } from '@/utils/modelSync';
import { getProviderIcon } from '../../Shared/ProviderIcons';
import { AdminToast, useAdminToast } from '../../Shared/AdminToast';
import { AdminButton } from '../../Shared/AdminButton';
import { AddModelDialog } from './AddModelDialog';
// DefaultModelsCard removed — tenant defaults are now managed in Admin → System Configuration → Default Models
import { StateMachineToggle } from '../../../primitives-v2';
import {
  ModelInfo, ModelConfig, DbProvider,
  CAPABILITY_BADGES, TIER_COLORS, MODEL_ROLES,
} from './constants';

export const RegistryTab: React.FC<{
  models: ModelInfo[];
  providers: DbProvider[];
  onRefresh: () => void;
}> = ({ models, providers, onRefresh }) => {
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<ModelConfig>({});
  const [saving, setSaving] = useState(false);
  const { toast, showToast, dismissToast } = useAdminToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  // Optimistic toggle state: track model IDs whose enabled state is flipped locally
  const [optimisticToggles, setOptimisticToggles] = useState<Set<string>>(new Set());

  // Anthropic (Claude) models deployed via Azure AI Foundry are hosted in
  // Anthropic's own datacenter and require special approval from Anthropic
  // plus deployment through the Azure portal — they CANNOT be added, removed,
  // enabled, or disabled from OpenAgentic. We detect them and show an
  // explanatory modal instead of firing the API call.
  const isAnthropicOnAIF = useCallback((model: ModelInfo) => {
    const isAIF = (model.providerType || '').toLowerCase().includes('foundry') ||
                  (model.providerType || '').toLowerCase().includes('azure-ai');
    const isAnthropic = /claude|anthropic/i.test(model.name || '');
    return isAIF && isAnthropic;
  }, []);

  const [aifBlockedAction, setAifBlockedAction] = useState<null | 'remove' | 'disable' | 'enable' | 'add'>(null);
  const showAnthropicAifBlockedMessage = useCallback((action: 'remove' | 'disable' | 'enable' | 'add') => {
    setAifBlockedAction(action);
  }, []);

  // Per-model "Test" — fires a low-token health probe asking the model to
  // identify itself, displays pass/fail + latency + reported model id.
  // Implements task #54.
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const handleTestModel = useCallback(async (model: ModelInfo) => {
    setTestingModel(model.id);
    try {
      const res = await apiRequest(
        `/admin/llm-providers/${encodeURIComponent(model.providerName)}/models/${encodeURIComponent(model.name)}/test`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const data = await res.json().catch(() => null);
      if (!data) {
        showToast('error', `${model.name}: empty response`);
        return;
      }
      if (data.ok) {
        const idMatch = data.reportedModel
          ? (data.reportedModel.toLowerCase().includes(model.name.toLowerCase()) ? '✓' : '⚠ id mismatch')
          : '';
        showToast('success', `${model.name}: ${data.latencyMs}ms ${idMatch}${data.reportedModel ? ` (${data.reportedModel.slice(0, 40)})` : ''}`);
      } else {
        showToast('error', `${model.name}: ${(data.error || 'failed').slice(0, 100)}`);
      }
    } catch (err: any) {
      showToast('error', `${model.name}: ${err.message}`);
    } finally {
      setTestingModel(null);
    }
  }, [showToast]);

  // #650 U7 — Per-model "Refresh from provider": re-runs live discovery
  // and updates capabilities + limits + pricing in place. Useful when the
  // upstream provider bumps prices or fixes context-window metadata.
  const [refreshingModel, setRefreshingModel] = useState<string | null>(null);
  const handleRefreshModel = useCallback(async (model: ModelInfo) => {
    setRefreshingModel(model.id);
    try {
      const res = await apiRequest(
        `/admin/llm-providers/${encodeURIComponent(model.providerName)}/models/${encodeURIComponent(model.name)}/refresh`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast('error', `Refresh failed for ${model.name}: ${(data?.message || data?.error || res.statusText).slice(0, 120)}`);
        return;
      }
      showToast('success', `Refreshed ${model.name} from ${data?.pricing_source ?? 'provider'}`);
      emitModelsChanged('refresh');
      onRefresh();
    } catch (err: any) {
      showToast('error', `Refresh failed: ${err.message}`);
    } finally {
      setRefreshingModel(null);
    }
  }, [onRefresh, showToast]);

  const handleDeleteModel = useCallback(async (model: ModelInfo) => {
    if (isAnthropicOnAIF(model)) {
      showAnthropicAifBlockedMessage('remove');
      return;
    }
    if (!confirm(`Remove model "${model.name}" from ${model.provider}?`)) return;
    setDeletingModel(model.id);
    try {
      // First try without force to check for active usage
      const res = await apiRequest(
        `/admin/llm-providers/${encodeURIComponent(model.providerName)}/models/${encodeURIComponent(model.name)}`,
        { method: 'DELETE' }
      );
      if (res.status === 409) {
        // Model is in use — show details and ask for force confirmation
        const data = await res.json();
        const usages = data.usages?.join('\n• ') || 'active usage detected';
        if (!confirm(`⚠️ "${model.name}" is currently in use:\n\n• ${usages}\n\nForce delete anyway?`)) {
          setDeletingModel(null);
          return;
        }
        // Retry with force
        const forceRes = await apiRequest(
          `/admin/llm-providers/${encodeURIComponent(model.providerName)}/models/${encodeURIComponent(model.name)}?force=true`,
          { method: 'DELETE' }
        );
        if (!forceRes.ok) throw new Error(await forceRes.text());
      } else if (!res.ok) {
        throw new Error(await res.text());
      }
      showToast('success', `Removed ${model.name}`);
      emitModelsChanged('delete');
      onRefresh();
    } catch (err: any) {
      showToast('error', `Failed to remove: ${err.message}`);
    } finally {
      setDeletingModel(null);
    }
  }, [onRefresh, showToast, isAnthropicOnAIF, showAnthropicAifBlockedMessage]);

  // Task #5 (Registry SoT): when the parent fetches models from the Registry
  // endpoint, `model.id` is the Registry row UUID. Toggles go through
  // PATCH /admin/llm-providers/registry/:id so the change lands on the SAME
  // table the toolbar + Smart Router read from. The legacy per-model PUT
  // only updates provider_config.models[] — which is NOT the Registry.
  const isRegistryRowId = useCallback((id: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id), []);

  // MC-H: handleToggleModel now takes the *desired* next state from the caller
  // (StateMachineToggle is the source of truth for what was clicked) and
  // returns Promise<boolean> so the toggle can drive its confirmed|rollback flow.
  //
  // optimisticToggles is kept because the row-level badge ("Active"/"Off") and
  // the expanded-detail CheckCircle/XCircle at lines ~419 and ~713 still read
  // `effectiveEnabled`. We keep the Set and flip it here so those indicators
  // stay in sync while the StateMachineToggle's internal optimistic state
  // drives the actual toggle knob. The Set is set on entry and cleared on
  // resolution — same lifetime as before, just driven from a different call site.
  const handleToggleModel = useCallback(async (model: ModelInfo, next: boolean): Promise<boolean> => {
    if (isAnthropicOnAIF(model)) {
      showAnthropicAifBlockedMessage(next ? 'enable' : 'disable');
      return false;
    }
    // Mirror the optimistic flip in the row badge / detail status indicator.
    setOptimisticToggles(prev => { const s = new Set(prev); s.add(model.id); return s; });
    try {
      // Deduped rows: when one ModelInfo represents multiple registry rows
      // (same provider+model registered for both 'chat' and 'code' roles),
      // fan out the PATCH so all per-role rows stay in sync. Without this,
      // toggling the merged row only flips one underlying registry row.
      const secondaryIds = (model as any).__secondaryRegistryIds as string[] | undefined;
      const allIds = [model.id, ...(secondaryIds ?? [])];
      const res = isRegistryRowId(model.id)
        ? await Promise.all(
            allIds.map(id =>
              apiRequest(
                `/admin/llm-providers/registry/${encodeURIComponent(id)}`,
                { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }) }
              ),
            ),
          ).then(rs => rs.find(r => !r.ok) ?? rs[0])
        : await apiRequest(
            `/admin/llm-providers/${encodeURIComponent(model.providerName)}/models/${encodeURIComponent(model.name)}`,
            { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { enabled: next } }) }
          );
      if (!res.ok) { showToast('error', `Failed to toggle: ${await res.text()}`); return false; }
      showToast('success', `${model.name} ${next ? 'enabled' : 'disabled'}`);
      emitModelsChanged('toggle');
      onRefresh();
      return true;
    } catch (err: any) {
      showToast('error', `Failed to toggle: ${err.message}`);
      return false;
    } finally {
      // Clear optimistic override — StateMachineToggle handles the knob state;
      // the row badge will re-sync from the refreshed model list.
      setOptimisticToggles(prev => { const s = new Set(prev); s.delete(model.id); return s; });
    }
  }, [onRefresh, showToast, isAnthropicOnAIF, showAnthropicAifBlockedMessage, isRegistryRowId]);

  const startEditing = useCallback((model: ModelInfo) => {
    setEditingModel(model.id);
    setEditConfig({
      maxOutputTokens: model.config?.maxOutputTokens || model.maxTokens || 8192,
      maxInputTokens: model.config?.maxInputTokens || model.contextWindow || 128000,
      rateLimitRequestsPerHour: model.config?.rateLimitRequestsPerHour || 0,
      rateLimitTokensPerHour: model.config?.rateLimitTokensPerHour || 0,
      temperature: model.config?.temperature ?? 1.0,
      topP: model.config?.topP ?? 1.0,
      enabled: model.enabled,
      roles: model.config?.roles || ['chat'],
      // (#69) Capability overrides — start with what's currently on the model
      capabilities: {
        chat: (model.capabilities as any)?.chat ?? true,
        vision: (model.capabilities as any)?.vision ?? false,
        tools: (model.capabilities as any)?.tools ?? false,
        thinking: (model.capabilities as any)?.thinking ?? false,
        embeddings: (model.capabilities as any)?.embeddings ?? false,
        imageGeneration: (model.capabilities as any)?.imageGeneration ?? false,
        streaming: (model.capabilities as any)?.streaming ?? true,
      },
      costTier: model.config?.costTier ?? (model as any).costTier ?? undefined,
      costPerMTokInput: model.config?.costPerMTokInput,
      costPerMTokOutput: model.config?.costPerMTokOutput,
      ttftMs: model.config?.ttftMs,
      ttftMeasuredAt: model.config?.ttftMeasuredAt,
    });
  }, []);

  // (#69) "Pull from provider" — re-fetch this model's metadata from the
  // provider's SDK and overwrite the edit form with whatever the SDK reports.
  // Lets admin reset to canonical SDK values without losing edit state.
  const [pullingFromProvider, setPullingFromProvider] = useState(false);
  const pullFromProvider = useCallback(async (model: ModelInfo) => {
    if (pullingFromProvider) return;
    setPullingFromProvider(true);
    try {
      const res = await apiRequest(
        `/admin/llm-providers/${encodeURIComponent(model.providerName)}/discover-models`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fresh = (data?.modelDetails || []).find((m: any) => m.id === model.name || m.name === model.name);
      if (!fresh) {
        showToast('error', `Model "${model.name}" not found in provider catalog`);
        return;
      }
      setEditConfig(c => ({
        ...c,
        maxOutputTokens: fresh.maxOutputTokens ?? fresh.maxTokens ?? c.maxOutputTokens,
        maxInputTokens: fresh.contextWindow ?? c.maxInputTokens,
        capabilities: {
          chat: fresh.capabilities?.chat ?? c.capabilities?.chat ?? true,
          vision: fresh.capabilities?.vision ?? c.capabilities?.vision ?? false,
          tools: fresh.capabilities?.tools ?? c.capabilities?.tools ?? false,
          thinking: fresh.capabilities?.thinking ?? c.capabilities?.thinking ?? false,
          embeddings: fresh.capabilities?.embeddings ?? c.capabilities?.embeddings ?? false,
          imageGeneration: fresh.capabilities?.imageGeneration ?? c.capabilities?.imageGeneration ?? false,
          streaming: fresh.capabilities?.streaming ?? c.capabilities?.streaming ?? true,
        },
        costTier: fresh.costTier ?? c.costTier,
      }));
      showToast('success', `Pulled fresh metadata from ${model.providerName}`);
    } catch (err: any) {
      showToast('error', `Failed to pull from provider: ${err.message}`);
    } finally {
      setPullingFromProvider(false);
    }
  }, [pullingFromProvider, showToast]);

  const saveModelConfig = useCallback(async (model: ModelInfo) => {
    setSaving(true);
    try {
      const res = isRegistryRowId(model.id)
        ? await apiRequest(
            `/admin/llm-providers/registry/${encodeURIComponent(model.id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                enabled: editConfig.enabled,
                role: editConfig.roles?.[0],
                temperature: editConfig.temperature ?? null,
                max_tokens: editConfig.maxOutputTokens ?? null,
              }),
            }
          )
        : await apiRequest(
            `/admin/llm-providers/${encodeURIComponent(model.providerName)}/models/${encodeURIComponent(model.name)}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config: editConfig }),
            }
          );
      if (!res.ok) throw new Error(await res.text());
      showToast('success', `Updated ${model.name} config`);
      setEditingModel(null);
      emitModelsChanged('edit');
      onRefresh();
    } catch (err: any) {
      showToast('error', `Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [editConfig, onRefresh, showToast, isRegistryRowId]);

  const [search, setSearch] = useState('');
  const [filterProvider, setFilterProvider] = useState('all');
  const [filterTier, setFilterTier] = useState('all');
  const [filterCapability, setFilterCapability] = useState('all');
  // #53: sort dropdown — name (default), provider, tier, capability count
  const [sortBy, setSortBy] = useState<'name' | 'provider' | 'tier' | 'capabilities'>('name');

  const providerNames = useMemo(() => [...new Set(models.map(m => m.provider))].sort((a, b) => a.localeCompare(b)), [models]);

  const countCapabilities = (m: ModelInfo) => {
    const caps = (m.capabilities as any) || {};
    return Object.values(caps).filter(v => v === true).length;
  };

  const filteredModels = useMemo(() => {
    const filtered = models.filter(m => {
      if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.provider.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterProvider !== 'all' && m.provider !== filterProvider) return false;
      if (filterTier !== 'all' && m.tier !== filterTier) return false;
      if (filterCapability !== 'all' && !(m.capabilities as any)[filterCapability]) return false;
      return true;
    });
    // Apply sort
    return [...filtered].sort((a, b) => {
      if (sortBy === 'capabilities') {
        const diff = countCapabilities(b) - countCapabilities(a);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'provider') return a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name);
      if (sortBy === 'tier') {
        const tierOrder: Record<string, number> = { premium: 0, balanced: 1, economical: 2, free: 3 };
        return (tierOrder[a.tier || 'balanced'] ?? 99) - (tierOrder[b.tier || 'balanced'] ?? 99) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name); // default: name
    });
  }, [models, search, filterProvider, filterTier, filterCapability, sortBy]);

  return (
    <div className="space-y-4">
      {/* Toast */}
      <AdminToast toast={toast} onDismiss={dismissToast} />

      {/* Tenant default models now managed in System Configuration → Default Models */}
      <div style={{
        background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.25)',
        borderRadius: 8, padding: '10px 14px', fontSize: 13,
        color: 'var(--text-muted)',
      }}>
        Tenant-wide default models (chat, code, embeddings, vision, image gen) are now managed in{' '}
        <strong>Admin → System Configuration → Default Models</strong>.
      </div>

      {/* Sub-header */}
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {models.length} model{models.length !== 1 ? 's' : ''} across {providerNames.length} provider{providerNames.length !== 1 ? 's' : ''}
        </p>
        <AdminButton variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setAddDialogOpen(true)}>
          Add Model
        </AdminButton>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search models..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border outline-none"
            style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
          />
        </div>
        {[
          { value: filterProvider, set: setFilterProvider, options: [['all', 'All Providers'], ...providerNames.map(p => [p, p])] },
          { value: filterTier, set: setFilterTier, options: [['all', 'All Tiers'], ['economy', 'Economy'], ['balanced', 'Balanced'], ['premium', 'Premium']] },
          { value: filterCapability, set: setFilterCapability, options: [['all', 'All Capabilities'], ['chat', 'Chat'], ['embeddings', 'Embeddings'], ['tools', 'Tools'], ['vision', 'Vision'], ['thinking', 'Thinking'], ['imageGeneration', 'Image Gen'], ['streaming', 'Streaming']] },
        ].map((f, i) => (
          <select key={i} value={f.value} onChange={e => f.set(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border outline-none"
            style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
          >
            {f.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        ))}
        {/* #53: Sort dropdown */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          className="px-3 py-2 text-xs rounded-lg border outline-none"
          style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
          title="Sort models"
        >
          <option value="name">Sort: Name</option>
          <option value="provider">Sort: Provider</option>
          <option value="tier">Sort: Tier</option>
          <option value="capabilities">Sort: Most Capabilities</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <div
          className="grid grid-cols-[2fr_1.2fr_80px_1fr_55px_65px_180px] gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
          style={{ background: 'var(--color-surfaceSecondary)', color: 'var(--text-muted)' }}
        >
          <span className="pl-5">Model</span><span>Provider</span><span>Tier</span><span>Capabilities</span><span title="Max output tokens per response (NOT context window — see expanded row for context)">Max Out</span><span>Status</span><span>Actions</span>
        </div>
        {filteredModels.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {search ? 'No models match your search.' : 'No models found.'}
          </div>
        ) : (
          filteredModels.map((model, i) => {
            // Apply optimistic toggle: if this model is being toggled, flip its enabled state visually
            const effectiveEnabled = optimisticToggles.has(model.id) ? !model.enabled : model.enabled;
            const isExpanded = expandedModel === model.id;
            const isEditing = editingModel === model.id;
            const providerPrefix = model.providerType === 'ollama' ? 'ollama' :
              model.providerType === 'aws-bedrock' ? 'bedrock' :
              model.providerType?.includes('azure') ? 'aif' :
              model.providerType === 'vertex-ai' ? 'vertex' : '';

            return (
            <div key={model.id}>
            <div
              className={`grid grid-cols-[2fr_1.2fr_80px_1fr_55px_65px_180px] gap-2 px-4 py-2.5 items-center text-xs cursor-pointer hover:bg-white/[0.02] transition-colors ${i > 0 ? 'border-t' : ''}`}
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => setExpandedModel(isExpanded ? null : model.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronRight size={12} className={`flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
                <div className="min-w-0 flex items-center gap-1.5">
                  <code className="font-mono text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }} title={model.name}>{model.name}</code>
                  {providerPrefix && <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--color-surfaceSecondary)' }}>{providerPrefix}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="flex-shrink-0">{getProviderIcon(model.providerType)}</span>
                <span className="truncate text-xs" style={{ color: 'var(--text-secondary)' }} title={model.provider}>{model.provider}</span>
              </div>
              <span>
                {model.tier && (
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${TIER_COLORS[model.tier]?.bg || ''} ${TIER_COLORS[model.tier]?.text || ''} ${TIER_COLORS[model.tier]?.border || ''}`}>
                    {model.tier}
                  </span>
                )}
              </span>
              <div className="flex gap-1">
                {CAPABILITY_BADGES.map(({ key, label, icon: Icon, color }) => {
                  const active = (model.capabilities as any)[key];
                  return (
                    <span key={key} title={label}
                      className="inline-flex items-center justify-center w-5 h-5 rounded"
                      style={{ backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent', color: active ? color : 'var(--text-muted)', opacity: active ? 1 : 0.25 }}>
                      <Icon size={11} />
                    </span>
                  );
                })}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{model.maxTokens ? `${(model.maxTokens / 1000).toFixed(0)}K` : '-'}</span>
              <span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  effectiveEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-gray-500/10 border border-gray-500/30'
                }`} style={{ color: effectiveEnabled ? undefined : 'var(--text-muted)' }}>
                  {effectiveEnabled ? <CheckCircle size={9} /> : <XCircle size={9} />}
                  {effectiveEnabled ? 'Active' : 'Off'}
                </span>
              </span>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                {/* Test model — low-token health probe (#54) */}
                <button onClick={() => handleTestModel(model)} disabled={testingModel === model.id}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors disabled:opacity-50 flex-shrink-0"
                  title={`Probe ${model.name} with a tiny request and verify it responds`}>
                  {testingModel === model.id ? 'Testing…' : 'Test'}
                </button>
                {/* Refresh from provider — re-runs live discovery (#650 U7) */}
                <button onClick={() => handleRefreshModel(model)} disabled={refreshingModel === model.id}
                  className="p-1 rounded hover:bg-purple-500/20 transition-colors disabled:opacity-50 flex-shrink-0"
                  title={`Refresh capabilities, limits, and pricing for ${model.name} from the upstream provider`}>
                  <RefreshCw size={13} className={`${refreshingModel === model.id ? 'animate-spin text-purple-300' : 'text-purple-400 hover:text-purple-300'}`} />
                </button>
                {/* Edit config */}
                <button onClick={() => { startEditing(model); setExpandedModel(model.id); }}
                  className="p-1 rounded hover:bg-blue-500/20 transition-colors flex-shrink-0" title={`Edit ${model.name} config`}>
                  <Edit3 size={13} className="text-blue-400 hover:text-blue-300" />
                </button>
                {/* Enable/disable toggle — MC-H: replaced bespoke button with StateMachineToggle */}
                <StateMachineToggle
                  checked={effectiveEnabled}
                  onCommit={(next) => handleToggleModel(model, next)}
                  label={`${effectiveEnabled ? 'Disable' : 'Enable'} ${model.name}`}
                  size="sm"
                  disabled={isAnthropicOnAIF(model)}
                />
                {/* Delete */}
                <button onClick={() => handleDeleteModel(model)} disabled={deletingModel === model.id}
                  className="p-1 rounded hover:bg-red-500/20 transition-colors flex-shrink-0" title={`Remove ${model.name}`}>
                  <Trash2 size={13} className={deletingModel === model.id ? 'text-gray-500 animate-pulse' : 'text-red-400 hover:text-red-300'} />
                </button>
              </div>
            </div>
            {/* Expanded detail / edit panel */}
            {isExpanded && (
              <div className="px-6 py-4 border-t" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
                {isEditing ? (
                  /* Edit mode */
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sliders size={14} style={{ color: 'var(--ap-accent)' }} />
                      <h4 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Edit Configuration — <code className="font-mono">{model.name}</code>
                      </h4>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      {/* Max Output Tokens */}
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Max Output Tokens</label>
                        <input
                          type="number" min={1} max={200000}
                          value={editConfig.maxOutputTokens || ''}
                          onChange={e => setEditConfig(c => ({ ...c, maxOutputTokens: Number(e.target.value) }))}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      {/* Max Input Tokens */}
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Max Input Tokens (Context)</label>
                        <input
                          type="number" min={1} max={2000000}
                          value={editConfig.maxInputTokens || ''}
                          onChange={e => setEditConfig(c => ({ ...c, maxInputTokens: Number(e.target.value) }))}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      {/* Rate Limit Requests/hr */}
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Rate Limit (req/hr, 0=unlimited)</label>
                        <input
                          type="number" min={0}
                          value={editConfig.rateLimitRequestsPerHour ?? 0}
                          onChange={e => setEditConfig(c => ({ ...c, rateLimitRequestsPerHour: Number(e.target.value) }))}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      {/* Rate Limit Tokens/hr */}
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Rate Limit (tokens/hr, 0=unlimited)</label>
                        <input
                          type="number" min={0}
                          value={editConfig.rateLimitTokensPerHour ?? 0}
                          onChange={e => setEditConfig(c => ({ ...c, rateLimitTokensPerHour: Number(e.target.value) }))}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      {/* Temperature */}
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                          Temperature: {(editConfig.temperature ?? 1.0).toFixed(1)}
                        </label>
                        <input
                          type="range" min={0} max={2} step={0.1}
                          value={editConfig.temperature ?? 1.0}
                          onChange={e => setEditConfig(c => ({ ...c, temperature: Number(e.target.value) }))}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                          style={{ accentColor: 'var(--ap-accent)' }}
                        />
                      </div>
                      {/* Top P */}
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                          Top P: {(editConfig.topP ?? 1.0).toFixed(1)}
                        </label>
                        <input
                          type="range" min={0} max={1} step={0.1}
                          value={editConfig.topP ?? 1.0}
                          onChange={e => setEditConfig(c => ({ ...c, topP: Number(e.target.value) }))}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                          style={{ accentColor: 'var(--ap-accent)' }}
                        />
                      </div>
                    </div>
                    {/* Roles */}
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Roles</label>
                      <div className="flex flex-wrap gap-2">
                        {MODEL_ROLES.map(role => {
                          const active = editConfig.roles?.includes(role);
                          return (
                            <button
                              key={role}
                              onClick={() => setEditConfig(c => ({
                                ...c,
                                roles: active
                                  ? (c.roles || []).filter(r => r !== role)
                                  : [...(c.roles || []), role],
                              }))}
                              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                                active ? 'shadow-sm' : ''
                              }`}
                              style={{
                                background: active ? 'var(--ap-accent)' : 'transparent',
                                borderColor: active ? 'var(--ap-accent)' : 'var(--color-border)',
                                color: active ? 'white' : 'var(--text-muted)',
                              }}
                            >
                              {role}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* (#69) Capability toggles — admin overrides for SDK guesses */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Capabilities (overrides SDK)</label>
                        <button
                          onClick={() => pullFromProvider(model)}
                          disabled={pullingFromProvider}
                          className="text-xs px-2 py-0.5 rounded border transition-all flex items-center gap-1"
                          style={{
                            borderColor: 'var(--color-border)',
                            color: 'var(--text-muted)',
                          }}
                          title="Re-fetch metadata from the provider's SDK"
                        >
                          {pullingFromProvider ? <RefreshCw size={9} className="animate-spin" /> : <RefreshCw size={9} />}
                          Pull from provider
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['chat','vision','tools','thinking','embeddings','imageGeneration','streaming'] as const).map(cap => {
                          const active = editConfig.capabilities?.[cap] ?? false;
                          return (
                            <button
                              key={cap}
                              onClick={() => setEditConfig(c => ({
                                ...c,
                                capabilities: {
                                  ...(c.capabilities ?? {}),
                                  [cap]: !active,
                                },
                              }))}
                              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all`}
                              style={{
                                background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
                                borderColor: active ? 'rgba(59,130,246,0.4)' : 'var(--color-border)',
                                color: active ? 'var(--ap-accent)' : 'var(--text-muted)',
                              }}
                            >
                              {cap}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* (#69) Cost tier + pricing fields */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Cost Tier</label>
                        <select
                          value={editConfig.costTier ?? ''}
                          onChange={e => setEditConfig(c => ({ ...c, costTier: (e.target.value || undefined) as any }))}
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                        >
                          <option value="">— unset —</option>
                          <option value="free">free</option>
                          <option value="low">low</option>
                          <option value="mid">mid</option>
                          <option value="high">high</option>
                          <option value="premium">premium</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>$ / M Tok Input</label>
                        <input
                          type="number" min={0} step={0.01}
                          value={editConfig.costPerMTokInput ?? ''}
                          onChange={e => setEditConfig(c => ({ ...c, costPerMTokInput: e.target.value === '' ? undefined : Number(e.target.value) }))}
                          placeholder="auto"
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>$ / M Tok Output</label>
                        <input
                          type="number" min={0} step={0.01}
                          value={editConfig.costPerMTokOutput ?? ''}
                          onChange={e => setEditConfig(c => ({ ...c, costPerMTokOutput: e.target.value === '' ? undefined : Number(e.target.value) }))}
                          placeholder="auto"
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                    </div>

                    {/* (#69) TTFT display (read-only — measured by chat pipeline) */}
                    {editConfig.ttftMs !== undefined && (
                      <div className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                        <span>TTFT: <strong className="text-emerald-400">{editConfig.ttftMs}ms</strong></span>
                        {editConfig.ttftMeasuredAt && (
                          <span className="opacity-60">measured {new Date(editConfig.ttftMeasuredAt).toLocaleString()}</span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <button
                        onClick={() => saveModelConfig(model)}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg transition-all"
                        style={{ background: 'var(--ap-accent)', color: 'white' }}
                      >
                        {saving ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}
                        Save
                      </button>
                      <button
                        onClick={() => setEditingModel(null)}
                        className="px-4 py-1.5 text-xs font-medium rounded-lg border transition-all"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--text-muted)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div className="grid grid-cols-5 gap-4 text-xs">
                      <div>
                        <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Context Window</div>
                        <div style={{ color: 'var(--text-primary)' }}>{model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}K tokens` : model.maxTokens ? `${(model.maxTokens / 1000).toFixed(0)}K tokens` : 'Unknown'}</div>
                      </div>
                      <div>
                        <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Provider</div>
                        <div style={{ color: 'var(--text-primary)' }}>{model.provider}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{model.providerType}</div>
                      </div>
                      <div>
                        <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Rate Limits</div>
                        <div style={{ color: 'var(--text-primary)' }}>
                          {model.config?.rateLimitRequestsPerHour
                            ? `${model.config.rateLimitRequestsPerHour} req/hr`
                            : 'Unlimited'}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {model.config?.rateLimitTokensPerHour
                            ? `${(model.config.rateLimitTokensPerHour / 1000000).toFixed(1)}M tok/hr`
                            : 'No token limit'}
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Tier</div>
                        <div style={{ color: 'var(--text-primary)' }}>{model.tier || 'Unassigned'}</div>
                      </div>
                      <div>
                        <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Status</div>
                        <div className="flex items-center gap-1">
                          {effectiveEnabled ? <CheckCircle size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-gray-500" />}
                          <span style={{ color: effectiveEnabled ? 'var(--ap-ok)' : 'var(--text-muted)' }}>{effectiveEnabled ? 'Active' : 'Disabled'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>Capabilities:</span>
                        {CAPABILITY_BADGES.map(({ key, label, icon: Icon, color }) => {
                          const active = (model.capabilities as any)[key];
                          return active ? (
                            <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`, color }}>
                              <Icon size={10} /> {label}
                            </span>
                          ) : null;
                        })}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditing(model); }}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border transition-all hover:border-blue-400"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                      >
                        <Edit3 size={11} />
                        Edit Config
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          );})
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {(['economy', 'balanced', 'premium'] as const).map(tier => {
          const count = models.filter(m => m.tier === tier).length;
          const tc = TIER_COLORS[tier];
          return (
            <div key={tier} className={`p-3 rounded-lg border ${tc.border}`} style={{ background: 'var(--color-surfaceSecondary)' }}>
              <div className={`text-lg font-bold ${tc.text}`}>{count}</div>
              <div className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>{tier}</div>
            </div>
          );
        })}
        <div className="p-3 rounded-lg border border-gray-500/30" style={{ background: 'var(--color-surfaceSecondary)' }}>
          <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{models.length}</div>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Total</div>
        </div>
      </div>

      <AddModelDialog
        isOpen={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        providers={providers}
        existingModels={models}
        onModelAdded={() => { onRefresh(); }}
      />

      {/* Anthropic-on-AIF blocked modal — explains why Claude models on AIF
          can't be managed from OpenAgentic and must go through Azure portal. */}
      {aifBlockedAction && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setAifBlockedAction(null)}
        >
          <div
            className="max-w-lg w-full rounded-xl border shadow-2xl"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b flex items-start gap-3" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(212, 165, 116, 0.15)' }}>
                {/* Anthropic brand orange #D4A574 — non-themeable brand identity color. */}
                {/* eslint-disable-next-line admin-tokens/no-hardcoded-admin-color */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4A574" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Anthropic models on Azure AI Foundry can't be {aifBlockedAction === 'add' ? 'added' : aifBlockedAction === 'remove' ? 'removed' : `${aifBlockedAction}d`} here
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Lifecycle is managed from Azure portal
                </p>
              </div>
            </div>
            <div className="px-5 py-4 text-xs space-y-3" style={{ color: 'var(--text-secondary)' }}>
              <p>
                Claude models accessed via AIF are hosted in Anthropic's own datacenter and
                require special approval from Anthropic before they can be deployed.
              </p>
              <div>
                <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>To add a Claude model:</div>
                <ol className="list-decimal list-inside space-y-1" style={{ color: 'var(--text-muted)' }}>
                  <li>Request Anthropic model access through your Azure subscription</li>
                  <li>Deploy the model in <code className="font-mono">Azure Portal → AI Foundry → Model catalog → Claude</code></li>
                  <li>Once deployed, it will appear in this registry automatically</li>
                </ol>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Note: model <em>configuration</em> (rate limits, cost tier, roles) is still editable
                from here — only lifecycle (add / remove / enable / disable) must go through Azure.
              </p>
            </div>
            <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={() => setAifBlockedAction(null)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{ background: 'var(--ap-accent)', color: 'white' }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
