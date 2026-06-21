/**
 * DefaultModelsView — Tenant Default Models
 *
 * Single-page SOT for all 5 model categories (chat, code, embedding, vision, imageGen).
 * Model picker draws exclusively from the enabled Model Registry
 * (/api/admin/llm-providers/registry?enabledOnly=true). FCA-floor cross-reference
 * comes from /api/admin/router-tuning.
 *
 * PUT fires only the delta (dirty categories), not the full object.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useAdminQuery, useAdminInvalidate } from '../../hooks/useAdminQuery';
import { apiRequest } from '@/utils/api';
import { onKeyActivate } from '@/utils/a11y';
import { AdminToast, useAdminToast } from '../Shared/AdminToast';
import { SoTBanner, ExplainerCard, PageHeader } from '../../primitives-v2';
import { ProviderQualifier } from '@/shared/components/ProviderQualifier';

/**
 * Theme-aware tint helper — produces a translucent version of a theme
 * token using CSS `color-mix`. Re-themes automatically when the user
 * toggles light/dark or changes accent.
 */
function tint(tokenVar: string, pct: number): string {
  return `color-mix(in srgb, ${tokenVar} ${pct}%, transparent)`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

type Category = 'chat' | 'code' | 'embedding' | 'vision' | 'imageGen';

interface DefaultModels {
  chat: string | null;
  code: string | null;
  embedding: string | null;
  vision: string | null;
  imageGen: string | null;
}

interface DefaultModelsApiResponse {
  defaults: DefaultModels;
  updatedAt?: string;
  updatedBy?: string;
}

interface RegistryModel {
  id: string;
  model: string;
  provider: string;
  provider_display_name?: string;
  enabled: boolean;
  tier?: string;
  fca_score?: number;
  cost_per_1k_tokens?: number;
  capabilities?: Record<string, boolean>;
  roles?: string[];
}

interface RouterTuningApiResponse {
  tuning: {
    fcaChatPoolFloor: number;
    [key: string]: unknown;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_META: Array<{
  key: Category;
  label: string;
  tag: string;
  description: string;
  appliedTo: string[];
}> = [
  {
    key: 'chat',
    label: 'Chat',
    tag: 'default_models.chat',
    description: 'New chat sessions with no explicit pin route here.',
    appliedTo: ['ChatCompletionService', 'session defaults'],
  },
  {
    key: 'code',
    label: 'Code mode',
    tag: 'default_models.code',
    description: 'Openagentic / code-mode sessions fall back here.',
    appliedTo: ['Openagentic CLI', '/api/openagentic routes'],
  },
  {
    key: 'embedding',
    label: 'Embeddings',
    tag: 'default_models.embeddings',
    description: 'Semantic search, memory, RAG. SmartRouter never touches this.',
    appliedTo: ['UniversalEmbeddingService', 'Milvus indexing', 'MemoryService', 'DocsRAGService'],
  },
  {
    key: 'vision',
    label: 'Vision',
    tag: 'default_models.vision',
    description: 'Image-containing chat messages route here.',
    appliedTo: ['vision-capable chat messages'],
  },
  {
    key: 'imageGen',
    label: 'Image Gen',
    tag: 'default_models.image_gen',
    description: '`generate_image` tool dispatches here.',
    appliedTo: ['generate_image tool'],
  },
];

const AUTO_VALUE = 'auto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function guessTier(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('opus') || m.includes('sonnet') || m.includes('gpt-4') || m.includes('gemini-1.5-pro')) return 'frontier';
  if (m.includes('haiku') || m.includes('gpt-3.5') || m.includes('ministral') || m.includes('flash')) return 'mid';
  if (m.includes('ollama') || m.includes('gpt-oss') || m.includes('local') || m.includes('llama')) return 'local';
  if (m.includes('embed') || m.includes('text-embed')) return 'emb';
  if (m.includes('image') || m.includes('dall') || m.includes('stable')) return 'img-gen';
  return 'mid';
}

function TierPill({ tier }: { tier: string }) {
  const styles: Record<string, React.CSSProperties> = {
    frontier: { background: tint('var(--color-warning)', 15), color: 'var(--color-warning)', border: `1px solid ${tint('var(--color-warning)', 40)}` },
    mid:      { background: tint('var(--color-primary)', 15),  color: 'var(--color-primary)',  border: `1px solid ${tint('var(--color-primary)', 40)}` },
    cheap:    { background: tint('var(--color-success)', 15),   color: 'var(--color-success)', border: `1px solid ${tint('var(--color-success)', 40)}` },
    local:    { background: tint('var(--color-accent-secondary, var(--color-primary))', 15), color: 'var(--color-accent-secondary, var(--color-primary))',  border: `1px solid ${tint('var(--color-accent-secondary, var(--color-primary))', 40)}` },
    router:   { background: tint('var(--color-accent-secondary, var(--color-primary))', 15), color: 'var(--color-accent-secondary, var(--color-primary))',  border: `1px solid ${tint('var(--color-accent-secondary, var(--color-primary))', 40)}` },
    emb:      { background: tint('var(--color-accent-secondary, var(--color-primary))', 15), color: 'var(--color-accent-secondary, var(--color-primary))',  border: `1px solid ${tint('var(--color-accent-secondary, var(--color-primary))', 40)}` },
    'img-gen':{ background: tint('var(--color-accent-secondary, var(--color-warning))', 15), color: 'var(--color-accent-secondary, var(--color-warning))',               border: `1px solid ${tint('var(--color-accent-secondary, var(--color-warning))', 40)}` },
  };
  const s = styles[tier] || styles['mid'];
  return (
    <span style={{
      ...s,
      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
      letterSpacing: '0.04em', display: 'inline-block',
    }}>
      {tier}
    </span>
  );
}

// ─── Model Picker ─────────────────────────────────────────────────────────────

interface ModelPickerProps {
  category: Category;
  value: string | null;
  registryModels: RegistryModel[];
  onChange: (val: string | null) => void;
  savedValue: string | null;
}

const ModelPicker: React.FC<ModelPickerProps> = ({ category, value, registryModels, onChange, savedValue }) => {
  const [open, setOpen] = useState(false);
  const displayValue = value ?? '';

  const validIds = useMemo(() => new Set(registryModels.map(m => m.model)), [registryModels]);
  const isStale = savedValue && savedValue !== AUTO_VALUE && !validIds.has(savedValue);

  const currentModel = registryModels.find(m => m.model === displayValue);
  const currentTier = displayValue === AUTO_VALUE ? 'router'
    : currentModel ? guessTier(currentModel.model)
    : guessTier(displayValue);

  const handleSelect = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      {isStale && (
        <div style={{
          background: tint('var(--color-error)', 10), border: `1px solid ${tint('var(--color-error)', 40)}`,
          borderRadius: 6, padding: '6px 10px', fontSize: 12,
          color: 'var(--color-error)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
        }}
          data-testid={`stale-banner-${category}`}
        >
          ⚠ &ldquo;{savedValue}&rdquo; is no longer in the registry — pick a new default. Current sessions using it will fall through to chat default.
        </div>
      )}
      <div
        role="combobox"
        aria-expanded={open}
        aria-label={`model picker for ${category}`}
        tabIndex={0}
        style={{
          background: 'var(--ap-bg-secondary)',
          border: `1px solid ${open ? 'var(--ap-accent)' : 'var(--ap-border)'}`,
          borderRadius: open ? '8px 8px 0 0' : 8,
          padding: '10px 14px',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          cursor: 'pointer', transition: 'border 120ms', userSelect: 'none',
        }}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(o => !o); if (e.key === 'Escape') setOpen(false); }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{displayValue === AUTO_VALUE ? 'auto (Smart Router)' : (displayValue || <em style={{ opacity: 0.5 }}>none</em>)}</span>
          {displayValue && <TierPill tier={currentTier} />}
        </div>
        <span style={{ color: 'var(--ap-muted)', fontSize: 10 }}>▼</span>
      </div>

      {open && (
        <div
          data-testid={`dropdown-${category}`}
          style={{
            background: 'var(--ap-bg-secondary)',
            border: '1px solid var(--ap-accent)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
            maxHeight: 280, overflowY: 'auto',
          }}
        >
          {/* Auto option */}
          <div
            role="option"
            tabIndex={0}
            aria-selected={displayValue === AUTO_VALUE}
            data-value={AUTO_VALUE}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              gap: 14, padding: '10px 14px', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 13,
              alignItems: 'center',
              background: displayValue === AUTO_VALUE ? tint('var(--color-primary)', 8) : 'transparent',
            }}
            onClick={() => handleSelect(AUTO_VALUE)}
            onKeyDown={onKeyActivate(() => handleSelect(AUTO_VALUE))}
          >
            <span>auto (Smart Router)</span>
            <TierPill tier="router" />
            <span style={{ color: 'var(--ap-muted)' }}>—</span>
            <span style={{ color: 'var(--ap-muted)' }}>—</span>
          </div>

          {registryModels.map(m => {
            const tier = guessTier(m.model);
            const fca = typeof m.fca_score === 'number' ? m.fca_score.toFixed(2) : '—';
            const cost = typeof m.cost_per_1k_tokens === 'number' ? `$${m.cost_per_1k_tokens.toFixed(3)}/1k` : '—';
            // 2026-05-01: surface the provider qualifier so duplicate
            // model IDs (e.g. nomic-embed-text:latest registered against
            // both `ollama-hal` and a second Ollama host) can be told
            // apart in the dropdown. Prefer provider_display_name; fall
            // back to provider canonical name.
            const providerLabel = m.provider_display_name || m.provider;
            return (
              <div
                key={m.id}
                role="option"
                tabIndex={0}
                aria-selected={displayValue === m.model}
                data-value={m.model}
                data-provider={m.provider}
                data-testid={`option-${category}-${m.model}-${m.provider}`}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr auto auto auto',
                  gap: 14, padding: '10px 14px', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 13,
                  alignItems: 'center',
                  background: displayValue === m.model ? tint('var(--color-primary)', 8) : 'transparent',
                }}
                onClick={() => handleSelect(m.model)}
                onKeyDown={onKeyActivate(() => handleSelect(m.model))}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <ProviderQualifier
                    providerType={(m as any).provider_type || 'ollama'}
                    providerDisplayName={providerLabel}
                    modelId={m.model}
                    variant="stacked"
                  />
                </div>
                <TierPill tier={tier} />
                <span style={{ color: 'var(--ap-muted)' }}>FCA {fca}</span>
                <span style={{ color: 'var(--ap-accent)', fontWeight: 500 }}>{cost}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Category Row ─────────────────────────────────────────────────────────────

interface CategoryRowProps {
  meta: typeof CATEGORY_META[number];
  savedValue: string | null;
  draftValue: string | null;
  registryModels: RegistryModel[];
  onChange: (cat: Category, val: string | null) => void;
  fcaFloor?: number;
}

const CategoryRow: React.FC<CategoryRowProps> = ({ meta, savedValue, draftValue, registryModels, onChange, fcaFloor }) => {
  const isDirty = draftValue !== savedValue;

  const draftModel = registryModels.find(m => m.model === draftValue);
  const draftFca = draftModel?.fca_score;
  const showFcaWarn = (meta.key === 'chat' || meta.key === 'code')
    && typeof draftFca === 'number'
    && typeof fcaFloor === 'number'
    && draftFca < fcaFloor;

  return (
    <div
      data-testid={`category-row-${meta.key}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr auto',
        gap: 20, alignItems: 'center',
        padding: '18px 20px',
        background: 'var(--ap-surface-2)',
        border: `1px solid ${isDirty ? 'var(--color-warning)' : 'var(--ap-border)'}`,
        boxShadow: isDirty ? `0 0 0 1px ${tint('var(--color-warning)', 15)}` : 'none',
        borderRadius: 10, marginBottom: 12,
        transition: 'border 150ms',
      }}
    >
      {/* Label column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          {meta.label}
          <span style={{
            background: 'var(--ap-bg-secondary)',
            border: '1px solid var(--ap-border)',
            padding: '2px 6px', borderRadius: 4,
            fontSize: 10, fontFamily: 'var(--font-mono)',
            color: 'var(--ap-muted)',
          }}>
            {meta.tag}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ap-muted)', lineHeight: 1.4, maxWidth: 180 }}>
          {meta.description}
        </div>
      </div>

      {/* Picker column */}
      <div>
        <ModelPicker
          category={meta.key}
          value={draftValue}
          registryModels={registryModels}
          onChange={(v) => onChange(meta.key, v)}
          savedValue={savedValue}
        />

        {showFcaWarn && (
          <div
            data-testid={`fca-warn-${meta.key}`}
            style={{
              background: tint('var(--color-warning)', 10),
              border: `1px solid ${tint('var(--color-warning)', 40)}`,
              color: 'var(--color-warning)',
              padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 8,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            ⚠ Default &ldquo;{draftValue}&rdquo; (FCA {draftFca?.toFixed(2)}) is below Router Tuning{' '}
            <code style={{ background: 'var(--ap-surface-2)', padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', color: 'var(--color-warning)' }}>
              fcaChatPoolFloor
            </code>{' '}
            ({fcaFloor?.toFixed(2)}). Smart Router will filter this model out when session uses &ldquo;auto&rdquo;.
          </div>
        )}

        {/* Applied-to tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {meta.appliedTo.map(tag => (
            <span
              key={tag}
              data-testid={`applied-tag-${meta.key}-${tag}`}
              style={{
                background: 'var(--ap-bg-secondary)',
                border: '1px solid var(--ap-border)',
                color: 'var(--ap-muted)',
                padding: '2px 8px', borderRadius: 4,
                fontSize: 11, fontFamily: 'var(--font-mono)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Info column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', fontSize: 11, color: 'var(--ap-muted)' }}>
        {isDirty ? (
          <>
            <span style={{ color: 'var(--color-warning)' }}>● unsaved</span>
            <span>Was: {savedValue || 'none'}</span>
          </>
        ) : (
          <span>saved</span>
        )}
      </div>
    </div>
  );
};

// ─── Precedence Flow ──────────────────────────────────────────────────────────

const PrecedenceFlow: React.FC = () => (
  <section
    data-testid="precedence-flow"
    style={{
      background: 'var(--ap-bg-secondary)',
      border: '1px solid var(--ap-border)',
      borderRadius: 12, padding: 28, marginBottom: 20,
    }}
  >
    <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ap-muted)', margin: '0 0 20px' }}>
      Selection Precedence — how the model is chosen per request
    </h2>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 10, alignItems: 'stretch', marginBottom: 24 }}>
      {/* Step 1 */}
      <div style={{
        background: 'var(--ap-surface-2)',
        border: '1px solid var(--ap-border)',
        borderRadius: 8, padding: '14px 16px',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ap-muted)', letterSpacing: '0.1em' }}>1 · WINS FIRST</div>
        <div style={{ fontWeight: 600, margin: '4px 0 2px', fontSize: 14 }}>Explicit request pin</div>
        <div style={{ fontSize: 12, color: 'var(--ap-muted)' }}>User/API selects a model on the request</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ap-muted)', fontSize: 18, fontFamily: 'var(--font-mono)' }}>→</div>

      {/* Step 2 */}
      <div style={{
        background: 'var(--ap-surface-2)',
        border: '1px solid var(--ap-border)',
        borderRadius: 8, padding: '14px 16px',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ap-muted)', letterSpacing: '0.1em' }}>2 · FALLBACK</div>
        <div style={{ fontWeight: 600, margin: '4px 0 2px', fontSize: 14 }}>Session model</div>
        <div style={{ fontSize: 12, color: 'var(--ap-muted)' }}>Pin persisted on the session (dropdown choice)</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ap-muted)', fontSize: 18, fontFamily: 'var(--font-mono)' }}>→</div>

      {/* Step 3 — ACTIVE */}
      <div style={{
        background: 'var(--ap-surface-2)',
        border: '1px solid var(--ap-accent)',
        boxShadow: `0 0 0 1px ${tint('var(--color-primary)', 20)}`,
        borderRadius: 8, padding: '14px 16px',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ap-muted)', letterSpacing: '0.1em' }}>3 · FALLBACK · YOU ARE HERE</div>
        <div style={{ fontWeight: 600, margin: '4px 0 2px', fontSize: 14, color: 'var(--ap-accent)' }}>Tenant default (this page)</div>
        <div style={{ fontSize: 12, color: 'var(--ap-muted)' }}>Resolves per category when nothing else is set</div>
      </div>
    </div>

    <div style={{ fontSize: 12, color: 'var(--ap-muted)', fontFamily: 'var(--font-mono)' }}>
      After resolution: if the chosen model id is{' '}
      <code style={{ background: 'var(--ap-bg-secondary)', padding: '1px 6px', borderRadius: 4 }}>auto</code>,
      Smart Router fires with the current tuning. Otherwise the pipeline dispatches the resolved model directly.
    </div>
  </section>
);

// ─── Main View ────────────────────────────────────────────────────────────────

const DefaultModelsView: React.FC = () => {
  const { toast, showToast, dismissToast } = useAdminToast();
  const invalidate = useAdminInvalidate();

  // ── Remote data
  const { data: defaultsApi, isLoading: defaultsLoading, error: defaultsError } = useAdminQuery<DefaultModelsApiResponse>(
    ['default-models'],
    '/api/admin/llm-providers/default-models',
  );

  const { data: registryApi, isLoading: registryLoading } = useAdminQuery<RegistryModel[]>(
    ['registry-enabled'],
    '/api/admin/llm-providers/registry?enabledOnly=true',
  );

  const { data: tuningApi } = useAdminQuery<RouterTuningApiResponse>(
    ['router-tuning'],
    '/api/admin/router-tuning',
  );

  // ── Local state (draft)
  const savedDefaults: DefaultModels = defaultsApi?.defaults ?? {
    chat: null, code: null, embedding: null, vision: null, imageGen: null,
  };

  const [draft, setDraft] = useState<DefaultModels | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync draft when remote data arrives (once)
  const effectiveDraft: DefaultModels = draft ?? savedDefaults;

  const handleChange = useCallback((cat: Category, val: string | null) => {
    setDraft(prev => {
      const base = prev ?? savedDefaults;
      return { ...base, [cat]: val };
    });
  }, [savedDefaults]);

  const dirtyCategories = useMemo((): Category[] => {
    return (Object.keys(effectiveDraft) as Category[]).filter(k => effectiveDraft[k] !== savedDefaults[k]);
  }, [effectiveDraft, savedDefaults]);

  const pendingCount = dirtyCategories.length;

  const registryModels: RegistryModel[] = Array.isArray(registryApi) ? registryApi : [];

  const fcaFloor = tuningApi?.tuning?.fcaChatPoolFloor;

  // ── Save
  const handleSave = useCallback(async () => {
    if (pendingCount === 0) return;
    const patch: Partial<DefaultModels> = {};
    for (const k of dirtyCategories) {
      patch[k] = effectiveDraft[k];
    }
    try {
      setSaving(true);
      const res = await apiRequest('/api/admin/llm-providers/default-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast('error', data?.message || data?.error || `HTTP ${res.status}`);
        return;
      }
      // Reset draft to committed state AND invalidate the cached query so the
      // dropdown re-reads the freshly persisted value from the server on next
      // render. Without this, setDraft only updated local state and the stale
      // `defaultsApi` cache made the pill snap back to the pre-save value —
      // the "doesn't stick" symptom.
      setDraft(data?.defaults ?? null);
      invalidate(['default-models']);
      showToast('success', `Saved ${(data?.changed || []).length || pendingCount} default(s)`);
    } catch (err: any) {
      showToast('error', err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [dirtyCategories, effectiveDraft, pendingCount, showToast]);

  // ── Reset to helm seed
  const handleResetToSeed = useCallback(async () => {
    try {
      setSaving(true);
      const res = await apiRequest('/api/admin/llm-providers/default-models/reset', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast('error', data?.message || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.defaults) setDraft(data.defaults);
      showToast('success', 'Reset to helm seed defaults');
    } catch (err: any) {
      showToast('error', err.message || 'Reset failed');
    } finally {
      setSaving(false);
    }
  }, [showToast]);

  // ── Discard
  const handleDiscard = useCallback(() => {
    setDraft(null);
  }, []);

  // ── Loading / error states
  if (defaultsLoading || registryLoading) {
    return (
      <div>
        <PageHeader
          crumbs={['Admin', 'LLM', 'Default Models']}
          title="Default Models"
          explainer="Per-category fallback models when a chat / code / embedding / vision / image-gen request has no explicit pin."
        />
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ap-muted)' }}>
          Loading tenant defaults…
        </div>
      </div>
    );
  }

  if (defaultsError) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{
          background: tint('var(--color-error)', 8), border: `1px solid ${tint('var(--color-error)', 30)}`,
          borderRadius: 8, padding: '12px 16px', color: 'var(--color-error)',
        }}>
          Failed to load default models: {String(defaultsError)}
        </div>
      </div>
    );
  }

  const chatCodeCats = CATEGORY_META.filter(m => m.key === 'chat' || m.key === 'code');
  const otherCats = CATEGORY_META.filter(m => m.key !== 'chat' && m.key !== 'code');

  return (
    <div style={{ maxWidth: 1180, padding: '0 0 80px', position: 'relative' }}>
      <PageHeader
        crumbs={['Admin', 'LLM', 'Default Models']}
        title="Default Models"
        explainer="Per-category fallback models when a chat / code / embedding / vision / image-gen request has no explicit pin."
      />

      <div style={{ padding: '24px 28px 0' }}>
      {/* Admin console · SoT enforcement banner — registry is the only source */}
      <SoTBanner context="The dropdowns below only list models from the registry; pinning a default to a model whose provider is later disabled raises a banner here AND a 503 with retry-from-fallback at runtime — never silent failure." />

      {/* Admin console · explainer card */}
      <ExplainerCard
        title="How a model gets picked, in order."
        body={
          <>
            <b>1.</b> If the request pins a specific model — that wins. <b>2.</b>{' '}
            Otherwise the chat session's saved model wins. <b>3.</b> Otherwise — what's
            on this page wins. Smart Router only fires when the resolved model is the
            literal string <span style={{ fontFamily: 'var(--font-mono)' }}>auto</span>; otherwise the pipeline dispatches the resolved model directly.
          </>
        }
        why={
          <>
            These are the safety nets. If everything else upstream goes blank, this is
            what users get. Set them to models you'd be happy serving production traffic
            on.
          </>
        }
      />

      {/* Status pill */}
      <div style={{ color: 'var(--ap-muted)', fontSize: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          background: tint('var(--color-success)', 12), border: `1px solid ${tint('var(--color-success)', 40)}`,
          color: 'var(--color-success)', borderRadius: 12, fontSize: 12,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)',
            display: 'inline-block',
          }} />
          Live · propagates to all pods
        </span>
      </div>

      {/* Scope note */}
      <div
        data-testid="scope-note"
        style={{
          background: tint('var(--color-primary)', 8), border: `1px solid ${tint('var(--color-primary)', 30)}`,
          borderRadius: 8, padding: '12px 16px', marginBottom: 32, fontSize: 13,
          color: 'var(--ap-muted)', lineHeight: 1.5,
        }}
      >
        <strong style={{ color: 'var(--ap-text)' }}>Scope:</strong>{' '}
        These defaults seed from the helm{' '}
        <code style={{ background: 'var(--ap-bg-secondary)', padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          DEFAULT_MODEL
        </code>{' '}
        env on first boot. Admin edits here persist and survive pod restarts.{' '}
        <strong style={{ color: 'var(--ap-text)' }}>Router Tuning</strong> (FCA floors, scoring weights)
        is a separate page under{' '}
        <strong style={{ color: 'var(--ap-text)' }}>Admin → LLM → Router Tuning</strong>{' '}
        — it only affects requests with session model{' '}
        <code style={{ background: 'var(--ap-bg-secondary)', padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          auto
        </code>.
        Tenant defaults set here are distinct from both Router Tuning and session-level pins.
      </div>

      {/* Precedence flow */}
      <PrecedenceFlow />

      {/* Chat + Code section */}
      <section style={{
        background: 'var(--ap-bg-secondary)',
        border: '1px solid var(--ap-border)',
        borderRadius: 12, padding: 28, marginBottom: 20,
      }}>
        <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ap-muted)', margin: '0 0 20px' }}>
          Chat
        </h2>
        {chatCodeCats.map(meta => (
          <CategoryRow
            key={meta.key}
            meta={meta}
            savedValue={savedDefaults[meta.key]}
            draftValue={effectiveDraft[meta.key]}
            registryModels={registryModels}
            onChange={handleChange}
            fcaFloor={fcaFloor}
          />
        ))}
      </section>

      {/* Embeddings / Vision / Image Gen section */}
      <section style={{
        background: 'var(--ap-bg-secondary)',
        border: '1px solid var(--ap-border)',
        borderRadius: 12, padding: 28, marginBottom: 20,
      }}>
        <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ap-muted)', margin: '0 0 20px' }}>
          Embeddings · Vision · Image Generation
        </h2>
        {otherCats.map(meta => (
          <CategoryRow
            key={meta.key}
            meta={meta}
            savedValue={savedDefaults[meta.key]}
            draftValue={effectiveDraft[meta.key]}
            registryModels={registryModels}
            onChange={handleChange}
            fcaFloor={fcaFloor}
          />
        ))}
      </section>

      {/* Sticky footer */}
      <div style={{
        position: 'sticky', bottom: 0,
        background: 'var(--ap-bg)',
        borderTop: '1px solid var(--ap-border)',
        padding: '20px 0', marginTop: 32,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: 12, color: 'var(--ap-muted)' }}>
          {pendingCount > 0 ? (
            <strong style={{ color: 'var(--color-warning)' }}>
              ● {pendingCount} change{pendingCount !== 1 ? 's' : ''} pending
            </strong>
          ) : (
            <span>no pending changes</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleResetToSeed}
            disabled={saving}
            style={{
              fontFamily: 'inherit', fontSize: 14, padding: '10px 18px', borderRadius: 8,
              cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500,
              background: 'transparent', color: 'var(--color-error)',
              border: '1px solid var(--color-error)',
              opacity: saving ? 0.4 : 1,
            }}
          >
            Reset All to Helm Seed
          </button>
          <button
            onClick={handleDiscard}
            disabled={saving || pendingCount === 0}
            style={{
              fontFamily: 'inherit', fontSize: 14, padding: '10px 18px', borderRadius: 8,
              cursor: (saving || pendingCount === 0) ? 'not-allowed' : 'pointer', fontWeight: 500,
              background: 'var(--ap-surface-2)', color: 'var(--ap-text)',
              border: '1px solid var(--ap-border)',
              opacity: (saving || pendingCount === 0) ? 0.4 : 1,
            }}
          >
            Discard
          </button>
          <button
            data-testid="save-button"
            onClick={handleSave}
            disabled={saving || pendingCount === 0}
            style={{
              fontFamily: 'inherit', fontSize: 14, padding: '10px 18px', borderRadius: 8,
              cursor: (saving || pendingCount === 0) ? 'not-allowed' : 'pointer', fontWeight: 500,
              background: 'var(--ap-accent)', color: 'var(--ap-bg)',
              border: '1px solid transparent',
              opacity: (saving || pendingCount === 0) ? 0.4 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save & Apply Live'}
          </button>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={dismissToast} />
      </div>
    </div>
  );
};

export default DefaultModelsView;
