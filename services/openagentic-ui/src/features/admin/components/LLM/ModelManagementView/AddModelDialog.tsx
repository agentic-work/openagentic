/**
 * AddModelDialog — SlideInPanel that lets users browse available models
 * from a provider and add them to the platform registry.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Search, RefreshCw, Plus, Check, ChevronDown,
  Sliders,
} from '@/shared/icons';
import { XCircle } from '../../Shared/AdminIcons';
import { SlideInPanel } from '../../Shared/SlideInPanel';
import { AdminButton } from '../../Shared/AdminButton';
import { AdminBadge } from '../../Shared/AdminBadge';
import { AdminToast, useAdminToast } from '../../Shared/AdminToast';
import { getProviderIcon, getProviderColor } from '../../Shared/ProviderIcons';
import { apiRequest } from '@/utils/api';
import { emitModelsChanged } from '@/utils/modelSync';
import { onKeyActivate } from '@/utils/a11y';
import {
  DiscoveredModel, ModelInfo, DbProvider,
  CAPABILITY_BADGES, TIER_COLORS, COST_TIER_COLORS, MODEL_ROLES, guessTier,
} from './constants';

interface AddModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  providers: DbProvider[];
  existingModels: ModelInfo[];
  onModelAdded: () => void;
}

const CAPABILITY_FILTERS = [
  { key: 'chat', label: 'Chat' },
  { key: 'embeddings', label: 'Embedding' },
  { key: 'vision', label: 'Vision' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'imageGeneration', label: 'Image Gen' },
  { key: 'tools', label: 'Tools' },
] as const;

/**
 * Provider types whose Registry rows are managed automatically by
 * RegistrySyncJob (AIF deployment list mirror, Ollama host pulls). Those
 * are listed in the dropdown but disabled so admins understand why adding
 * a single model there isn't the right action — the provider's host
 * already curates membership. Matches the server-side allowlist in
 * services/model-routing/registryAutoSyncPolicy.ts.
 */
const AUTO_SYNC_PROVIDER_TYPES = new Set(['azure-ai-foundry', 'ollama']);

const isAutoSyncProvider = (providerType: string): boolean =>
  AUTO_SYNC_PROVIDER_TYPES.has(providerType);

