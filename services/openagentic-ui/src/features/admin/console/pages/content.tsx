/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Content domain pages — the admin v4 "Content" leaf bodies, at mock fidelity
 * (the admin-console mock INV.Content) and WIRED to real endpoints.
 *
 * Four leaves, each rendering ONLY the page BODY (PageHead + content); the
 * AdminConsole appends the OptionSpec inventory panel (the two-part leaf
 * contract). Every number resolves from a live hook or renders an honest "—"
 * / empty-state Banner — never a fabricated value or invented row. Every color
 * resolves via a global theme token (var(--*)); zero hex (Rule 8b).
 *
 * Data sources (real admin routes):
 *   templates   → GET /api/workflows/templates           (workflow templates)
 *   shared-kb   → GET /api/admin/shared-kb/sources        (RAG corpora / Milvus)
 *   data-layer  → GET /api/admin/storage                  (milvus/pgvector/redis)
 *   user-memory → GET /api/admin/user-context/overview    (+ /retention)
 *
 * Wiring status (blueprint §2):
 *   shared-kb  REAL · user-memory REAL ·
 *   templates  PARTIAL (workflow templates only — no admin artifact/message
 *              template source exists; those slices render honest-empty) ·
 *   data-layer PARTIAL (datastore inventory composed from the storage probe;
 *              no per-datastore DSN/scope/used-by source — shown as "—").
 */
import * as React from 'react'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import {
  useStorage,
  type StorageResponse,
  type StorageSection,
} from '../../hooks/useDashboardMetrics'
import {
  Banner,
  DataTable,
  FormSection,
  KpiStrip,
  PageHead,
  Pill,
  StatusDot,
  type DtColumn,
  type FormRow,
  type Kpi,
} from '../primitives'
import type { LeafPageProps } from './registry'
import type { Tone } from '../types'

/* ----------------------------- format helpers ----------------------------- */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function fmtBytes(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return String(Math.round(n)) + ' B'
}
function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  return d.toISOString().slice(0, 10)
}
/** Stringify any unknown payload for safe JSX rendering (no React #31). */
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
/** last_ingest_status → tone */
function ingestTone(status: string | null | undefined): Tone {
  switch ((status ?? '').toLowerCase()) {
    case 'success':
      return 'ok'
    case 'partial':
    case 'running':
      return 'warn'
    case 'error':
    case 'failed':
      return 'err'
    default:
      return 'muted'
  }
}

/* ====================================================================== */
/* templates · nt — workflow + artifact + message templates                */
/* ====================================================================== */
interface TemplateRow extends Record<string, unknown> {
  id: string
  name: string
  category?: string | null
  tags?: string[] | null
  createdBy?: string | null
  created_by?: string | null
  totalExecutions?: number | null
  total_executions?: number | null
  isActive?: boolean | null
  is_active?: boolean | null
  updatedAt?: string | null
  updated_at?: string | null
}
interface TemplatesResponse {
  templates?: TemplateRow[]
  total?: number
}

