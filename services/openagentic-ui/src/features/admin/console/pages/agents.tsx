/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * agents.tsx — the admin v4 "Agents" domain page bodies (4 leaves), at mock
 * fidelity (the admin-console mock PAGES['agent-*']) and WIRED to
 * the real admin agent endpoints. Follows the HomePage exemplar exactly:
 *   - every number comes from a live hook or renders an honest "—" / empty
 *     state (never a fabricated value, never an invented row),
 *   - every color resolves via a global theme token (var(--*)); zero hex,
 *   - each component renders ONLY the page BODY (PageHead + content); the
 *     AdminConsole appends the OptionSpec inventory (two-part leaf contract).
 *
 * Data sources (all real admin routes, via useDashboardMetrics hooks):
 *   useAdminAgents            → GET /api/admin/agents (registry list)
 *   useAdminAgentMetrics      → GET /api/admin/agents/metrics (rollup)
 *   useAdminAgentFleet        → GET /api/admin/agents/metrics/fleet (per-agent 24h + runs)
 *   useAdminAgentExecutionStats→ GET /api/admin/agents/executions/stats
 *   useAdminAgentLiveExecutions→ GET /api/admin/agents/executions/live
 *   useAdminAgentExecutions   → GET /api/admin/agents/executions (agentRunLog)
 *   useAdminAgentSkills       → GET /api/admin/agents/skills
 *
 * Cost field note: the FLEET / STATS endpoints report cost in CENTS
 * (totalCostCents / costCents / costTodayCents); the REGISTRY / EXECUTIONS
 * rows report USD (estimated_cost). Helpers below convert explicitly so the
 * mock's "$X" labels stay honest.
 */
import * as React from 'react'
import {
  AreaChart,
  Banner,
  DataTable,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  StatusDot,
  Tag,
  type DtColumn,
  type Kpi,
} from '../primitives'
import type { LeafPageProps } from './registry'
import type { Tone } from '../types'
import {
  useAdminAgentExecutionStats,
  useAdminAgentExecutions,
  useAdminAgentFleet,
  useAdminAgentLiveExecutions,
  useAdminAgentMetrics,
  useAdminAgentSkills,
  useAdminAgents,
  type AdminAgentExecutionRow,
  type AdminAgentLiveExecution,
  type AdminAgentRow,
  type AdminAgentSkillRow,
  type FleetMetricsAgent,
  type FleetMetricsRun,
} from '../../hooks/useDashboardMetrics'

/**
 * DataTable<T> constrains T to `Record<string, unknown>`; the typed admin
 * row interfaces (optional fields) don't structurally satisfy that index
 * constraint, so we widen with a local alias and cast the row arrays once at
 * each call site. Purely a typing convenience — no runtime shape change.
 */
type DtRow<T> = T & Record<string, unknown>