export const AddModelDialog: React.FC<AddModelDialogProps> = ({
  isOpen, onClose, providers, existingModels, onModelAdded,
}) => {
  const [selectedProviderName, setSelectedProviderName] = useState<string>('');
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [capFilter, setCapFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'context' | 'tier' | 'output' | 'cap-chat' | 'cap-vision' | 'cap-tools' | 'cap-thinking' | 'cap-embeddings' | 'cap-imageGeneration' | 'cap-streaming'>('name');
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [addingModelId, setAddingModelId] = useState<string | null>(null);
  const [aifBlocked, setAifBlocked] = useState(false);
  const { toast, showToast, dismissToast } = useAdminToast();

  // Track models added this session for immediate UI feedback
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Cache per provider
  const [cache, setCache] = useState<Record<string, DiscoveredModel[]>>({});

  // Inline config state
  const [addConfig, setAddConfig] = useState({
    roles: ['chat'] as string[],
    maxOutputTokens: 8192,
    temperature: 1.0,
    topP: 1.0,
    rateLimitRequestsPerHour: 0,
  });

  const enabledProviders = useMemo(
    () => providers.filter(p => p.enabled),
    [providers]
  );

  const existingModelNames = useMemo(
    () => new Set([...existingModels.map(m => m.name), ...addedIds]),
    [existingModels, addedIds]
  );

  // Auto-select first EXPLICIT-ADD provider when dialog opens. AIF/Ollama
  // providers are skipped here because picking one would be a dead-end
  // (their rows are owned by RegistrySyncJob, not manual add). If no
  // explicit-add provider is configured, fall back to the first provider
  // so the dropdown still has a valid value.
  useEffect(() => {
    if (!isOpen || enabledProviders.length === 0 || selectedProviderName) return;
    const firstExplicit = enabledProviders.find(p => !isAutoSyncProvider(p.provider_type));
    setSelectedProviderName((firstExplicit ?? enabledProviders[0]).name);
  }, [isOpen, enabledProviders, selectedProviderName]);

  const fetchModels = useCallback(async (providerName: string, useCache = true) => {
    if (useCache && cache[providerName]) {
      setDiscoveredModels(cache[providerName]);
      return;
    }
    setLoading(true);
    setError(null);
    setExpandedModelId(null);
    try {
      const res = await apiRequest(
        `/admin/llm-providers/${encodeURIComponent(providerName)}/discover-models`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const models: DiscoveredModel[] = (data.modelDetails || []).map((m: any) => ({
        id: m.id || m.name || m,
        name: m.name || m.id || m,
        provider: providerName,
        description: m.description,
        capabilities: m.capabilities,
        maxTokens: m.maxTokens,
        maxOutputTokens: m.maxOutputTokens,
        contextWindow: m.contextWindow,
        providerName: m.providerName,
        tier: m.tier || guessTier(m.id || m.name || ''),
        costTier: m.costTier,
        family: m.family,
        costPerInputToken: m.costPerInputToken,
        costPerOutputToken: m.costPerOutputToken,
      }));
      setDiscoveredModels(models);
      setCache(prev => ({ ...prev, [providerName]: models }));
    } catch (err: any) {
      setError(err.message || 'Failed to discover models');
      setDiscoveredModels([]);
    } finally {
      setLoading(false);
    }
  }, [cache]);

  useEffect(() => {
    if (selectedProviderName && isOpen) {
      fetchModels(selectedProviderName);
    }
  }, [selectedProviderName, isOpen, fetchModels]);

  // Reset when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setExpandedModelId(null);
      setSearch('');
      setCapFilter(null);
      setError(null);
      setAddedIds(new Set());
    }
  }, [isOpen]);

  // Filtered + sorted models
  const filteredModels = useMemo(() => {
    let list = [...discoveredModels];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q) ||
        (m.providerName || '').toLowerCase().includes(q)
      );
    }
    if (capFilter) {
      list = list.filter(m => m.capabilities?.[capFilter]);
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'context') return (b.contextWindow || 0) - (a.contextWindow || 0);
      if (sortBy === 'output') return (b.maxOutputTokens || b.maxTokens || 0) - (a.maxOutputTokens || a.maxTokens || 0);
      if (sortBy === 'tier') {
        const order: Record<string, number> = { premium: 0, high: 1, mid: 2, balanced: 2, low: 3, economy: 3, free: 4 };
        const aTier = a.costTier || a.tier || 'balanced';
        const bTier = b.costTier || b.tier || 'balanced';
        return (order[aTier] ?? 2) - (order[bTier] ?? 2);
      }
      // Capability-specific sorts: models WITH the capability first, then by name
      if (sortBy.startsWith('cap-')) {
        const capKey = sortBy.replace('cap-', '');
        const aHas = a.capabilities?.[capKey] ? 1 : 0;
        const bHas = b.capabilities?.[capKey] ? 1 : 0;
        if (bHas !== aHas) return bHas - aHas;
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
    // Already added sort to bottom
    list.sort((a, b) =>
      (existingModelNames.has(a.id) ? 1 : 0) - (existingModelNames.has(b.id) ? 1 : 0)
    );
    return list;
  }, [discoveredModels, search, capFilter, sortBy, existingModelNames]);

  const selectedProvider = enabledProviders.find(p => p.name === selectedProviderName);

  const openConfig = useCallback((model: DiscoveredModel) => {
    const caps = model.capabilities || {};
    const isEmbed = caps.embeddings || model.id.toLowerCase().includes('embed');
    const isImageGen = caps.imageGeneration || model.id.toLowerCase().includes('imagen') || model.id.toLowerCase().includes('nova-canvas');
    // Infer roles from provider-reported capabilities
    const roles: string[] = [];
    if (isEmbed) roles.push('embedding');
    else if (isImageGen) roles.push('image-generation');
    else {
      if (caps.chat !== false) roles.push('chat');
      if (caps.vision) roles.push('vision');
    }
    if (roles.length === 0) roles.push('chat');

    setExpandedModelId(model.id);
    setAddConfig({
      roles,
      maxOutputTokens: model.maxOutputTokens || model.maxTokens || 8192,
      temperature: 0.7,
      topP: 0.9,
      rateLimitRequestsPerHour: 0,
    });
  }, []);

  const handleAdd = useCallback(async (model: DiscoveredModel) => {
    if (!selectedProviderName) {
      showToast('error', 'No provider selected — choose a provider from the dropdown first');
      return;
    }

    setAddingModelId(model.id);
    try {
      const res = await apiRequest(
        `/admin/llm-providers/${encodeURIComponent(selectedProviderName)}/models`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: model.id,
            displayName: model.name,
            capabilities: model.capabilities || { chat: true },
            config: {
              // Use provider-reported values when available, fall back to defaults
              maxOutputTokens: model.maxOutputTokens || model.maxTokens || addConfig.maxOutputTokens,
              contextWindow: model.contextWindow || undefined,
              temperature: addConfig.temperature,
              topP: addConfig.topP,
              rateLimitRequestsPerHour: addConfig.rateLimitRequestsPerHour,
              enabled: true,
              roles: addConfig.roles,
            },
          }),
        }
      );
      if (res.status === 409) {
        // Model already in registry — show info toast, mark as added locally
        showToast('info', `${model.name} is already in the registry`);
        setAddedIds(prev => new Set(prev).add(model.id));
        setExpandedModelId(null);
        return;
      }
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      showToast('success', `${model.name} added to platform`);
      setAddedIds(prev => new Set(prev).add(model.id));
      setExpandedModelId(null);
      // Invalidate cache so the list refreshes and shows the model as "already added"
      setCache(prev => { const n = { ...prev }; delete n[selectedProviderName]; return n; });
      emitModelsChanged('add');
      onModelAdded();
    } catch (err: any) {
      showToast('error', `Failed to add ${model.name}: ${err.message}`);
    } finally {
      setAddingModelId(null);
    }
  }, [selectedProviderName, addConfig, onModelAdded, showToast]);

  return (
    <>
      <AdminToast toast={toast} onDismiss={dismissToast} />
      <SlideInPanel
        isOpen={isOpen}
        onClose={onClose}
        title="Add Model to Platform"
        subtitle={selectedProvider ? `${selectedProvider.display_name} — ${filteredModels.length} models` : 'Select a provider'}
        width="lg"
      >
        <div className="space-y-4">
          {/* Provider selector */}
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Provider</label>
            <div className="flex items-center gap-3">
              <select
                value={selectedProviderName}
                onChange={e => setSelectedProviderName(e.target.value)}
                className="flex-1 px-3 py-2 text-xs rounded-input-sm border outline-none transition-[border-color,box-shadow] duration-200 ease-emphasized focus:shadow-focus-ring"
                style={{ background: 'var(--surface-1)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
              >
                {enabledProviders.map(p => {
                  const autoSync = isAutoSyncProvider(p.provider_type);
                  const suffix = autoSync ? ' — auto-synced from provider' : '';
                  return (
                    <option
                      key={p.id}
                      value={p.name}
                      disabled={autoSync}
                      title={autoSync ? 'Auto-synced from provider — no manual Add Model needed. Ollama models come from `ollama pull` on the host; AIF models come from deployments in the Azure portal.' : undefined}
                    >
                      {p.display_name} ({p.provider_type}){suffix}
                    </option>
                  );
                })}
              </select>
              <AdminButton
                size="sm"
                icon={<RefreshCw size={12} className={loading ? 'animate-spin' : ''} />}
                onClick={() => fetchModels(selectedProviderName, false)}
                disabled={loading}
              >
                Refresh
              </AdminButton>
            </div>
          </div>

          {/* Search + filters */}
          <div className="space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${discoveredModels.length} models...`}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-input-sm border outline-none transition-[border-color,box-shadow] duration-200 ease-emphasized focus:shadow-focus-ring"
                style={{ background: 'var(--surface-1)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setCapFilter(null)}
                className="px-3 py-1 text-xs font-medium rounded-pill transition-[background,transform] duration-200 ease-emphasized active:scale-[0.98]"
                style={{
                  background: !capFilter ? 'var(--ap-accent)' : 'transparent',
                  color: !capFilter ? 'white' : 'var(--text-muted)',
                  border: !capFilter ? 'none' : '1px solid var(--color-border)',
                }}
              >All</button>
              {CAPABILITY_FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setCapFilter(capFilter === f.key ? null : f.key)}
                  className="px-3 py-1 text-xs font-medium rounded-pill transition-[background,transform] duration-200 ease-emphasized active:scale-[0.98]"
                  style={{
                    background: capFilter === f.key ? 'var(--ap-accent)' : 'transparent',
                    color: capFilter === f.key ? 'white' : 'var(--text-muted)',
                    border: capFilter === f.key ? 'none' : '1px solid var(--color-border)',
                  }}
                >{f.label}</button>
              ))}
              <div className="ml-auto">
                <select
                  value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                  className="px-2 py-1 text-xs rounded border"
                  style={{ background: 'var(--color-surface)', color: 'var(--text-primary)', borderColor: 'var(--color-border)' }}
                >
                  <option value="name">Sort: Name</option>
                  <option value="context">Sort: Context Window</option>
                  <option value="output">Sort: Max Output</option>
                  <option value="tier">Sort: Cost Tier</option>
                  <option value="cap-chat">Sort: Chat</option>
                  <option value="cap-vision">Sort: Vision</option>
                  <option value="cap-tools">Sort: Tools</option>
                  <option value="cap-thinking">Sort: Thinking</option>
                  <option value="cap-embeddings">Sort: Embeddings</option>
                  <option value="cap-imageGeneration">Sort: Image Gen</option>
                  <option value="cap-streaming">Sort: Streaming</option>
                </select>
              </div>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={20} className="animate-spin" style={{ color: selectedProvider ? getProviderColor(selectedProvider.provider_type) : 'var(--ap-accent)' }} />
              <span className="ml-3 text-xs" style={{ color: 'var(--text-muted)' }}>Discovering models...</span>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="p-4 rounded-xl border border-[color-mix(in_srgb,var(--color-err)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-err)_5%,transparent)]">
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-error)' }}>
                <XCircle size={14} />
                <span>{error}</span>
              </div>
              <AdminButton size="sm" className="mt-2" onClick={() => fetchModels(selectedProviderName, false)}>
                Retry
              </AdminButton>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && discoveredModels.length === 0 && selectedProviderName && (
            <div className="text-center py-12 text-xs" style={{ color: 'var(--text-muted)' }}>
              No models found for this provider. Check credentials or try refreshing.
            </div>
          )}

          {/* Model list */}
          {!loading && filteredModels.length > 0 && (
            <div className="rounded-xl border overflow-hidden max-h-[500px] overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
              {filteredModels.map((model, i) => {
                const isAdded = existingModelNames.has(model.id);
                const isExpanded = expandedModelId === model.id;
                const costTierKey = model.costTier || (model.tier ? (model.tier === 'economy' ? 'low' : model.tier === 'balanced' ? 'mid' : 'high') : undefined);
                const costTierColor = costTierKey ? COST_TIER_COLORS[costTierKey] || TIER_COLORS[model.tier || 'balanced'] : null;
                return (
                  <div key={model.id} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--color-border)' }}>
                    {/* Model row */}
                    <div className="flex items-center justify-between px-4 py-3 hover:bg-[color-mix(in_srgb,var(--color-fg)_2%,transparent)] transition-colors">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="flex-shrink-0">
                          {selectedProvider && getProviderIcon(selectedProvider.provider_type)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{model.id}</code>
                            {costTierKey && costTierColor && (
                              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium border ${costTierColor.bg} ${costTierColor.text} ${costTierColor.border}`}>
                                {costTierKey}
                              </span>
                            )}
                            {isAdded && (
                              <AdminBadge color="var(--color-success)" label="Added" icon={<Check size={10} />} size="sm" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {model.providerName && (
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{model.providerName}</span>
                            )}
                            {model.contextWindow ? (
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {(model.contextWindow / 1000).toFixed(0)}K ctx
                              </span>
                            ) : null}
                            {(model.maxOutputTokens || model.maxTokens) ? (
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {((model.maxOutputTokens || model.maxTokens || 0) / 1000).toFixed(0)}K out
                              </span>
                            ) : null}
                            {model.capabilities && (
                              <span className="flex gap-0.5">
                                {CAPABILITY_BADGES.filter(b => model.capabilities?.[b.key]).map(b => (
                                  <span key={b.key} title={b.label} className="inline-flex items-center justify-center w-4 h-4 rounded"
                                    style={{ backgroundColor: `color-mix(in srgb, ${b.color} 15%, transparent)`, color: b.color }}>
                                    <b.icon size={9} />
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                          {model.description && (
                            <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{model.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 ml-3">
                        {!isAdded ? (
                          <AdminButton
                            size="sm"
                            variant={isExpanded ? 'primary' : 'secondary'}
                            icon={isExpanded ? <ChevronDown size={11} /> : <Plus size={11} />}
                            onClick={() => isExpanded ? setExpandedModelId(null) : openConfig(model)}
                          >
                            {isExpanded ? 'Configure' : 'Add'}
                          </AdminButton>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }}>
                            In Registry
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Inline config form */}
                    {isExpanded && !isAdded && (
                      <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <Sliders size={13} style={{ color: 'var(--ap-accent)' }} />
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Configure before adding</span>
                        </div>
                        {/* Provider-reported specs (read-only) */}
                        {(model.contextWindow || model.capabilities) ? (
                          <div className="mb-3 p-2.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                            <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Provider-reported specs</div>
                            <div className="flex flex-wrap gap-2">
                              {model.contextWindow ? (
                                <span className="px-2 py-0.5 text-xs font-mono rounded" style={{ background: 'var(--ap-accent-dim, color-mix(in srgb, var(--color-nfo) 10%, transparent))', color: 'var(--ap-accent)' }}>
                                  {(model.contextWindow / 1000).toFixed(0)}K context
                                </span>
                              ) : null}
                              {(model.maxOutputTokens || model.maxTokens) ? (
                                <span className="px-2 py-0.5 text-xs font-mono rounded" style={{ background: 'var(--ap-accent-dim, color-mix(in srgb, var(--color-nfo) 10%, transparent))', color: 'var(--ap-accent)' }}>
                                  {((model.maxOutputTokens || model.maxTokens || 0) / 1000).toFixed(0)}K max output
                                </span>
                              ) : null}
                              {model.capabilities && CAPABILITY_BADGES.filter(b => model.capabilities?.[b.key]).map(b => (
                                <span key={b.key} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded"
                                  style={{ backgroundColor: `color-mix(in srgb, ${b.color} 15%, transparent)`, color: b.color }}>
                                  <b.icon size={10} /> {b.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Max Output Tokens</label>
                            <input type="number" min={1} max={200000} value={addConfig.maxOutputTokens}
                              onChange={e => setAddConfig(c => ({ ...c, maxOutputTokens: Number(e.target.value) }))}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }} />
                          </div>
                          <div>
                            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Rate Limit (req/hr, 0=none)</label>
                            <input type="number" min={0} value={addConfig.rateLimitRequestsPerHour}
                              onChange={e => setAddConfig(c => ({ ...c, rateLimitRequestsPerHour: Number(e.target.value) }))}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }} />
                          </div>
                          <div>
                            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                              Temperature: {addConfig.temperature.toFixed(1)}
                            </label>
                            <input type="range" min={0} max={2} step={0.1} value={addConfig.temperature}
                              onChange={e => setAddConfig(c => ({ ...c, temperature: Number(e.target.value) }))}
                              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                              style={{ accentColor: selectedProvider ? getProviderColor(selectedProvider.provider_type) : 'var(--ap-accent)' }} />
                          </div>
                          <div>
                            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                              Top P: {addConfig.topP.toFixed(1)}
                            </label>
                            <input type="range" min={0} max={1} step={0.1} value={addConfig.topP}
                              onChange={e => setAddConfig(c => ({ ...c, topP: Number(e.target.value) }))}
                              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                              style={{ accentColor: selectedProvider ? getProviderColor(selectedProvider.provider_type) : 'var(--ap-accent)' }} />
                          </div>
                        </div>
                        {/* Roles */}
                        <div className="mt-3">
                          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Roles</label>
                          <div className="flex flex-wrap gap-1.5">
                            {MODEL_ROLES.map(role => {
                              const active = addConfig.roles.includes(role);
                              return (
                                <button key={role}
                                  onClick={() => setAddConfig(c => ({
                                    ...c,
                                    roles: active ? c.roles.filter(r => r !== role) : [...c.roles, role],
                                  }))}
                                  className="px-2.5 py-1 text-xs font-medium rounded-lg border transition-all"
                                  style={{
                                    background: active ? 'var(--ap-accent)' : 'transparent',
                                    borderColor: active ? 'var(--ap-accent)' : 'var(--color-border)',
                                    color: active ? 'white' : 'var(--text-muted)',
                                  }}
                                >{role}</button>
                              );
                            })}
                          </div>
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                          <AdminButton
                            variant="primary"
                            size="sm"
                            loading={addingModelId === model.id}
                            icon={<Plus size={12} />}
                            onClick={() => handleAdd(model)}
                          >
                            Add to Platform
                          </AdminButton>
                          <AdminButton size="sm" onClick={() => setExpandedModelId(null)}>
                            Cancel
                          </AdminButton>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SlideInPanel>

      {/* Anthropic-on-AIF blocked modal — explains why Claude models on AIF
          can't be added from OpenAgentic and must go through Azure portal. */}
      {aifBlocked && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'color-mix(in srgb, var(--color-shadow) 70%, transparent)', backdropFilter: 'blur(4px)' }}
          role="button"
          tabIndex={0}
          aria-label="Close"
          onClick={() => setAifBlocked(false)}
          onKeyDown={onKeyActivate(() => setAifBlocked(false))}
        >
          <div
            className="max-w-lg w-full rounded-panel shadow-soft-lg"
            style={{ background: 'var(--surface-2)' }}
            role="presentation"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
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
                  Anthropic models on Azure AI Foundry can't be added here
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
            </div>
            <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={() => setAifBlocked(false)}
                className="px-5 py-2 text-xs font-medium rounded-pill transition-[background,transform] duration-200 ease-emphasized active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-focus-ring"
                style={{ background: 'var(--ap-accent)', color: 'var(--color-on-accent)' }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AddModelDialog;
