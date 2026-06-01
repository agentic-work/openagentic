/**
 * Model Management View — Dynamic Model Discovery + Per-Model Configuration
 *
 * Three tabs:
 * 1. Registry — All configured models across providers with edit/delete/status
 * 2. Model Garden — Live discovery from provider APIs with config panel for adding
 * 3. Playground — Interactive model testing with chat
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Layers, Sparkles, Play } from '@/shared/icons';
import { XCircle } from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';
import { getProviderIcon } from '../Shared/ProviderIcons';
import { SoTBanner, PageHeader } from '../../primitives-v2';
import {
  ModelInfo, ModelConfig, DbProvider, ModelManagementViewProps, TabId, guessTier,
} from './ModelManagementView/constants';
import { RegistryTab } from './ModelManagementView/RegistryTab';
import { ModelGardenTab } from './ModelManagementView/ModelGardenTab';
import { PlaygroundTab } from './ModelManagementView/PlaygroundTab';
import { dedupeRegistryModels } from './ModelManagementView/dedupeRegistryModels';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const ModelManagementView: React.FC<ModelManagementViewProps> = ({ theme }) => {
  const [activeTab, setActiveTab] = useState<TabId>('registry');
  const [providers, setProviders] = useState<DbProvider[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest('/admin/llm-providers/database');
      const data = await res.json();
      const providerList: DbProvider[] = data?.providers || [];
      setProviders(providerList);

      // Task #5 (Registry SoT): primary source for the Models page is the
      // curated Registry (admin.model_role_assignments). Provider-create
      // auto-populates this table (task #2), the admin toggles rows via
      // PATCH /registry/:id (task #5 backend), and every reader — toolbar,
      // admin page, Smart Router — sees the same set. No more drift.
      //
      // If the Registry is empty (fresh bootstrap or migration gap), we
      // fall back to the legacy live-discovery path so the admin can still
      // see what's in the provider catalog and hit Add-Model.
      const registryRes = await apiRequest('/admin/llm-providers/registry?enabledOnly=false').catch(() => null);
      const registryRows: any[] = registryRes?.ok ? await registryRes.json() : [];

      const allModels: ModelInfo[] = [];

      if (registryRows.length > 0) {
        // Map each Registry row into the ModelInfo shape RegistryTab consumes.
        // We preserve the Registry row id as `id` so the Save/Toggle handlers
        // can PATCH /registry/:id by that key.
        const providerByName = new Map(providerList.map(p => [p.name, p]));
        for (const r of registryRows) {
          const p = providerByName.get(r.provider);
          const caps = (r.capabilities || {}) as Record<string, boolean>;
          allModels.push({
            id: r.id, // Registry row PK — used by toggle/save handlers
            name: r.model,
            provider: r.provider_display_name || p?.display_name || r.provider,
            providerId: p?.id || r.provider,
            providerType: p?.provider_type || '',
            providerName: r.provider,
            capabilities: {
              chat: !!caps.chat,
              embeddings: !!caps.embeddings,
              tools: !!caps.tools,
              vision: !!caps.vision,
              thinking: !!caps.thinking,
              imageGeneration: !!caps.imageGeneration,
              streaming: !!caps.streaming,
            },
            maxTokens: r.max_tokens || undefined,
            tier: guessTier(r.model),
            enabled: !!r.enabled,
            config: {
              maxOutputTokens: r.max_tokens,
              temperature: r.temperature ?? undefined,
              enabled: !!r.enabled,
              roles: [r.role || 'chat'],
              capabilities: {
                chat: !!caps.chat,
                vision: !!caps.vision,
                tools: !!caps.tools,
                thinking: !!caps.thinking,
                embeddings: !!caps.embeddings,
                imageGeneration: !!caps.imageGeneration,
                streaming: !!caps.streaming,
              },
            },
          } as any);
        }
        // Collapse per-(role,model,provider) registry rows into one row per
        // (provider,model) for the listing UI. The DB still stores per-role
        // configuration; the UI just shows merged role badges so a single
        // model registered for both 'chat' and 'code' isn't perceived as a
        // duplicate. Source: dedupeRegistryModels (TDD-tested).
        setModels(dedupeRegistryModels(allModels));
        return;
      }

      // Fallback: Registry empty — fall back to legacy per-provider discovery
      // so admin can still see what's in the catalog and hit Add-Model to
      // get a row into the Registry.
      const enabledProviders = providerList.filter(p => p.enabled);

      // Discover live from every enabled provider in parallel
      const discoveries = await Promise.all(enabledProviders.map(async (p) => {
        try {
          const dres = await apiRequest(`/admin/llm-providers/${encodeURIComponent(p.name)}/discover-models`);
          if (!dres.ok) return { provider: p, discovered: [] as any[], error: `HTTP ${dres.status}` };
          const ddata = await dres.json();
          return { provider: p, discovered: (ddata?.modelDetails || []) as any[], error: null };
        } catch (err: any) {
          return { provider: p, discovered: [] as any[], error: err.message };
        }
      }));

      for (const { provider: p, discovered, error: discErr } of discoveries) {
        const mc = p.model_config || {};
        const pc = p.provider_config || {};
        const persistedModels: any[] = Array.isArray(pc.models) ? pc.models : [];
        const persistedById = new Map(persistedModels.map(m => [m.id || m.name, m]));
        const disabledModels: string[] = Array.isArray(mc.disabledModels) ? mc.disabledModels : [];

        // Merge discovered + persisted by id — some providers (e.g. AWS
        // Bedrock) don't return inference-profile models through their
        // public ListFoundationModels API, so admin-curated entries in
        // provider_config.models[] need to surface even when discovery
        // didn't include them.
        const merged = new Map<string, any>();
        for (const m of discovered) {
          const key = m.id || m.name;
          if (key) merged.set(key, m);
        }
        for (const m of persistedModels) {
          const key = m.id || m.name;
          if (key && !merged.has(key)) merged.set(key, m);
        }
        const sourceList = [...merged.values()];
        if (discErr && discovered.length === 0) {
          console.warn(`[ModelManagement] Discovery failed for ${p.name}: ${discErr} — showing persisted models only`);
        }

        for (const m of sourceList) {
          const mId = m.id || m.name;
          if (!mId) continue;
          // Registry only shows models explicitly configured in model_config
          // (chatModel, embeddingModel, visionModel, etc.) or marked as deployed.
          // Auto-discovered models in provider_config.models[] are for SDK use
          // but belong in Model Garden, not the registry.
          const configuredModels = new Set([
            mc.chatModel, mc.embeddingModel, mc.visionModel,
            mc.toolModel, mc.defaultModel, mc.thinkingModel,
            mc.economicalModel, mc.premiumModel, mc.ultraPremiumModel,
            ...(mc.additionalModels || []),
          ].filter(Boolean));
          const isConfigured = configuredModels.has(mId) || m.deployed === true;
          if (!isConfigured) continue;
          if (m.deployed === false) continue;
          // Layer persisted overrides on top of discovered metadata
          const override = persistedById.get(mId);
          const capabilities = override?.capabilities || m.capabilities || { chat: true, tools: true, streaming: true };
          const config = override?.config || m.config || {};
          allModels.push({
            id: `${p.id}-${mId}`,
            name: mId,
            provider: p.display_name || p.name,
            providerId: p.id,
            providerType: p.provider_type,
            providerName: p.name,
            capabilities,
            maxTokens: m.maxOutputTokens || m.maxTokens || config.maxOutputTokens || 8192,
            contextWindow: m.contextWindow || config.maxInputTokens,
            tier: guessTier(mId),
            enabled: p.enabled && !disabledModels.includes(mId),
            config: {
              maxOutputTokens: config.maxOutputTokens || m.maxOutputTokens || m.maxTokens || 8192,
              maxInputTokens: config.maxInputTokens || m.contextWindow,
              rateLimitRequestsPerHour: config.rateLimitRequestsPerHour ?? 0,
              rateLimitTokensPerHour: config.rateLimitTokensPerHour ?? 0,
              temperature: config.temperature,
              topP: config.topP,
              enabled: p.enabled && !disabledModels.includes(mId),
              roles: config.roles || (capabilities.embeddings ? ['embeddings'] : ['chat']),
              capabilities,
              costTier: config.costTier ?? m.costTier,
              ttftMs: config.ttftMs,
              ttftMeasuredAt: config.ttftMeasuredAt,
            },
          } as any);
        }
      }
      // Same dedup as the registry-SoT path above — keeps UI consistent.
      setModels(dedupeRegistryModels(allModels));
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const activeProviders = useMemo(() => providers.filter(p => p.enabled), [providers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--ap-accent)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-xl border" style={{ background: 'var(--ap-bg-secondary)', borderColor: 'var(--ap-border)' }}>
        <div className="flex items-center gap-3" style={{ color: 'var(--ap-text-error)' }}>
          <XCircle size={20} />
          <div>
            <h3 className="font-semibold text-sm">Failed to Load</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{error}</p>
          </div>
        </div>
        <button onClick={fetchProviders} className="mt-3 px-4 py-1.5 text-xs font-medium rounded-lg" style={{ background: 'var(--ap-accent)', color: 'var(--color-on-accent)' }}>
          Retry
        </button>
      </div>
    );
  }

  const TABS: { id: TabId; label: string; icon: React.FC<any>; count?: number }[] = [
    { id: 'registry', label: 'Model Registry', icon: Layers, count: models.length },
    { id: 'garden', label: 'Model Garden', icon: Sparkles },
    { id: 'playground', label: 'Playground', icon: Play },
  ];

  return (
    <div className="space-y-5">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'LLM', 'Models']}
        title="Models"
        explainer="Browse the registered model catalog, discover new models from enabled providers, and run quick playground tests."
        actions={[
          { label: 'Refresh', onClick: fetchProviders },
        ]}
      />

      {/* Mission Control · SoT enforcement banner — top of page, every render */}
      <SoTBanner />

      {/* Tab switcher — unchanged below the page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-surfaceSecondary)' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === tab.id ? 'shadow-sm' : 'hover:opacity-80'
              }`}
              style={{
                background: activeTab === tab.id ? 'var(--ap-accent)' : 'transparent',
                color: activeTab === tab.id ? 'white' : 'var(--text-muted)',
              }}
            >
              <tab.icon size={13} />
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === tab.id ? 'bg-[color-mix(in_srgb,var(--color-fg)_20%,transparent)] text-on-accent' : 'bg-[color-mix(in_srgb,var(--color-fg-subtle)_20%,transparent)]'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'registry' && (
        <RegistryTab models={models} providers={providers} onRefresh={fetchProviders} />
      )}
      {activeTab === 'garden' && (
        <ModelGardenTab providers={activeProviders} existingModels={models} onModelAdded={fetchProviders} />
      )}
      {activeTab === 'playground' && (
        <PlaygroundTab providers={activeProviders} models={models} />
      )}
    </div>
  );
};

export default ModelManagementView;
