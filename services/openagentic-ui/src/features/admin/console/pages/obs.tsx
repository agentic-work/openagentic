/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Observability domain pages (blueprint §2 — OBSERVABILITY, 11 leaves) at
 * mock fidelity (the admin-console mock INV: cluster-health /
 * analytics / user-activity / errors / slo / context-window / embeddings /
 * audit / feedback / test-harness / chargeback) and WIRED to the real admin
 * endpoints.
 *
 * Each leaf is a body-only component — PageHead + content, NEVER its own
 * OptionSpec (AdminConsole appends the option-spec inventory = the two-part
 * leaf contract). Every number comes from a live hook or renders an honest
 * "—"; tables render real rows or an honest-empty Banner; no value is
 * fabricated. Every color resolves via a global theme token (var(--*)).
 *
 * Data sources (all real admin routes):
 *   GET /api/cluster/services            → live k8s deployments + nodes + GPU
 *                                          (cluster-health)
 *   GET /api/admin/dashboard/metrics     → token/request/user/session rollups
 *                                          (analytics, context-window)
 *   GET /api/admin/user-activity/live    → per-user live activity (user-activity)
 *   GET /api/admin/mcp-logs              → error / monitoring feed (errors)
 *   GET /api/admin/slo                   → SLO objective list (slo)
 *   GET /api/admin/context-metrics       → per-session context util (context-window)
 *   GET /api/admin/embeddings/config     → embedding provider/model (embeddings)
 *   GET /api/admin/storage               → milvus / pgvector / redis (embeddings)
 *   GET /api/admin/audit-logs            → platform audit trail (audit)
 *   GET /api/admin/feedback/recent|stats → user feedback + sentiment (feedback)
 *   GET /api/admin/test-harness/results  → real-model scenario runs (test-harness)
 *   GET /api/admin/chargeback/budgets    → per-team cost attribution (chargeback)
 */