/* ---------------- format helpers (honest "—" on missing) ---------------- */
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
/** Cents → USD string (fleet/stats endpoints report cents). */
function fmtCents(c: number | undefined | null): string {
  if (c == null || Number.isNaN(c)) return '—'
  return fmtUsd(c / 100)
}
/** estimated_cost can arrive as a number, numeric string, or null. */
function asUsd(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : undefined
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`
}
function fmtMs(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1000) return (n / 1000).toFixed(1) + 's'
  return Math.round(n) + 'ms'
}
function relTime(ts: string | undefined | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const diff = Date.now() - d.getTime()
  if (diff < 0) return 'now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
/** Success-rate → tone (mock: ≥95 ok, ≥75 warn, else err). */
function rateTone(pct: number | undefined | null): Tone {
  if (pct == null) return 'muted'
  const p = pct <= 1 ? pct * 100 : pct
  return p >= 95 ? 'ok' : p >= 75 ? 'warn' : 'err'
}
/** Execution status → tone. */
function execTone(status: string | undefined): Tone {
  const s = (status ?? '').toLowerCase()
  if (s === 'completed' || s === 'success') return 'ok'
  if (s === 'running' || s === 'queued' || s === 'pending') return 'info'
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'err'
  return 'muted'
}
/** Safe display name for an agent registry row. */
function agentName(a: AdminAgentRow): string {
  return a.display_name || a.name || a.id
}
/** Stringify any unknown payload for a drill-in panel — never render an object as a JSX child (React #31). */
function stringify(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/* ---------------- shared drill-in side panel ---------------- */
function SidePanel({
  title,
  sub,
  onClose,
  children,
}: {
  title: string
  sub?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'color-mix(in srgb, var(--bg-0) 55%, transparent)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(520px, 92vw)',
          height: '100%',
          overflow: 'auto',
          background: 'var(--bg-1)',
          borderLeft: '1px solid var(--line-1)',
          boxShadow: '-8px 0 28px color-mix(in srgb, var(--bg-0) 60%, transparent)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            position: 'sticky',
            top: 0,
            background: 'var(--bg-1)',
            borderBottom: '1px solid var(--line-1)',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
            {sub != null && (
              <div style={{ color: 'var(--fg-2)', fontSize: 12, marginTop: 2 }}>{sub}</div>
            )}
          </div>
          <button className="awc-btn awc-sm awc-ghost" onClick={onClose}>
            close ✕
          </button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  )
}

/** A two-column definition row for the side panel. */
function DlRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '7px 0',
        borderTop: '1px solid var(--line-1)',
        fontSize: 13,
      }}
    >
      <div style={{ width: 130, flexShrink: 0, color: 'var(--fg-3)' }}>{k}</div>
      <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{v ?? '—'}</div>
    </div>
  )
}

/** A `<pre>` block for stringified unknown payloads (no raw-object JSX child). */
function CodeBlock({ text }: { text: string }) {
  return (
    <pre
      style={{
        margin: '6px 0 0',
        padding: 10,
        background: 'var(--bg-2)',
        border: '1px solid var(--line-1)',
        borderRadius: 8,
        color: 'var(--fg-1)',
        fontSize: 11.5,
        fontFamily: 'var(--font-v3-mono)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 320,
        overflow: 'auto',
      }}
    >
      {text}
    </pre>
  )
}

/* ---------------- error / loading banners ---------------- */
function StateBanner({
  isLoading,
  isError,
  label,
}: {
  isLoading: boolean
  isError: boolean
  label: string
}) {
  if (isError)
    return (
      <Banner tone="err">
        Could not load {label}. The endpoint returned an error or is unreachable — showing no
        fabricated data.
      </Banner>
    )
  if (isLoading) return <Banner tone="info">Loading {label}…</Banner>
  return null
}

/* ====================================================================== */
/* agent-registry — Agent definitions table (model, tools, status) + drill */
/* ====================================================================== */
function AgentRegistryPage(_: LeafPageProps) {
  const list = useAdminAgents()
  const metrics = useAdminAgentMetrics()
  const fleet = useAdminAgentFleet()
  const stats = useAdminAgentExecutionStats()
  const [sel, setSel] = React.useState<AdminAgentRow | null>(null)

  const agents = list.data?.agents ?? []
  const enabledCount = agents.filter((a) => a.enabled).length

  // Per-agent 24h fleet metrics keyed by agentId for the drill-in.
  const fleetById = React.useMemo(() => {
    const m = new Map<string, FleetMetricsAgent>()
    for (const f of fleet.data?.agents ?? []) m.set(f.agentId, f)
    return m
  }, [fleet.data])

  const totalExec = metrics.data?.totalExecutions
  const tokensToday = stats.data?.tokensToday
  const costTodayCents = stats.data?.costTodayCents
  const successRate = stats.data?.successRate

  const kpis: Kpi[] = [
    { label: 'Agents', val: list.data ? agents.length : '—', tone: 'accent' },
    {
      label: 'Active',
      val: list.data ? enabledCount : '—',
      tone: 'ok',
      sub: successRate != null ? `${fmtPct(successRate)} success` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Executions',
      val: totalExec != null ? fmtNum(totalExec) : '—',
      tone: 'info',
      sub: stats.data?.totalToday != null ? `${fmtNum(stats.data.totalToday)} today` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Tokens (24h)',
      val: tokensToday != null ? fmtNum(tokensToday) : '—',
      unit: tokensToday != null ? 'tok' : undefined,
      tone: 'info',
    },
    {
      label: 'Cost (24h)',
      val: costTodayCents != null ? fmtCents(costTodayCents) : '—',
      tone: 'warn',
    },
  ]

  const cols: DtColumn<DtRow<AdminAgentRow>>[] = [
    {
      label: 'Agent',
      val: (r) => agentName(r),
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={r.enabled ? 'ok' : 'muted'} />
          <span className="awc-name">{agentName(r)}</span>
        </span>
      ),
    },
    { label: 'Type', render: (r) => (r.agent_type ? <Tag>{r.agent_type}</Tag> : <span>—</span>) },
    {
      label: 'Kind',
      render: (r) =>
        r.category ? (
          <Pill tone={r.category === 'platform' ? 'purple' : 'info'}>{r.category}</Pill>
        ) : (
          <span>—</span>
        ),
    },
    { label: 'Model', val: (r) => r.model_config?.primaryModel ?? '—' },
    { label: 'Skills', r: true, val: (r) => r.skills?.length ?? 0 },
    { label: 'Tools', r: true, val: (r) => r.tools_whitelist?.length ?? 0 },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={r.enabled ? 'ok' : 'muted'} dot>
          {r.enabled ? 'enabled' : 'disabled'}
        </Pill>
      ),
    },
    { label: 'Created', val: (r) => (r.created_at ? relTime(r.created_at) : '—') },
  ]

  const chips = {
    active: 'all',
    opts: [
      { id: 'all', label: 'all', cnt: agents.length },
      { id: 'platform', label: 'platform', cnt: agents.filter((a) => a.category === 'platform').length },
      { id: 'background', label: 'background', cnt: agents.filter((a) => a.category === 'background').length },
      { id: 'enabled', label: 'enabled', cnt: enabledCount },
      { id: 'disabled', label: 'disabled', cnt: agents.length - enabledCount },
    ],
    filter: (row: unknown, chip: string) => {
      const a = row as AdminAgentRow
      if (chip === 'all') return true
      if (chip === 'enabled') return !!a.enabled
      if (chip === 'disabled') return !a.enabled
      return a.category === chip
    },
  }

  const selFleet = sel ? fleetById.get(sel.id) : undefined

  return (
    <>
      <PageHead
        title="Agents"
        sub={
          list.data
            ? `${agents.length} registered · ${enabledCount} active${
                totalExec != null ? ` · ${fmtNum(totalExec)} executions` : ''
              }${costTodayCents != null ? ` · ${fmtCents(costTodayCents)} (24h)` : ''}`
            : 'agent registry · model · tools · status'
        }
        actions={[{ label: 'Register agent', ic: '＋ ', primary: true }]}
        mode="editable"
      />

      <StateBanner isLoading={list.isLoading} isError={list.isError} label="agent registry" />

      <KpiStrip kpis={kpis} />

      <Section title="Registry" sub="agent definitions · click a row to drill in" />
      <DataTable<DtRow<AdminAgentRow>>
        cols={cols}
        rows={agents as DtRow<AdminAgentRow>[]}
        chips={chips}
        dimKey="enabled"
        search="search agents · names, types, descriptions…"
        onRow={(r) => setSel(r)}
        empty={
          list.isLoading
            ? 'Loading agents…'
            : list.isError
              ? 'Agent registry unavailable.'
              : 'No agents registered.'
        }
      />

      {sel && (
        <SidePanel
          title={agentName(sel)}
          sub={`${sel.agent_type ?? 'agent'} · ${sel.skills?.length ?? 0} skills · ${
            sel.tools_whitelist?.length ?? 0
          } tools`}
          onClose={() => setSel(null)}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <Pill tone={sel.enabled ? 'ok' : 'muted'} dot>
              {sel.enabled ? 'enabled' : 'disabled'}
            </Pill>
            {sel.category && <Pill tone={sel.category === 'platform' ? 'purple' : 'info'}>{sel.category}</Pill>}
          </div>
          {sel.description && (
            <div style={{ color: 'var(--fg-2)', fontSize: 13, marginBottom: 10 }}>{sel.description}</div>
          )}

          <Section title="Identity" />
          <DlRow k="id" v={<span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{sel.id}</span>} />
          <DlRow k="name" v={sel.name ?? '—'} />
          <DlRow k="agent_type" v={sel.agent_type ?? '—'} />
          <DlRow k="primary model" v={sel.model_config?.primaryModel ?? '—'} />
          <DlRow k="fallback model" v={sel.model_config?.fallbackModel ?? '—'} />
          <DlRow k="created by" v={sel.created_by ?? '—'} />
          <DlRow k="created" v={sel.created_at ? relTime(sel.created_at) : '—'} />

          <Section title="Fleet (24h)" sub="/admin/agents/metrics/fleet" />
          {selFleet ? (
            <>
              <DlRow k="runs (24h)" v={fmtNum(selFleet.runCount24h)} />
              <DlRow
                k="success"
                v={<span style={{ color: `var(--${rateTone(selFleet.successRate)})` }}>{fmtPct(selFleet.successRate)}</span>}
              />
              <DlRow k="p50 duration" v={fmtMs(selFleet.p50DurationMs)} />
              <DlRow k="cost (24h)" v={fmtCents(selFleet.totalCostCents)} />
            </>
          ) : (
            <Banner tone="info">No 24h fleet metrics for this agent yet.</Banner>
          )}

          <Section title="Skills" />
          {sel.skills?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {sel.skills.map((s, i) => (
                <Tag key={i}>{s}</Tag>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--fg-3)', fontSize: 12 }}>No skills attached.</div>
          )}

          <Section title="Tools" />
          {sel.tools_whitelist?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {sel.tools_whitelist.map((t, i) => (
                <Tag key={i}>{t}</Tag>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--fg-3)', fontSize: 12 }}>No tools whitelisted.</div>
          )}

          {sel.background != null && (
            <>
              <Section title="Background config" />
              <CodeBlock text={stringify(sel.background)} />
            </>
          )}
        </SidePanel>
      )}
    </>
  )
}

/* ====================================================================== */
/* agent-ops — live running agents + execution velocity (read-only)        */
/* ====================================================================== */
function AgentOpsPage(_: LeafPageProps) {
  const stats = useAdminAgentExecutionStats()
  const live = useAdminAgentLiveExecutions()
  const fleet = useAdminAgentFleet()
  const metrics = useAdminAgentMetrics()
  const [selRun, setSelRun] = React.useState<FleetMetricsRun | null>(null)

  const s = stats.data
  const liveRows = (live.data?.executions ?? []).slice(0, 12)
  const fleetAgents = fleet.data?.agents ?? []
  const fleetRuns = fleet.data?.runs ?? []

  // Partial-failure banner when any of the 3 live sources is unreachable.
  const anyError = stats.isError || live.isError || fleet.isError

  const kpis: Kpi[] = [
    {
      label: 'Active now',
      val: live.data ? liveRows.length : '—',
      tone: liveRows.length > 0 ? 'ok' : 'muted',
      sub: s?.activeAgents != null ? `${s.activeAgents} agents active` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Runs today',
      val: s?.totalToday != null ? fmtNum(s.totalToday) : '—',
      tone: 'accent',
      sub: s?.failedToday != null ? `${s.failedToday} failed` : undefined,
      deltaDir: s?.failedToday ? 'down' : 'flat',
    },
    {
      label: 'Runs (7d)',
      val: s?.totalWeek != null ? fmtNum(s.totalWeek) : '—',
      tone: 'info',
      sub: s?.avgLatencyMs != null ? `avg ${fmtMs(s.avgLatencyMs)}` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Success rate (7d)',
      val: s?.successRate != null ? fmtPct(s.successRate) : '—',
      tone: rateTone(s?.successRate),
      sub: s?.costTodayCents != null ? `${fmtCents(s.costTodayCents)} today` : undefined,
      deltaDir: 'flat',
    },
  ]

  // Executions-over-time: derive a per-agent 24h-run series from the fleet
  // rollup (the dashboard agentExecutions time-series lives on a different
  // hook; here we honestly chart what THIS endpoint provides — per-agent
  // 24h run counts — and render an empty state if absent).
  const runSeries = fleetAgents.map((a) => a.runCount24h)
  const runLabels = fleetAgents.map((a) => a.agentName)

  const fleetCols: DtColumn<DtRow<FleetMetricsAgent>>[] = [
    {
      label: 'Agent',
      val: (r) => r.agentName,
      render: (r) => (
        <span>
          <span className="awc-name">{r.agentName}</span>
          <div style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>
            {r.agentType}
          </div>
        </span>
      ),
    },
    { label: 'Runs 24h', r: true, val: (r) => r.runCount24h, render: (r) => fmtNum(r.runCount24h) },
    {
      label: 'Success',
      r: true,
      sortVal: (r) => r.successRate,
      render: (r) => (
        <span style={{ color: `var(--${rateTone(r.successRate)})` }}>{fmtPct(r.successRate)}</span>
      ),
    },
    { label: 'p50', r: true, sortVal: (r) => r.p50DurationMs, render: (r) => fmtMs(r.p50DurationMs) },
    { label: 'Cost 24h', r: true, sortVal: (r) => r.totalCostCents, render: (r) => fmtCents(r.totalCostCents) },
  ]

  return (
    <>
      <PageHead
        title="AgentOps"
        sub="real-time running agents + execution velocity · live 5s"
        mode="readonly"
      />

      {anyError && (
        <Banner tone="warn">
          Partial telemetry — one or more of stats / live / fleet is unreachable. KPIs and lists
          below show only the sources that responded (no fabricated values).
        </Banner>
      )}

      <KpiStrip kpis={kpis} />

      <Section title="Executions over time" sub="per-agent runs (24h) · /admin/agents/metrics/fleet" />
      {runSeries.length ? (
        <div className="awc-chartcard">
          <AreaChart series={[{ name: 'runs (24h)', data: runSeries }]} labels={runLabels} tone={['accent']} />
        </div>
      ) : (
        <Banner tone="info">
          {fleet.isLoading
            ? 'Loading fleet execution series…'
            : 'No per-agent run series available for this window.'}
        </Banner>
      )}

      <Section title="In-flight" sub="/admin/agents/executions/live · top 12 · 5s" />
      <div className="awc-tablewrap" style={{ marginBottom: 18 }}>
        <div className="awc-toolbar">
          <span style={{ fontWeight: 700 }}>Live executions</span>
          <span style={{ marginLeft: 'auto' }}>
            <Pill tone={liveRows.length ? 'ok' : 'muted'} dot>
              {liveRows.length ? 'live' : 'idle'}
            </Pill>
          </span>
        </div>
        {live.isError ? (
          <div style={{ padding: '14px 12px', color: 'var(--err)' }}>Live feed unavailable.</div>
        ) : liveRows.length ? (
          liveRows.map((e: AdminAgentLiveExecution) => {
            const role =
              e.agent_specs?.[0]?.role || e.results?.[0]?.role || e.orchestration || 'agent'
            const cost = asUsd(e.total_cost_cents)
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'baseline',
                  padding: '8px 12px',
                  borderTop: '1px solid var(--line-1)',
                }}
              >
                <span
                  style={{
                    color: 'var(--fg-3)',
                    fontSize: 11,
                    fontFamily: 'var(--font-v3-mono)',
                    flexShrink: 0,
                    width: 64,
                  }}
                >
                  {relTime(e.created_at ?? e.startedAt)}
                </span>
                <Pill tone={execTone(e.status)} dot>
                  {e.status}
                </Pill>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>{role}</span>
                <span
                  style={{
                    color: 'var(--fg-2)',
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {e.orchestration ?? '—'}
                  {e.tool_calls_count != null ? ` · ${e.tool_calls_count} tool calls` : ''}
                </span>
                <span style={{ color: 'var(--fg-2)', fontSize: 12, flexShrink: 0 }}>
                  {cost != null ? fmtUsd(cost / 100) : '—'}
                </span>
              </div>
            )
          })
        ) : (
          <div style={{ padding: '14px 12px', color: 'var(--fg-3)' }}>
            {live.isLoading ? 'Loading live executions…' : 'No agents in flight right now.'}
          </div>
        )}
      </div>

      <Section title="Fleet health" sub="/admin/agents/metrics/fleet · 24h" />
      <DataTable<DtRow<FleetMetricsAgent>>
        cols={fleetCols}
        rows={fleetAgents as DtRow<FleetMetricsAgent>[]}
        pageSize={8}
        search="agent…"
        onRow={(r) => {
          const run = fleetRuns.find((x) => x.agentId === r.agentId) ?? null
          setSelRun(run)
        }}
        empty={
          fleet.isLoading
            ? 'Loading fleet health…'
            : fleet.isError
              ? 'Fleet health unavailable.'
              : 'No fleet metrics for this window.'
        }
      />
      {metrics.data?.totalAgents != null && (
        <div style={{ color: 'var(--fg-3)', fontSize: 12, marginTop: 6 }}>
          {metrics.data.totalAgents} agents registered · {fmtNum(metrics.data.totalExecutions)}{' '}
          lifetime executions
        </div>
      )}

      {selRun && (
        <SidePanel
          title={selRun.agentName}
          sub={`run ${selRun.id.slice(0, 8)} · ${selRun.status}`}
          onClose={() => setSelRun(null)}
        >
          <div style={{ marginBottom: 8 }}>
            <Pill tone={execTone(selRun.status)} dot>
              {selRun.status}
            </Pill>
          </div>
          <DlRow k="run id" v={<span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{selRun.id}</span>} />
          <DlRow k="agent id" v={<span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{selRun.agentId}</span>} />
          <DlRow k="duration" v={fmtMs(selRun.durationMs)} />
          <DlRow k="cost" v={fmtCents(selRun.costCents)} />
          <DlRow k="started" v={relTime(selRun.startedAt)} />
          {selRun.error && (
            <>
              <Section title="Error" />
              <CodeBlock text={stringify(selRun.error)} />
            </>
          )}
        </SidePanel>
      )}
    </>
  )
}

/* ====================================================================== */
/* agent-skills — agent skills & plugins catalog (read-only)               */
/* ====================================================================== */
function AgentSkillsPage(_: LeafPageProps) {
  const skillsQ = useAdminAgentSkills()
  const skills = skillsQ.data?.skills ?? []
  const [sel, setSel] = React.useState<AdminAgentSkillRow | null>(null)

  const typeOf = (s: AdminAgentSkillRow): string => s.type ?? 'other'
  const types = Array.from(new Set(skills.map(typeOf)))

  const cols: DtColumn<DtRow<AdminAgentSkillRow>>[] = [
    {
      label: 'Skill',
      val: (r) => r.display_name || r.name,
      render: (r) => (
        <span>
          <span className="awc-name">{r.display_name || r.name}</span>
          <div style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>
            {r.name}
          </div>
        </span>
      ),
    },
    { label: 'Type', render: (r) => (r.type ? <Tag>{r.type}</Tag> : <span>—</span>) },
    { label: 'Source', val: (r) => r.source ?? '—' },
    {
      label: 'Tags',
      render: (r) => {
        const tags = r.tags ?? []
        if (!tags.length) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const head = tags.slice(0, 3)
        return (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {head.map((t, i) => (
              <Pill key={i} tone="muted">
                {t}
              </Pill>
            ))}
            {tags.length > 3 && <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>+{tags.length - 3}</span>}
          </span>
        )
      },
    },
    { label: 'Used by', r: true, val: (r) => r.usage_count ?? 0 },
    { label: 'Created', val: (r) => (r.created_at ? relTime(r.created_at) : '—') },
  ]

  const chips = {
    active: 'all',
    opts: [
      { id: 'all', label: 'all', cnt: skills.length },
      ...types.map((t) => ({ id: t, label: t, cnt: skills.filter((s) => typeOf(s) === t).length })),
    ],
    filter: (row: unknown, chip: string) =>
      chip === 'all' ? true : typeOf(row as AdminAgentSkillRow) === chip,
  }

  return (
    <>
      <PageHead
        title="Skills & Plugins"
        sub={
          skillsQ.data
            ? `${skills.length} skills · /admin/agents/skills`
            : 'agent skills & plugins catalog'
        }
        mode="readonly"
      />

      <StateBanner isLoading={skillsQ.isLoading} isError={skillsQ.isError} label="agent skills" />

      <Section title="Catalog" sub="prompt modules · tool bundles · workflows · code templates" />
      <DataTable<DtRow<AdminAgentSkillRow>>
        cols={cols}
        rows={skills as DtRow<AdminAgentSkillRow>[]}
        chips={chips}
        pageSize={10}
        search="search skills · names, descriptions, tags…"
        onRow={(r) => setSel(r)}
        empty={
          skillsQ.isLoading
            ? 'Loading skills…'
            : skillsQ.isError
              ? 'Skills catalog unavailable.'
              : 'No agent skills registered.'
        }
      />

      {sel && (
        <SidePanel
          title={sel.display_name || sel.name}
          sub={`${sel.type ?? 'skill'}${sel.source ? ` · ${sel.source}` : ''}`}
          onClose={() => setSel(null)}
        >
          {sel.description && (
            <div style={{ color: 'var(--fg-2)', fontSize: 13, marginBottom: 10 }}>{sel.description}</div>
          )}
          <DlRow k="id" v={<span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{sel.id}</span>} />
          <DlRow k="name" v={sel.name} />
          <DlRow k="type" v={sel.type ?? '—'} />
          <DlRow k="source" v={sel.source ?? '—'} />
          <DlRow k="source url" v={sel.source_url ?? '—'} />
          <DlRow k="visibility" v={sel.visibility ?? '—'} />
          <DlRow k="used by" v={sel.usage_count ?? '—'} />
          <DlRow k="created" v={sel.created_at ? relTime(sel.created_at) : '—'} />
          {sel.tags?.length ? (
            <>
              <Section title="Tags" />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sel.tags.map((t, i) => (
                  <Tag key={i}>{t}</Tag>
                ))}
              </div>
            </>
          ) : null}
        </SidePanel>
      )}
    </>
  )
}

/* ====================================================================== */
/* agent-executions — execution history table + drill trace (read-only)    */
/* ====================================================================== */
function AgentExecutionsPage(_: LeafPageProps) {
  const exec = useAdminAgentExecutions({ limit: 50 })
  const stats = useAdminAgentExecutionStats()
  const [sel, setSel] = React.useState<AdminAgentExecutionRow | null>(null)

  const rows = exec.data?.executions ?? []
  const s = stats.data

  const norm = (st: string | undefined): string => {
    const x = (st ?? '').toLowerCase()
    if (x === 'success') return 'completed'
    return x || 'unknown'
  }

  const statusCount = (st: string) => rows.filter((r) => norm(r.status) === st).length

  const cols: DtColumn<DtRow<AdminAgentExecutionRow>>[] = [
    {
      label: 'Agent',
      val: (r) => r.agent?.name ?? r.agent?.agent_type ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name">{r.agent?.name ?? r.agent?.agent_type ?? 'agent'}</span>
          <div style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>
            {r.agent?.agent_type ?? '—'} · {r.id.slice(0, 8)}
          </div>
        </span>
      ),
    },
    {
      label: 'User',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
          {r.user_id ? r.user_id.slice(0, 12) : '—'}
        </span>
      ),
    },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={execTone(r.status)} dot>
          {norm(r.status)}
        </Pill>
      ),
    },
    { label: 'Model', val: (r) => r.model_used ?? '—' },
    {
      label: 'Duration',
      r: true,
      sortVal: (r) => r.duration_ms ?? 0,
      render: (r) => fmtMs(r.duration_ms),
    },
    {
      label: 'Tokens',
      r: true,
      sortVal: (r) => r.total_tokens ?? 0,
      render: (r) => fmtNum(r.total_tokens),
    },
    {
      label: 'Cost',
      r: true,
      sortVal: (r) => asUsd(r.estimated_cost) ?? 0,
      render: (r) => fmtUsd(asUsd(r.estimated_cost)),
    },
    { label: 'Started', val: (r) => (r.started_at ? relTime(r.started_at) : '—') },
  ]

  const statuses = ['completed', 'running', 'failed', 'pending', 'cancelled']
  const chips = {
    active: 'all',
    opts: [
      { id: 'all', label: 'all', cnt: rows.length },
      ...statuses.map((st) => ({ id: st, label: st, cnt: statusCount(st) })),
    ],
    filter: (row: unknown, chip: string) =>
      chip === 'all' ? true : norm((row as AdminAgentExecutionRow).status) === chip,
  }

  return (
    <>
      <PageHead
        title="Executions"
        sub={
          exec.data
            ? `${rows.length} shown · /admin/agents/executions (agentRunLog) · limit 50`
            : '/admin/agents/executions (agentRunLog) · limit 50'
        }
        mode="readonly"
      />

      <StateBanner isLoading={exec.isLoading} isError={exec.isError} label="agent executions" />

      {s && (
        <KpiStrip
          kpis={[
            { label: 'Today', val: s.totalToday != null ? fmtNum(s.totalToday) : '—', tone: 'accent' },
            {
              label: 'Failed today',
              val: s.failedToday != null ? fmtNum(s.failedToday) : '—',
              tone: (s.failedToday ?? 0) > 0 ? 'err' : 'ok',
            },
            { label: 'This week', val: s.totalWeek != null ? fmtNum(s.totalWeek) : '—', tone: 'info' },
            {
              label: 'Success rate',
              val: s.successRate != null ? fmtPct(s.successRate) : '—',
              tone: rateTone(s.successRate),
            },
            {
              label: 'Cost (24h)',
              val: s.costTodayCents != null ? fmtCents(s.costTodayCents) : '—',
              tone: 'warn',
            },
          ]}
        />
      )}

      <Section title="Execution log" sub="click a row to drill into the run trace" />
      <DataTable<DtRow<AdminAgentExecutionRow>>
        cols={cols}
        rows={rows as DtRow<AdminAgentExecutionRow>[]}
        chips={chips}
        pageSize={10}
        search="search executions · agent · model · user · id…"
        onRow={(r) => setSel(r)}
        empty={
          exec.isLoading
            ? 'Loading executions…'
            : exec.isError
              ? 'Execution log unavailable.'
              : 'No agent executions recorded.'
        }
      />

      {sel && (
        <SidePanel
          title={sel.agent?.name ?? sel.agent?.agent_type ?? 'Execution'}
          sub={`run ${sel.id.slice(0, 8)} · ${norm(sel.status)}`}
          onClose={() => setSel(null)}
        >
          <div style={{ marginBottom: 8 }}>
            <Pill tone={execTone(sel.status)} dot>
              {norm(sel.status)}
            </Pill>
            {sel.fallback_used && (
              <span style={{ marginLeft: 6 }}>
                <Pill tone="warn">fallback used</Pill>
              </span>
            )}
          </div>
          <DlRow k="run id" v={<span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{sel.id}</span>} />
          <DlRow k="loop id" v={sel.loop_id ?? '—'} />
          <DlRow k="session" v={sel.session_id ?? '—'} />
          <DlRow k="user" v={sel.user_id ?? '—'} />
          <DlRow k="agent type" v={sel.agent?.agent_type ?? '—'} />
          <DlRow k="model" v={sel.model_used ?? '—'} />
          <DlRow k="duration" v={fmtMs(sel.duration_ms)} />
          <DlRow
            k="tokens"
            v={
              sel.total_tokens != null
                ? `${fmtNum(sel.total_tokens)} (${fmtNum(sel.input_tokens)} in · ${fmtNum(sel.output_tokens)} out)`
                : '—'
            }
          />
          <DlRow k="cost" v={fmtUsd(asUsd(sel.estimated_cost))} />
          <DlRow k="started" v={sel.started_at ? relTime(sel.started_at) : '—'} />
          <DlRow k="completed" v={sel.completed_at ? relTime(sel.completed_at) : '—'} />
          {sel.error && (
            <>
              <Section title="Error" />
              <CodeBlock text={stringify(sel.error)} />
            </>
          )}
        </SidePanel>
      )}
    </>
  )
}

/* ---------------- domain export (all 4 leaves) ---------------- */
export const agentsPages: Record<string, React.ComponentType<LeafPageProps>> = {
  'agent-registry': AgentRegistryPage,
  'agent-ops': AgentOpsPage,
  'agent-skills': AgentSkillsPage,
  'agent-executions': AgentExecutionsPage,
}