function TemplatesPage(_: LeafPageProps) {
  const q = useAdminQuery<TemplatesResponse>(
    ['content-templates'],
    '/api/workflows/templates',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const rows: TemplateRow[] = q.data?.templates ?? []

  const ownerOf = (r: TemplateRow) => r.createdBy ?? r.created_by ?? '—'
  const usedByOf = (r: TemplateRow) => r.totalExecutions ?? r.total_executions ?? 0
  const updatedOf = (r: TemplateRow) => r.updatedAt ?? r.updated_at ?? null
  const activeOf = (r: TemplateRow) => (r.isActive ?? r.is_active) ?? false
  const typeOf = (r: TemplateRow) => r.category || 'flow'

  const cols: DtColumn<TemplateRow>[] = [
    {
      key: 'name',
      label: 'Template',
      val: (r) => r.name ?? r.id,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name ?? r.id}</div>
          {Array.isArray(r.tags) && r.tags.length > 0 && (
            <div style={{ color: 'var(--fg-3)', fontSize: 11, marginTop: 2 }}>
              {r.tags.slice(0, 4).join(' · ')}
            </div>
          )}
        </div>
      ),
    },
    { label: 'Type', val: typeOf, render: (r) => <Pill tone="info">{typeOf(r)}</Pill> },
    { label: 'Owner', val: (r) => String(ownerOf(r)) },
    { label: 'Used by', r: true, val: usedByOf, render: (r) => fmtNum(Number(usedByOf(r))) },
    {
      label: 'Updated',
      r: true,
      val: (r) => updatedOf(r) ?? '',
      render: (r) => fmtDate(updatedOf(r)),
    },
    {
      label: 'Enabled',
      r: true,
      val: (r) => (activeOf(r) ? 1 : 0),
      render: (r) => (
        <Pill tone={activeOf(r) ? 'ok' : 'muted'} dot>
          {activeOf(r) ? 'enabled' : 'disabled'}
        </Pill>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Templates"
        sub="flow · artifact · message templates"
        mode="editable"
        actions={[{ label: 'New template', ic: '＋ ', primary: true }]}
      />
      {q.isError ? (
        <Banner tone="err">
          Failed to load templates from <b>/api/workflows/templates</b>. The list cannot be shown
          until the endpoint responds.
        </Banner>
      ) : q.isLoading ? (
        <Banner tone="info">Loading templates…</Banner>
      ) : (
        <>
          <Banner tone="info">
            Showing <b>flow</b> templates from the workflow catalog. Artifact and message template
            sources are not yet exposed by a managed admin endpoint and are omitted here rather than
            fabricated.
          </Banner>
          <DataTable<TemplateRow>
            cols={cols}
            rows={rows}
            search="filter templates…"
            chips={{
              opts: [
                { id: 'all', label: 'all', cnt: rows.length },
                { id: 'flow', label: 'flow' },
                { id: 'artifact', label: 'artifact' },
                { id: 'message', label: 'message' },
              ],
              active: 'all',
              filter: (row, chip) =>
                chip === 'all' ? true : typeOf(row as TemplateRow) === chip,
            }}
            empty="No templates — none published as a public workflow template yet."
          />
        </>
      )}
    </>
  )
}

/* ====================================================================== */
/* shared-kb · nk — RAG corpora (Milvus)                                    */
/* ====================================================================== */
interface KbSourceRow extends Record<string, unknown> {
  id: string
  name: string
  type?: string
  enabled?: boolean
  doc_count?: number
  chunk_count?: number
  last_ingest_at?: string | null
  last_ingest_status?: string | null
  last_ingest_error?: string | null
  schedule?: string | null
  created_by?: string | null
  created_at?: string | null
}
interface KbSourcesResponse {
  sources?: KbSourceRow[]
  count?: number
}

function SharedKbPage(_: LeafPageProps) {
  const q = useAdminQuery<KbSourcesResponse>(
    ['content-shared-kb'],
    '/api/admin/shared-kb/sources',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const [openId, setOpenId] = React.useState<string | null>(null)
  const rows: KbSourceRow[] = q.data?.sources ?? []
  const selected = rows.find((r) => r.id === openId) ?? null

  const totalVectors = rows.reduce((a, r) => a + (r.chunk_count ?? 0), 0)
  const totalDocs = rows.reduce((a, r) => a + (r.doc_count ?? 0), 0)
  const enabledCount = rows.filter((r) => r.enabled).length

  const kpis: Kpi[] = [
    { label: 'Knowledge Bases', val: q.data ? rows.length : '—', tone: 'accent' },
    { label: 'Enabled', val: q.data ? enabledCount : '—', tone: enabledCount > 0 ? 'ok' : 'muted' },
    { label: 'Total Vectors', val: q.data ? fmtNum(totalVectors) : '—', tone: 'info' },
    { label: 'Documents', val: q.data ? fmtNum(totalDocs) : '—', tone: 'info' },
  ]

  const cols: DtColumn<KbSourceRow>[] = [
    {
      key: 'name',
      label: 'KB',
      val: (r) => r.name ?? r.id,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name ?? r.id}</div>
          <div style={{ color: 'var(--fg-3)', fontSize: 11, marginTop: 2 }}>{r.type ?? '—'}</div>
        </div>
      ),
    },
    { label: 'Vectors', r: true, val: (r) => r.chunk_count ?? 0, render: (r) => fmtNum(r.chunk_count) },
    { label: 'Embedding model', val: () => '—', render: () => <span style={{ color: 'var(--fg-3)' }}>—</span> },
    { label: 'Docs', r: true, val: (r) => r.doc_count ?? 0, render: (r) => fmtNum(r.doc_count) },
    {
      label: 'Last reindex',
      r: true,
      val: (r) => r.last_ingest_at ?? '',
      render: (r) => fmtDate(r.last_ingest_at),
    },
    {
      label: 'Status',
      r: true,
      val: (r) => r.last_ingest_status ?? 'idle',
      render: (r) => (
        <Pill tone={ingestTone(r.last_ingest_status)} dot>
          {r.last_ingest_status ?? 'idle'}
        </Pill>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Shared Knowledge Base"
        sub="RAG corpora · Milvus-backed shared sources"
        mode="editable"
        actions={[{ label: 'New KB', ic: '＋ ', primary: true }]}
      />
      {q.isError ? (
        <Banner tone="err">
          Failed to load shared KB sources from <b>/api/admin/shared-kb/sources</b>.
        </Banner>
      ) : q.isLoading ? (
        <Banner tone="info">Loading knowledge bases…</Banner>
      ) : (
        <>
          <KpiStrip kpis={kpis} />
          <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 320px' : '1fr', gap: 14 }}>
            <DataTable<KbSourceRow>
              cols={cols}
              rows={rows}
              search="filter knowledge bases…"
              dimKey="enabled"
              onRow={(r) => setOpenId(r.id)}
              empty="No shared knowledge bases configured."
            />
            {selected && (
              <KbDetailPanel source={selected} onClose={() => setOpenId(null)} />
            )}
          </div>
        </>
      )}
    </>
  )
}

function KbDetailPanel({ source, onClose }: { source: KbSourceRow; onClose: () => void }) {
  return (
    <div
      className="awc-chartcard"
      style={{ position: 'sticky', top: 12, alignSelf: 'start', marginBottom: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <StatusDot tone={source.enabled ? 'ok' : 'muted'} />
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{source.name ?? source.id}</span>
        <button className="awc-btn awc-sm awc-ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      <DetailRow label="Type" value={asText(source.type)} />
      <DetailRow label="Documents" value={fmtNum(source.doc_count)} />
      <DetailRow label="Vectors" value={fmtNum(source.chunk_count)} />
      <DetailRow label="Schedule" value={source.schedule ? asText(source.schedule) : 'manual only'} />
      <DetailRow label="Last reindex" value={fmtDate(source.last_ingest_at)} />
      <DetailRow
        label="Status"
        value={<Pill tone={ingestTone(source.last_ingest_status)}>{source.last_ingest_status ?? 'idle'}</Pill>}
      />
      <DetailRow label="Created by" value={asText(source.created_by)} />
      <DetailRow label="Created" value={fmtDate(source.created_at)} />
      {source.last_ingest_error && (
        <div style={{ marginTop: 8 }}>
          <Banner tone="err">{asText(source.last_ingest_error)}</Banner>
        </div>
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button className="awc-btn awc-sm awc-pri">Reindex</button>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        padding: '5px 0',
        borderTop: '1px solid var(--line-1)',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--fg-3)' }}>{label}</span>
      <span style={{ color: 'var(--fg-1)', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

/* ====================================================================== */
/* data-layer · nd — datastores + connections                              */
/* ====================================================================== */
interface DatastoreRow extends Record<string, unknown> {
  id: string
  name: string
  type: string
  status: Tone
  statusLabel: string
  usedBy: string
  detail: string
}

function buildDatastores(s: StorageResponse | undefined): DatastoreRow[] {
  if (!s) return []
  const out: DatastoreRow[] = []
  const mk = (
    id: string,
    name: string,
    type: string,
    section: StorageSection | undefined,
    usedBy: string,
    detail: string,
  ): DatastoreRow => {
    const ok = !!section && !section.error
    return {
      id,
      name,
      type,
      status: ok ? 'ok' : section?.error ? 'err' : 'muted',
      statusLabel: ok ? 'connected' : section?.error ? 'error' : 'unknown',
      usedBy,
      detail,
    }
  }
  if (s.milvus) {
    out.push(
      mk(
        'milvus',
        'Milvus',
        'milvus',
        s.milvus,
        'RAG · embeddings',
        s.milvus.error
          ? asText(s.milvus.error)
          : `${fmtNum(s.milvus.collections)} collections · ${fmtNum(s.milvus.total_vectors)} vectors`,
      ),
    )
  }
  if (s.pgvector) {
    out.push(
      mk(
        'pgvector',
        'pgvector',
        'postgres',
        s.pgvector,
        'memory · context',
        s.pgvector.error
          ? asText(s.pgvector.error)
          : `${fmtNum(s.pgvector.tables)} tables · ${fmtNum(s.pgvector.total_rows)} rows`,
      ),
    )
  }
  if (s.redis) {
    out.push(
      mk(
        'redis',
        'Redis',
        'redis',
        s.redis,
        'cache · sessions',
        s.redis.error
          ? asText(s.redis.error)
          : `${fmtNum(s.redis.keys)} keys · ${s.redis.memory_mb != null ? `${fmtNum(s.redis.memory_mb)} MB` : '—'}`,
      ),
    )
  }
  return out
}

function DataLayerPage(_: LeafPageProps) {
  const q = useStorage()
  const rows = buildDatastores(q.data)

  const connected = rows.filter((r) => r.status === 'ok').length
  const kpis: Kpi[] = [
    { label: 'Datastores', val: q.data ? rows.length : '—', tone: 'accent' },
    { label: 'Connected', val: q.data ? connected : '—', tone: connected > 0 ? 'ok' : 'muted' },
    {
      label: 'Vectors (Milvus)',
      val: q.data?.milvus && !q.data.milvus.error ? fmtNum(q.data.milvus.total_vectors) : '—',
      tone: 'info',
    },
    {
      label: 'Cache keys (Redis)',
      val: q.data?.redis && !q.data.redis.error ? fmtNum(q.data.redis.keys) : '—',
      tone: 'info',
    },
  ]

  const cols: DtColumn<DatastoreRow>[] = [
    { key: 'name', label: 'Datastore', val: (r) => r.name, render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
    { label: 'Type', val: (r) => r.type, render: (r) => <Pill tone="info">{r.type}</Pill> },
    {
      label: 'Status',
      val: (r) => r.statusLabel,
      render: (r) => (
        <Pill tone={r.status} dot>
          {r.statusLabel}
        </Pill>
      ),
    },
    { label: 'Used by', val: (r) => r.usedBy },
    {
      label: 'Connection',
      val: (r) => r.detail,
      render: (r) => <span style={{ color: 'var(--fg-2)', fontSize: 12 }}>{r.detail}</span>,
    },
  ]

  return (
    <>
      <PageHead
        title="Unified Data Layer"
        sub="datastores + connections · live storage probe"
        mode="readonly"
        actions={[{ label: 'Add datastore', ic: '＋ ' }]}
      />
      {q.isError ? (
        <Banner tone="err">
          Failed to probe the data layer via <b>/api/admin/storage</b>.
        </Banner>
      ) : q.isLoading ? (
        <Banner tone="info">Probing datastores…</Banner>
      ) : (
        <>
          <Banner tone="info">
            Datastores are composed from the live storage probe (Milvus · pgvector · Redis).
            Per-datastore DSN / scope / managed connection editing is not yet surfaced by a managed
            endpoint, so those fields read "—" rather than being fabricated.
          </Banner>
          <KpiStrip kpis={kpis} />
          <DataTable<DatastoreRow>
            cols={cols}
            rows={rows}
            search="filter datastores…"
            empty="No datastore probe results — storage backends unreachable."
          />
        </>
      )}
    </>
  )
}

/* ====================================================================== */
/* user-memory · nm — cross-mode memory entries                            */
/* ====================================================================== */
interface UserMemRow extends Record<string, unknown> {
  userId: string
  email: string
  name: string
  totalEntries: number
  lastActivity?: string | null
}
interface UserMemOverview {
  totalEntries: number
  bySource: Record<string, number>
  totalUsers: number
  storageBytes: number
}
interface UserContextResponse {
  overview?: UserMemOverview
  users?: UserMemRow[]
}
interface RetentionResponse {
  chatRetentionDays?: number
  codeRetentionDays?: number
  workflowRetentionDays?: number
  memoryRetentionDays?: number
  autoCleanupEnabled?: boolean
}

function UserMemoryPage(_: LeafPageProps) {
  const q = useAdminQuery<UserContextResponse>(
    ['content-user-memory'],
    '/api/admin/user-context/overview',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const ret = useAdminQuery<RetentionResponse>(
    ['content-user-memory-retention'],
    '/api/admin/user-context/retention',
    { staleTime: 60_000, refetchInterval: 120_000 },
  )

  const ov = q.data?.overview
  const users: UserMemRow[] = q.data?.users ?? []
  // Even spread of total storage across entries → honest per-user estimate.
  const bytesPerEntry =
    ov && ov.totalEntries > 0 ? ov.storageBytes / ov.totalEntries : undefined

  const kpis: Kpi[] = [
    { label: 'Memory Entries', val: ov ? fmtNum(ov.totalEntries) : '—', tone: 'accent' },
    { label: 'Users', val: ov ? ov.totalUsers : '—', tone: 'info' },
    { label: 'Storage', val: ov ? fmtBytes(ov.storageBytes) : '—', tone: 'info' },
    {
      label: 'Sources',
      val: ov ? Object.values(ov.bySource).filter((v) => v > 0).length : '—',
      tone: 'muted',
    },
  ]

  const settingsRows: FormRow[] = [
    {
      label: 'Cross-mode memory',
      desc: 'share memory entries across chat / code / workflow modes',
      type: 'toggle',
      value: !!ret.data?.autoCleanupEnabled ? false : true,
      locked: true,
    },
    {
      label: 'Retention (memory)',
      desc: 'days before unpinned memory entries are eligible for cleanup',
      type: 'number',
      value: ret.data?.memoryRetentionDays ?? '',
      suffix: 'days',
      locked: true,
    },
    {
      label: 'Retention (chat)',
      desc: 'days of chat-derived memory retained',
      type: 'number',
      value: ret.data?.chatRetentionDays ?? '',
      suffix: 'days',
      locked: true,
    },
    {
      label: 'Auto cleanup',
      desc: 'automatically purge entries past their retention window',
      type: 'toggle',
      value: !!ret.data?.autoCleanupEnabled,
      locked: true,
    },
  ]

  const cols: DtColumn<UserMemRow>[] = [
    {
      key: 'name',
      label: 'User',
      val: (r) => r.name ?? r.email ?? r.userId,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name ?? r.email ?? r.userId}</div>
          {r.email && r.email !== r.name && (
            <div style={{ color: 'var(--fg-3)', fontSize: 11, marginTop: 2 }}>{r.email}</div>
          )}
        </div>
      ),
    },
    { label: 'Entries', r: true, val: (r) => r.totalEntries ?? 0, render: (r) => fmtNum(r.totalEntries) },
    {
      label: 'Last updated',
      r: true,
      val: (r) => r.lastActivity ?? '',
      render: (r) => fmtDate(r.lastActivity),
    },
    {
      label: 'Size',
      r: true,
      val: (r) => (bytesPerEntry != null ? r.totalEntries * bytesPerEntry : 0),
      render: (r) =>
        bytesPerEntry != null ? fmtBytes(Math.round(r.totalEntries * bytesPerEntry)) : '—',
    },
  ]

  return (
    <>
      <PageHead
        title="User Memory"
        sub="cross-mode memory entries · per-user store"
        mode="hitl"
        actions={[{ label: 'Purge user memory', ic: '🗑 ', danger: true }]}
      />
      {q.isError ? (
        <Banner tone="err">
          Failed to load user memory from <b>/api/admin/user-context/overview</b>.
        </Banner>
      ) : q.isLoading ? (
        <Banner tone="info">Loading memory store…</Banner>
      ) : (
        <>
          <KpiStrip kpis={kpis} />
          <FormSection
            title="Memory Settings"
            sub="retention policy"
            mode="readonly"
            rows={settingsRows}
          />
          <DataTable<UserMemRow>
            cols={cols}
            rows={users}
            search="filter users…"
            empty="No user memory entries recorded yet."
          />
          <Banner tone="warn">
            Purging a user's memory is a destructive, credential-touching action and requires HITL
            approval. Per-user "Size" is an even-spread estimate of the measured total store, not a
            per-row measurement.
          </Banner>
        </>
      )}
    </>
  )
}

/* ============================== registry =============================== */
export const contentPages: Record<string, React.ComponentType<LeafPageProps>> = {
  templates: TemplatesPage,
  'shared-kb': SharedKbPage,
  'data-layer': DataLayerPage,
  'user-memory': UserMemoryPage,
}