import * as React from 'react'
import {
  AreaChart,
  Banner,
  DataTable,
  Donut,
  HBars,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  StatusDot,
  Tag,
  type AreaSeries,
  type DonutSeg,
  type DtColumn,
  type HBarItem,
  type Kpi,
} from '../primitives'
import type { Tone } from '../types'
import {
  useAuditLogs,
  useDashboardMetrics,
  useMcpLogs,
  useStorage,
  type AuditLogEntry,
  type McpLogEntry,
} from '../../hooks/useDashboardMetrics'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import type { LeafPageProps } from './registry'

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
function utcStamp(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
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

/* ============================================================
 * shared loading / error / empty helpers
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

/* ============================================================
 * row + response shapes (permissive — mirror the real admin envelopes)
 * ============================================================ */
interface ClusterServiceRow extends Record<string, unknown> {
  name: string
  kind?: string
  category?: string
  image?: string
  shaShort?: string | null
  replicas?: { desired?: number; ready?: number; available?: number }
  status?: 'available' | 'progressing' | 'unavailable' | 'unknown' | string
  node?: string
}
interface ClusterNodeRow extends Record<string, unknown> {
  name: string
  ready?: boolean
  gpu?: number
  roles?: string[]
  notReadyReason?: string | null
}
interface ClusterServicesResponse {
  release?: { version?: string; codename?: string }
  namespace?: string
  scrapedAt?: string
  services?: ClusterServiceRow[]
  nodes?: ClusterNodeRow[]
}

interface ActiveUserRow extends Record<string, unknown> {
  userId: string
  email?: string
  name?: string
  isAdmin?: boolean
  lastAccessed?: string
  sessionCount?: number
  ipAddress?: string
  activityType?: string
}
interface UserActivityResponse {
  users?: ActiveUserRow[]
  total?: number
  asOf?: string
}

interface SloRow extends Record<string, unknown> {
  metric: string
  type?: string
  threshold?: number
  window?: string
  description?: string
  enabled?: boolean
}
interface SloResponse {
  slos?: SloRow[]
}

interface ContextSessionRow extends Record<string, unknown> {
  id: string
  userName?: string
  userEmail?: string
  title?: string
  model?: string
  messageCount?: number
  contextTokensTotal?: number
  contextWindowSize?: number | null
  contextUtilizationPct?: number | null
  updatedAt?: string
}
interface ContextMetricsResponse {
  sessions?: ContextSessionRow[]
  total?: number
  statistics?: {
    averageUtilization?: number
    maxUtilization?: number
    totalSessions?: number
    highUtilizationSessions?: number
  }
}

interface EmbeddingConfigResponse {
  provider?: string
  model?: string
  dimensions?: number | null
  enabled?: boolean
}

interface FeedbackRow extends Record<string, unknown> {
  id: string
  feedbackType?: string
  rating?: number | null
  comment?: string | null
  tags?: string[]
  model?: string | null
  provider?: string | null
  createdAt?: string
  user?: { id?: string; name?: string; email?: string } | null
}
interface FeedbackRecentResponse {
  feedback?: FeedbackRow[]
  total?: number
}
interface FeedbackStatsResponse {
  totalFeedback?: number
  uniqueMessages?: number
  uniqueUsers?: number
  satisfactionRate?: number
  byType?: Record<string, number>
}

interface HarnessRow extends Record<string, unknown> {
  category?: string
  test?: string
  status?: 'pass' | 'fail' | 'skip' | 'running' | string
  durationMs?: number
  error?: string | null
  details?: unknown
  timestamp?: string
}
interface HarnessResultsResponse {
  results?: HarnessRow[]
  lastRun?: string | null
  summary?: { total?: number; passed?: number; failed?: number; skipped?: number }
}

interface BudgetRow extends Record<string, unknown> {
  id: string
  name?: string
  scope?: string
  scope_type?: string
  monthly_limit?: number | null
  current_spend?: number | null
  usage_percentage?: number | null
  over_budget?: boolean
  alert_level?: 'normal' | 'caution' | 'warning' | 'critical' | string
}
interface ChargebackBudgetsResponse {
  budgets?: BudgetRow[]
  total?: number
}

/* ============================================================
 * domain-local hooks (leaves with no dedicated typed hook)
 * ============================================================ */
function useClusterServices() {
  return useAdminQuery<ClusterServicesResponse>(['obs-cluster-services'], '/api/cluster/services', {
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
function useUserActivityLive() {
  return useAdminQuery<UserActivityResponse>(
    ['obs-user-activity-live'],
    '/api/admin/user-activity/live',
    { staleTime: 10_000, refetchInterval: 15_000 },
  )
}
function useSlos() {
  return useAdminQuery<SloResponse>(['obs-slos'], '/api/admin/slo', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useContextMetrics() {
  return useAdminQuery<ContextMetricsResponse>(
    ['obs-context-metrics'],
    '/api/admin/context-metrics?limit=50',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}
function useEmbeddingConfig() {
  return useAdminQuery<EmbeddingConfigResponse>(
    ['obs-embeddings-config'],
    '/api/admin/embeddings/config',
    { staleTime: 60_000, refetchInterval: 120_000 },
  )
}
function useFeedbackRecent() {
  return useAdminQuery<FeedbackRecentResponse>(
    ['obs-feedback-recent'],
    '/api/admin/feedback/recent?limit=100',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}
function useFeedbackStats() {
  return useAdminQuery<FeedbackStatsResponse>(['obs-feedback-stats'], '/api/admin/feedback/stats', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useHarnessResults() {
  return useAdminQuery<HarnessResultsResponse>(
    ['obs-harness-results'],
    '/api/admin/test-harness/results',
    { staleTime: 15_000, refetchInterval: 30_000 },
  )
}
function useChargebackBudgets() {
  return useAdminQuery<ChargebackBudgetsResponse>(
    ['obs-chargeback-budgets'],
    '/api/admin/chargeback/budgets',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

/* shared tone helpers */
function svcTone(s: string | undefined): Tone {
  const v = String(s ?? '').toLowerCase()
  if (v === 'available') return 'ok'
  if (v === 'progressing') return 'info'
  if (v === 'unavailable') return 'err'
  return 'muted'
}
function utilTone(p: number | null | undefined): Tone {
  if (p == null || Number.isNaN(p)) return 'muted'
  return p >= 90 ? 'err' : p >= 70 ? 'warn' : 'ok'
}
function alertTone(a: string | undefined): Tone {
  const v = String(a ?? '').toLowerCase()
  if (v === 'critical') return 'err'
  if (v === 'warning') return 'warn'
  if (v === 'caution') return 'info'
  return 'ok'
}

/* ============================================================
 * 1. cluster-health · mh — live k8s topology (deployments + nodes + GPU)
 * ============================================================ */
function ClusterHealthPage(_props: LeafPageProps) {
  const cl = useClusterServices()
  const services = cl.data?.services ?? []
  const nodes = cl.data?.nodes ?? []

  const readyNodes = nodes.filter((n) => n.ready).length
  const notReady = nodes.filter((n) => !n.ready)
  const gpuTotal = nodes.reduce((a, n) => a + (n.gpu ?? 0), 0)
  const svcOk = services.filter((s) => String(s.status).toLowerCase() === 'available').length
  const svcDown = services.filter((s) => String(s.status).toLowerCase() === 'unavailable').length

  const strip: Kpi[] = [
    {
      label: 'Nodes ready',
      val: cl.data ? `${readyNodes}/${nodes.length}` : '—',
      tone: notReady.length > 0 ? 'warn' : 'ok',
      sub: notReady.length > 0 ? `${notReady.length} NotReady` : undefined,
    },
    {
      label: 'Services available',
      val: cl.data ? `${svcOk}/${services.length}` : '—',
      tone: svcDown > 0 ? 'err' : 'accent',
      sub: svcDown > 0 ? `${svcDown} unavailable` : undefined,
    },
    {
      label: 'GPUs allocatable',
      val: cl.data ? gpuTotal : '—',
      tone: 'accent',
      sub: cl.data?.namespace ? `ns ${cl.data.namespace}` : undefined,
    },
    {
      label: 'Release',
      val: cl.data?.release?.version ?? '—',
      tone: 'info',
      sub: cl.data?.release?.codename || undefined,
    },
  ]

  const nodeCols: DtColumn<ClusterNodeRow>[] = [
    {
      label: 'Node',
      val: (r) => r.name,
      render: (r) => <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.name}</span>,
    },
    {
      label: 'Roles',
      render: (r) =>
        r.roles && r.roles.length ? (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {r.roles.map((role) => (
              <Tag key={role}>{role}</Tag>
            ))}
          </span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
    { label: 'GPU', r: true, val: (r) => r.gpu ?? 0 },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={r.ready ? 'ok' : 'err'} dot>
          {r.ready ? 'Ready' : 'NotReady'}
        </Pill>
      ),
    },
    {
      label: 'Reason',
      val: (r) => (r.ready ? '—' : r.notReadyReason ?? 'Unknown'),
      render: (r) =>
        r.ready ? (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ) : (
          <span style={{ color: 'var(--warn)' }}>{r.notReadyReason ?? 'Unknown'}</span>
        ),
    },
  ]

  const svcCols: DtColumn<ClusterServiceRow>[] = [
    {
      label: 'Service',
      val: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={svcTone(r.status)} />
          <span className="awc-name">{r.name}</span>
        </span>
      ),
    },
    { label: 'Kind', render: (r) => <Tag>{r.kind ?? r.category ?? '—'}</Tag> },
    {
      label: 'Replicas',
      r: true,
      val: (r) => `${r.replicas?.ready ?? 0}/${r.replicas?.desired ?? 0}`,
    },
    {
      label: 'SHA',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
          {r.shaShort ?? '—'}
        </span>
      ),
    },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={svcTone(r.status)} dot>
          {r.status ?? 'unknown'}
        </Pill>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Cluster Health"
        sub={
          cl.data
            ? `k3s · ${cl.data.namespace ?? '—'} · ${readyNodes}/${nodes.length} nodes ready · ${services.length} services · live 30s`
            : 'live k8s deployments + nodes + GPU · /api/cluster/services'
        }
        actions={[{ label: 'Refresh', ic: '↻ ', onClick: () => cl.refetch() }]}
        mode="readonly"
      />
      {notReady.length > 0 && (
        <Banner tone="warn">
          <b>
            {notReady.length} {notReady.length === 1 ? 'node' : 'nodes'} NotReady
          </b>{' '}
          — {notReady.map((n) => n.name).join(', ')}. Check the node runbook before scheduling.
        </Banner>
      )}
      <LoadErr isLoading={cl.isLoading} isError={cl.isError} label="cluster health" />
      <KpiStrip kpis={strip} />
      <Section title="Nodes" sub={cl.data ? `${nodes.length} nodes · ${gpuTotal} GPUs` : 'kube-API'} />
      {cl.data && (
        <DataTable<ClusterNodeRow>
          cols={nodeCols}
          rows={nodes}
          search="search nodes…"
          pageSize={8}
          empty="No nodes reported"
        />
      )}
      <Section
        title="Services"
        sub={cl.data ? `${services.length} deployments + statefulsets` : 'kube-API'}
      />
      {cl.data && (
        <DataTable<ClusterServiceRow>
          cols={svcCols}
          rows={services}
          search="search services…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: services.length },
              { id: 'available', label: 'available', cnt: svcOk },
              { id: 'unavailable', label: 'down', cnt: svcDown },
            ],
            filter: (row, chip) => {
              const r = row as ClusterServiceRow
              const v = String(r.status ?? '').toLowerCase()
              if (chip === 'all') return true
              if (chip === 'unavailable') return v === 'unavailable'
              return v === 'available'
            },
          }}
          empty="No services reported"
        />
      )}
    </>
  )
}

/* ============================================================
 * 2. analytics · my — usage analytics (tokens / requests / users / sessions)
 * ============================================================ */
function AnalyticsPage(_props: LeafPageProps) {
  const [win, setWin] = React.useState<'24h' | '7d' | '30d'>('24h')
  const metrics = useDashboardMetrics(win)
  const s = metrics.data?.summary
  const ts = metrics.data?.timeSeries
  const usage = metrics.data?.modelUsage ?? []

  const strip: Kpi[] = [
    {
      label: 'Token burn',
      val: s ? fmtNum(s.totalTokens) : '—',
      unit: s ? 'tok' : undefined,
      tone: 'accent',
      sub:
        s?.tokensDeltaPct != null
          ? `${s.tokensDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(s.tokensDeltaPct).toFixed(1)}% vs prev`
          : undefined,
      deltaDir: s?.tokensDeltaPct != null ? (s.tokensDeltaPct >= 0 ? 'up' : 'down') : 'flat',
      spark: ts?.tokenUsage?.length ? ts.tokenUsage.map((p) => p.value) : undefined,
    },
    {
      label: 'API requests',
      val: s ? fmtNum(s.totalApiRequests) : '—',
      tone: 'info',
      sub: s?.apiErrorRate != null ? `${fmtPct(s.apiErrorRate)} error rate` : undefined,
    },
    {
      label: 'Active users',
      val: s ? fmtNum(s.activeUsersBroad ?? s.activeUsers) : '—',
      tone: 'ok',
      sub: s ? `${fmtNum(s.totalUsers)} total` : undefined,
    },
    {
      label: 'Sessions',
      val: s ? fmtNum(s.totalSessions) : '—',
      tone: 'accent',
      sub: s?.sessionChange != null ? `${s.sessionChange >= 0 ? '+' : ''}${s.sessionChange} vs prev` : undefined,
      deltaDir: s?.sessionChange != null ? (s.sessionChange >= 0 ? 'up' : 'down') : 'flat',
    },
  ]

  const tokenSeries: AreaSeries[] = ts?.tokenUsage?.length
    ? [{ name: 'tokens', data: ts.tokenUsage.map((p) => p.value) }]
    : []
  const reqSeries: AreaSeries[] = ts?.apiRequests?.length
    ? [{ name: 'requests', data: ts.apiRequests.map((p) => p.value) }]
    : []

  const userCols: DtColumn<Record<string, unknown>>[] = [
    {
      label: 'User',
      val: (r) => String(r.email ?? r.displayName ?? r.userId ?? ''),
      render: (r) => (
        <span>
          <span className="awc-name">{String(r.displayName ?? r.email ?? '—')}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {String(r.email ?? '')}
          </div>
        </span>
      ),
    },
    { label: 'Tokens', r: true, sortVal: (r) => Number(r.tokens ?? 0), val: (r) => fmtNum(Number(r.tokens ?? 0)) },
    { label: 'Sessions', r: true, val: (r) => Number(r.sessions ?? 0) },
    {
      label: 'Cost',
      r: true,
      sortVal: (r) => Number(r.cost ?? 0),
      render: (r) => <span style={{ color: 'var(--accent)' }}>{fmtUsd(Number(r.cost ?? 0))}</span>,
    },
    { label: 'Last active', val: (r) => relTime(r.lastActive as string | undefined) },
  ]
  const perUser = (metrics.data?.perUserUsage ?? []) as unknown as Record<string, unknown>[]

  const WINDOWS: Array<'24h' | '7d' | '30d'> = ['24h', '7d', '30d']

  return (
    <>
      <PageHead
        title="Usage Analytics"
        sub={`tokens · requests · active users over ${win} · /api/admin/dashboard/metrics`}
        actions={WINDOWS.map((w) => ({ label: w, primary: w === win, onClick: () => setWin(w) }))}
        mode="readonly"
      />
      <LoadErr isLoading={metrics.isLoading} isError={metrics.isError} label="usage analytics" />
      <KpiStrip kpis={strip} />
      <Section title="Usage over time" sub={`window ${win}`} />
      <div className="awc-grid2">
        <div className="awc-chartcard">
          <div className="awc-chartcard__ch">Token usage</div>
          <div className="awc-chartcard__csub">tokens per bucket</div>
          {tokenSeries.length ? (
            <AreaChart series={tokenSeries} tone={['accent']} />
          ) : (
            <Banner tone="info">No token time-series in this window.</Banner>
          )}
        </div>
        <div className="awc-chartcard">
          <div className="awc-chartcard__ch">API requests</div>
          <div className="awc-chartcard__csub">requests per bucket</div>
          {reqSeries.length ? (
            <AreaChart series={reqSeries} tone={['info']} />
          ) : (
            <Banner tone="info">No request time-series in this window.</Banner>
          )}
        </div>
      </div>
      <Section title="Top users" sub={`by token usage · ${perUser.length} users`} />
      {metrics.data ? (
        perUser.length ? (
          <DataTable<Record<string, unknown>>
            cols={userCols}
            rows={perUser}
            search="search users…"
            pageSize={10}
            empty="No per-user usage in this window"
          />
        ) : (
          <Banner tone="info">No per-user usage recorded in this window.</Banner>
        )
      ) : null}
      {usage.length > 0 && (
        <>
          <Section title="By model" sub="token share across models" />
          <div className="awc-chartcard">
            <HBars
              items={usage
                .slice()
                .sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))
                .slice(0, 8)
                .map((m): HBarItem => ({ l: m.model, v: m.tokens ?? 0, tone: 'accent', disp: fmtNum(m.tokens) }))}
            />
          </div>
        </>
      )}
    </>
  )
}

/* ============================================================
 * 3. user-activity · ma — per-user live session + tool activity
 * ============================================================ */
function UserActivityPage(_props: LeafPageProps) {
  const act = useUserActivityLive()
  const rows = act.data?.users ?? []
  const total = act.data?.total ?? rows.length

  const typeTone = (t: string | undefined): Tone => {
    const v = String(t ?? '').toLowerCase()
    if (v === 'chatting') return 'ok'
    if (v === 'browsing') return 'info'
    return 'muted'
  }

  const count = (pred: (r: ActiveUserRow) => boolean) => rows.filter(pred).length
  const strip: Kpi[] = [
    { label: 'Active users', val: act.data ? total : '—', tone: 'accent' },
    { label: 'Chatting', val: act.data ? count((r) => r.activityType === 'chatting') : '—', tone: 'info' },
    { label: 'Admins online', val: act.data ? count((r) => !!r.isAdmin) : '—', tone: 'warn' },
  ]

  const cols: DtColumn<ActiveUserRow>[] = [
    {
      label: 'User',
      val: (r) => r.email ?? r.name ?? r.userId,
      render: (r) => (
        <span>
          <span className="awc-name">{r.name ?? r.email ?? '—'}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.email ?? ''}
          </div>
        </span>
      ),
    },
    {
      label: 'Activity',
      render: (r) => (
        <Pill tone={typeTone(r.activityType)} dot>
          {String(r.activityType ?? 'idle').replace(/_/g, ' ')}
        </Pill>
      ),
    },
    { label: 'Sessions', r: true, val: (r) => r.sessionCount ?? 0 },
    { label: 'Role', render: (r) => <Tag>{r.isAdmin ? 'admin' : 'user'}</Tag> },
    { label: 'IP', val: (r) => r.ipAddress ?? '—' },
    { label: 'Last seen', val: (r) => relTime(r.lastAccessed) },
  ]

  return (
    <>
      <PageHead
        title="User Activity"
        sub={
          act.data
            ? `${total} active users · as of ${utcStamp(act.data.asOf)} UTC · live 15s`
            : 'per-user live session + tool activity · /api/admin/user-activity/live'
        }
        mode="readonly"
      />
      <LoadErr isLoading={act.isLoading} isError={act.isError} label="user activity" />
      <KpiStrip kpis={strip} />
      <Section title="Live activity" right={<Pill tone="ok" dot>live</Pill>} />
      {act.data && (
        <DataTable<ActiveUserRow>
          cols={cols}
          rows={rows}
          search="search users · email · name · ip…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'chatting', label: 'chatting', cnt: count((r) => r.activityType === 'chatting') },
              { id: 'browsing', label: 'browsing', cnt: count((r) => r.activityType === 'browsing') },
            ],
            filter: (row, chip) =>
              chip === 'all' ? true : (row as ActiveUserRow).activityType === chip,
          }}
          empty="No active users right now"
        />
      )}
    </>
  )
}

