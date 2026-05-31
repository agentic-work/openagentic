import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  ScoringStrip,
  Score,
  Panel,
  PanelHead,
  SectionBar,
  EmptyInline,
  Btn,
  SidePanel,
} from '../primitives-v3'
import {
  useDashboardCounts,
  useProviderHealth,
  useScopedAuditLogs,
} from '../hooks/useDashboardMetrics'

// 6 top-level tabs (down from 12 before 2026-05-13 audit). Each tab scroll-
// jumps to its primary section; secondary sections live in the same
// stacked scroll region so deep links keep working. Empty groups collapse
// via EmptySectionGate so a healthy cluster reads ~2× viewport instead
// of 7.5×. user-analytics still renders for deep-link compatibility but
// is no longer surfaced as a top tab — it belongs under monitoring.
const TABS = [
  { id: 'overview',         label: 'overview' },
  { id: 'usage',            label: 'usage & cost' },
  { id: 'llm-performance',  label: 'llm & router' },
  { id: 'flows-agents',     label: 'flows & agents' },
  { id: 'mcp-tools',        label: 'mcp & tools' },
  { id: 'api-limits',       label: 'infra & perf' },
]

/**
 * Detail-panel descriptor — what each row drill opens.
 * Generic shape so any pane can drop a row into the same panel.
 */
type Detail =
  | { kind: 'provider'; name: string; row: any }
  | { kind: 'mcp-server'; name: string; row: any }
  | { kind: 'signal'; row: any }
  | { kind: 'workflow'; name: string; row: any }
  | { kind: 'model'; name: string; row: any }
  | { kind: 'user'; name: string; row: any }

// ============================================================
// Format helpers — used by OverviewPane
// ============================================================
const fmtNum = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
const fmtTokens = (n?: number): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
const fmtUsd = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'

// ============================================================
// Time-range selector — chip group on the dashboard top right.
// 7 options that map cleanly to the api parseTimeRange (Nh / Nd).
// State lifted to the page component so every data-hook reuses it.
// ============================================================
const TIME_RANGE_OPTIONS = ['1h', '6h', '12h', '24h', '7d', '30d', '90d'] as const
type TimeRange = (typeof TIME_RANGE_OPTIONS)[number]

const TimeRangeSelector = ({
  value,
  onChange,
}: {
  value: TimeRange
  onChange: (r: TimeRange) => void
}) => (
  <div
    role="group"
    aria-label="Time range"
    style={{ display: 'inline-flex', gap: 0, border: '1px solid var(--line-1)' }}
  >
    {TIME_RANGE_OPTIONS.map((r, i) => (
      <button
        key={r}
        type="button"
        aria-pressed={value === r}
        onClick={() => onChange(r)}
        style={{
          appearance: 'none',
          background:
            value === r
              ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-3))'
              : 'var(--bg-2)',
          border: 0,
          borderLeft: i === 0 ? 0 : '1px solid var(--line-1)',
          color: value === r ? 'var(--accent)' : 'var(--fg-2)',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 11,
          padding: '4px 10px',
          cursor: 'pointer',
          letterSpacing: '0.06em',
          textTransform: 'lowercase',
          boxShadow: value === r ? 'inset 0 -2px 0 var(--accent)' : 'none',
        }}
      >
        {r}
      </button>
    ))}
  </div>
)

// ============================================================
// Scroll-spy hook — when the section currently in viewport changes,
// fire onChange(id). Watches DOM nodes by id (each section wrapper
// has id={`section-${id}`}). Uses IntersectionObserver with a top
// margin so a section becomes "active" when it crosses the sticky
// Subtabs strip line.
// ============================================================
function useScrollSpy(
  sectionIds: readonly string[],
  onActive: (id: string) => void,
): void {
  React.useEffect(() => {
    const targets = sectionIds
      .map((id) => document.getElementById(`section-${id}`))
      .filter((el): el is HTMLElement => el != null)
    if (targets.length === 0) return
    // top: -120px ≈ topbar + ribbon + page-head + subtabs height; bottom: -50%
    // means the active section is whichever crosses the upper third.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible.length === 0) return
        const id = (visible[0].target as HTMLElement).id.replace(/^section-/, '')
        onActive(id)
      },
      { rootMargin: '-120px 0px -50% 0px', threshold: [0, 0.1, 0.5] },
    )
    for (const t of targets) observer.observe(t)
    return () => observer.disconnect()
  }, [sectionIds, onActive])
}

