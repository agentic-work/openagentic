import * as React from 'react'
import { Modal, v3InputStyle, Btn, Banner } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'
import type { ModelRow } from './types'
import type { LlmProviderRow } from '../../hooks/useDashboardMetrics'
import type { ToastApi } from '../_shared/mutationHelpers'
import { useAdminInvalidate } from '../../hooks/useAdminQuery'

export interface DiscoveredModel {
  id: string
  name?: string
  description?: string
  family?: string
  capabilities?: Record<string, boolean | undefined>
  contextWindow?: number
  maxTokens?: number
  maxOutputTokens?: number
  tier?: string
  costTier?: string
  costPerInputToken?: number
  costPerOutputToken?: number
  provider?: string
}

export interface ModelBrowseModalProps {
  open: boolean
  onClose: () => void
  providers: LlmProviderRow[] | undefined
  /** Existing registry rows — used to disable already-added entries. */
  existingModels: ReadonlyArray<Pick<ModelRow, 'model' | 'providerName'>>
  toast: ToastApi
}

const CAP_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'chat', label: 'chat' },
  { key: 'tools', label: 'tools' },
  { key: 'vision', label: 'vision' },
  { key: 'thinking', label: 'thinking' },
  { key: 'embeddings', label: 'embed' },
  { key: 'imageGeneration', label: 'img-gen' },
  { key: 'streaming', label: 'stream' },
]

type SortKey =
  | 'name'
  | 'context'
  | 'output'
  | 'tier'
  | 'cap-chat'
  | 'cap-tools'
  | 'cap-vision'
  | 'cap-thinking'
  | 'cap-embeddings'

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'name' },
  { key: 'context', label: 'context window ↓' },
  { key: 'output', label: 'max output ↓' },
  { key: 'tier', label: 'tier (premium first)' },
  { key: 'cap-chat', label: 'has chat' },
  { key: 'cap-tools', label: 'has tools' },
  { key: 'cap-vision', label: 'has vision' },
  { key: 'cap-thinking', label: 'has thinking' },
  { key: 'cap-embeddings', label: 'has embeddings' },
]

const TIER_ORDER: Record<string, number> = {
  premium: 0,
  high: 1,
  balanced: 2,
  mid: 2,
  economy: 3,
  low: 3,
  free: 4,
}

function tierBadgeStyle(tier?: string): React.CSSProperties {
  const t = (tier || '').toLowerCase()
  const palette: Record<string, [string, string]> = {
    premium: ['color-mix(in srgb, var(--color-accent) 18%, transparent)', 'var(--color-accent)'],
    high: ['color-mix(in srgb, var(--color-nfo) 18%, transparent)', 'var(--color-nfo)'],
    balanced: ['color-mix(in srgb, var(--color-nfo) 18%, transparent)', 'var(--color-nfo)'],
    mid: ['color-mix(in srgb, var(--color-nfo) 18%, transparent)', 'var(--color-nfo)'],
    economy: ['color-mix(in srgb, var(--color-warn) 18%, transparent)', 'var(--color-warn)'],
    low: ['color-mix(in srgb, var(--color-warn) 18%, transparent)', 'var(--color-warn)'],
    free: ['color-mix(in srgb, var(--color-ok) 18%, transparent)', 'var(--color-ok)'],
  }
  const [bg, fg] = palette[t] || ['var(--ctl-surf)', 'var(--fg-2)']
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    padding: '2px 6px',
    background: bg,
    color: fg,
    border: '1px solid currentColor',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  }
}

function fmtNum(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return String(n)
}