/* ============================================================
 * 4. errors · me — monitoring + error stream (MCP error logs)
 *     + OB-2: REAL container logs from Loki (LogQL via /api/admin/loki)
 * ============================================================ */
type ErrRow = McpLogEntry & Record<string, unknown>

/**
 * OB-2 — one parsed Loki log line. Loki's query_range returns
 * `{ data: { result: [ { stream: {labels}, values: [[ns_ts, line], …] } ] } }`.
 */
type LokiLine = { tsNs: string; line: string; labels: Record<string, string> }

type LokiQueryRangeResponse = {
  status?: string
  data?: {
    resultType?: string
    result?: Array<{ stream?: Record<string, string>; values?: Array<[string, string]> }>
  }
}

/** Flatten the Loki streams response into a flat, newest-first line list. */
function parseLokiStreams(resp: LokiQueryRangeResponse | undefined): LokiLine[] {
  const out: LokiLine[] = []
  for (const s of resp?.data?.result ?? []) {
    const labels = s.stream ?? {}
    for (const [tsNs, line] of s.values ?? []) {
      out.push({ tsNs, line, labels })
    }
  }
  // values come newest-last per stream and interleaved across streams; sort
  // by the ns timestamp descending so the table reads newest-first.
  out.sort((a, b) => (a.tsNs < b.tsNs ? 1 : a.tsNs > b.tsNs ? -1 : 0))
  return out
}