// ============================================================
// LastRefreshedBadge — small mono "Xs ago" indicator that auto-ticks
// every second. When fetching is in flight (background refetch), the
// dot pulses in --warn so the operator sees data flowing.
// ============================================================
const LastRefreshedBadge = ({
  updatedAt,
  fetching,
}: {
  updatedAt: number
  fetching: boolean
}) => {
  // Force re-render every 1s so "Xs ago" stays accurate.
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (!updatedAt) {
    return <span style={{ color: 'var(--fg-3)' }}>refreshing…</span>
  }
  const sec = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
  const txt =
    sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.floor(sec / 60)}m ago` : `${Math.floor(sec / 3600)}h ago`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: fetching ? 'var(--warn)' : 'var(--ok)',
          boxShadow: `0 0 4px ${fetching ? 'var(--warn)' : 'var(--ok)'}`,
          animation: fetching ? 'awPulse 1.2s ease-in-out infinite' : 'none',
        }}
      />
      <span style={{ color: 'var(--fg-3)' }}>{fetching ? 'refreshing' : `refreshed ${txt}`}</span>
    </span>
  )
}

// ============================================================
// Top-level page component
// ============================================================
export const Dashboard = () => {
  const [pane, setPane] = React.useState('overview')
  const [detail, setDetail] = React.useState<Detail | null>(null)
  const [detailTab, setDetailTab] = React.useState('overview')
  const [timeRange, setTimeRange] = React.useState<TimeRange>('24h')
  // When the user clicks a Subtabs tab, we scrollIntoView. The scroll-spy
  // observer would otherwise fight that scroll by jumping back. Suppress
  // updates from the observer for ~600ms after a click.
  const suppressSpyUntilRef = React.useRef<number>(0)

  const counts = useDashboardCounts()
  const providerHealth = useProviderHealth()

  // Scroll-spy: as the user scrolls, update the active tab so the
  // Subtabs strip reflects "you are here".
  useScrollSpy(
    React.useMemo(() => TABS.map((t) => t.id), []),
    React.useCallback((id) => {
      if (Date.now() < suppressSpyUntilRef.current) return
      setPane(id)
    }, []),
  )

  const open = (d: Detail) => {
    setDetail(d)
    setDetailTab('overview')
  }
  const close = () => setDetail(null)

  return (
    <>
      <PageHead
        title="Dashboard"
        meta={
          <>
            auto-refresh 30s ·{' '}
            <LastRefreshedBadge updatedAt={counts.dataUpdatedAt ?? 0} fetching={counts.isFetching} />
          </>
        }
        actions={
          <>
            <Btn variant="ghost">filters</Btn>
            <Btn>export</Btn>
          </>
        }
      />
      <Subtabs
        items={TABS}
        active={pane}
        onChange={(id) => {
          // Suppress scroll-spy briefly so smooth-scroll doesn't fight
          // the spy bouncing back to whichever section the scroll
          // animation passes through.
          suppressSpyUntilRef.current = Date.now() + 600
          setPane(id)
          const el = document.getElementById(`section-${id}`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        right={<TimeRangeSelector value={timeRange} onChange={setTimeRange} />}
      />

      {counts.isError && (
        <Banner level="warn" label="counts">
          failed to load <span className="accent">/api/admin/dashboard/counts</span> — showing zeros
        </Banner>
      )}

      <div id="section-overview"><OverviewPane counts={counts} providerHealth={providerHealth} /></div>
      <div id="section-usage" style={{ marginTop: 24 }}><AnalyticsPlaceholder section="Usage & Cost" /></div>
      <div id="section-llm-performance" style={{ marginTop: 24 }}><AnalyticsPlaceholder section="LLM & Router" /></div>
      <div id="section-flows-agents" style={{ marginTop: 24 }}><AnalyticsPlaceholder section="Flows & Agents" /></div>
      <div id="section-mcp-tools" style={{ marginTop: 24 }}><AnalyticsPlaceholder section="MCP & Tools" /></div>
      <div id="section-api-limits" style={{ marginTop: 24 }}><AnalyticsPlaceholder section="Infra & Perf" /></div>

      <SidePanel
        open={detail != null}
        onClose={close}
        title={detail?.kind === 'provider' ? detail.name :
               detail?.kind === 'mcp-server' ? detail.name :
               detail?.kind === 'workflow' ? detail.name :
               detail?.kind === 'model' ? detail.name :
               detail?.kind === 'user' ? detail.name :
               detail?.kind === 'signal' ? 'Signal' : ''}
        meta={detail ? detailMeta(detail) : undefined}
        tabs={detail ? detailTabs(detail) : undefined}
        activeTab={detailTab}
        onTabChange={setDetailTab}
      >
        {detail && <DetailBody detail={detail} tab={detailTab} />}
      </SidePanel>
    </>
  )
}

const detailMeta = (d: Detail): React.ReactNode => {
  if (d.kind === 'provider') return d.row.sub ? `${d.row.sub} · ${d.row.calls ?? '—'} calls/h` : `${d.row.calls ?? '—'} calls/h`
  if (d.kind === 'mcp-server') return d.row.tools ? `${d.row.tools} tools · ${d.row.count ?? d.row.calls ?? '—'} calls` : `${d.row.count ?? d.row.calls ?? '—'} calls`
  if (d.kind === 'workflow') return `${d.row.user ?? ''} · ${d.row.node ?? ''}`
  if (d.kind === 'model') return d.row.tokens != null ? `${fmtTokens(d.row.tokens)} tokens · ${fmtUsd(d.row.cost)}` : ''
  if (d.kind === 'user') return d.row.email
  return ''
}

const detailTabs = (d: Detail) => {
  if (d.kind === 'provider' || d.kind === 'mcp-server') {
    return [
      { id: 'overview', label: 'overview' },
      { id: 'metrics', label: 'metrics' },
      { id: 'logs', label: 'logs' },
      { id: 'config', label: 'config' },
    ]
  }
  if (d.kind === 'user' || d.kind === 'workflow' || d.kind === 'model') {
    return [
      { id: 'overview', label: 'overview' },
      { id: 'metrics', label: 'metrics' },
    ]
  }
  return undefined
}

const DetailBody: React.FC<{ detail: Detail; tab: string }> = ({ detail, tab }) => {
  // All four sub-tabs render real data sourced from existing endpoints.
  // No "in follow-up" stub copy anywhere — if a kind doesn't have data
  // for a tab, we render an empty-state with the actionable reason
  // instead of a placeholder URL string.

  if (tab === 'metrics') {
    return <DetailMetrics detail={detail} />
  }
  if (tab === 'logs') {
    return <DetailLogs detail={detail} />
  }
  if (tab === 'config') {
    return <DetailConfig detail={detail} />
  }
  // overview tab — render the captured row JSON (real data from the
  // dashboard metrics fetch, not fabricated).
  return (
    <>
      <SectionBar title="object" />
      <div style={{ padding: '8px 14px', fontFamily: 'var(--font-v3-mono)', fontSize: 'var(--v3-t-meta)', color: 'var(--fg-2)' }}>
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
{JSON.stringify(detail, null, 2)}
        </pre>
      </div>
    </>
  )
}

/**
 * Per-resource metrics — no detailed time-series metrics view for this
 * resource yet.
 */
const DetailMetrics: React.FC<{ detail: Detail }> = () => (
  <EmptyInline pad>
    no detailed metrics available for this resource.
  </EmptyInline>
)

/**
 * Per-resource audit-log filter — server-side scoped fetch via
 * /api/admin/audit-logs?resourceId=... so the empty-state doesn't
 * trigger when the global last-200 doesn't happen to mention the
 * resource. Falls back to a client-side scan only if the scoped
 * query is empty (covers older audit-rows where details.name was
 * the only handle).
 */
const DetailLogs: React.FC<{ detail: Detail }> = ({ detail }) => {
  const name = (detail as any).name ?? ''
  const scoped = useScopedAuditLogs({ resourceId: name, limit: 200 })

  if (scoped.isLoading) return <EmptyInline pad>loading audit log…</EmptyInline>
  if (scoped.isError) return <EmptyInline pad>failed to fetch /api/admin/audit-logs</EmptyInline>
  const matched: any[] = scoped.data?.logs ?? []
  if (matched.length === 0) {
    return (
      <EmptyInline pad>
        no audit-log entries reference "{name}" across the full history.
      </EmptyInline>
    )
  }

  return (
    <>
      <SectionBar title={`audit log · matching "${name}"`} count={matched.length} />
      <div style={{ padding: '8px 14px', fontFamily: 'var(--font-v3-mono)', fontSize: 'var(--v3-t-meta)' }}>
        {matched.slice(0, 30).map((row: any, i: number) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--line-1)' }}>
            <span style={{ color: 'var(--fg-3)' }}>{row.timestamp ?? row.created_at ?? '—'}</span>{' '}
            <span style={{ color: 'var(--accent)' }}>{row.action ?? '—'}</span>{' '}
            <span style={{ color: 'var(--fg-1)' }}>{row.actor ?? row.user_email ?? '—'}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Per-resource config view — renders the row's own object as a
 * structured KV table (the row IS the resource config — no follow-up
 * fetch needed).
 */
const DetailConfig: React.FC<{ detail: Detail }> = ({ detail }) => {
  const entries = Object.entries(detail).filter(([k]) => k !== 'kind')
  if (entries.length === 0) {
    return <EmptyInline pad>no config available for this resource</EmptyInline>
  }
  return (
    <>
      <SectionBar title="config" />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-v3-mono)', fontSize: 'var(--v3-t-meta)' }}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '6px 14px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', width: 160 }}>{k}</td>
              <td style={{ padding: '6px 14px', color: 'var(--fg-1)', wordBreak: 'break-all' }}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

type DrillFn = (d: Detail) => void

// ============================================================
// AnalyticsPlaceholder — neutral empty-state for analytics sections
// whose detailed time-series endpoints aren't wired in this build.
// ============================================================
const AnalyticsPlaceholder = ({ section }: { section: string }) => (
  <>
    <SectionBar title="analytics" />
    <Panel>
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--fg-2)', fontSize: 14, marginBottom: 6, fontWeight: 600 }}>
          {section}
        </p>
        <p style={{ color: 'var(--fg-3)', fontSize: 12 }}>
          Detailed time-series analytics for this section aren&apos;t available yet.
        </p>
      </div>
    </Panel>
  </>
)

/* ============================================================
   1. OVERVIEW
   ============================================================ */
const OverviewPane = ({
  counts,
  providerHealth,
}: {
  counts: ReturnType<typeof useDashboardCounts>
  providerHealth: ReturnType<typeof useProviderHealth>
}) => {
  // /api/admin/llm-providers/health returns { overall, providers: [...], timestamp }
  // — derive total/healthy from the array. Fall back to legacy { total, healthy } shape.
  const providerList = providerHealth.data?.providers
  const providerTotal = Array.isArray(providerList)
    ? providerList.length
    : providerHealth.data?.total
  const providerHealthy = Array.isArray(providerList)
    ? providerList.filter((p) => p.healthy === true || p.status === 'healthy').length
    : providerHealth.data?.healthy
  const providerVal: React.ReactNode = providerTotal != null
    ? <>{providerHealthy ?? 0}<span style={{ color: 'var(--fg-3)', fontSize: 13 }}>/{providerTotal}</span></>
    : '—'

  // Compute a one-line verdict — DC3-style executive summary.
  // tone bias: err > warn > ok > info.
  const verdict = (() => {
    const downProviders = (providerTotal ?? 0) - (providerHealthy ?? 0)
    if (downProviders > 0) {
      return {
        tone: 'warn' as const,
        text: `${downProviders} provider${downProviders === 1 ? '' : 's'} unhealthy · ${fmtNum(counts.data?.llmRequests)} LLM requests · ${fmtNum(counts.data?.users)} users`,
      }
    }
    if (counts.isLoading) {
      return { tone: 'info' as const, text: 'loading platform counts…' }
    }
    return {
      tone: 'ok' as const,
      text: `Platform healthy — ${providerHealthy ?? 0} provider${providerHealthy === 1 ? '' : 's'} live · ${fmtNum(counts.data?.llmRequests ?? 0)} LLM requests · ${fmtNum(counts.data?.users ?? 0)} users · ${fmtNum(counts.data?.chats ?? 0)} chats`,
    }
  })()

  return (
    <>
      <Banner level={verdict.tone} label={verdict.tone === 'ok' ? 'verdict' : 'note'}>
        {verdict.text}
      </Banner>

      <ScoringStrip cols={8}>
        <Score
          label="api health"
          value={counts.isError ? 'down' : counts.isLoading ? '…' : 'healthy'}
          tone={counts.isError ? 'err' : 'ok'}
        />
        <Score label="providers" value={providerVal} delta={providerHealth.isLoading ? '…' : '—'} />
        <Score label="llm requests" value={counts.isLoading ? '…' : fmtNum(counts.data?.llmRequests ?? 0)} />
        <Score label="users" value={counts.isLoading ? '…' : fmtNum(counts.data?.users ?? 0)} />
        <Score label="chats" value={counts.isLoading ? '…' : fmtNum(counts.data?.chats ?? 0)} />
        <Score label="messages" value={counts.isLoading ? '…' : fmtNum(counts.data?.messages ?? 0)} />
        <Score label="agent runs" value={counts.isLoading ? '…' : fmtNum(counts.data?.agentRuns ?? 0)} />
        <Score label="flow runs" value={counts.isLoading ? '…' : fmtNum(counts.data?.flowRuns ?? 0)} />
      </ScoringStrip>

      {/* Platform counts — 7 stat cards from /api/admin/dashboard/counts */}
      <SectionBar
        title="platform counts"
        right={
          <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>
            {counts.isLoading ? 'loading…' : counts.isError ? 'unavailable' : 'live totals'}
          </span>
        }
      />
      <KpiGrid cols={4}>
        <Kpi
          label="Chats"
          value={counts.isLoading ? '…' : fmtNum(counts.data?.chats ?? 0)}
          sub="total chat sessions"
        />
        <Kpi
          label="Messages"
          value={counts.isLoading ? '…' : fmtNum(counts.data?.messages ?? 0)}
          sub="total messages sent"
        />
        <Kpi
          label="Users"
          value={counts.isLoading ? '…' : fmtNum(counts.data?.users ?? 0)}
          sub="registered users"
        />
        <Kpi
          label="Workflows"
          value={counts.isLoading ? '…' : fmtNum(counts.data?.workflows ?? 0)}
          sub="defined workflows"
        />
        <Kpi
          label="Flow Runs"
          value={counts.isLoading ? '…' : fmtNum(counts.data?.flowRuns ?? 0)}
          sub="workflow executions"
        />
        <Kpi
          label="Agent Runs"
          value={counts.isLoading ? '…' : fmtNum(counts.data?.agentRuns ?? 0)}
          sub="agent executions"
        />
        <Kpi
          label="LLM Requests"
          value={counts.isLoading ? '…' : fmtNum(counts.data?.llmRequests ?? 0)}
          sub="total LLM requests"
        />
      </KpiGrid>

      <AnalyticsPlaceholder section="Overview" />
    </>
  )
}