export const ModelBrowseModal: React.FC<ModelBrowseModalProps> = ({
  open,
  onClose,
  providers,
  existingModels,
  toast,
}) => {
  const invalidate = useAdminInvalidate()
  const [providerName, setProviderName] = React.useState<string>('')
  const [models, setModels] = React.useState<DiscoveredModel[]>([])
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [capFilter, setCapFilter] = React.useState<string | null>(null)
  const [sortBy, setSortBy] = React.useState<SortKey>('context')
  const [addingId, setAddingId] = React.useState<string | null>(null)
  const [justAdded, setJustAdded] = React.useState<Set<string>>(new Set())
  const [cache, setCache] = React.useState<Record<string, DiscoveredModel[]>>({})

  const enabledProviders = React.useMemo(
    () => (providers ?? []).filter((p) => p.enabled !== false),
    [providers],
  )

  // Auto-select first enabled provider when modal opens.
  React.useEffect(() => {
    if (!open) return
    if (!providerName && enabledProviders.length > 0) {
      setProviderName(enabledProviders[0].name)
    }
  }, [open, providerName, enabledProviders])

  // Reset transient state on close.
  React.useEffect(() => {
    if (open) return
    setErr(null)
    setSearch('')
    setCapFilter(null)
    setJustAdded(new Set())
  }, [open])

  // Fetch models when provider changes.
  React.useEffect(() => {
    if (!open || !providerName) return
    const cached = cache[providerName]
    if (cached) {
      setModels(cached)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    ;(async () => {
      try {
        const res = await apiRequest(
          `/admin/llm-providers/${encodeURIComponent(providerName)}/discover-models`,
        )
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        }
        const body = await res.json()
        const list: DiscoveredModel[] = (body.modelDetails || []).map((m: any) => ({
          id: m.id || m.name,
          name: m.name || m.id,
          description: m.description,
          family: m.family,
          capabilities: m.capabilities || {},
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          maxOutputTokens: m.maxOutputTokens,
          tier: m.tier,
          costTier: m.costTier,
          costPerInputToken: m.costPerInputToken,
          costPerOutputToken: m.costPerOutputToken,
          provider: providerName,
        }))
        if (cancelled) return
        setModels(list)
        setCache((prev) => ({ ...prev, [providerName]: list }))
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || 'failed to discover models')
          setModels([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, providerName, cache])

  const existingKeys = React.useMemo(() => {
    const s = new Set<string>()
    for (const m of existingModels) {
      if (m.providerName === providerName) s.add(m.model)
    }
    for (const id of justAdded) s.add(id)
    return s
  }, [existingModels, providerName, justAdded])

  const filtered = React.useMemo(() => {
    let list = [...models]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          (m.name || '').toLowerCase().includes(q) ||
          (m.description || '').toLowerCase().includes(q) ||
          (m.family || '').toLowerCase().includes(q),
      )
    }
    if (capFilter) {
      list = list.filter((m) => m.capabilities?.[capFilter])
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.id.localeCompare(b.id)
      if (sortBy === 'context') return (b.contextWindow || 0) - (a.contextWindow || 0)
      if (sortBy === 'output')
        return (b.maxOutputTokens || b.maxTokens || 0) - (a.maxOutputTokens || a.maxTokens || 0)
      if (sortBy === 'tier') {
        const aT = a.costTier || a.tier || 'balanced'
        const bT = b.costTier || b.tier || 'balanced'
        return (TIER_ORDER[aT] ?? 2) - (TIER_ORDER[bT] ?? 2)
      }
      if (sortBy.startsWith('cap-')) {
        const cap = sortBy.replace('cap-', '')
        const aHas = a.capabilities?.[cap] ? 1 : 0
        const bHas = b.capabilities?.[cap] ? 1 : 0
        if (bHas !== aHas) return bHas - aHas
        return a.id.localeCompare(b.id)
      }
      return 0
    })
    // Push existing/added rows to bottom.
    list.sort(
      (a, b) =>
        (existingKeys.has(a.id) ? 1 : 0) - (existingKeys.has(b.id) ? 1 : 0),
    )
    return list
  }, [models, search, capFilter, sortBy, existingKeys])

  const handleAdd = React.useCallback(
    async (m: DiscoveredModel) => {
      if (!providerName) return
      setAddingId(m.id)
      setErr(null)
      try {
        // Infer role from capabilities. Embedding-only and image-gen rows
        // need their dedicated registry role; everything else defaults to
        // chat (with caller-side per-cap flags preserved).
        const caps = m.capabilities || {}
        const isEmbed = !!caps.embeddings && !caps.chat
        const isImageGen = !!caps.imageGeneration && !caps.chat
        const role = isEmbed ? 'embedding' : isImageGen ? 'image-generation' : 'chat'

        const body = {
          modelId: m.id,
          displayName: m.name || m.id,
          capabilities: {
            chat: caps.chat ?? (!isEmbed && !isImageGen),
            tools: !!caps.tools,
            vision: !!caps.vision,
            embeddings: !!caps.embeddings,
            streaming: caps.streaming !== false,
            thinking: !!caps.thinking,
          },
          config: {
            maxOutputTokens: m.maxOutputTokens || m.maxTokens || 8192,
            contextWindow: m.contextWindow,
            temperature: 0.7,
            enabled: true,
            roles: [role],
            ...(typeof m.costPerInputToken === 'number'
              ? { inputCostPer1k: m.costPerInputToken * 1000 }
              : {}),
            ...(typeof m.costPerOutputToken === 'number'
              ? { outputCostPer1k: m.costPerOutputToken * 1000 }
              : {}),
          },
        }
        const doPost = (force: boolean) =>
          apiRequest(
            `/admin/llm-providers/${encodeURIComponent(providerName)}/models${force ? '?force=true' : ''}`,
            { method: 'POST', body: JSON.stringify(body) },
          )
        let res = await doPost(false)
        if (res.status === 409) {
          // Disambiguate: api emits MODEL_FAMILY_CONFLICT for "same family
          // already added — pass force=true to replace" vs plain duplicate.
          let parsed: any = null
          try { parsed = await res.clone().json() } catch {}
          if (parsed?.error === 'MODEL_FAMILY_CONFLICT') {
            const existing = parsed.existingModelId ?? 'an existing entry'
            const ok = window.confirm(
              `"${m.id}" is in the same model family as "${existing}".\n\n` +
              `Add it anyway? Both will live in the registry side-by-side ` +
              `(use admin to delete the older one later).`,
            )
            if (!ok) return
            res = await doPost(true)
          } else {
            // Plain "already in registry" duplicate — treat as soft-add.
            toast.show('warn', 'exists', `"${m.id}" already in registry`)
            setJustAdded((prev) => new Set(prev).add(m.id))
            return
          }
        }
        if (!res.ok) {
          const t = await res.text().catch(() => res.statusText)
          setErr(t.slice(0, 240) || `HTTP ${res.status}`)
          return
        }
        toast.show('ok', 'added', `"${m.id}" → ${providerName}`)
        setJustAdded((prev) => new Set(prev).add(m.id))
        invalidate(['llm-registry', 'enabled'])
        invalidate(['llm-registry', 'all'])
        invalidate(['llm-providers'])
      } catch (e: any) {
        setErr(e?.message ?? 'unexpected error')
      } finally {
        setAddingId(null)
      }
    },
    [providerName, toast, invalidate],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Browse provider catalog · add to registry"
      width={920}
      footer={
        <Btn variant="ghost" onClick={onClose}>
          close
        </Btn>
      }
    >
      {err && (
        <Banner level="err" label="error">
          {err}
        </Banner>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, 200px) 1fr minmax(180px, 220px)',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <select
          value={providerName}
          onChange={(e) => setProviderName(e.target.value)}
          style={v3InputStyle}
          aria-label="provider"
          data-testid="model-browse-provider-select"
        >
          {enabledProviders.length === 0 && <option value="">no enabled providers</option>}
          {enabledProviders.map((p) => (
            <option key={p.id} value={p.name}>
              {p.displayName || p.name} ({p.type})
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="search by id / name / family"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={v3InputStyle}
          data-testid="model-browse-search"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          style={v3InputStyle}
          aria-label="sort"
          data-testid="model-browse-sort"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              sort · {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Capability filter chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          onClick={() => setCapFilter(null)}
          style={chipStyle(capFilter === null)}
          data-testid="model-browse-cap-all"
        >
          all
        </button>
        {CAP_FILTERS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCapFilter(capFilter === c.key ? null : c.key)}
            style={chipStyle(capFilter === c.key)}
            data-testid={`model-browse-cap-${c.key}`}
          >
            {c.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
          {loading ? 'discovering…' : `${filtered.length} of ${models.length} models`}
        </div>
      </div>

      {/* Table header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 80px 80px 1fr 80px 80px',
          gap: 8,
          padding: '6px 4px',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--fg-2)',
          borderBottom: '1px solid var(--line-1)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        <span>model id</span>
        <span style={{ textAlign: 'right' }}>context</span>
        <span style={{ textAlign: 'right' }}>max-out</span>
        <span>capabilities</span>
        <span>tier</span>
        <span></span>
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 460, overflowY: 'auto' }} data-testid="model-browse-list">
        {loading && (
          <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)' }}>
            discovering models from {providerName}…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)' }}>
            no models match the current filter.
          </div>
        )}
        {!loading &&
          filtered.map((m) => {
            const exists = existingKeys.has(m.id)
            return (
              <div
                key={m.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 80px 80px 1fr 80px 80px',
                  gap: 8,
                  padding: '8px 4px',
                  borderBottom: '1px solid var(--line-1)',
                  alignItems: 'center',
                  opacity: exists ? 0.45 : 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                }}
                data-testid={`model-browse-row-${m.id}`}
              >
                <span title={m.description || m.id} style={{ color: 'var(--fg-0)' }}>
                  {m.id}
                  {m.family && (
                    <span style={{ color: 'var(--fg-2)', fontSize: 10, marginLeft: 6 }}>
                      · {m.family}
                    </span>
                  )}
                </span>
                <span style={{ textAlign: 'right', color: 'var(--fg-1)' }}>{fmtNum(m.contextWindow)}</span>
                <span style={{ textAlign: 'right', color: 'var(--fg-1)' }}>
                  {fmtNum(m.maxOutputTokens || m.maxTokens)}
                </span>
                <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {Object.entries(m.capabilities || {})
                    .filter(([, v]) => v)
                    .map(([k]) => (
                      <span
                        key={k}
                        style={{
                          fontSize: 9,
                          padding: '1px 4px',
                          background: 'var(--ctl-surf)',
                          color: 'var(--fg-2)',
                          border: '1px solid var(--glass-border)',
                        }}
                      >
                        {k}
                      </span>
                    ))}
                </span>
                <span>
                  <span style={tierBadgeStyle(m.costTier || m.tier)}>
                    {(m.costTier || m.tier || '—').toLowerCase()}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  {exists ? (
                    <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>✓ added</span>
                  ) : (
                    <Btn
                      variant="primary"
                      onClick={() => handleAdd(m)}
                      disabled={addingId === m.id}
                      data-testid={`model-browse-add-${m.id}`}
                    >
                      {addingId === m.id ? '…' : 'add'}
                    </Btn>
                  )}
                </span>
              </div>
            )
          })}
      </div>
    </Modal>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    padding: '4px 8px',
    background: active ? 'var(--glass-accent-fill)' : 'var(--ctl-surf)',
    color: active ? 'var(--accent)' : 'var(--fg-1)',
    border: active ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
    cursor: 'pointer',
  }
}

export default ModelBrowseModal