/** Format a Loki nanosecond epoch string as a short HH:MM:SS UTC stamp. */
function lokiTs(tsNs: string): string {
  const ms = Number(tsNs.slice(0, 13)) // ns → ms (first 13 digits)
  if (!Number.isFinite(ms)) return '—'
  const d = new Date(ms)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`
}

/**
 * OB-2 — query the REAL Loki log corpus through the admin loki-proxy. Default
 * window = last 1h of openagentic container logs. Returns the raw query_range
 * payload (parsed in the component). 20s refetch for a live tail feel.
 */
function useLokiLogs(logql: string, enabled = true) {
  const nowNs = `${Date.now()}000000`
  const startNs = `${Date.now() - 60 * 60 * 1000}000000`
  const qs = new URLSearchParams({
    query: logql,
    start: startNs,
    end: nowNs,
    limit: '300',
    direction: 'backward',
  }).toString()
  return useAdminQuery<LokiQueryRangeResponse>(
    ['loki', 'logs', logql],
    `/api/admin/loki/query_range?${qs}`,
    { refetchInterval: 20_000, staleTime: 15_000, enabled },
  )
}

/** OB-2 — preset LogQL queries the operator can flip between in the logs leaf. */
const LOKI_PRESETS: Array<{ id: string; label: string; logql: string }> = [
  { id: 'all-errors', label: 'All errors', logql: '{namespace="openagentic"} |~ `(?i)error|exception|panic|fatal`' },
  { id: 'api', label: 'API', logql: '{namespace="openagentic", app="openagentic-api"}' },
  { id: 'mcp-proxy', label: 'MCP proxy', logql: '{namespace="openagentic", app="openagentic-mcp-proxy"}' },
  { id: 'all', label: 'All namespace', logql: '{namespace="openagentic"}' },
]

function ErrorsPage(_props: LeafPageProps) {
  const logs = useMcpLogs(100)
  const all = (logs.data?.logs ?? []) as ErrRow[]
  const rows = all.filter((l) => l.status === 'error')

  // OB-2 — REAL Loki container-log corpus (LogQL via /api/admin/loki).
  const [lokiPreset, setLokiPreset] = React.useState<string>(LOKI_PRESETS[0].id)
  const activePreset = LOKI_PRESETS.find((p) => p.id === lokiPreset) ?? LOKI_PRESETS[0]
  const loki = useLokiLogs(activePreset.logql)
  const lokiLines = parseLokiStreams(loki.data)
  const lokiCols: DtColumn<LokiLine>[] = [
    { label: 'Time', val: (r) => lokiTs(r.tsNs), sortVal: (r) => r.tsNs },
    {
      label: 'Source',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>
          {r.labels.pod ?? r.labels.app ?? r.labels.container ?? '—'}
        </span>
      ),
    },
    {
      label: 'Line',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {r.line}
        </span>
      ),
    },
  ]

  const errCols: DtColumn<ErrRow>[] = [
    { label: 'When', val: (r) => relTime(r.timestamp), sortVal: (r) => r.timestamp ?? '' },
    {
      label: 'Tool',
      val: (r) => r.toolName,
      render: (r) => (
        <span>
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.toolName}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.serverId}</div>
        </span>
      ),
    },
    { label: 'User', val: (r) => r.userEmail ?? r.userName ?? '—' },
    {
      label: 'Error',
      render: (r) => (
        <span style={{ color: 'var(--err)', whiteSpace: 'normal' }}>{r.error ?? '—'}</span>
      ),
    },
    { label: 'Duration', r: true, sortVal: (r) => r.executionTime ?? -1, val: (r) => fmtMs(r.executionTime) },
  ]

  const errRate = all.length ? Math.round((rows.length / all.length) * 100) : 0
  const strip: Kpi[] = [
    { label: 'Errors (recent)', val: logs.data ? rows.length : '—', tone: rows.length > 0 ? 'err' : 'ok' },
    { label: 'Total calls (recent)', val: logs.data ? all.length : '—', tone: 'accent' },
    { label: 'Error rate', val: logs.data ? `${errRate}%` : '—', tone: errRate > 5 ? 'warn' : 'ok' },
    {
      label: 'Distinct tools failing',
      val: logs.data ? new Set(rows.map((r) => r.toolName)).size : '—',
      tone: 'info',
    },
  ]

  return (
    <>
      <PageHead
        title="Monitoring & Errors"
        sub="MCP error stream + failure classes · /api/admin/mcp-logs"
        actions={[{ label: 'Refresh', ic: '↻ ', onClick: () => logs.refetch() }]}
        mode="readonly"
      />
      {rows.length > 0 && (
        <Banner tone="err">
          <b>{rows.length} errors</b> in the recent MCP call window across{' '}
          {new Set(rows.map((r) => r.serverId)).size} servers.
        </Banner>
      )}
      <LoadErr isLoading={logs.isLoading} isError={logs.isError} label="error logs" />
      <KpiStrip kpis={strip} />
      <Section title="Recent errors" sub="failed MCP tool calls" right={<Pill tone="ok" dot>live</Pill>} />
      {logs.data &&
        (rows.length ? (
          <DataTable<ErrRow>
            cols={errCols}
            rows={rows}
            search="search errors · tool · server · user · message…"
            pageSize={12}
            empty="No errors in this window"
          />
        ) : (
          <Banner tone="ok">No MCP tool errors in the recent window — the fleet is healthy.</Banner>
        ))}

      {/* OB-2 — REAL container logs from Loki (LogQL), not the Postgres surrogate. */}
      <Section
        title="Container logs (Loki)"
        sub={`last 1h · LogQL · ${activePreset.logql}`}
        right={<Pill tone="ok" dot>live</Pill>}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {LOKI_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setLokiPreset(p.id)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 11.5,
              border: '1px solid var(--border-1)',
              background: p.id === lokiPreset ? 'var(--accent)' : 'var(--bg-2)',
              color: p.id === lokiPreset ? 'var(--accent-fg, #fff)' : 'var(--fg-2)',
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => loki.refetch()}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 11.5,
            border: '1px solid var(--border-1)',
            background: 'var(--bg-2)',
            color: 'var(--fg-2)',
          }}
        >
          ↻ Refresh
        </button>
      </div>
      <LoadErr isLoading={loki.isLoading} isError={loki.isError} label="Loki logs" />
      {loki.isError && (
        <Banner tone="warn">
          Loki query failed — check that the api can reach monitoring-stack/loki:3100 (NetworkPolicy
          egress) and that the loki-proxy route is deployed.
        </Banner>
      )}
      {loki.data &&
        (lokiLines.length ? (
          <DataTable<LokiLine>
            cols={lokiCols}
            rows={lokiLines}
            search="search log lines · pod · message…"
            pageSize={20}
            empty="No log lines for this query in the last hour"
          />
        ) : (
          <Banner tone="info">No log lines matched this LogQL query in the last hour.</Banner>
        ))}
    </>
  )
}

/* ============================================================
 * 5. slo · ms — latency + availability objectives
 * ============================================================ */
function SloPage(_props: LeafPageProps) {
  const slo = useSlos()
  const rows = slo.data?.slos ?? []
  const enabled = rows.filter((r) => r.enabled).length

  const strip: Kpi[] = [
    { label: 'SLOs defined', val: slo.data ? rows.length : '—', tone: 'accent' },
    { label: 'Enabled', val: slo.data ? enabled : '—', tone: 'ok' },
    {
      label: 'Latency objectives',
      val: slo.data ? rows.filter((r) => r.type === 'p99').length : '—',
      tone: 'info',
    },
    {
      label: 'Error-rate objectives',
      val: slo.data ? rows.filter((r) => r.type === 'error_rate').length : '—',
      tone: 'warn',
    },
  ]

  const typeUnit = (t: string | undefined, threshold: number | undefined): string => {
    if (threshold == null) return '—'
    if (t === 'p99') return `${threshold}s`
    if (t === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
    return String(threshold)
  }

  const cols: DtColumn<SloRow>[] = [
    {
      label: 'SLO',
      val: (r) => r.metric,
      render: (r) => (
        <span>
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.metric}</span>
          {r.description && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.description}</div>}
        </span>
      ),
    },
    { label: 'Type', render: (r) => <Tag>{r.type ?? '—'}</Tag> },
    { label: 'Target', r: true, val: (r) => typeUnit(r.type, r.threshold) },
    { label: 'Window', render: (r) => <Tag>{r.window ?? '—'}</Tag> },
    {
      label: 'Enabled',
      render: (r) => (
        <Pill tone={r.enabled ? 'ok' : 'muted'} dot>
          {r.enabled ? 'enabled' : 'disabled'}
        </Pill>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="SLOs"
        sub="latency + availability objectives · /api/admin/slo"
        mode="readonly"
      />
      <Banner tone="info">
        Objectives are evaluated against the live metrics window. Each row shows the target +
        evaluation window; the met/breached status is computed per metric on the SLO detail route —
        no value here is fabricated.
      </Banner>
      <LoadErr isLoading={slo.isLoading} isError={slo.isError} label="SLOs" />
      <KpiStrip kpis={strip} />
      <Section title="Service-level objectives" sub={slo.data ? `${rows.length} defined · ${enabled} enabled` : 'SLOService'} />
      {slo.data &&
        (rows.length ? (
          <DataTable<SloRow>
            cols={cols}
            rows={rows}
            search="search SLOs · metric · description…"
            pageSize={12}
            empty="No SLOs defined"
          />
        ) : (
          <Banner tone="info">No SLOs are defined yet.</Banner>
        ))}
    </>
  )
}

/* ============================================================
 * 6. context-window · mw — per-session context utilization + compaction
 * ============================================================ */
function ContextWindowPage(_props: LeafPageProps) {
  const ctx = useContextMetrics()
  const rows = ctx.data?.sessions ?? []
  const stats = ctx.data?.statistics

  const strip: Kpi[] = [
    {
      label: 'Avg utilization',
      val: stats?.averageUtilization != null ? fmtPct(stats.averageUtilization) : '—',
      tone: utilTone(stats?.averageUtilization),
    },
    {
      label: 'Max utilization',
      val: stats?.maxUtilization != null ? fmtPct(stats.maxUtilization) : '—',
      tone: utilTone(stats?.maxUtilization),
    },
    { label: 'Sessions tracked', val: ctx.data ? stats?.totalSessions ?? rows.length : '—', tone: 'accent' },
    {
      label: 'High-utilization',
      val: ctx.data ? stats?.highUtilizationSessions ?? 0 : '—',
      tone: (stats?.highUtilizationSessions ?? 0) > 0 ? 'warn' : 'ok',
    },
  ]

  const cols: DtColumn<ContextSessionRow>[] = [
    {
      label: 'Session',
      val: (r) => r.title ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name">{r.title ?? '—'}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {String(r.id).slice(0, 8)} · {r.userEmail ?? r.userName ?? '—'}
          </div>
        </span>
      ),
    },
    { label: 'Model', render: (r) => <Tag>{r.model ?? '—'}</Tag> },
    { label: 'Messages', r: true, val: (r) => r.messageCount ?? 0 },
    { label: 'Context tokens', r: true, sortVal: (r) => r.contextTokensTotal ?? 0, val: (r) => fmtNum(r.contextTokensTotal) },
    { label: 'Window', r: true, val: (r) => (r.contextWindowSize != null ? fmtNum(r.contextWindowSize) : '—') },
    {
      label: 'Utilization',
      r: true,
      sortVal: (r) => r.contextUtilizationPct ?? -1,
      render: (r) => {
        if (r.contextUtilizationPct == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const t = utilTone(r.contextUtilizationPct)
        const v = t === 'err' ? 'var(--err)' : t === 'warn' ? 'var(--warn)' : 'var(--ok)'
        return <span style={{ color: v }}>{fmtPct(r.contextUtilizationPct)}</span>
      },
    },
    { label: 'Updated', val: (r) => relTime(r.updatedAt) },
  ]

  return (
    <>
      <PageHead
        title="Context Window"
        sub="per-session context utilization + compaction · /api/admin/context-metrics"
        mode="readonly"
      />
      <LoadErr isLoading={ctx.isLoading} isError={ctx.isError} label="context metrics" />
      <KpiStrip kpis={strip} />
      <Section title="Sessions" sub={ctx.data ? `${rows.length} loaded` : 'per-session utilization'} />
      {ctx.data &&
        (rows.length ? (
          <DataTable<ContextSessionRow>
            cols={cols}
            rows={rows}
            search="search sessions · title · user · model…"
            pageSize={12}
            empty="No sessions tracked"
          />
        ) : (
          <Banner tone="info">No sessions with context-window telemetry in this window.</Banner>
        ))}
    </>
  )
}

/* ============================================================
 * 7. embeddings · mb — embedding throughput + vector stores
 * ============================================================ */
function EmbeddingsPage(_props: LeafPageProps) {
  const cfg = useEmbeddingConfig()
  const storage = useStorage()
  const milvus = storage.data?.milvus
  const pgv = storage.data?.pgvector

  const strip: Kpi[] = [
    {
      label: 'Milvus vectors',
      val: milvus?.total_vectors != null ? fmtNum(milvus.total_vectors) : '—',
      tone: 'accent',
      sub: milvus?.collections != null ? `${milvus.collections} collections` : undefined,
    },
    {
      label: 'pgvector rows',
      val: pgv?.total_rows != null ? fmtNum(pgv.total_rows) : '—',
      tone: 'info',
      sub: pgv?.tables != null ? `${pgv.tables} tables` : undefined,
    },
    {
      label: 'Embedding model',
      val: cfg.data?.model ?? '—',
      tone: 'ok',
      sub: cfg.data?.provider || undefined,
    },
    {
      label: 'Dimensions',
      val: cfg.data?.dimensions != null ? cfg.data.dimensions : '—',
      tone: 'accent',
    },
  ]

  interface StoreRow extends Record<string, unknown> {
    store: string
    units: string
    count: number | null
    detail: string
  }
  const storeRows: StoreRow[] = [
    {
      store: 'Milvus',
      units: 'vectors',
      count: milvus?.total_vectors ?? null,
      detail: milvus?.error ? `error: ${milvus.error}` : `${milvus?.collections ?? '—'} collections`,
    },
    {
      store: 'pgvector',
      units: 'rows',
      count: pgv?.total_rows ?? null,
      detail: pgv?.error ? `error: ${pgv.error}` : `${pgv?.tables ?? '—'} tables`,
    },
    {
      store: 'Redis',
      units: 'keys',
      count: storage.data?.redis?.keys ?? null,
      detail: storage.data?.redis?.memory_mb != null ? `${storage.data.redis.memory_mb} MB` : '—',
    },
  ]
  const storeCols: DtColumn<StoreRow>[] = [
    { label: 'Store', val: (r) => r.store, render: (r) => <span className="awc-name">{r.store}</span> },
    { label: 'Units', render: (r) => <Tag>{r.units}</Tag> },
    { label: 'Count', r: true, render: (r) => <span>{r.count != null ? fmtNum(r.count) : '—'}</span> },
    { label: 'Detail', val: (r) => r.detail },
  ]

  return (
    <>
      <PageHead
        title="Embeddings"
        sub="embedding model + vector-store throughput · /api/admin/embeddings/config · /api/admin/storage"
        mode="readonly"
      />
      <LoadErr
        isLoading={cfg.isLoading || storage.isLoading}
        isError={cfg.isError && storage.isError}
        label="embeddings + storage"
      />
      <KpiStrip kpis={strip} />
      <Section title="Vector stores" sub="Milvus · pgvector · Redis usage" />
      {storage.data ? (
        <DataTable<StoreRow>
          cols={storeCols}
          rows={storeRows}
          search="search stores…"
          pageSize={8}
          empty="No storage stats"
        />
      ) : (
        <Banner tone="info">Storage usage not available — the storage probe returned no data.</Banner>
      )}
    </>
  )
}

/* ============================================================
 * 8. audit · md — full platform audit log
 * ============================================================ */
type AuditRow = AuditLogEntry & Record<string, unknown>

function AuditPage(_props: LeafPageProps) {
  const audit = useAuditLogs(100)
  const rows = (audit.data?.logs ?? []) as AuditRow[]
  const total = audit.data?.pagination?.totalItems ?? rows.length

  const actorOf = (l: AuditRow): string => l.userName || l.userEmail || l.userId || 'system'
  const outcomeTone = (ok: boolean | undefined): Tone =>
    ok == null ? 'muted' : ok ? 'ok' : 'err'

  const strip: Kpi[] = [
    { label: 'Events', val: audit.data ? fmtNum(total) : '—', tone: 'accent' },
    {
      label: 'Errors',
      val: audit.data ? rows.filter((r) => r.success === false).length : '—',
      tone: 'err',
    },
    {
      label: 'Admin actions',
      val: audit.data ? rows.filter((r) => r.type === 'admin').length : '—',
      tone: 'warn',
    },
    {
      label: 'Distinct actors',
      val: audit.data ? new Set(rows.map(actorOf)).size : '—',
      tone: 'info',
    },
  ]

  const cols: DtColumn<AuditRow>[] = [
    { label: 'When', val: (r) => relTime(r.timestamp), sortVal: (r) => r.timestamp ?? '' },
    { label: 'Actor', val: (r) => actorOf(r) },
    { label: 'Action', render: (r) => <Tag>{r.action ?? '—'}</Tag> },
    {
      label: 'Resource',
      val: (r) => `${r.resourceType ?? ''} ${r.resourceId ?? ''}`.trim() || '—',
      render: (r) => (
        <span>
          <span className="awc-name">{r.resourceType ?? '—'}</span>
          {r.resourceId && (
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
              {r.resourceId}
            </div>
          )}
        </span>
      ),
    },
    {
      label: 'Outcome',
      render: (r) => (
        <Pill tone={outcomeTone(r.success)} dot>
          {r.success == null ? '—' : r.success ? 'ok' : 'error'}
        </Pill>
      ),
    },
    { label: 'IP', val: (r) => r.ipAddress ?? '—' },
  ]

  return (
    <>
      <PageHead
        title="Audit Logs"
        sub={audit.data ? `${fmtNum(total)} platform audit events · /api/admin/audit-logs` : 'full platform audit · /api/admin/audit-logs'}
        actions={[{ label: 'Export CSV', ic: '⤓ ' }]}
        mode="readonly"
      />
      <KpiStrip kpis={strip} />
      <Section
        title="Platform audit trail"
        sub="admin + user actions · FedRAMP AU-2/AU-6"
        right={<Pill tone="ok" dot>live</Pill>}
      />
      <LoadErr isLoading={audit.isLoading} isError={audit.isError} label="audit logs" />
      {audit.data && (
        <DataTable<AuditRow>
          cols={cols}
          rows={rows}
          search="search audit · actor · action · resource · query…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'admin', label: 'admin', cnt: rows.filter((r) => r.type === 'admin').length },
              { id: 'user', label: 'user', cnt: rows.filter((r) => r.type === 'user').length },
              { id: 'errors', label: 'errors', cnt: rows.filter((r) => r.success === false).length },
            ],
            filter: (row, chip) => {
              const r = row as AuditRow
              if (chip === 'all') return true
              if (chip === 'errors') return r.success === false
              return r.type === chip
            },
          }}
          empty="No audit events"
        />
      )}
    </>
  )
}

/* ============================================================
 * 9. feedback · mf — thumbs + free-text feedback on responses
 * ============================================================ */
function FeedbackPage(_props: LeafPageProps) {
  const recent = useFeedbackRecent()
  const stats = useFeedbackStats()
  const rows = recent.data?.feedback ?? []
  const st = stats.data

  const isUp = (r: FeedbackRow): boolean => {
    const t = String(r.feedbackType ?? '').toLowerCase()
    if (t.includes('up') || t === 'positive' || t === 'thumbs_up') return true
    if (r.rating != null) return r.rating > 0
    return false
  }
  const isDown = (r: FeedbackRow): boolean => {
    const t = String(r.feedbackType ?? '').toLowerCase()
    if (t.includes('down') || t === 'negative' || t === 'thumbs_down') return true
    if (r.rating != null) return r.rating < 0
    return false
  }

  const up = rows.filter(isUp).length
  const down = rows.filter(isDown).length
  const segs: DonutSeg[] = [
    { v: up || 0.0001, tone: 'ok' },
    { v: down || 0.0001, tone: 'err' },
  ]

  const strip: Kpi[] = [
    { label: 'Total feedback', val: st?.totalFeedback != null ? fmtNum(st.totalFeedback) : recent.data ? rows.length : '—', tone: 'accent' },
    {
      label: 'Satisfaction',
      val: st?.satisfactionRate != null ? fmtPct(st.satisfactionRate * (st.satisfactionRate <= 1 ? 100 : 1)) : '—',
      tone: 'ok',
    },
    { label: 'Distinct users', val: st?.uniqueUsers != null ? st.uniqueUsers : '—', tone: 'info' },
    { label: 'Negative (recent)', val: recent.data ? down : '—', tone: down > 0 ? 'warn' : 'ok' },
  ]

  const sentimentTone = (r: FeedbackRow): Tone => (isUp(r) ? 'ok' : isDown(r) ? 'err' : 'muted')

  const cols: DtColumn<FeedbackRow>[] = [
    { label: 'When', val: (r) => relTime(r.createdAt), sortVal: (r) => r.createdAt ?? '' },
    { label: 'User', val: (r) => r.user?.email ?? r.user?.name ?? '—' },
    {
      label: 'Sentiment',
      render: (r) => (
        <Pill tone={sentimentTone(r)} dot>
          {isUp(r) ? 'up' : isDown(r) ? 'down' : (r.feedbackType ?? '—')}
        </Pill>
      ),
    },
    {
      label: 'Comment',
      render: (r) =>
        r.comment ? (
          <span style={{ whiteSpace: 'normal', color: 'var(--fg-1)' }}>{r.comment}</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
    { label: 'Model', render: (r) => (r.model ? <Tag>{r.model}</Tag> : <span style={{ color: 'var(--fg-3)' }}>—</span>) },
  ]

  return (
    <>
      <PageHead
        title="Feedback"
        sub="thumbs + free-text feedback on responses · /api/admin/feedback/recent · /stats"
        mode="readonly"
      />
      <LoadErr isLoading={recent.isLoading} isError={recent.isError} label="feedback" />
      <KpiStrip kpis={strip} />
      {recent.data && (up > 0 || down > 0) && (
        <Section title="Sentiment" sub={`${up} up · ${down} down (recent window)`}>
          <div className="awc-chartcard" style={{ display: 'flex', justifyContent: 'center' }}>
            <Donut segs={segs} label={`${Math.round((up / (up + down || 1)) * 100)}%`} />
          </div>
        </Section>
      )}
      <Section title="Recent feedback" sub={recent.data ? `${rows.length} loaded` : 'thumbs + comments'} />
      {recent.data &&
        (rows.length ? (
          <DataTable<FeedbackRow>
            cols={cols}
            rows={rows}
            search="search feedback · user · comment · model…"
            chips={{
              active: 'all',
              opts: [
                { id: 'all', label: 'all', cnt: rows.length },
                { id: 'up', label: 'up', cnt: up },
                { id: 'down', label: 'down', cnt: down },
              ],
              filter: (row, chip) => {
                const r = row as FeedbackRow
                if (chip === 'all') return true
                if (chip === 'up') return isUp(r)
                return isDown(r)
              },
            }}
            pageSize={12}
            empty="No feedback recorded"
          />
        ) : (
          <Banner tone="info">No feedback recorded in this window.</Banner>
        ))}
    </>
  )
}

/* ============================================================
 * 10. test-harness · mt — real-model scenario runs (pass/fail)
 * ============================================================ */
function TestHarnessPage(_props: LeafPageProps) {
  const harness = useHarnessResults()
  const rows = harness.data?.results ?? []
  const summary = harness.data?.summary

  const statusTone = (s: string | undefined): Tone => {
    const v = String(s ?? '').toLowerCase()
    if (v === 'pass') return 'ok'
    if (v === 'fail') return 'err'
    if (v === 'running') return 'info'
    return 'muted'
  }

  const strip: Kpi[] = [
    { label: 'Scenarios', val: harness.data ? summary?.total ?? rows.length : '—', tone: 'accent' },
    { label: 'Passed', val: harness.data ? summary?.passed ?? 0 : '—', tone: 'ok' },
    { label: 'Failed', val: harness.data ? summary?.failed ?? 0 : '—', tone: (summary?.failed ?? 0) > 0 ? 'err' : 'ok' },
    {
      label: 'Last run',
      val: harness.data?.lastRun ? relTime(harness.data.lastRun) : '—',
      tone: 'info',
    },
  ]

  const cols: DtColumn<HarnessRow>[] = [
    {
      label: 'Scenario',
      val: (r) => r.test ?? '',
      render: (r) => (
        <span>
          <span className="awc-name">{r.test ?? '—'}</span>
          {r.category && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.category}</div>}
        </span>
      ),
    },
    {
      label: 'Status',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={statusTone(r.status)} />
          <span style={{ color: r.status === 'fail' ? 'var(--err)' : r.status === 'pass' ? 'var(--ok)' : 'var(--fg-2)' }}>
            {r.status ?? '—'}
          </span>
        </span>
      ),
    },
    { label: 'Duration', r: true, sortVal: (r) => r.durationMs ?? -1, val: (r) => fmtMs(r.durationMs) },
    {
      label: 'Error',
      render: (r) =>
        r.error ? (
          <span style={{ color: 'var(--err)', whiteSpace: 'normal' }}>{asText(r.error)}</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
    { label: 'When', val: (r) => relTime(r.timestamp) },
  ]

  return (
    <>
      <PageHead
        title="Test Harness"
        sub={
          harness.data
            ? `${summary?.passed ?? 0} pass · ${summary?.failed ?? 0} fail · last run ${harness.data.lastRun ? relTime(harness.data.lastRun) : '—'}`
            : 'real-model scenario runs · /api/admin/test-harness/results'
        }
        actions={[{ label: 'Run scenario', ic: '▷ ', primary: true }]}
        mode="hitl"
      />
      {(summary?.failed ?? 0) > 0 && (
        <Banner tone="err">
          <b>{summary?.failed} scenario{(summary?.failed ?? 0) === 1 ? '' : 's'} RED</b> in the last
          run — the build gate blocks on a RED harness (Rule 7c).
        </Banner>
      )}
      <LoadErr isLoading={harness.isLoading} isError={harness.isError} label="harness results" />
      <KpiStrip kpis={strip} />
      <Section title="Scenarios" sub={harness.data ? `${rows.length} results` : 'last run results'} />
      {harness.data &&
        (rows.length ? (
          <DataTable<HarnessRow>
            cols={cols}
            rows={rows}
            search="search scenarios · name · category…"
            chips={{
              active: 'all',
              opts: [
                { id: 'all', label: 'all', cnt: rows.length },
                { id: 'pass', label: 'pass', cnt: rows.filter((r) => r.status === 'pass').length },
                { id: 'fail', label: 'fail', cnt: rows.filter((r) => r.status === 'fail').length },
                { id: 'skip', label: 'skip', cnt: rows.filter((r) => r.status === 'skip').length },
              ],
              filter: (row, chip) =>
                chip === 'all' ? true : (row as HarnessRow).status === chip,
            }}
            pageSize={12}
            empty="No harness runs yet"
          />
        ) : (
          <Banner tone="info">
            No harness runs recorded — trigger a scenario to populate this table. Nothing is shown
            rather than a fabricated pass/fail.
          </Banner>
        ))}
    </>
  )
}

/* ============================================================
 * 11. chargeback · bc — cost management (per-team / tenant attribution)
 * ============================================================ */
function ChargebackPage(_props: LeafPageProps) {
  const cb = useChargebackBudgets()
  const rows = cb.data?.budgets ?? []

  const totalSpend = rows.reduce((a, r) => a + (r.current_spend ?? 0), 0)
  const totalLimit = rows.reduce((a, r) => a + (r.monthly_limit ?? 0), 0)
  const overBudget = rows.filter((r) => r.over_budget).length

  const strip: Kpi[] = [
    { label: 'Total spend', val: cb.data ? fmtUsd(totalSpend) : '—', tone: 'accent' },
    { label: 'Monthly budget', val: cb.data && totalLimit ? fmtUsd(totalLimit) : '—', tone: 'info' },
    {
      label: 'Budgets tracked',
      val: cb.data ? rows.length : '—',
      tone: 'ok',
    },
    {
      label: 'Over budget',
      val: cb.data ? overBudget : '—',
      tone: overBudget > 0 ? 'err' : 'ok',
    },
  ]

  const bars: HBarItem[] = rows
    .slice()
    .sort((a, b) => (b.current_spend ?? 0) - (a.current_spend ?? 0))
    .slice(0, 10)
    .map((r): HBarItem => ({
      l: String(r.name ?? r.scope ?? r.id).slice(0, 24) || '—',
      v: r.current_spend ?? 0,
      tone: r.over_budget ? 'err' : 'accent',
      disp: fmtUsd(r.current_spend),
    }))

  const cols: DtColumn<BudgetRow>[] = [
    {
      label: 'Cost center',
      val: (r) => r.name ?? r.scope ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name">{r.name ?? r.scope ?? r.id}</span>
          {r.scope_type && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.scope_type}</div>}
        </span>
      ),
    },
    {
      label: 'Spend',
      r: true,
      sortVal: (r) => r.current_spend ?? 0,
      render: (r) => <span style={{ color: 'var(--accent)' }}>{fmtUsd(r.current_spend)}</span>,
    },
    { label: 'Budget', r: true, val: (r) => (r.monthly_limit != null ? fmtUsd(r.monthly_limit) : '—') },
    {
      label: 'Usage',
      r: true,
      sortVal: (r) => r.usage_percentage ?? -1,
      render: (r) => {
        if (r.usage_percentage == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const t = alertTone(r.alert_level)
        const v = t === 'err' ? 'var(--err)' : t === 'warn' ? 'var(--warn)' : t === 'info' ? 'var(--info)' : 'var(--ok)'
        return <span style={{ color: v }}>{fmtPct(r.usage_percentage)}</span>
      },
    },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={alertTone(r.alert_level)} dot>
          {r.alert_level ?? (r.over_budget ? 'over' : 'normal')}
        </Pill>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Cost Management"
        sub="chargeback by team / tenant · per-budget attribution · /api/admin/chargeback/budgets"
        mode="readonly"
      />
      {overBudget > 0 && (
        <Banner tone="err">
          <b>{overBudget} cost {overBudget === 1 ? 'center is' : 'centers are'} over budget</b> —
          review the attribution table below.
        </Banner>
      )}
      <LoadErr isLoading={cb.isLoading} isError={cb.isError} label="chargeback budgets" />
      <KpiStrip kpis={strip} />
      {bars.length > 0 && (
        <Section title="Spend by cost center" sub="top by current spend">
          <div className="awc-chartcard">
            <HBars items={bars} />
          </div>
        </Section>
      )}
      <Section title="Budgets" sub={cb.data ? `${rows.length} cost centers` : 'per-team attribution'} />
      {cb.data &&
        (rows.length ? (
          <DataTable<BudgetRow>
            cols={cols}
            rows={rows}
            search="search cost centers…"
            chips={{
              active: 'all',
              opts: [
                { id: 'all', label: 'all', cnt: rows.length },
                { id: 'over', label: 'over budget', cnt: overBudget },
                { id: 'normal', label: 'within budget', cnt: rows.length - overBudget },
              ],
              filter: (row, chip) => {
                const r = row as BudgetRow
                if (chip === 'all') return true
                if (chip === 'over') return !!r.over_budget
                return !r.over_budget
              },
            }}
            pageSize={12}
            empty="No budgets configured"
          />
        ) : (
          <Banner tone="info">
            No chargeback budgets configured yet — create a budget to attribute spend per team /
            tenant. No spend rows are fabricated.
          </Banner>
        ))}
    </>
  )
}

/* ============================================================
 * exports — all 11 Observability leaf ids → page component
 * ============================================================ */
export const obsPages: Record<string, React.ComponentType<LeafPageProps>> = {
  'cluster-health': ClusterHealthPage,
  analytics: AnalyticsPage,
  'user-activity': UserActivityPage,
  errors: ErrorsPage,
  slo: SloPage,
  'context-window': ContextWindowPage,
  embeddings: EmbeddingsPage,
  audit: AuditPage,
  feedback: FeedbackPage,
  'test-harness': TestHarnessPage,
  chargeback: ChargebackPage,
}
