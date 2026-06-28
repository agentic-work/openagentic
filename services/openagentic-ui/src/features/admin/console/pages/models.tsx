/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Models & Providers domain pages (blueprint §2 — MODELS & PROVIDERS, 7
 * leaves) at mock fidelity (the admin-console mock PAGES.providers /
 * model-management / default-models / router-tuning / ollama / tiered-fc /
 * llm-performance) and WIRED to the real admin endpoints.
 *
 * Each leaf is a body-only component — PageHead + content, NEVER its own
 * OptionSpec (AdminConsole appends the option-spec inventory = the two-part
 * leaf contract). Every number comes from a live hook or renders an honest
 * "—"; tables render real rows or an honest-empty Banner; no value is
 * fabricated. Every color resolves via a global theme token (var(--*)).
 *
 * Data sources (all real admin routes):
 *   GET /api/admin/llm-providers                  → provider list (providers)
 *   GET /api/admin/llm-providers/health           → provider health (providers)
 *   GET /api/admin/llm-providers/registry         → model registry rows
 *                                                   (model-management, llm-perf,
 *                                                    router-tuning scoring lab)
 *   GET /api/admin/llm-providers/default-models   → per-role defaults
 *                                                   (default-models)
 *   GET /api/admin/router-tuning                  → scoring weights + FCA floors
 *                                                   (router-tuning)
 *   GET /api/admin/ollama/hosts                   → live Ollama host probe
 *                                                   (ollama)
 *   GET /api/admin/metrics/llm/performance        → latency / throughput KPIs
 *                                                   (llm-performance)
 *   GET /api/admin/metrics/llm/performance-trends → bucketed latency series
 *                                                   (llm-performance)
 *
 * tiered-fc is DEPRECATED (GH-622 — TFC replaced by SmartModelRouter FCA
 * scoring). It renders the mock's deprecation banners + a static "where the
 * settings live now" navigation map (no fabricated runtime data — these are
 * literal field→config mappings, not data).
 */
import * as React from 'react'
import {
  AreaChart,
  Banner,
  ChartCard,
  DataTable,
  FormSection,
  HBars,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  StatusDot,
  Tag,
  type AreaSeries,
  type DtColumn,
  type FormRow,
  type HBarItem,
  type Kpi,
} from '../primitives'
import type { Tone } from '../types'
import {
  useLlmProviders,
  useProviderHealth,
  useLlmRegistry,
  useRouterTuning,
  useOllamaHosts,
  useLlmPerformance,
  useLlmPerformanceTrends,
  type LlmProviderRow,
  type LlmRegistryRow,
  type OllamaHostRow,
} from '../../hooks/useDashboardMetrics'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import type { LeafPageProps } from './registry'
import {
  ProviderModal,
  ModelModal,
  ModelSandbox,
  ProviderAuditFeed,
  type NotifyFn,
} from './ModelsDialogs'

