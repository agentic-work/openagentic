/**
 * Model Garden Tab — Live discovery from provider APIs with config panel for adding
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Search, RefreshCw, ChevronDown, Plus, Check,
  X as XIcon, Sparkles, Sliders,
} from '@/shared/icons';
import { CheckCircle, XCircle } from '../../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';
import { getProviderIcon, getProviderColor } from '../../Shared/ProviderIcons';
import { AdminToast, useAdminToast } from '../../Shared/AdminToast';
import {
  ModelInfo, ModelConfig, DiscoveredModel, DbProvider,
  CAPABILITY_BADGES, MODEL_ROLES,
} from './constants';

interface AddModelConfig {
  modelId: string;
  displayName: string;
  capabilities: Record<string, boolean>;
  config: ModelConfig;
}

export const ModelGardenTab: React.FC<{
  providers: DbProvider[];
  existingModels: ModelInfo[];
  onModelAdded: () => void;
}> = ({ providers, existingModels, onModelAdded }) => {
  const [selectedProviderName, setSelectedProviderName] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [addingModel, setAddingModel] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useAdminToast();
  const [showConfigured, setShowConfigured] = useState<'all' | 'configured' | 'available'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'provider' | 'capabilities' | 'context' | 'output' | 'tier' | 'cap-chat' | 'cap-vision' | 'cap-tools' | 'cap-thinking' | 'cap-embeddings' | 'cap-imageGeneration' | 'cap-streaming'>('name');
  // Pull state (Ollama)
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<string>('');
  // Config panel state
  const [configPanelModel, setConfigPanelModel] = useState<DiscoveredModel | null>(null);
  const [addConfig, setAddConfig] = useState<AddModelConfig>({
    modelId: '',
    displayName: '',
    capabilities: { chat: true, vision: false, tools: true, embeddings: false, streaming: true, imageGeneration: false },
    config: {
      maxOutputTokens: 8192,
      maxInputTokens: 128000,
      rateLimitRequestsPerHour: 0,
      rateLimitTokensPerHour: 0,
      temperature: 1.0,
      topP: 1.0,
      enabled: true,
      roles: ['chat'],
    },
  });

  // Resolve selectedProvider from providers list by name (survives refresh)
  const selectedProvider = useMemo(
    () => providers.find(p => p.name === selectedProviderName) || null,
    [providers, selectedProviderName],
  );

  // Build set of configured model names for the selected provider from its model_config
  const configuredModelNames = useMemo(() => {
    if (!selectedProvider) return new Set<string>();
    const mc = selectedProvider.model_config || {};
    const pc = selectedProvider.provider_config || {};
    const names = new Set<string>();
    const fields = ['chatModel', 'defaultModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel'];
    for (const f of fields) {
      if (mc[f]) names.add(mc[f]);
    }
    if (pc.modelId) names.add(pc.modelId);
    if (pc.models && Array.isArray(pc.models)) {
      for (const m of pc.models) {
        const mId = m.id || m.name;
        if (mId) names.add(mId);
      }
    }
    return names;
  }, [selectedProvider]);

  // Also track registry-level model names across all providers
  const existingModelNames = useMemo(() => new Set(existingModels.map(m => m.name)), [existingModels]);

  // (#68) Reconciliation: discoveredModelIds is what the upstream provider
  // currently exposes; configured/existing is what we have in our registry.
  // Combine these to detect NEW (in upstream, not in registry) and STALE
  // (in registry, not in upstream) for the currently-selected provider.
  const discoveredModelIds = useMemo(
    () => new Set(discoveredModels.map(m => m.id)),
    [discoveredModels]
  );

  // STALE = models that exist in selectedProvider's model_config or
  // provider_config.models[] but are NOT returned by current discovery.
  // These were probably removed in the provider's own console (Azure portal,
  // AWS console, etc.) and the registry is now out of sync.
  // Note: only computed when discovery has actually run (discoveredModels.length > 0)
  // to avoid false-positive STALE on first mount before discovery completes.
  const staleModels = useMemo(() => {
    if (!selectedProvider || discoveredModels.length === 0) return [];
    const result: Array<{ id: string; source: 'model_config' | 'provider_config' }> = [];
    const seen = new Set<string>();
    const mc = selectedProvider.model_config || {};
    const pc = selectedProvider.provider_config || {};
    const fields = ['chatModel', 'defaultModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel'];
    for (const f of fields) {
      const v = mc[f];
      if (v && !discoveredModelIds.has(v) && !seen.has(v)) {
        seen.add(v);
        result.push({ id: v, source: 'model_config' });
      }
    }
    if (Array.isArray(pc.models)) {
      for (const m of pc.models) {
        const mId = m.id || m.name;
        if (mId && !discoveredModelIds.has(mId) && !seen.has(mId)) {
          seen.add(mId);
          result.push({ id: mId, source: 'provider_config' });
        }
      }
    }
    return result;
  }, [selectedProvider, discoveredModels.length, discoveredModelIds]);

  // NEW = models in upstream discovery that aren't yet configured in this provider.
  const newModels = useMemo(
    () => discoveredModels.filter(m => !configuredModelNames.has(m.id)),
    [discoveredModels, configuredModelNames]
  );

  // Bulk action state — handlers are declared AFTER discoverModels (below).
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkRemoving, setBulkRemoving] = useState(false);

  const discoverModels = useCallback(async (provider: DbProvider) => {
    setSelectedProviderName(provider.name);
    setDiscovering(true);
    setDiscoverError(null);
    setDiscoveredModels([]);
    setConfigPanelModel(null);
    try {
      const res = await apiRequest(`/admin/llm-providers/${encodeURIComponent(provider.name)}/discover-models`);
      const data = await res.json();
      const models = (data?.modelDetails || []).map((m: any) => ({
        id: m.id || m.name || m,
        name: m.name || m.id || m,
        provider: provider.name,
        description: m.description,
        configured: m.configured !== false,
        capabilities: m.capabilities,
        maxTokens: m.maxTokens,
        maxOutputTokens: m.maxOutputTokens,
        contextWindow: m.contextWindow,
        costTier: m.costTier,
        family: m.family,
        pullRequired: m.pullRequired,
        deployed: m.deployed,
        modelFormat: m.modelFormat,
        modelVersion: m.modelVersion,
      }));
      setDiscoveredModels(models);
    } catch (err: any) {
      setDiscoverError(err.message || 'Failed to discover models');
    } finally {
      setDiscovering(false);
    }
  }, []);

  const refreshAfterChange = useCallback(async () => {
    onModelAdded();
    // Re-discover to update configured badges
    if (selectedProvider) {
      // Small delay to let backend propagate
      setTimeout(() => discoverModels(selectedProvider), 500);
    }
  }, [onModelAdded, selectedProvider, discoverModels]);

  // (#68) Bulk add all NEW models — declared after discoverModels so it can
  // close over it. Uses each discovered model's SDK-provided capabilities +
  // context/output limits as defaults.
  const handleBulkAddNew = useCallback(async () => {
    if (!selectedProvider || newModels.length === 0 || bulkAdding) return;
    setBulkAdding(true);
    let added = 0;
    let failed = 0;
    for (const model of newModels) {
      try {
        const res = await apiRequest(
          `/admin/llm-providers/${encodeURIComponent(selectedProvider.name)}/models`,
          {
            method: 'POST',
            body: JSON.stringify({
              modelId: model.id,
              displayName: model.name || model.id,
              capabilities: model.capabilities || { chat: true, streaming: true },
              config: {
                enabled: true,
                roles: model.capabilities?.embeddings ? ['embeddings'] : ['chat'],
                temperature: 0.7,
                topP: 1.0,
                maxInputTokens: model.contextWindow ?? 128000,
                maxOutputTokens: model.maxOutputTokens ?? 4096,
                rateLimitRequestsPerHour: 0,
                rateLimitTokensPerHour: 0,
              },
            }),
          }
        );
        if (res.ok) added++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBulkAdding(false);
    showToast(
      failed > 0 ? 'error' : 'success',
      `Added ${added}/${newModels.length} new model${added === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}`
    );
    onModelAdded();
    if (selectedProvider) discoverModels(selectedProvider);
  }, [selectedProvider, newModels, bulkAdding, showToast, onModelAdded, discoverModels]);

  // (#68) Bulk remove all STALE models — uses the existing single-model delete endpoint.
  const handleBulkRemoveStale = useCallback(async () => {
    if (!selectedProvider || staleModels.length === 0 || bulkRemoving) return;
    if (!window.confirm(`Remove ${staleModels.length} stale model${staleModels.length === 1 ? '' : 's'} from "${selectedProvider.display_name}"? They were removed in the provider's console and are no longer available upstream.`)) {
      return;
    }
    setBulkRemoving(true);
    let removed = 0;
    let failed = 0;
    for (const stale of staleModels) {
      try {
        const res = await apiRequest(
          `/admin/llm-providers/${encodeURIComponent(selectedProvider.name)}/models/${encodeURIComponent(stale.id)}`,
          { method: 'DELETE' }
        );
        if (res.ok) removed++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBulkRemoving(false);
    showToast(
      failed > 0 ? 'error' : 'success',
      `Removed ${removed}/${staleModels.length} stale model${removed === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}`
    );
    onModelAdded();
    if (selectedProvider) discoverModels(selectedProvider);
  }, [selectedProvider, staleModels, bulkRemoving, showToast, onModelAdded, discoverModels]);

  const openConfigPanel = useCallback((model: DiscoveredModel) => {
    setConfigPanelModel(model);
    const isEmbedding = model.id.toLowerCase().includes('embed');
    const isImageGen = model.id.toLowerCase().includes('imagen') || model.id.toLowerCase().includes('nova-canvas') || model.id.toLowerCase().includes('dall-e');
    setAddConfig({
      modelId: model.id,
      displayName: model.name || model.id,
      capabilities: {
        chat: model.capabilities?.chat ?? !isEmbedding,
        vision: model.capabilities?.vision ?? false,
        tools: model.capabilities?.tools ?? !isEmbedding,
        embeddings: model.capabilities?.embeddings ?? isEmbedding,
        streaming: model.capabilities?.streaming ?? true,
        imageGeneration: model.capabilities?.imageGeneration ?? isImageGen,
      },
      config: {
        maxOutputTokens: model.maxOutputTokens || model.maxTokens || 8192,
        maxInputTokens: model.contextWindow || 128000,
        rateLimitRequestsPerHour: 0,
        rateLimitTokensPerHour: 0,
        temperature: 1.0,
        topP: 1.0,
        enabled: true,
        roles: isEmbedding ? ['embedding'] : isImageGen ? ['image-generation'] : ['chat'],
      },
    });
  }, []);

  const pullAndAddModel = useCallback(async (model: DiscoveredModel) => {
    if (!selectedProvider) return;
    setPullingModel(model.id);
    setPullProgress('Starting pull...');
    try {
      const res = await apiRequest(`/admin/llm-providers/${encodeURIComponent(selectedProvider.name)}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.id }),
      });

      if (!res.ok) throw new Error(await res.text());

      // Try to read streaming response
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let done = false;
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;
          if (value) {
            const text = decoder.decode(value, { stream: true });
            // Parse Ollama pull progress (JSON lines)
            const lines = text.split('\n').filter(l => l.trim());
            for (const line of lines) {
              try {
                const json = JSON.parse(line);
                if (json.status) {
                  const pct = json.completed && json.total
                    ? ` ${Math.round((json.completed / json.total) * 100)}%`
                    : '';
                  setPullProgress(`${json.status}${pct}`);
                }
              } catch { /* not JSON */ }
            }
          }
        }
      }

      setPullProgress('Pull complete! Adding model...');
      // Now open the config panel to add the model
      openConfigPanel(model);
      showToast('success', `Pulled ${model.id} successfully`);
    } catch (err: any) {
      showToast('error', `Pull failed: ${err.message}`);
    } finally {
      setPullingModel(null);
      setPullProgress('');
    }
  }, [selectedProvider, openConfigPanel, showToast]);

  const saveNewModel = useCallback(async () => {
    if (!selectedProvider || !addConfig.modelId) return;
    setAddingModel(addConfig.modelId);
    try {
      // For AIF providers with undeployed catalog models, create ARM deployment first
      const sourceModel = discoveredModels.find(m => m.id === addConfig.modelId);
      if (selectedProvider.provider_type === 'azure-ai-foundry' && sourceModel && (sourceModel as any).deployed === false) {
        const deployRes = await apiRequest(`/admin/llm-providers/${encodeURIComponent(selectedProvider.name)}/deploy-model`, {
          method: 'POST',
          body: JSON.stringify({
            modelName: addConfig.modelId,
            modelVersion: (sourceModel as any).modelVersion || '',
            modelFormat: (sourceModel as any).modelFormat || '',
            sku: 'GlobalStandard',
            capacity: 1,
          }),
        });
        if (!deployRes.ok) {
          const err = await deployRes.json().catch(() => ({}));
          throw new Error((err as any).error || (err as any).details || `Deploy failed: ${deployRes.status}`);
        }
        const deployData = await deployRes.json();
        showToast('success', (deployData as any).message || `Deployed ${addConfig.modelId}`);
      } else {
        // Non-AIF or already deployed: add to config. For AIF providers we also
        // ship the deployment metadata so the server can idempotently ensure
        // the Azure deployment exists (belt + suspenders for stale `.deployed`
        // flags that would otherwise skip the /deploy-model branch above).
        const aifDeployment =
          selectedProvider.provider_type === 'azure-ai-foundry' && sourceModel && (sourceModel as any).modelVersion
            ? {
                modelName: addConfig.modelId,
                modelVersion: (sourceModel as any).modelVersion,
                modelFormat: (sourceModel as any).modelFormat || 'OpenAI',
                sku: 'GlobalStandard',
                capacity: 1,
              }
            : undefined;
        const res = await apiRequest(`/admin/llm-providers/${encodeURIComponent(selectedProvider.name)}/models`, {
          method: 'POST',
          body: JSON.stringify({
            modelId: addConfig.modelId,
            displayName: addConfig.displayName,
            capabilities: addConfig.capabilities,
            config: addConfig.config,
            ...(aifDeployment ? { deployment: aifDeployment } : {}),
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('success', `Added ${addConfig.modelId}`);
      }
      setConfigPanelModel(null);
      refreshAfterChange();
    } catch (err: any) {
      showToast('error', `Failed: ${err.message}`);
    } finally {
      setAddingModel(null);
    }
  }, [selectedProvider, addConfig, discoveredModels, refreshAfterChange, showToast]);

  const filteredDiscovered = useMemo(() => {
    let list = [...discoveredModels];
    if (showConfigured === 'configured') list = list.filter(m => configuredModelNames.has(m.id));
    else if (showConfigured === 'available') list = list.filter(m => !configuredModelNames.has(m.id));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q));
    }
    // Sort
    const capCount = (m: DiscoveredModel) => Object.values(m.capabilities || {}).filter(Boolean).length;
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'provider') return (a.description || a.id).localeCompare(b.description || b.id);
      if (sortBy === 'capabilities') return capCount(b) - capCount(a);
      if (sortBy === 'context') return (b.contextWindow || 0) - (a.contextWindow || 0);
      if (sortBy === 'output') return (b.maxOutputTokens || b.maxTokens || 0) - (a.maxOutputTokens || a.maxTokens || 0);
      if (sortBy === 'tier') {
        const order: Record<string, number> = { premium: 0, high: 1, mid: 2, low: 3, free: 4 };
        return (order[a.costTier || 'mid'] ?? 2) - (order[b.costTier || 'mid'] ?? 2);
      }
      // Capability-specific sorts
      if (sortBy.startsWith('cap-')) {
        const capKey = sortBy.replace('cap-', '');
        const aHas = a.capabilities?.[capKey] ? 1 : 0;
        const bHas = b.capabilities?.[capKey] ? 1 : 0;
        if (bHas !== aHas) return bHas - aHas;
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
    // Always show configured first
    list.sort((a, b) => (configuredModelNames.has(b.id) ? 1 : 0) - (configuredModelNames.has(a.id) ? 1 : 0));
    return list;
  }, [discoveredModels, search, showConfigured, configuredModelNames, sortBy]);

  // (#68) Live discovery — always fresh when admin views the tab.
  //
  // Strategy:
  //   1. On mount: pick the first provider and discover.
  //   2. On provider change (dropdown): discover the newly-selected one.
  //   3. On window focus / tab visibility: re-discover the current selection
  //      (catches the case where admin made changes in the provider's own
  //      console — Azure portal, AWS console, etc. — and switches back here).
  //   4. Every 30 seconds while the tab is visible: poll discover so the
  //      view stays live without user interaction.
  //
  // The /admin/llm-providers/<name>/discover-models endpoint hits the
  // provider's SDK directly and bypasses the in-memory ProviderManager
  // cache, so each call returns whatever the upstream API says right now.
  useEffect(() => {
    // (1) initial auto-pick
    if (providers.length > 0 && !selectedProviderName) {
      discoverModels(providers[0]);
    }
  }, [providers, selectedProviderName, discoverModels]);

  // (3) re-discover on focus/visibility change
  useEffect(() => {
    if (!selectedProvider) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        discoverModels(selectedProvider);
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [selectedProvider, discoverModels]);

  // (4) periodic poll while visible — 30s interval
  useEffect(() => {
    if (!selectedProvider) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        discoverModels(selectedProvider);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [selectedProvider, discoverModels]);

  return (
    <div className="space-y-5">
      {/* Toast */}
      <AdminToast toast={toast} onDismiss={dismissToast} />

      {/* Provider selector dropdown */}
      <div>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
          Discover models from a provider
        </h3>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <select
              value={selectedProviderName || ''}
              onChange={e => {
                const prov = providers.find(p => p.name === e.target.value);
                if (prov) discoverModels(prov);
              }}
              className="w-full px-3 py-2.5 text-xs rounded-lg border outline-none appearance-none pr-8"
              style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
            >
              <option value="" disabled>Select a provider...</option>
              {providers.map(p => (
                <option key={p.id} value={p.name}>
                  {p.display_name || p.name} ({p.provider_type})
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          </div>
          {selectedProvider && (
            <div className="flex items-center gap-2">
              <span className="flex-shrink-0">{getProviderIcon(selectedProvider.provider_type)}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {selectedProvider.display_name || selectedProvider.name}
              </span>
              <CheckCircle size={14} className="text-emerald-400" />
            </div>
          )}
        </div>
      </div>

      {/* Model list + config panel side by side */}
      {selectedProvider && (
        <div className="flex gap-4">
          {/* Left: discovered models list */}
          <div className={`space-y-3 ${configPanelModel ? 'flex-1 min-w-0' : 'w-full'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Model Catalog
                {discoveredModels.length > 0 && (
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    {filteredDiscovered.length} of {discoveredModels.length} models
                    {' '}({discoveredModels.filter(m => configuredModelNames.has(m.id)).length} configured)
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                {/* Sort */}
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="px-2 py-1 text-xs rounded border"
                  style={{ background: 'var(--color-surface)', color: 'var(--text-primary)', borderColor: 'var(--color-border)' }}
                >
                  <option value="name">Sort: Name</option>
                  <option value="context">Sort: Context Window</option>
                  <option value="output">Sort: Max Output</option>
                  <option value="tier">Sort: Cost Tier</option>
                  <option value="capabilities">Sort: Capabilities</option>
                  <option value="cap-chat">Sort: Chat</option>
                  <option value="cap-vision">Sort: Vision</option>
                  <option value="cap-tools">Sort: Tools</option>
                  <option value="cap-thinking">Sort: Thinking</option>
                  <option value="cap-embeddings">Sort: Embeddings</option>
                  <option value="cap-imageGeneration">Sort: Image Gen</option>
                  <option value="cap-streaming">Sort: Streaming</option>
                  <option value="provider">Sort: Provider</option>
                </select>
                {/* Filter: configured / available / all */}
                <div className="flex gap-0.5 p-0.5 rounded-md" style={{ background: 'var(--color-surface)' }}>
                  {([['all', 'All'], ['configured', 'Active'], ['available', 'Available']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setShowConfigured(val)}
                      className="px-2 py-1 text-xs font-medium rounded transition-all"
                      style={{
                        background: showConfigured === val ? 'var(--ap-accent)' : 'transparent',
                        color: showConfigured === val ? 'white' : 'var(--text-muted)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => discoverModels(selectedProvider)}
                  disabled={discovering}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--text-primary)', background: 'var(--color-surfaceSecondary)' }}
                >
                  <RefreshCw size={11} className={discovering ? 'animate-spin' : ''} />
                  {discovering ? 'Discovering...' : 'Refresh'}
                </button>
              </div>
            </div>

            {discovering && (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-3">
                  <RefreshCw size={20} className="animate-spin" style={{ color: getProviderColor(selectedProvider.provider_type) }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Querying {selectedProvider.display_name || selectedProvider.name} API...
                  </span>
                </div>
              </div>
            )}

            {discoverError && (
              <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5">
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <XCircle size={14} />
                  <span>{discoverError}</span>
                </div>
              </div>
            )}

            {!discovering && discoveredModels.length > 0 && (
              <>
                {/* (#68 reverted) Sync/reconciliation UI removed — Model Garden is
                    a LIVE view of what each provider's SDK currently exposes.
                    No registry curation step, no NEW/STALE concept. Models you
                    add or remove in the provider's own console (AIF, Bedrock,
                    etc.) appear here automatically on next refresh (auto every
                    30s, on focus, and on tab open). */}

                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={`Search ${discoveredModels.length} models...`}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border outline-none"
                    style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div className="rounded-xl border overflow-hidden max-h-[600px] overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
                  {filteredDiscovered.map((model, i) => {
                    const isConfigured = configuredModelNames.has(model.id);
                    const isAlreadyInRegistry = existingModelNames.has(model.id);
                    const isSelected = configPanelModel?.id === model.id;
                    return (
                      <div
                        key={model.id}
                        className={`flex items-center justify-between px-4 py-3 transition-colors ${i > 0 ? 'border-t' : ''} ${
                          isSelected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                        }`}
                        style={{
                          borderColor: 'var(--color-border)',
                          ...(isSelected ? { borderLeft: `3px solid ${getProviderColor(selectedProvider.provider_type)}` } : {}),
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="flex-shrink-0">{getProviderIcon(selectedProvider.provider_type)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="font-mono text-xs truncate" style={{ color: 'var(--text-primary)' }}>{model.id}</code>
                              {model.name && model.name !== model.id && (
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{model.name}</span>
                              )}
                              {isConfigured && (
                                <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                  <Check size={8} /> Configured
                                </span>
                              )}
                            </div>
                            {/* Capability badges + metadata */}
                            {model.capabilities && (
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {model.costTier && (
                                  <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                                    style={{
                                      backgroundColor: model.costTier === 'premium' ? 'rgba(168,85,247,0.1)' :
                                        model.costTier === 'high' ? 'rgba(245,158,11,0.1)' :
                                        model.costTier === 'low' || model.costTier === 'free' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)',
                                      color: model.costTier === 'premium' ? 'var(--ap-accent)' :
                                        model.costTier === 'high' ? 'var(--ap-warn)' :
                                        model.costTier === 'low' || model.costTier === 'free' ? 'var(--ap-ok)' : 'var(--ap-accent)',
                                    }}>
                                    {model.costTier}
                                  </span>
                                )}
                                {CAPABILITY_BADGES.map(({ key, label, icon: Icon, color }) => {
                                  const active = model.capabilities?.[key];
                                  if (!active) return null;
                                  return (
                                    <span key={key} title={label}
                                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs"
                                      style={{ backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`, color }}>
                                      <Icon size={9} /> {label}
                                    </span>
                                  );
                                })}
                                {model.contextWindow && (
                                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--text-muted)' }}>
                                    {(model.contextWindow / 1000).toFixed(0)}K ctx
                                  </span>
                                )}
                                {(model.maxOutputTokens || model.maxTokens) && (
                                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--text-muted)' }}>
                                    {((model.maxOutputTokens || model.maxTokens || 0) / 1000).toFixed(0)}K out
                                  </span>
                                )}
                              </div>
                            )}
                            {model.description && (
                              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{model.description}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          {!isConfigured ? (
                            model.pullRequired && selectedProvider.provider_type === 'ollama' ? (
                              <button
                                onClick={() => pullingModel === model.id ? undefined : pullAndAddModel(model)}
                                disabled={!!pullingModel}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                                style={{
                                  background: pullingModel === model.id
                                    ? `color-mix(in srgb, ${getProviderColor(selectedProvider.provider_type)} 15%, transparent)`
                                    : `color-mix(in srgb, ${getProviderColor(selectedProvider.provider_type)} 8%, transparent)`,
                                  color: getProviderColor(selectedProvider.provider_type),
                                }}
                              >
                                {pullingModel === model.id ? (
                                  <>
                                    <RefreshCw size={11} className="animate-spin" />
                                    <span className="max-w-[120px] truncate">{pullProgress || 'Pulling...'}</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus size={11} />
                                    Pull & Add
                                  </>
                                )}
                              </button>
                            ) : (model as any).deployed === false && selectedProvider.provider_type === 'azure-ai-foundry' ? (
                              /* AIF catalog model — needs ARM deployment first */
                              <button
                                onClick={async () => {
                                  setAddingModel(model.id);
                                  try {
                                    const res = await apiRequest(
                                      `/admin/llm-providers/${encodeURIComponent(selectedProvider.name)}/deploy-model`,
                                      {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          modelName: model.id,
                                          modelVersion: (model as any).modelVersion || '',
                                          modelFormat: (model as any).modelFormat || '',
                                          sku: 'GlobalStandard',
                                          capacity: 1,
                                        }),
                                      }
                                    );
                                    if (res.ok) {
                                      const data = await res.json();
                                      showToast('success', data.message || `Deployed ${model.id}`);
                                      refreshAfterChange();
                                    } else {
                                      const err = await res.json().catch(() => ({}));
                                      showToast('error', err.error || `Deploy failed: ${res.status}`);
                                    }
                                  } catch (e: any) {
                                    showToast('error', e.message);
                                  } finally {
                                    setAddingModel(null);
                                  }
                                }}
                                disabled={addingModel === model.id}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                                style={{
                                  background: `color-mix(in srgb, ${getProviderColor(selectedProvider.provider_type)} 8%, transparent)`,
                                  color: getProviderColor(selectedProvider.provider_type),
                                }}
                              >
                                {addingModel === model.id ? (
                                  <><RefreshCw size={11} className="animate-spin" /> Deploying...</>
                                ) : (
                                  <><Plus size={11} /> Deploy</>
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={() => openConfigPanel(model)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                                style={{
                                  background: isSelected ? getProviderColor(selectedProvider.provider_type) : `color-mix(in srgb, ${getProviderColor(selectedProvider.provider_type)} 8%, transparent)`,
                                  color: isSelected ? 'white' : getProviderColor(selectedProvider.provider_type),
                                }}
                              >
                                <Plus size={11} />
                                Add Model
                              </button>
                            )
                          ) : (
                            <span className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }}>
                              Configured
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {!discovering && !discoverError && discoveredModels.length === 0 && selectedProvider && (
              <div className="text-center py-12 text-xs" style={{ color: 'var(--text-muted)' }}>
                Click "Refresh" to discover available models from the provider API.
              </div>
            )}
          </div>

          {/* Right: config panel (slide-in) */}
          {configPanelModel && (
            <div className="w-[380px] flex-shrink-0">
              <div className="rounded-xl border overflow-hidden sticky top-0" style={{ borderColor: getProviderColor(selectedProvider.provider_type) + '40', background: 'var(--color-surfaceSecondary)' }}>
                {/* Header */}
                <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)', background: `color-mix(in srgb, ${getProviderColor(selectedProvider.provider_type)} 3%, transparent)` }}>
                  <div className="flex items-center gap-2">
                    <Sliders size={14} style={{ color: getProviderColor(selectedProvider.provider_type) }} />
                    <h4 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Add Model</h4>
                  </div>
                  <button onClick={() => setConfigPanelModel(null)} className="p-1 rounded hover:bg-white/10 transition-colors">
                    <XIcon size={14} style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>

                <div className="p-4 space-y-4 max-h-[580px] overflow-y-auto">
                  {/* Model ID (read-only) */}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Model ID</label>
                    <div className="px-2.5 py-1.5 text-xs font-mono rounded-lg border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)', opacity: 0.8 }}>
                      {addConfig.modelId}
                    </div>
                  </div>

                  {/* Display Name */}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Display Name</label>
                    <input
                      type="text"
                      value={addConfig.displayName}
                      onChange={e => setAddConfig(c => ({ ...c, displayName: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                    />
                  </div>

                  {/* Max Output Tokens */}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                      Max Output Tokens: {addConfig.config.maxOutputTokens?.toLocaleString()}
                    </label>
                    <input
                      type="range" min={256} max={200000} step={256}
                      value={addConfig.config.maxOutputTokens || 8192}
                      onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, maxOutputTokens: Number(e.target.value) } }))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: getProviderColor(selectedProvider.provider_type) }}
                    />
                    <div className="flex justify-between text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      <span>256</span>
                      <input
                        type="number" min={256} max={200000}
                        value={addConfig.config.maxOutputTokens || 8192}
                        onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, maxOutputTokens: Number(e.target.value) } }))}
                        className="w-20 px-1 py-0.5 text-xs rounded border outline-none text-right font-mono"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>

                  {/* Max Input Tokens */}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                      Max Input Tokens (Context Window): {addConfig.config.maxInputTokens?.toLocaleString()}
                    </label>
                    <input
                      type="range" min={1024} max={2000000} step={1024}
                      value={addConfig.config.maxInputTokens || 128000}
                      onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, maxInputTokens: Number(e.target.value) } }))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: getProviderColor(selectedProvider.provider_type) }}
                    />
                    <div className="flex justify-between text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      <span>1K</span>
                      <input
                        type="number" min={1024} max={2000000}
                        value={addConfig.config.maxInputTokens || 128000}
                        onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, maxInputTokens: Number(e.target.value) } }))}
                        className="w-24 px-1 py-0.5 text-xs rounded border outline-none text-right font-mono"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>

                  {/* Rate Limits */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Req/hr (0=none)</label>
                      <input
                        type="number" min={0}
                        value={addConfig.config.rateLimitRequestsPerHour ?? 0}
                        onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, rateLimitRequestsPerHour: Number(e.target.value) } }))}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Tok/hr (0=none)</label>
                      <input
                        type="number" min={0}
                        value={addConfig.config.rateLimitTokensPerHour ?? 0}
                        onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, rateLimitTokensPerHour: Number(e.target.value) } }))}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>

                  {/* Temperature */}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                      Temperature: {(addConfig.config.temperature ?? 1.0).toFixed(1)}
                    </label>
                    <input
                      type="range" min={0} max={2} step={0.1}
                      value={addConfig.config.temperature ?? 1.0}
                      onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, temperature: Number(e.target.value) } }))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: getProviderColor(selectedProvider.provider_type) }}
                    />
                    <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>Precise</span><span>Creative</span>
                    </div>
                  </div>

                  {/* Top P */}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
                      Top P: {(addConfig.config.topP ?? 1.0).toFixed(1)}
                    </label>
                    <input
                      type="range" min={0} max={1} step={0.1}
                      value={addConfig.config.topP ?? 1.0}
                      onChange={e => setAddConfig(c => ({ ...c, config: { ...c.config, topP: Number(e.target.value) } }))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: getProviderColor(selectedProvider.provider_type) }}
                    />
                    <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>Narrow</span><span>Full</span>
                    </div>
                  </div>

                  {/* Enabled toggle */}
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Enabled</label>
                    <button
                      onClick={() => setAddConfig(c => ({ ...c, config: { ...c.config, enabled: !c.config.enabled } }))}
                      className={`relative w-10 h-5 rounded-full transition-colors ${addConfig.config.enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${addConfig.config.enabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {/* Capabilities */}
                  <div>
                    <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Capabilities</label>
                    <div className="flex flex-wrap gap-1.5">
                      {CAPABILITY_BADGES.map(({ key, label, icon: Icon, color }) => {
                        const active = addConfig.capabilities[key];
                        return (
                          <button
                            key={key}
                            onClick={() => setAddConfig(c => ({
                              ...c,
                              capabilities: { ...c.capabilities, [key]: !active },
                            }))}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-all"
                            style={{
                              background: active ? `color-mix(in srgb, ${color} 8%, transparent)` : 'transparent',
                              borderColor: active ? `color-mix(in srgb, ${color} 25%, transparent)` : 'var(--color-border)',
                              color: active ? color : 'var(--text-muted)',
                            }}
                          >
                            <Icon size={10} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Roles */}
                  <div>
                    <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Roles</label>
                    <div className="flex flex-wrap gap-1.5">
                      {MODEL_ROLES.map(role => {
                        const active = addConfig.config.roles?.includes(role);
                        return (
                          <button
                            key={role}
                            onClick={() => setAddConfig(c => ({
                              ...c,
                              config: {
                                ...c.config,
                                roles: active
                                  ? (c.config.roles || []).filter(r => r !== role)
                                  : [...(c.config.roles || []), role],
                              },
                            }))}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg border transition-all"
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

                  {/* Save button */}
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <button
                      onClick={saveNewModel}
                      disabled={addingModel === addConfig.modelId}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-all"
                      style={{ background: getProviderColor(selectedProvider.provider_type), color: 'white' }}
                    >
                      {addingModel === addConfig.modelId ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : (
                        <Plus size={12} />
                      )}
                      Add {addConfig.displayName || addConfig.modelId}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedProvider && (
        <div className="text-center py-12">
          <Sparkles size={32} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a provider above to browse and add models</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Models are discovered live from each provider's API/SDK
          </p>
        </div>
      )}
    </div>
  );
};