/* ============================================================
 * format helpers (honest "—" on missing) — port of HomePage's
 * ============================================================ */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function fmtUsd(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'
  if (n === 0) return '$0'
  if (n < 0.01) return '$' + n.toFixed(4)
  return '$' + n.toFixed(2)
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n)}%`
}
function fmtMs(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1000) return (n / 1000).toFixed(1) + 's'
  return Math.round(n) + 'ms'
}
function fmtFca(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  // accept either 0–1 or 0–100 inputs and render as a percent
  const v = n <= 1 ? n * 100 : n
  return `${Math.round(v)}%`
}
function relTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const t = d.getTime()
  if (Number.isNaN(t)) return String(ts).slice(0, 16)
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}
/** Stringify an unknown payload so it never renders as a raw object (no React #31). */
function asText(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
function providerStatusTone(p: LlmProviderRow, healthy: boolean | undefined): Tone {
  if (!p.enabled) return 'muted'
  if (healthy === false) return 'err'
  if (healthy === true) return 'ok'
  return 'info'
}

/* ============================================================
 * shared loading / error helper
 * ============================================================ */
function LoadErr({
  isLoading,
  isError,
  label,
}: {
  isLoading: boolean
  isError: boolean
  label: string
}) {
  if (isError) {
    return (
      <Banner tone="err">
        Failed to load {label}. The endpoint returned an error — no data is shown rather than a
        fabricated value.
      </Banner>
    )
  }
  if (isLoading) {
    return <Banner tone="info">Loading {label}…</Banner>
  }
  return null
}

/* domain-local hook for the per-role default-models read (no dedicated typed
 * hook). Real route: GET /api/admin/llm-providers/default-models →
 * { defaults: { chat, code, embedding, vision, imageGen } } (nullable). */
interface DefaultModels extends Record<string, unknown> {
  chat?: string | null
  code?: string | null
  embedding?: string | null
  vision?: string | null
  imageGen?: string | null
}
interface DefaultModelsResponse {
  defaults?: DefaultModels
}
function useDefaultModels() {
  return useAdminQuery<DefaultModelsResponse>(
    ['llm-default-models'],
    '/api/admin/llm-providers/default-models',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

/* permissive read of capability flags off a registry row's `capabilities`
 * sub-object (the shape varies per provider build — chat/tools/vision/etc.). */
function capsOf(r: LlmRegistryRow): string[] {
  const c = (r.capabilities ?? {}) as Record<string, unknown>
  return Object.entries(c)
    .filter(([k, v]) => v === true && typeof k === 'string')
    .map(([k]) => k)
}
/** small token-only capability chip row (mock's .cap-pill). */
function CapPills({ caps }: { caps: string[] }) {
  if (!caps.length) return <span style={{ color: 'var(--fg-3)' }}>—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {caps.map((c) => (
        <Tag key={c}>{c}</Tag>
      ))}
    </span>
  )
}

/* ============================================================
 * 1. providers · lp — provider table (enable/disable, health, key status)
 * ============================================================ */
/** transient inline status toast — token-only, auto-dismisses. */
function useNotify(): { node: React.ReactNode; notify: NotifyFn } {
  const [msg, setMsg] = React.useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify: NotifyFn = React.useCallback((tone, text) => {
    setMsg({ tone, text })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 4500)
  }, [])
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const node = msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null
  return { node, notify }
}

function ProvidersPage(_props: LeafPageProps) {
  const prov = useLlmProviders()
  const health = useProviderHealth()
  const { node: toast, notify } = useNotify()

  // dialog state — null = closed; { editing } opens the modal (editing null = create).
  const [provModal, setProvModal] = React.useState<{ editing: LlmProviderRow | null } | null>(null)
  const [sandbox, setSandbox] = React.useState<{ provider?: string } | null>(null)

  const rows = prov.data?.providers ?? []
  const total = prov.data?.totalProviders ?? rows.length
  const totalModels = prov.data?.totalModels
  const enabledCt = rows.filter((r) => r.enabled).length

  // health lookup by provider name (permissive on either envelope shape)
  const healthByName = React.useMemo(() => {
    const m = new Map<string, boolean>()
    for (const h of health.data?.providers ?? []) {
      const name = h.provider ?? ''
      const ok = h.healthy ?? (h.status ? h.status.toLowerCase() === 'healthy' : undefined)
      if (name && ok != null) m.set(name, ok)
    }
    return m
  }, [health.data])

  const healthyCt = rows.filter((r) => r.enabled && healthByName.get(r.name) === true).length
  const downCt = rows.filter((r) => r.enabled && healthByName.get(r.name) === false).length

  const strip: Kpi[] = [
    { label: 'Total providers', val: prov.data ? total : '—', tone: 'accent', sub: `${total - enabledCt} disabled` },
    {
      label: 'Healthy',
      val: prov.data ? `${healthyCt}/${enabledCt}` : '—',
      tone: downCt > 0 ? 'warn' : 'ok',
      sub: downCt > 0 ? `${downCt} down` : 'all reachable',
    },
    {
      label: 'Models registered',
      val: totalModels != null ? totalModels : '—',
      tone: 'info',
      sub: `across ${total} providers`,
    },
    {
      label: 'Enabled',
      val: prov.data ? enabledCt : '—',
      tone: 'ok',
      sub: `${rows.filter((r) => r.capabilities?.tools).length} tool-capable`,
    },
  ]

  const cols: DtColumn<LlmProviderRow>[] = [
    {
      label: 'Provider',
      val: (r) => r.displayName ?? r.name,
      render: (r) => (
        <span>
          <span className="awc-name">{r.displayName ?? r.name}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.type}
            {r.config?.region ? ` · ${r.config.region}` : ''}
            {r.config?.endpoint ? ` · ${String(r.config.endpoint).slice(0, 32)}` : ''}
          </div>
        </span>
      ),
    },
    { label: 'Tier', render: (r) => <Tag>{r.priority != null ? `P${r.priority}` : '—'}</Tag> },
    {
      label: 'Status',
      render: (r) => {
        const h = healthByName.get(r.name)
        const tone = providerStatusTone(r, h)
        const label = !r.enabled ? 'off' : h === false ? 'down' : h === true ? 'healthy' : 'unknown'
        return (
          <Pill tone={tone} dot>
            {label}
          </Pill>
        )
      },
    },
    { label: 'Models', r: true, val: (r) => r.models?.length ?? 0 },
    {
      label: 'Auth',
      render: (r) => (
        <Tag>{r.authConfig?.type ?? (r.authConfig?.hasApiKey ? 'api-key' : r.authConfig?.hasCredentials ? 'creds' : 'none')}</Tag>
      ),
    },
    {
      label: 'Enabled',
      render: (r) => (
        <Pill tone={r.enabled ? 'ok' : 'muted'} dot>
          {r.enabled ? 'on' : 'off'}
        </Pill>
      ),
    },
    {
      label: 'Actions',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button className="awc-btn awc-sm awc-ghost" onClick={() => setProvModal({ editing: r })}>
            edit
          </button>
          <button className="awc-btn awc-sm awc-ghost" onClick={() => setSandbox({ provider: r.name })}>
            sandbox
          </button>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Providers"
        sub={
          prov.data
            ? `${total} registered · ${healthyCt}/${enabledCt} healthy · ${totalModels ?? '—'} models · auto-refresh 30s`
            : 'all LLM providers · /api/admin/llm-providers'
        }
        actions={[
          { label: 'Refresh', ic: '↻ ', onClick: () => prov.refetch() },
          { label: 'Sandbox', ic: '▷ ', onClick: () => setSandbox({}) },
          { label: 'Add provider', ic: '＋ ', primary: true, onClick: () => setProvModal({ editing: null }) },
        ]}
        mode="editable"
      />
      {toast}
      {downCt > 0 && (
        <Banner tone="err">
          <b>
            {downCt} provider{downCt === 1 ? '' : 's'} down
          </b>{' '}
          — health probe failing. Rotate the credential or disable the provider so chat stops
          routing to it.
        </Banner>
      )}
      <KpiStrip kpis={strip} />
      <Section title="Overview" sub="click a row to edit · /llm-providers/health" />
      <LoadErr isLoading={prov.isLoading} isError={prov.isError} label="providers" />
      {prov.data && (
        // DataTable<T> needs T extends Record<string, unknown>; LlmProviderRow's
        // typed `models[]`/`config` fields don't satisfy the index constraint, so
        // <any> here (the cols + handlers are still typed against LlmProviderRow).
        <DataTable<any>
          cols={cols as DtColumn<any>[]}
          rows={rows}
          onRow={(r) => setProvModal({ editing: r as LlmProviderRow })}
          search="provider, type, endpoint…"
          dimKey="enabled"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'healthy', label: 'healthy', cnt: healthyCt },
              { id: 'down', label: 'down', cnt: downCt },
              { id: 'disabled', label: 'disabled', cnt: rows.length - enabledCt },
            ],
            filter: (row, chip) => {
              const r = row as LlmProviderRow
              if (chip === 'all') return true
              if (chip === 'disabled') return !r.enabled
              if (chip === 'healthy') return r.enabled && healthByName.get(r.name) === true
              if (chip === 'down') return r.enabled && healthByName.get(r.name) === false
              return true
            },
          }}
          empty="No providers configured"
        />
      )}

      <Section
        title="Change feed"
        sub="chain-of-custody · who changed which provider, when · /audit-logs?resourceType=LLMProvider"
      />
      <ProviderAuditFeed />

      {provModal && (
        <ProviderModal
          editing={provModal.editing}
          notify={notify}
          onClose={() => setProvModal(null)}
        />
      )}
      {sandbox && (
        <ModelSandbox
          initialProvider={sandbox.provider}
          notify={notify}
          onClose={() => setSandbox(null)}
        />
      )}
    </>
  )
}

/* ============================================================
 * 2. model-management · lm — model registry table (provider, tier, ctx, role)
 * ============================================================ */
function ModelManagementPage(_props: LeafPageProps) {
  // include disabled rows so the catalog is complete
  const reg = useLlmRegistry(false)
  const { node: toast, notify } = useNotify()
  const [modelModal, setModelModal] = React.useState<{ editing: LlmRegistryRow | null } | null>(null)
  const [sandbox, setSandbox] = React.useState<{ provider?: string; model?: string } | null>(null)
  const rows = reg.data ?? []
  const enabledCt = rows.filter((r) => r.enabled).length
  const providerCt = new Set(rows.map((r) => r.provider).filter(Boolean)).size
  const costRows = rows.filter((r) => r.enabled && (r.inputCostPer1k ?? 0) > 0)
  const avgCostPer1M =
    costRows.length > 0
      ? (costRows.reduce((a, r) => a + (r.inputCostPer1k ?? 0), 0) / costRows.length) * 1000
      : 0

  const strip: Kpi[] = [
    { label: 'Models in registry', val: reg.data ? rows.length : '—', tone: 'accent' },
    {
      label: 'Enabled',
      val: reg.data ? `${enabledCt}/${rows.length}` : '—',
      tone: 'ok',
      sub: `${rows.length - enabledCt} disabled`,
    },
    { label: 'Providers', val: reg.data ? providerCt : '—', tone: 'info' },
    {
      label: 'Avg cost / 1M tok',
      val: costRows.length ? fmtUsd(avgCostPer1M) : '—',
      tone: 'warn',
      sub: costRows.length ? `${costRows.length} priced` : 'local / free',
    },
  ]

  const cols: DtColumn<LlmRegistryRow>[] = [
    {
      label: 'Model',
      val: (r) => r.model,
      render: (r) => (
        <span>
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>
            {r.model}
          </span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.role}
            {(r.inputCostPer1k ?? 0) > 0
              ? ` · in ${fmtUsd((r.inputCostPer1k ?? 0) * 1000)} / 1M`
              : ' · local · no per-token cost'}
          </div>
        </span>
      ),
    },
    { label: 'Provider', val: (r) => r.provider },
    { label: 'Role', render: (r) => <Tag>{r.role}</Tag> },
    { label: 'Capabilities', render: (r) => <CapPills caps={capsOf(r)} /> },
    {
      label: 'FCA',
      r: true,
      sortVal: (r) => (r.functionCallingAccuracy ?? -1) as number,
      render: (r) => <span>{fmtFca(r.functionCallingAccuracy as number | undefined)}</span>,
    },
    {
      label: 'Max ctx',
      r: true,
      sortVal: (r) => (r.maxContextTokens as number | undefined) ?? -1,
      render: (r) =>
        r.maxContextTokens != null ? (
          <span>{fmtNum(r.maxContextTokens as number)}</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
    {
      label: 'Thinking',
      r: true,
      sortVal: (r) => (r.thinking_budget as number | undefined) ?? -1,
      render: (r) =>
        r.thinking_budget != null ? (
          <span>{fmtNum(r.thinking_budget as number)}</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
    {
      label: 'Enabled',
      render: (r) => (
        <Pill tone={r.enabled ? 'ok' : 'muted'} dot>
          {r.enabled ? 'on' : 'off'}
        </Pill>
      ),
    },
    {
      label: 'Actions',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button className="awc-btn awc-sm awc-ghost" onClick={() => setModelModal({ editing: r })}>
            edit
          </button>
          <button
            className="awc-btn awc-sm awc-ghost"
            onClick={() => setSandbox({ provider: r.provider, model: r.model })}
          >
            test
          </button>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Models"
        sub={
          reg.data
            ? `${rows.length} models · ${enabledCt} enabled · ${providerCt} providers · auto-refresh 60s`
            : 'model registry · /api/admin/llm-providers/registry'
        }
        actions={[
          { label: 'Refresh', ic: '↻ ', onClick: () => reg.refetch() },
          { label: 'Sandbox', ic: '▷ ', onClick: () => setSandbox({}) },
          { label: 'Add model', ic: '＋ ', primary: true, onClick: () => setModelModal({ editing: null }) },
        ]}
        mode="editable"
      />
      {toast}
      <Section title="Catalog" sub="click a row to edit · PATCH /registry/:id" />
      <LoadErr isLoading={reg.isLoading} isError={reg.isError} label="model registry" />
      {reg.data && (
        <DataTable<LlmRegistryRow>
          cols={cols}
          rows={rows}
          onRow={(r) => setModelModal({ editing: r })}
          search="model, provider, role…"
          dimKey="enabled"
          pageSize={12}
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'enabled', label: 'enabled', cnt: enabledCt },
              { id: 'disabled', label: 'disabled', cnt: rows.length - enabledCt },
            ],
            filter: (row, chip) => {
              const r = row as LlmRegistryRow
              return chip === 'all' ? true : chip === 'enabled' ? r.enabled : !r.enabled
            },
          }}
          empty="No models in the registry"
        />
      )}

      {modelModal && (
        <ModelModal
          editing={modelModal.editing}
          notify={notify}
          onClose={() => setModelModal(null)}
        />
      )}
      {sandbox && (
        <ModelSandbox
          initialProvider={sandbox.provider}
          initialModel={sandbox.model}
          notify={notify}
          onClose={() => setSandbox(null)}
        />
      )}
    </>
  )
}

/* ============================================================
 * 3. default-models · ld — default-model-per-role (chat/code/embedding/…)
 * ============================================================ */
interface RoleRow extends Record<string, unknown> {
  role: string
  useCase: string
  model: string | null
  registered: boolean
}
function DefaultModelsPage(_props: LeafPageProps) {
  const dm = useDefaultModels()
  const reg = useLlmRegistry(false)

  const defaults = dm.data?.defaults ?? {}
  const registeredModels = React.useMemo(
    () => new Set((reg.data ?? []).filter((r) => r.enabled).map((r) => r.model)),
    [reg.data],
  )

  // mock's role order + use-case captions (these are LITERAL service mappings,
  // not fabricated data — the model VALUES come from the live endpoint).
  const ROLE_META: Array<{ role: keyof DefaultModels; label: string; useCase: string }> = [
    { role: 'chat', label: 'chat', useCase: 'ChatCompletionService · session defaults' },
    { role: 'code', label: 'code', useCase: 'Agenticode CLI · /api/agenticode' },
    { role: 'embedding', label: 'embedding', useCase: 'UniversalEmbeddingService · Milvus · DocsRAG' },
    { role: 'vision', label: 'vision', useCase: 'vision-capable messages' },
    { role: 'imageGen', label: 'imageGen', useCase: 'generate_image tool' },
  ]

  const rows: RoleRow[] = ROLE_META.map((m) => {
    const model = (defaults[m.role] as string | null | undefined) ?? null
    return {
      role: m.label,
      useCase: m.useCase,
      model,
      registered: model ? registeredModels.has(model) : false,
    }
  })

  const configured = rows.filter((r) => r.model).length
  const stale = rows.filter((r) => r.model && !r.registered && reg.data).length

  const strip: Kpi[] = [
    {
      label: 'Roles configured',
      val: dm.data ? `${configured}/${rows.length}` : '—',
      tone: stale > 0 ? 'warn' : 'ok',
      sub: stale > 0 ? `${stale} stale` : 'all resolve',
    },
    {
      label: 'Models in registry',
      val: reg.data ? registeredModels.size : '—',
      tone: 'info',
      sub: 'enabled only',
    },
    {
      label: 'Unset roles',
      val: dm.data ? rows.length - configured : '—',
      tone: rows.length - configured > 0 ? 'muted' : 'ok',
      sub: 'fall through to chat default',
    },
    {
      label: 'Stale pins',
      val: reg.data && dm.data ? stale : '—',
      tone: stale > 0 ? 'err' : 'ok',
      sub: 'model no longer enabled',
    },
  ]

  const cols: DtColumn<RoleRow>[] = [
    {
      label: 'Role',
      val: (r) => r.role,
      render: (r) => (
        <span>
          <span className="awc-name">{r.role}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.useCase}
          </div>
        </span>
      ),
    },
    {
      label: 'Assigned model',
      render: (r) =>
        r.model ? (
          <span
            style={{
              fontFamily: 'var(--font-v3-mono)',
              color: r.registered || !reg.data ? 'var(--fg-1)' : 'var(--err)',
            }}
          >
            {r.model}
            {r.model && !r.registered && reg.data ? ' (stale)' : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>unset</span>
        ),
    },
    {
      label: 'Status',
      render: (r) =>
        !r.model ? (
          <Pill tone="muted" dot>
            unset
          </Pill>
        ) : r.registered || !reg.data ? (
          <Pill tone="ok" dot>
            resolves
          </Pill>
        ) : (
          <Pill tone="err" dot>
            stale
          </Pill>
        ),
    },
  ]

  return (
    <>
      <PageHead
        title="Default Models"
        sub={
          dm.data
            ? `${configured}/${rows.length} roles configured · ${registeredModels.size} models registered · auto-refresh 60s`
            : 'per-role model defaults · /api/admin/llm-providers/default-models'
        }
        actions={[
          { label: 'Reset to seed', ic: '⟲ ' },
          { label: 'Assign role', ic: '＋ ', primary: true },
        ]}
        mode="editable"
      />
      {stale > 0 && (
        <Banner tone="warn">
          <b>
            {stale} role{stale === 1 ? '' : 's'} stale
          </b>{' '}
          — pinned to a model no longer in the enabled registry → the router falls through to the
          chat default. Re-assign or re-enable the model.
        </Banner>
      )}
      <LoadErr isLoading={dm.isLoading} isError={dm.isError} label="default models" />
      <KpiStrip kpis={strip} />
      <Section title="Roles" sub="one default model per router role" />
      {dm.data && (
        <DataTable<RoleRow>
          cols={cols}
          rows={rows}
          search="role, model…"
          pageSize={8}
          empty="No roles configured"
        />
      )}
    </>
  )
}

/* ============================================================
 * 4. router-tuning · lr — scoring weights form + FCA floors + scoring lab
 * ============================================================ */
function RouterTuningPage(_props: LeafPageProps) {
  const rt = useRouterTuning()
  const reg = useLlmRegistry(true)
  const t = rt.data?.tuning

  const v = (key: keyof NonNullable<typeof t>): number | undefined => {
    const x = t?.[key]
    return typeof x === 'number' ? x : undefined
  }
  const b = (key: keyof NonNullable<typeof t>): boolean | undefined => {
    const x = t?.[key]
    return typeof x === 'boolean' ? x : undefined
  }

  // FCA floors → editable KPI strip (mock parity)
  const floors: Kpi[] = [
    { label: 'fcaChatPoolFloor', val: t ? v('fcaChatPoolFloor') ?? '—' : '—', tone: 'accent', sub: 'kicks low-FCA out of chat' },
    { label: 'fcaSimpleToolFloor', val: t ? v('fcaSimpleToolFloor') ?? '—' : '—', tone: 'accent', sub: 'single-round tools' },
    { label: 'fcaComplexToolFloor', val: t ? v('fcaComplexToolFloor') ?? '—' : '—', tone: 'accent', sub: 'multi-step chains' },
    { label: 'fcaDestructiveFloor', val: t ? v('fcaDestructiveFloor') ?? '—' : '—', tone: 'warn', sub: 'delete · drop · terminate' },
    { label: 'fcaInfraOpsFloor', val: t ? v('fcaInfraOpsFloor') ?? '—' : '—', tone: 'accent', sub: 'provision · rebuild · query' },
    { label: 'fcaComplexityBiasFloor', val: t ? v('fcaComplexityBiasFloor') ?? '—' : '—', tone: 'warn', sub: '≥2 complexity keywords' },
    { label: 'fcaT3Floor', val: t ? v('fcaT3Floor') ?? '—' : '—', tone: 'warn', sub: 'T3 capability gate' },
    { label: 'contextT3Floor', val: t ? (v('contextT3Floor') != null ? fmtNum(v('contextT3Floor')!) : '—') : '—', tone: 'warn', sub: 'tokens · T3 gate' },
  ]

  const scoringRows: FormRow[] = [
    { label: 'costBonusMaxPoints', type: 'number', value: v('costBonusMaxPoints'), desc: '0–500' },
    { label: 'costWeight', type: 'number', value: v('costWeight'), desc: 'step 0.05 · 0–1' },
    { label: 'qualityWeight', type: 'number', value: v('qualityWeight'), desc: 'step 0.05 · 0–1' },
    { label: 'fcaQualityFloor', type: 'number', value: v('fcaQualityFloor'), desc: 'step 0.01 · 0–1' },
    { label: 'fcaQualityMultiplier', type: 'number', value: v('fcaQualityMultiplier'), desc: '0–1000' },
    { label: 'fcaQualityGatedByComplexity', type: 'toggle', value: b('fcaQualityGatedByComplexity'), desc: 'gated by complexity' },
    { label: 'latencyBonusMaxPoints', type: 'number', value: v('latencyBonusMaxPoints'), desc: '0–500' },
    { label: 'toolCallingBonusMaxPoints', type: 'number', value: v('toolCallingBonusMaxPoints'), desc: 'if hasTools' },
    { label: 'reasoningBonusMaxPoints', type: 'number', value: v('reasoningBonusMaxPoints'), desc: 'if multi-step' },
    { label: 'costNormalizationCeiling', type: 'number', value: v('costNormalizationCeiling'), desc: '$/1k · step 0.001' },
  ]

  const t3Rows: FormRow[] = [
    { label: 't3TriggerTaskTypes', type: 'json', value: t ? asText(t.t3TriggerTaskTypes) : undefined },
    { label: 'capabilityProfileFloors', type: 'json', value: t ? asText(t.capabilityProfileFloors) : undefined },
    { label: 'capabilityContextFloors', type: 'json', value: t ? asText(t.capabilityContextFloors) : undefined },
    { label: 'intentClassifierEnabled', type: 'toggle', value: b('intentClassifierEnabled') },
    { label: 'intentClassifierModelId', type: 'text', value: t?.intentClassifierModelId },
  ]

  // ScoreBreakdownTable — real chat-capable registry rows scored against the
  // live fcaT3Floor (no fabricated rows; FCA/cost/latency come from the registry).
  const t3Floor = (v('fcaT3Floor') ?? 0.93) as number
  interface LabRow extends Record<string, unknown> {
    id: string
    role: string
    fca: number | null
    cost1k: number | null
    lat: number | null
    pass: boolean
  }
  const labRows: LabRow[] = (reg.data ?? [])
    .filter((r) => capsOf(r).includes('chat') || r.role === 'chat')
    .map((r) => {
      const fcaRaw = r.functionCallingAccuracy as number | null | undefined
      const fca = fcaRaw == null ? null : fcaRaw <= 1 ? fcaRaw : fcaRaw / 100
      return {
        id: r.model,
        role: r.role,
        fca,
        cost1k: (r.inputCostPer1k as number | undefined) ?? null,
        lat: (r.avgLatencyMs as number | undefined) ?? null,
        pass: fca != null && fca >= t3Floor,
      }
    })

  const labCols: DtColumn<LabRow>[] = [
    {
      label: 'Model',
      val: (r) => r.id,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={r.pass ? 'ok' : 'muted'} />
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>
            {r.id}
          </span>
        </span>
      ),
    },
    { label: 'Role', render: (r) => <Tag>{r.role}</Tag> },
    { label: 'FCA', r: true, sortVal: (r) => r.fca ?? -1, render: (r) => fmtFca(r.fca) },
    { label: '$/1k', r: true, sortVal: (r) => r.cost1k ?? -1, render: (r) => (r.cost1k != null ? fmtUsd(r.cost1k) : '—') },
    { label: 'Latency', r: true, sortVal: (r) => r.lat ?? -1, render: (r) => fmtMs(r.lat) },
    {
      label: 'T3 gate',
      r: true,
      sortVal: (r) => (r.pass ? 1 : 0),
      render: (r) =>
        r.fca == null ? (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ) : r.pass ? (
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>pass</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>&lt; floor</span>
        ),
    },
  ]

  const podCount = rt.data?.podCount
  return (
    <>
      <PageHead
        title="Router Tuning"
        sub={
          rt.data
            ? `Smart Router scoring weights · ${podCount != null ? `${podCount} pods synced` : 'pods —'} · ${rt.data.lastUpdatedAt ? `updated ${relTime(rt.data.lastUpdatedAt)}` : 'never updated'}`
            : 'scoring weights + FCA floors · /api/admin/router-tuning'
        }
        actions={[
          { label: 'Reset to defaults', ic: '⟲ ' },
          { label: 'Save & apply live', ic: '✓ ', primary: true },
        ]}
        mode="editable"
      />
      <Banner tone="info">
        A <b>0.1</b> weight change typically shifts <b>10–30%</b> of routed traffic. FCA =
        Function-Calling Accuracy floor · cost = $/1M weight · latency = p95 ms weight · quality =
        BFCL + MMLU + agent blend.
      </Banner>
      <LoadErr isLoading={rt.isLoading} isError={rt.isError} label="router tuning" />
      {rt.data ? (
        <>
          <FormSection title="Scoring formula" sub="weights & bonuses" rows={scoringRows} mode="editable" />
          <Section title="FCA floors" sub="minimum function-calling accuracy per intent class" />
          <KpiStrip kpis={floors} />
          <FormSection title="T3 capability gates" sub="stage + revert · JSON tuning" rows={t3Rows} mode="editable" />
          <Section title="Score breakdown" sub={`chat-capable registry rows scored vs fcaT3Floor ${t3Floor}`} />
          {reg.data ? (
            <DataTable<LabRow>
              cols={labCols}
              rows={labRows}
              search="model…"
              pageSize={8}
              empty="No chat-capable models in the registry"
            />
          ) : (
            <Banner tone="info">Loading the registry to score against the live floors…</Banner>
          )}
        </>
      ) : (
        !rt.isLoading && (
          <Banner tone="warn">
            Router tuning config not surfaced on this build — weights and floors are not shown rather
            than fabricated. Wire <b>/api/admin/router-tuning</b> to populate this page.
          </Banner>
        )
      )}
    </>
  )
}

/* ============================================================
 * 5. ollama · lo — live Ollama host probe (READ-ONLY)
 * ============================================================ */
function OllamaPage(_props: LeafPageProps) {
  const oll = useOllamaHosts()
  const rows = oll.data?.hosts ?? []

  const statusOf = (r: OllamaHostRow): string => String(r.status ?? 'unknown').toLowerCase()
  const isConnected = (r: OllamaHostRow) => ['connected', 'ok', 'healthy', 'running'].includes(statusOf(r))
  const connectedCt = rows.filter(isConnected).length
  const totalModels = rows.reduce((a, r) => a + (r.modelCount ?? 0), 0)
  const totalRunning = rows.reduce((a, r) => a + (r.runningCount ?? 0), 0)

  const strip: Kpi[] = [
    {
      label: 'Ollama hosts',
      val: oll.data ? `${connectedCt}/${rows.length}` : '—',
      tone: connectedCt < rows.length ? 'warn' : 'ok',
      sub: `${rows.length} registered`,
    },
    { label: 'Models (live)', val: oll.data ? totalModels : '—', tone: 'accent', sub: 'across hosts' },
    { label: 'Running now', val: oll.data ? totalRunning : '—', tone: 'info', sub: 'loaded into VRAM' },
    {
      label: 'Unreachable',
      val: oll.data ? rows.length - connectedCt : '—',
      tone: rows.length - connectedCt > 0 ? 'err' : 'ok',
      sub: 'probe failed',
    },
  ]

  const cols: DtColumn<OllamaHostRow>[] = [
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={isConnected(r) ? 'ok' : 'err'} dot>
          {isConnected(r) ? 'connected' : statusOf(r)}
        </Pill>
      ),
    },
    {
      label: 'Host',
      val: (r) => r.displayName ?? r.name ?? r.id ?? '—',
      render: (r) => (
        <span>
          <span className="awc-name">{r.displayName ?? r.name ?? r.id ?? '—'}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.host ?? r.endpoint ?? '—'}
          </div>
        </span>
      ),
    },
    { label: 'Models', r: true, val: (r) => r.modelCount ?? 0 },
    {
      label: 'Running',
      r: true,
      sortVal: (r) => r.runningCount ?? 0,
      render: (r) => (
        <span style={{ color: (r.runningCount ?? 0) > 0 ? 'var(--ok)' : 'var(--fg-3)' }}>
          {r.runningCount ?? 0}
        </span>
      ),
    },
    { label: 'Chat model', render: (r) => <span style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.chatModel ?? 'auto'}</span> },
    { label: 'Pri', r: true, val: (r) => r.priority ?? '—' },
    { label: 'Last sync', val: (r) => relTime(r.lastSync) },
    {
      label: 'Error',
      render: (r) =>
        r.error ? (
          <span style={{ color: 'var(--err)', fontSize: 11 }}>{asText(r.error)}</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
  ]

  return (
    <>
      <PageHead
        title="Ollama Hosts"
        sub={
          oll.data
            ? `${connectedCt}/${rows.length} connected · ${totalModels} models · ${totalRunning} running · live probe`
            : 'live Ollama host probe · /api/admin/ollama/hosts'
        }
        actions={[{ label: 'Refresh', ic: '↻ ' }]}
        mode="readonly"
      />
      <Banner tone="info">
        Read-only — sync / pull / delete / test mutations stay in the v2 view. Each row is a live
        probe against the host; an unreachable host shows its probe error, never a fabricated status.
      </Banner>
      <LoadErr isLoading={oll.isLoading} isError={oll.isError} label="Ollama hosts" />
      <KpiStrip kpis={strip} />
      <Section title="Ollama hosts" sub="live probe per row · auto-refresh 60s" />
      {oll.data &&
        (rows.length ? (
          <DataTable<any>
            cols={cols}
            rows={rows}
            search="host…"
            pageSize={8}
            empty="No Ollama hosts registered"
          />
        ) : (
          <Banner tone="warn">
            No Ollama providers configured — add a provider of type <b>ollama</b> on the Providers
            leaf to surface live host probes here.
          </Banner>
        ))}
    </>
  )
}

/* ============================================================
 * 6. tiered-fc · lt — DEPRECATED (replaced by SmartModelRouter FCA scoring GH-622)
 * ============================================================ */
interface LegacyMapRow extends Record<string, unknown> {
  legacy: string
  now: string
}
function TieredFcPage(_props: LeafPageProps) {
  // These are LITERAL field→config mappings (the mock's static "where it lives
  // now" table), not runtime data — there is nothing to fetch or fabricate.
  const mapRows: LegacyMapRow[] = [
    { legacy: 'cheapModel selector', now: 'Router Tuning → fcaChatPoolFloor / fcaSimpleToolFloor' },
    { legacy: 'balancedModel selector', now: 'Router Tuning → fcaComplexToolFloor' },
    { legacy: 'premiumModel selector', now: 'Router Tuning → fcaDestructiveFloor + T3 gates' },
  ]
  const cols: DtColumn<LegacyMapRow>[] = [
    {
      label: 'Legacy field (no effect)',
      val: (r) => r.legacy,
      render: (r) => <span className="awc-name">{r.legacy}</span>,
    },
    {
      label: 'Now lives at',
      render: (r) => <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{r.now}</span>,
    },
  ]

  return (
    <>
      <PageHead
        title="Tiered Function Calling"
        sub="DEPRECATED · replaced by SmartModelRouter FCA scoring (GH-622)"
        actions={[{ label: 'Open Router Tuning →', ic: '⚖ ' }]}
        mode="deprecated"
      />
      <Banner tone="warn">
        <b>Deprecated.</b> The old cheap / balanced / premium tier selectors had no effect — writes
        are silently ignored. Routing now goes through FCA scoring. Use <b>Router Tuning</b>.
      </Banner>
      <Banner tone="info">
        The v2 pipeline routes via FCA scoring, not tier buckets.{' '}
        <span style={{ fontFamily: 'var(--font-v3-mono)' }}>
          TieredFunctionCallingService.makeDecision()
        </span>{' '}
        is called only from the admin config-test endpoint — zero chat-pipeline call sites.
      </Banner>
      <Section title="Where the old settings live now" sub="read-only navigation map" />
      <DataTable<LegacyMapRow>
        cols={cols}
        rows={mapRows}
        search="legacy field…"
        pageSize={8}
        empty="—"
      />
    </>
  )
}

/* ============================================================
 * 7. llm-performance · lf — latency / throughput / reliability charts
 * ============================================================ */
function LlmPerformancePage(_props: LeafPageProps) {
  const perf = useLlmPerformance(24)
  const trends = useLlmPerformanceTrends(24)
  const reg = useLlmRegistry(true)

  const k = (perf.data?.kpis ?? {}) as Record<string, unknown>
  const num = (key: string): number | undefined => {
    const x = k[key]
    return typeof x === 'number' ? x : undefined
  }

  const strip: Kpi[] = [
    {
      label: 'Avg TTFT',
      val: num('avgTTFT') != null ? Math.round(num('avgTTFT')!) : '—',
      unit: num('avgTTFT') != null ? 'ms' : undefined,
      tone: 'ok',
      sub: num('p95TTFT') != null ? `p95 ${Math.round(num('p95TTFT')!)}` : undefined,
    },
    {
      label: 'Avg Response',
      val: num('avgResponseTime') != null ? Math.round(num('avgResponseTime')!) : '—',
      unit: num('avgResponseTime') != null ? 'ms' : undefined,
      tone: 'ok',
      sub: num('p95ResponseTime') != null ? `p95 ${Math.round(num('p95ResponseTime')!)}` : undefined,
    },
    {
      label: 'Throughput',
      val: num('avgTokensPerSecond') != null ? Math.round(num('avgTokensPerSecond')!) : '—',
      unit: num('avgTokensPerSecond') != null ? 'tok/s' : undefined,
      tone: 'accent',
    },
    {
      label: 'Requests',
      val: num('totalRequests') != null ? fmtNum(num('totalRequests')) : '—',
      tone: 'info',
      sub: 'window 24h',
    },
    {
      label: 'Error rate',
      val: num('errorRate') != null ? fmtPct(num('errorRate')! <= 1 ? num('errorRate')! * 100 : num('errorRate')!) : '—',
      tone: (num('errorRate') ?? 0) > 0.02 ? 'warn' : 'ok',
    },
  ]

  // Bucketed latency series from the trends endpoint (real points, honest-empty
  // when the build has no buckets).
  const trendPts = trends.data?.trends ?? []
  const p50Series = trendPts.map((p) => (p.p50TotalLatency as number) ?? (p.avgTotalLatency as number) ?? 0)
  const p95Series = trendPts.map((p) => (p.p95TotalLatency as number) ?? 0)
  const ttft50 = trendPts.map((p) => (p.p50TTFT as number) ?? (p.avgTTFT as number) ?? 0)
  const ttft95 = trendPts.map((p) => (p.p95TTFT as number) ?? 0)
  const labels = trendPts.map((p) => {
    const raw = p.bucket ?? p.timestamp
    if (raw == null) return ''
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return String(raw).slice(11, 16)
    const z = (n: number) => String(n).padStart(2, '0')
    return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
  })
  const hasTrend = trendPts.length > 0 && p50Series.some((v) => v > 0)

  const respSeries: AreaSeries[] = [
    { name: 'p50', data: p50Series },
    { name: 'p95', data: p95Series },
  ]
  const ttftSeries: AreaSeries[] = [
    { name: 'p50', data: ttft50 },
    { name: 'p95', data: ttft95 },
  ]

  // Latency-by-model bars from the registry's avgLatencyMs (real, top-8).
  const latBars: HBarItem[] = (reg.data ?? [])
    .filter((r) => (r.avgLatencyMs as number | undefined) != null && (r.avgLatencyMs as number) > 0)
    .sort((a, b) => (b.avgLatencyMs as number) - (a.avgLatencyMs as number))
    .slice(0, 8)
    .map((r) => ({
      l: String(r.model).slice(0, 24),
      v: r.avgLatencyMs as number,
      tone: 'accent',
      disp: fmtMs(r.avgLatencyMs as number),
    }))

  return (
    <>
      <PageHead
        title="Performance Metrics"
        sub="LLM latency, throughput & reliability · /api/admin/metrics/llm/performance"
        actions={[{ label: 'Window: 24h', ic: '◷ ' }]}
        mode="readonly"
      />
      <LoadErr isLoading={perf.isLoading} isError={perf.isError} label="LLM performance" />
      <KpiStrip kpis={strip} />
      <Section title="Latency trend" sub="bucketed over 24h · /performance-trends" />
      {hasTrend ? (
        <div className="awc-grid2">
          <ChartCard title="Response time · p50 / p95" sub="ms over 24h">
            <AreaChart series={respSeries} labels={labels} tone={['accent', 'warn']} />
          </ChartCard>
          <ChartCard title="Time to first token · p50 / p95" sub="ms over 24h">
            <AreaChart series={ttftSeries} labels={labels} tone={['ok', 'purple']} />
          </ChartCard>
        </div>
      ) : (
        <Banner tone="info">
          {trends.isLoading
            ? 'Loading the bucketed latency series…'
            : 'No bucketed latency series for this window — the performance-trends endpoint returned no buckets. Charts populate once requests flow through the window.'}
        </Banner>
      )}
      <Section title="Latency by model" sub="top-8 by avg latency · from the registry" />
      <div className="awc-chartcard">
        {reg.isLoading ? (
          <Banner tone="info">Loading the model registry…</Banner>
        ) : latBars.length ? (
          <HBars items={latBars} />
        ) : (
          <Banner tone="info">
            No per-model latency on the registry yet — latency populates as models accumulate
            benchmark samples.
          </Banner>
        )}
      </div>
    </>
  )
}

/* ============================================================
 * exports — all 7 Models & Providers leaf ids → page component
 * ============================================================ */
export const modelsPages: Record<string, React.ComponentType<LeafPageProps>> = {
  providers: ProvidersPage,
  'model-management': ModelManagementPage,
  'default-models': DefaultModelsPage,
  'router-tuning': RouterTuningPage,
  ollama: OllamaPage,
  'tiered-fc': TieredFcPage,
  'llm-performance': LlmPerformancePage,
}
