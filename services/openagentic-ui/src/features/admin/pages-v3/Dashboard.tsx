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
  Grid,
  Dt,
  type DtCol,
  BarList,
  type BarItem,
  Feed,
  FeedRow,
  EmptyInline,
  SectionBar,
  MetricChart,
  type ChartSeries,
  Btn,
  SidePanel,
} from '../primitives-v3'
import {
  useDashboardMetrics,
  useMcpHealth,
  useProviderHealth,
  useLlmProviders,
  useMcpServers,
  useAuditLogs,
  useScopedAuditLogs,
  useMcpLogs,
  useRouterDecisions,
  useLlmRegistry,
  useRouterTuning,
  useFlowsRecentFailures,
  useTopEndpoints,
  useStatusCodes,
  useAuthMethods,
  usePerfPercentiles,
  usePerfThroughput,
  useClusterHealth,
  useStorage,
  useApiThrottles,
  useRouterEscalationTriggers,
  useMcpLogsHistogram,
  usePromHealth,
  useOpenagenticApiKeys,
  type DashboardMetricsState,
  type TimeSeriesPoint,
  type ModelUsageRow,
  type McpToolUsageRow,
  type PerUserUsageRow,
  type AuditLogEntry,
  type McpLogEntry,
  type LlmProviderRow,
  type McpServerRow,
  type RouterDecisionEntry,
  type FlowFailureRow,
  type TopEndpointRow,
  type PerfPercentileRow,
  type OpenagenticApiKeyRow,
} from '../hooks/useDashboardMetrics'
import { usePromInstant, type PromSample } from '../hooks/useProm'
import { useAdminQuery } from '../hooks/useAdminQuery'
import type { UseQueryResult } from '@tanstack/react-query'
import LLMPerformancePane from './llm-performance/LLMPerformancePane'
import { TrafficFlowExpand } from './TrafficFlowExpand'
import { ExtendedThinkingSection } from './ExtendedThinkingSection'
import { Sankey as AwSankey, type SankeyData as AwSankeyData } from '../../../lib/charts/components/Sankey'
import { ClusterTopo as AwClusterTopo, type ClusterTopoData as AwClusterTopoData } from '../../../lib/charts/components/ClusterTopo'
import { Donut as AwDonut, type DonutData as AwDonutData } from '../../../lib/charts/components/Donut'
import { ExpandableChart } from '../../../lib/charts/ExpandableChart'

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
// Format helpers — consistent across panes
// ============================================================
const fmtTokens = (n?: number): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
const fmtUsd = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'
const fmtPct = (n?: number, digits = 1): string =>
  typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—'
const fmtMs = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? `${Math.round(n)}ms` : '—'
const fmtPer1k = (cost?: number, tokens?: number): string => {
  if (!tokens || !cost || !Number.isFinite(tokens) || !Number.isFinite(cost)) return '—'
  if (tokens === 0) return '—'
  return `$${((cost / tokens) * 1000).toFixed(4)}`
}
const fmtNum = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
const formatHourLabel = (ts: number | string): string => {
  // API timeSeries[].timestamp arrives as ISO strings ("2026-05-13T17:00:00.000Z");
  // legacy call sites may pass epoch ms. Coerce both into a Date safely — pre-fix
  // string inputs failed Number.isFinite and silently returned '', which collapsed
  // every chart point onto the same x-coordinate (Sev-1, 2026-05-14).
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}
const tsToValues = (series?: TimeSeriesPoint[]): number[] =>
  Array.isArray(series) ? series.map((p) => Number(p.value) || 0) : []
const tsToLabels = (series?: TimeSeriesPoint[]): string[] =>
  Array.isArray(series) ? series.map((p) => formatHourLabel(p.timestamp)) : []
const calcPerMin = (totalCalls?: number, periodStart?: string, periodEnd?: string): string => {
  if (typeof totalCalls !== 'number' || !periodStart || !periodEnd) return '—'
  const ms = new Date(periodEnd).getTime() - new Date(periodStart).getTime()
  const minutes = ms / 60000
  if (minutes <= 0) return '—'
  return Math.round(totalCalls / minutes).toLocaleString()
}

// Loading-aware KPI value: if the query is still in flight, show '…'
// rather than the unwrapped placeholder. Prevents the "0/0%" flash.
const loadingValue = (isLoading: boolean, formatted: string): string =>
  isLoading ? '…' : formatted

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
// DashboardDonut — token-themed donut + auto-legend.
// Cutover 2026-05-13: now delegates to <AwDonut>. The hand-rolled
// DONUT_COLORS palette is gone — <AwDonut> picks from theme tokens
// (--accent / --ok / --warn / --info / --err / --cap-*) automatically.
// ============================================================

interface DonutDatum {
  name: string
  value: number
}

const DashboardDonut = ({
  data,
  height = 180,
  unitLabel = '',
}: {
  data: DonutDatum[]
  height?: number
  unitLabel?: string
}) => {
  if (data.length === 0) return null
  // Cutover 2026-05-13: ripped recharts PieChart in favor of <AwDonut>.
  // <AwDonut> already lays out donut + side legend together with
  // click-to-isolate behavior, so the previous custom dual-column flex
  // layout collapses into the component itself.
  const donutData: AwDonutData = {
    centerSubtitle: unitLabel,
    slices: data.map((d) => ({ name: d.name, value: d.value })),
  }
  return <AwDonut data={donutData} height={height} disableFrame />
}

// ============================================================
// TrafficFlowSankey — 2-layer Sankey: provider → model.
//
// Cutover 2026-05-13: ripped the recharts implementation in favor of the
// shared <AwSankey> component (src/lib/charts/components/Sankey.tsx) built
// on d3-sankey + theme tokens + useChartFrame (zoom/pan/right-click menu).
// Same data prep below — only the renderer changed.
// ============================================================

const TrafficFlowSankey = ({
  llmProviders,
  modelUsage,
  height = 320,
}: {
  llmProviders: ReturnType<typeof useLlmProviders>
  modelUsage: ModelUsageRow[]
  height?: number
}) => {
  const data = React.useMemo<AwSankeyData>(() => {
    const providers = llmProviders.data?.providers ?? []
    if (providers.length === 0 || modelUsage.length === 0) {
      return { nodes: [], links: [] }
    }
    // Build model→provider map from registry
    const modelToProvider = new Map<string, string>()
    for (const p of providers) {
      const pname = p.displayName ?? p.name
      for (const m of p.models ?? []) {
        const mname = (m as any)?.name ?? (typeof m === 'string' ? m : '')
        if (mname) modelToProvider.set(mname, pname)
      }
    }
    // Resolve a usage row's model name to a provider — same fallback chain
    // as the legacy recharts impl: exact, row.provider field, prefix match,
    // "Other models" bucket. Never invent a provider name.
    const registryModels = [...modelToProvider.keys()].sort(
      (a, b) => b.length - a.length,
    )
    const resolveProvider = (u: ModelUsageRow): string => {
      const exact = modelToProvider.get(u.model)
      if (exact) return exact
      const rowProvider = (u as { provider?: string }).provider
      if (rowProvider) return rowProvider
      for (const reg of registryModels) {
        if (u.model.startsWith(reg) || reg.startsWith(u.model)) {
          const mapped = modelToProvider.get(reg)
          if (mapped) return mapped
        }
      }
      return 'Other models'
    }
    // Aggregate per-provider + per-model
    const providerTotals = new Map<string, number>()
    const modelTotals = new Map<string, { provider: string; value: number }>()
    for (const u of modelUsage) {
      const provider = resolveProvider(u)
      const value = u.tokens > 0 ? u.tokens : u.count
      if (value <= 0) continue
      providerTotals.set(provider, (providerTotals.get(provider) ?? 0) + value)
      const prev = modelTotals.get(u.model) ?? { provider, value: 0 }
      modelTotals.set(u.model, { provider, value: prev.value + value })
    }
    if (providerTotals.size === 0) {
      return { nodes: [], links: [] }
    }
    const providerNames = [...providerTotals.keys()].sort(
      (a, b) => (providerTotals.get(b) ?? 0) - (providerTotals.get(a) ?? 0),
    )
    const modelNames = [...modelTotals.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 12) // cap at 12 models
      .map(([name]) => name)
    return {
      nodes: [
        ...providerNames.map((n) => ({ id: n, label: n, kind: 'source' as const })),
        ...modelNames.map((n) => ({ id: n, label: n, kind: 'sink' as const })),
      ],
      links: modelNames.flatMap((m) => {
        const info = modelTotals.get(m)
        if (!info) return []
        return [{ source: info.provider, target: m, value: info.value, sourceId: info.provider }]
      }),
    }
  }, [llmProviders.data, modelUsage])

  if (data.nodes.length === 0 || data.links.length === 0) {
    return (
      <EmptyInline pad>
        no provider/model traffic in window — fire a chat or agent run to see traffic flow
      </EmptyInline>
    )
  }

  // <AwSankey> uses its own internal layout height; outer height prop matches
  // the legacy block's allocated space. The chart re-flows to container width.
  // Wrapped in <ExpandableChart> so double-click opens a fullscreen modal
  // with the same Sankey at large dimensions + wheel-zoom enabled.
  return (
    <div style={{ width: '100%', height }}>
      <ExpandableChart
        title="Provider → Model Flow"
        subtitle={`${data.nodes.length} nodes · ${data.links.length} flows`}
        inlineHeight={height}
        expandedHeight={720}
        renderChart={({ wheelZoom, height: h, onExpand }) => (
          <AwSankey
            data={data}
            title="provider-model-flow"
            height={h}
            wheelZoom={wheelZoom}
            onExpand={onExpand}
          />
        )}
      />
    </div>
  )
}

// ============================================================
// ServiceTopologySvg — live cluster service topology rendered as
// inline SVG. Tier-based layout: column = category, row = service
// within category. Status colors come from --ok/--warn/--err/--fg-3
// tokens; edges are bezier curves between source and target.
//
// Hover on a node highlights the node + dims unrelated edges, and
// emits a tip with image/replicas. Hits /api/cluster/services every
// 30s for live state. Falls back to EmptyInline when the cluster
// endpoint isn't reachable (running outside k8s in dev).
// ============================================================
type ClusterCategory = 'core' | 'data' | 'mcp' | 'agent' | 'codemode' | 'auxiliary'

interface ClusterServiceRow {
  name: string
  displayName: string
  status: 'available' | 'progressing' | 'unavailable' | 'unknown'
  category: ClusterCategory
  edges: string[]
  replicas: { desired: number; ready: number; available: number }
  tag?: string
  image?: string
}

interface ClusterResponse {
  services: ClusterServiceRow[]
  namespace?: string
}

const CATEGORY_ORDER: ClusterCategory[] = ['core', 'data', 'mcp', 'agent', 'codemode', 'auxiliary']
const CATEGORY_LABEL: Record<ClusterCategory, string> = {
  core: 'core',
  data: 'data',
  mcp: 'mcp',
  agent: 'agent',
  codemode: 'codemode',
  auxiliary: 'aux',
}
const STATUS_COLOR_VAR: Record<ClusterServiceRow['status'], string> = {
  available: 'var(--ok)',
  progressing: 'var(--warn)',
  unavailable: 'var(--err)',
  unknown: 'var(--fg-3)',
}

// Cutover 2026-05-14: switched from force-directed <AwNetwork> to the new
// drillable <AwClusterTopo>. Force layout lost the strict tier-by-category
// information that the legacy inline-SVG topology conveyed; ClusterTopo
// restores tier columns + adds click-to-drilldown, click-tier-to-filter,
// status-tinted side panel — all on the shared chart-frame chrome.
const ServiceTopologySvg = ({ height = 360 }: { height?: number }) => {
  const q = useAdminQuery<ClusterResponse>(
    ['cluster', 'services'],
    '/api/cluster/services',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
  const topo = React.useMemo<AwClusterTopoData | null>(() => {
    const services = q.data?.services ?? []
    if (services.length === 0) return null
    // Map cluster status → ClusterTopo's ok/warn/err/unknown
    const statusOf = (s: ClusterServiceRow['status']): 'ok' | 'warn' | 'err' | 'unknown' => {
      if (s === 'available') return 'ok'
      if (s === 'progressing') return 'warn'
      if (s === 'unavailable') return 'err'
      return 'unknown'
    }
    return {
      tiers: CATEGORY_ORDER,
      tierLabels: CATEGORY_LABEL,
      nodes: services.map((s) => ({
        id: s.name,
        label: s.displayName ?? s.name,
        tier: CATEGORY_ORDER.includes(s.category) ? s.category : 'auxiliary',
        status: statusOf(s.status),
        tag: s.tag,
        replicas: s.replicas
          ? { ready: s.replicas.ready, desired: s.replicas.desired }
          : undefined,
        sub: s.image,
      })),
      links: services.flatMap((s) =>
        (s.edges ?? [])
          .filter((t) => services.some((x) => x.name === t))
          .map((t) => ({ source: s.name, target: t })),
      ),
    }
  }, [q.data])

  if (q.isLoading && !topo) return <EmptyInline pad>loading service topology…</EmptyInline>
  if (q.isError) return (
    <EmptyInline pad>
      /api/cluster/services unreachable — running outside k8s? topology view requires cluster api access
    </EmptyInline>
  )
  if (!topo) return <EmptyInline pad>no services found in cluster</EmptyInline>

  // Wrapped in <ExpandableChart> — double-click opens fullscreen modal
  // with the same topology at full size + wheel-zoom enabled.
  return (
    <ExpandableChart
      title="Cluster Topology"
      subtitle={`${topo.nodes.length} services · ${topo.links.length} dependencies`}
      inlineHeight={height}
      expandedHeight={780}
      renderChart={({ wheelZoom, height: h, onExpand }) => (
        <AwClusterTopo
          data={topo}
          title="cluster-topology"
          height={h}
          wheelZoom={wheelZoom}
          onExpand={onExpand}
        />
      )}
    />
  )
}

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

  const metrics = useDashboardMetrics(timeRange)
  const mcpHealth = useMcpHealth()
  const providerHealth = useProviderHealth()
  const llmProviders = useLlmProviders()
  const mcpServers = useMcpServers()
  const auditLogs = useAuditLogs(10)
  const mcpLogs = useMcpLogs(20)

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
            window <span className="accent">{timeRange}</span> · auto-refresh 30s ·{' '}
            <LastRefreshedBadge updatedAt={metrics.dataUpdatedAt} fetching={metrics.isFetching} />
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

      {metrics.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/dashboard/metrics</span> — values below may be stale
        </Banner>
      )}

      <div id="section-overview"><OverviewPane metrics={metrics} mcpHealth={mcpHealth} providerHealth={providerHealth} llmProviders={llmProviders} mcpServers={mcpServers} auditLogs={auditLogs} mcpLogs={mcpLogs} onDrill={open} timeRange={timeRange} /></div>
      <div id="section-llm-performance" style={{ marginTop: 24 }}><LLMPerformancePane timeRange={timeRange} /></div>
      <div id="section-usage" style={{ marginTop: 24 }}><UsagePane metrics={metrics} onDrill={open} /></div>
      <div id="section-cost" style={{ marginTop: 24 }}><CostPane metrics={metrics} onDrill={open} /></div>
      <div id="section-flows-agents" style={{ marginTop: 24 }}><FlowsAgentsPane metrics={metrics} onDrill={open} /></div>
      <div id="section-mcp-tools" style={{ marginTop: 24 }}><McpToolsPane metrics={metrics} mcpHealth={mcpHealth} onDrill={open} /></div>
      <div id="section-api-limits" style={{ marginTop: 24 }}><ApiLimitsPane metrics={metrics} /></div>
      <div id="section-infra" style={{ marginTop: 24 }}><InfraPane /></div>
      <div id="section-performance" style={{ marginTop: 24 }}><PerformancePane metrics={metrics} /></div>
      <div id="section-openagentic" style={{ marginTop: 24 }}><OpenagenticPane metrics={metrics} /></div>
      <div id="section-user-analytics" style={{ marginTop: 24 }}><UserAnalyticsPane metrics={metrics} onDrill={open} /></div>
      <div id="section-router-health" style={{ marginTop: 24 }}><RouterHealthPane /></div>

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
 * Per-resource metrics — pulls from the existing dashboard /metrics
 * fetch (no new endpoint needed; the data is already in memory).
 */
const DetailMetrics: React.FC<{ detail: Detail }> = ({ detail }) => {
  const dashboardMetrics = useDashboardMetrics('24h')
  const data = dashboardMetrics.data
  let rows: Array<[string, React.ReactNode]> = []

  if (detail.kind === 'provider') {
    // Match the row's name against modelUsage rows where provider matches.
    const usage = (data?.modelUsage ?? []).filter(
      (m) => (m.providerName ?? m.provider ?? '').toLowerCase() === (detail.name ?? '').toLowerCase(),
    )
    const totalReqs = usage.reduce((s, m) => s + (m.requestCount ?? 0), 0)
    const totalCost = usage.reduce((s, m) => s + (m.costUsd ?? 0), 0)
    const totalTokens = usage.reduce((s, m) => s + (m.totalTokens ?? 0), 0)
    rows = [
      ['models registered', usage.length],
      ['requests (24h)', totalReqs.toLocaleString()],
      ['cost (24h)', `$${totalCost.toFixed(2)}`],
      ['tokens (24h)', totalTokens.toLocaleString()],
    ]
  } else if (detail.kind === 'model') {
    const m = (data?.modelUsage ?? []).find(
      (r) => (r.model ?? '').toLowerCase() === (detail.name ?? '').toLowerCase(),
    )
    if (m) {
      rows = [
        ['provider', m.providerName ?? m.provider ?? '—'],
        ['requests (24h)', (m.requestCount ?? 0).toLocaleString()],
        ['cost (24h)', `$${(m.costUsd ?? 0).toFixed(2)}`],
        ['input tokens', (m.inputTokens ?? 0).toLocaleString()],
        ['output tokens', (m.outputTokens ?? 0).toLocaleString()],
      ]
    }
  } else if (detail.kind === 'mcp-server') {
    const tool = (data?.mcpToolUsage ?? []).find(
      (t) => (t.serverName ?? '').toLowerCase() === (detail.name ?? '').toLowerCase(),
    )
    if (tool) {
      rows = [
        ['calls (24h)', (tool.callCount ?? 0).toLocaleString()],
        ['errors', (tool.errorCount ?? 0).toLocaleString()],
        ['avg latency', `${tool.avgLatencyMs ?? '—'}ms`],
      ]
    }
  } else if (detail.kind === 'user') {
    const u = (data?.perUserUsage ?? []).find(
      (r) => (r.email ?? r.userId ?? '').toLowerCase() === (detail.name ?? '').toLowerCase(),
    )
    if (u) {
      rows = [
        ['requests (24h)', (u.requestCount ?? 0).toLocaleString()],
        ['cost (24h)', `$${(u.costUsd ?? 0).toFixed(2)}`],
        ['models used', (u.modelCount ?? 0).toLocaleString()],
      ]
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyInline pad>
        no metrics for {detail.kind} "{(detail as any).name ?? '—'}" in the last 24h window
      </EmptyInline>
    )
  }

  return (
    <>
      <SectionBar title="metrics · 24h" />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-v3-mono)', fontSize: 'var(--v3-t-meta)' }}>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i}>
              <td style={{ padding: '6px 14px', color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', width: 160 }}>{k}</td>
              <td style={{ padding: '6px 14px', color: 'var(--fg-1)' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

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

interface PaneProps {
  metrics: DashboardMetricsState
  onDrill?: DrillFn
}

/* ============================================================
   1. OVERVIEW
   ============================================================ */
const OverviewPane = ({
  metrics,
  mcpHealth,
  providerHealth,
  llmProviders,
  mcpServers,
  auditLogs,
  mcpLogs,
  onDrill,
  timeRange,
}: {
  metrics: DashboardMetricsState
  mcpHealth: ReturnType<typeof useMcpHealth>
  providerHealth: ReturnType<typeof useProviderHealth>
  llmProviders: ReturnType<typeof useLlmProviders>
  mcpServers: ReturnType<typeof useMcpServers>
  auditLogs: ReturnType<typeof useAuditLogs>
  mcpLogs: ReturnType<typeof useMcpLogs>
  onDrill: DrillFn
  timeRange: string
}) => {
  const summary = metrics.data?.summary
  const period = metrics.data?.period
  const costSeries = metrics.data?.costByModel
  const apiSeries = metrics.data?.timeSeries?.apiRequests
  const wfSeries = metrics.data?.timeSeries?.workflowExecutions
  const agentSeries = metrics.data?.timeSeries?.agentExecutions
  const tokenSeries = metrics.data?.timeSeries?.tokenUsage
  const codeTokenSeries = metrics.data?.timeSeries?.codeTokenUsage
  const sessionsSeries = metrics.data?.timeSeries?.sessions
  const messagesSeries = metrics.data?.timeSeries?.messages
  const mcpToolUsage = metrics.data?.mcpToolUsage ?? []
  const agentByName = metrics.data?.agentMetrics?.byAgent ?? []
  const [tfExpanded, setTfExpanded] = React.useState(false)

  // #929 — primary-metrics-over-time series. Three independent fetches per
  // metric (tokens-by-model line, TTFT-by-model line, top-tools donut). Lives
  // under the existing "01 · primary metrics over time" SectionBar.
  type TsBucket = { t: string; byModel: Record<string, number> }
  type TsResp = {
    success: boolean
    metric: 'tokens' | 'ttft' | 'tools'
    window: string
    bucket: string
    buckets: TsBucket[]
    topTools?: Array<{ tool: string; count: number }>
  }
  const tokensTs = useAdminQuery<TsResp>(
    ['analytics-timeseries', 'tokens', timeRange],
    `/admin/analytics/system/timeseries?metric=tokens&window=${timeRange}&bucket=1d`,
    { staleTime: 60_000 },
  )
  const ttftTs = useAdminQuery<TsResp>(
    ['analytics-timeseries', 'ttft', timeRange],
    `/admin/analytics/system/timeseries?metric=ttft&window=${timeRange}&bucket=1d`,
    { staleTime: 60_000 },
  )
  const toolsTs = useAdminQuery<TsResp>(
    ['analytics-timeseries', 'tools', timeRange],
    `/admin/analytics/system/timeseries?metric=tools&window=${timeRange}&bucket=1d`,
    { staleTime: 60_000 },
  )

  // Pivot `buckets: [{ t, byModel: {model: v} }]` into MetricChart series.
  // Picks top-5 models by total over the window so the legend stays readable.
  const projectByModelSeries = React.useCallback((resp: TsResp | undefined) => {
    const buckets = resp?.buckets ?? []
    if (buckets.length === 0) return { xLabels: [] as string[], series: [] as ChartSeries[] }
    const totals = new Map<string, number>()
    for (const b of buckets) {
      for (const [m, v] of Object.entries(b.byModel ?? {})) {
        totals.set(m, (totals.get(m) ?? 0) + (typeof v === 'number' ? v : 0))
      }
    }
    const topModels = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m]) => m)
    const xLabels = buckets.map((b) => b.t)
    const series: ChartSeries[] = topModels.map((m, i) => ({
      name: m,
      data: buckets.map((b) => Number(b.byModel?.[m] ?? 0)),
      color: PALETTE[i % PALETTE.length],
    }))
    return { xLabels, series }
  }, [])

  const tokensByModel = React.useMemo(() => projectByModelSeries(tokensTs.data), [tokensTs.data, projectByModelSeries])
  const ttftByModel = React.useMemo(() => projectByModelSeries(ttftTs.data), [ttftTs.data, projectByModelSeries])
  const toolsDonutData = React.useMemo(() => {
    const top = (toolsTs.data?.topTools ?? []).slice(0, 12)
    return top.map((t, i) => ({ name: t.tool, value: t.count, color: PALETTE[i % PALETTE.length] }))
  }, [toolsTs.data])

  const reqsPerMin = calcPerMin(summary?.totalApiRequests, period?.start, period?.end)
  const callsPerMin = calcPerMin(summary?.totalMcpCalls, period?.start, period?.end)

  // MCP donut: prefers tool-call counts in the window (live activity),
  // falls back to toolCount (presence). Each registered server appears
  // with the max of (calls-in-window, toolCount), or 1 as a presence
  // floor so a freshly-connected server still shows in the donut
  // instead of vanishing. Distinguish "no servers registered" from
  // "servers registered but quiet" in the empty-state copy.
  const mcpServerList: McpServerRow[] = React.useMemo(() => {
    return Array.isArray(mcpServers.data)
      ? mcpServers.data
      : mcpServers.data?.servers ?? []
  }, [mcpServers.data])

  const callsByServerPrefix = React.useMemo(() => {
    const agg = new Map<string, number>()
    for (const t of mcpToolUsage) {
      const tool = String(t.tool ?? '')
      const prefix = tool.includes(':')
        ? tool.split(':')[0]
        : tool.includes('.')
          ? tool.split('.')[0]
          : tool.includes('__')
            ? tool.split('__')[0]
            : '(unprefixed)'
      agg.set(prefix, (agg.get(prefix) ?? 0) + (t.count ?? 0))
    }
    return agg
  }, [mcpToolUsage])

  const { mcpDonutData, mcpDonutMode } = React.useMemo<{
    mcpDonutData: DonutDatum[]
    mcpDonutMode: 'calls' | 'tools' | 'servers'
  }>(() => {
    if (mcpServerList.length > 0) {
      const matchKeys = (s: McpServerRow): string[] => {
        const candidates = [s.name, (s as any).displayName, (s as any).id]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
        return candidates.flatMap((c) => [c, c.replace(/^awp[_-]?/i, '')])
      }
      const rows = mcpServerList.map((s) => {
        const toolCount =
          typeof (s as any).toolCount === 'number'
            ? (s as any).toolCount
            : Array.isArray((s as any).tools)
              ? (s as any).tools.length
              : 0
        let calls = 0
        for (const k of matchKeys(s)) {
          calls = Math.max(calls, callsByServerPrefix.get(k) ?? 0)
        }
        return {
          name: String((s as any).displayName ?? s.name ?? '—'),
          toolCount,
          calls,
        }
      })
      const anyCalls = rows.some((r) => r.calls > 0)
      const anyTools = rows.some((r) => r.toolCount > 0)
      const mode: 'calls' | 'tools' | 'servers' = anyCalls
        ? 'calls'
        : anyTools
          ? 'tools'
          : 'servers'
      const valueOf = (r: { calls: number; toolCount: number }) =>
        mode === 'calls' ? Math.max(r.calls, 1) : mode === 'tools' ? Math.max(r.toolCount, 1) : 1
      const activityOf = (r: { calls: number; toolCount: number }) =>
        mode === 'calls' ? r.calls : mode === 'tools' ? r.toolCount : 0
      const data = rows
        .map((r) => ({ name: r.name, value: valueOf(r), _activity: activityOf(r) }))
        .sort((a, b) => b._activity - a._activity || b.value - a.value)
        .slice(0, 8)
        .map(({ name, value }) => ({ name, value }))
      return { mcpDonutData: data, mcpDonutMode: mode }
    }
    // No registered servers: surface aggregated call counts by prefix
    // so operators still see tool activity if any is happening.
    const fallback = Array.from(callsByServerPrefix.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
    return { mcpDonutData: fallback, mcpDonutMode: 'calls' }
  }, [mcpServerList, callsByServerPrefix])

  // Did any tool actually fire in this window? Drives the sub-line copy
  // below the donut (registered-but-quiet vs active).
  const totalMcpCalls = React.useMemo(
    () => Array.from(callsByServerPrefix.values()).reduce((a, b) => a + b, 0),
    [callsByServerPrefix],
  )

  const agentDonutData = React.useMemo<DonutDatum[]>(
    () =>
      agentByName
        .map((a) => ({ name: a.name, value: a.count }))
        .filter((d) => d.value > 0)
        .slice(0, 8),
    [agentByName],
  )

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
    if (metrics.isError) {
      return { tone: 'err' as const, text: 'API metrics unreachable — degraded' }
    }
    const downProviders = (providerTotal ?? 0) - (providerHealthy ?? 0)
    if (downProviders > 0) {
      return {
        tone: 'warn' as const,
        text: `${downProviders} provider${downProviders === 1 ? '' : 's'} unhealthy · ${fmtNum(summary?.totalApiRequests)} requests · ${fmtUsd(summary?.totalCost)} spend in ${timeRange}`,
      }
    }
    if (metrics.isLoading) {
      return { tone: 'info' as const, text: `loading platform metrics for ${timeRange}…` }
    }
    return {
      tone: 'ok' as const,
      text: `Platform healthy — ${providerHealthy ?? 0} provider${providerHealthy === 1 ? '' : 's'} live · ${fmtNum(summary?.totalApiRequests)} requests · ${fmtUsd(summary?.totalCost)} spend · ${fmtTokens(summary?.totalTokens)} tokens in ${timeRange}`,
    }
  })()

  return (
    <>
      <Banner level={verdict.tone} label={verdict.tone === 'ok' ? 'verdict' : verdict.tone === 'err' ? 'sev' : 'note'}>
        {verdict.text}
      </Banner>

      <ScoringStrip cols={8}>
        <Score
          label="api health"
          value={metrics.isError ? 'down' : metrics.isLoading ? '…' : 'healthy'}
          tone={metrics.isError ? 'err' : 'ok'}
        />
        <Score label="providers" value={providerVal} delta={providerHealth.isLoading ? '…' : '—'} />
        <Score label="requests/min" value={reqsPerMin} />
        <Score label="p95 latency" value={loadingValue(metrics.isLoading, fmtMs(summary?.apiAvgResponseTime))} />
        <Score label="tool calls/min" value={callsPerMin} />
        <Score label={`spend (${timeRange})`} value={loadingValue(metrics.isLoading, fmtUsd(summary?.totalCost))} />
        <Score label="active users" value={loadingValue(metrics.isLoading, fmtNum(summary?.activeUsers))} />
        <Score label={`tokens (${timeRange})`} value={loadingValue(metrics.isLoading, fmtTokens(summary?.totalTokens))} />
      </ScoringStrip>

      <SectionBar
        title="01 · primary metrics over time"
        right={<span style={{ color: 'var(--fg-3)' }}>tokens · spend · requests · sessions · last {timeRange}</span>}
      />
      <Grid cols={2}>
        <Panel>
          <PanelHead
            title="Tokens over time"
            count={`${timeRange} · chat + code`}
            right={<a>{fmtTokens(summary?.totalTokens)} total</a>}
          />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (tokenSeries?.length ?? 0) === 0 && (
            <EmptyInline pad>no token usage in window</EmptyInline>
          )}
          {metrics.data && (tokenSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat="tok"
                xLabels={tsToLabels(tokenSeries)}
                series={[
                  { name: 'chat', data: tsToValues(tokenSeries), color: 'accent' },
                  { name: 'code', data: tsToValues(codeTokenSeries), color: 'info' },
                ]}
                showLegend
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="Spend by Model"
            count={`${timeRange} · top 5`}
            right={<a>{fmtUsd(summary?.totalCost)} total</a>}
          />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (costSeries?.length ?? 0) === 0 && (
            <EmptyInline pad>no spend in window</EmptyInline>
          )}
          {metrics.data && (costSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat="usd"
                xLabels={tsToLabels(costSeries![0]?.data)}
                series={costSeries!.slice(0, 5).map((s, i) => ({
                  name: s.model,
                  data: tsToValues(s.data),
                  color: PALETTE[i % PALETTE.length],
                }))}
                showLegend
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="API Requests"
            count={timeRange}
            right={<a>{fmtNum(summary?.totalApiRequests)} total</a>}
          />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (apiSeries?.length ?? 0) === 0 && (
            <EmptyInline pad>no api requests in window</EmptyInline>
          )}
          {metrics.data && (apiSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(apiSeries)}
                series={[{ name: 'requests', data: tsToValues(apiSeries), color: 'accent' }]}
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="Sessions & Messages"
            count={timeRange}
            right={<a>{fmtNum(summary?.totalSessions)} sessions</a>}
          />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (sessionsSeries?.length ?? 0) === 0 && (
            <EmptyInline pad>no sessions in window</EmptyInline>
          )}
          {metrics.data && (sessionsSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(sessionsSeries)}
                series={[
                  { name: 'sessions', data: tsToValues(sessionsSeries), color: 'accent' },
                  { name: 'messages', data: tsToValues(messagesSeries), color: 'info' },
                ]}
                showLegend
              />
            </div>
          )}
        </Panel>
      </Grid>

      {/* #929 — primary-metrics over time, per-model breakdown + tool pie.
          Three additional charts wired to /api/admin/analytics/system/timeseries
          (added 2026-05-18). Lives under the same "01 · primary metrics" SectionBar. */}
      <Grid cols={3}>
        <Panel>
          <PanelHead
            title="Tokens by Model"
            count={`${timeRange} · top 5`}
            right={<a>{fmtTokens(summary?.totalTokens)} total</a>}
          />
          {tokensTs.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!tokensTs.isLoading && tokensByModel.series.length === 0 && (
            <EmptyInline pad>no per-model token usage in window</EmptyInline>
          )}
          {tokensByModel.series.length > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="line"
                yFormat="tok"
                xLabels={tokensByModel.xLabels}
                series={tokensByModel.series}
                showLegend
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="TTFT by Model"
            count={`${timeRange} · p50 ms`}
            right={<a>time-to-first-token</a>}
          />
          {ttftTs.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!ttftTs.isLoading && ttftByModel.series.length === 0 && (
            <EmptyInline pad>no TTFT samples in window</EmptyInline>
          )}
          {ttftByModel.series.length > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="line"
                yFormat="ms"
                xLabels={ttftByModel.xLabels}
                series={ttftByModel.series}
                showLegend
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="Tool Usage"
            count={`${timeRange} · top 12`}
            right={<a>{toolsDonutData.reduce((s, t) => s + t.value, 0)} calls</a>}
          />
          {toolsTs.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!toolsTs.isLoading && toolsDonutData.length === 0 && (
            <EmptyInline pad>no tool invocations in window</EmptyInline>
          )}
          {toolsDonutData.length > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="donut"
                data={toolsDonutData}
                showLegend
              />
            </div>
          )}
        </Panel>
      </Grid>

      <SectionBar
        title="02 · executions over time"
        right={<span style={{ color: 'var(--fg-3)' }}>workflow + agent runs · last {timeRange}</span>}
      />
      <Grid cols={2}>
        <Panel>
          <PanelHead
            title="Workflow Executions"
            count={timeRange}
            right={<a>{fmtNum(summary?.totalWorkflowExecutions)} runs</a>}
          />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (wfSeries?.length ?? 0) === 0 && (
            <EmptyInline pad>no workflow runs in window</EmptyInline>
          )}
          {metrics.data && (wfSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(wfSeries)}
                series={[{ name: 'runs', data: tsToValues(wfSeries), color: 'accent' }]}
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="Agent Executions"
            count={timeRange}
            right={<a>{fmtNum(summary?.totalAgentExecutions)} runs</a>}
          />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (agentSeries?.length ?? 0) === 0 && (
            <EmptyInline pad>no agent runs in window</EmptyInline>
          )}
          {metrics.data && (agentSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(agentSeries)}
                series={[{ name: 'runs', data: tsToValues(agentSeries), color: 'info' }]}
              />
            </div>
          )}
        </Panel>
      </Grid>

      <SectionBar title="03 · platform stack" right={<span style={{ color: 'var(--fg-3)' }}>donuts and traffic flow · live data over {timeRange}</span>} />

      <Grid cols={2}>
        <Panel>
          <PanelHead
            title="MCP Tools"
            count={
              mcpServers.isLoading
                ? '…'
                : `${mcpDonutData.length} server${mcpDonutData.length === 1 ? '' : 's'}`
            }
            right={<a>view fleet →</a>}
          />
          {mcpServers.isLoading || metrics.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : mcpDonutData.length === 0 ? (
            <EmptyInline pad>
              no MCP servers registered — add one in{' '}
              <span className="accent">MCP Fleet</span>
            </EmptyInline>
          ) : (
            <>
              <DashboardDonut
                data={mcpDonutData}
                unitLabel={mcpDonutMode === 'servers' ? 'servers' : mcpDonutMode}
              />
              {totalMcpCalls === 0 && mcpServerList.length > 0 && (
                <div
                  style={{
                    padding: '8px 14px',
                    fontSize: 11,
                    color: 'var(--fg-3)',
                    borderTop: '1px solid var(--line-1)',
                    fontFamily: 'var(--font-v3-mono)',
                  }}
                >
                  {mcpServerList.length} server{mcpServerList.length === 1 ? '' : 's'} connected · 0 tool calls in {timeRange}
                </div>
              )}
            </>
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="Agent Activity"
            count={
              metrics.isLoading
                ? '…'
                : `${agentDonutData.length} agent${agentDonutData.length === 1 ? '' : 's'}`
            }
            right={<a>view registry →</a>}
          />
          {metrics.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : agentDonutData.length === 0 ? (
            <EmptyInline pad>
              no agent runs in window — register an agent in{' '}
              <span className="accent">Agents</span>
            </EmptyInline>
          ) : (
            <DashboardDonut data={agentDonutData} unitLabel="runs" />
          )}
        </Panel>
      </Grid>

      <SectionBar
        title="04 · traffic flow"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--fg-3)' }}>provider → model · width = tokens (or calls)</span>
            <button
              type="button"
              className="aw-tf-expand-btn"
              onClick={() => setTfExpanded(true)}
              aria-label="Open full-screen Traffic Flow views (Sankey · Heatmap · Ring)"
              title="Open full-screen views (Sankey · Heatmap · Ring)"
            >
              ↗ expand
            </button>
          </span>
        }
      />
      <Panel>
        <PanelHead
          title="Provider → Model token flow"
          count={metrics.isLoading ? '…' : `${(metrics.data?.modelUsage ?? []).length} models`}
          right={<span style={{ color: 'var(--fg-3)', fontSize: 11 }}>hover a band for detail</span>}
        />
        {metrics.isLoading || llmProviders.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : (
          <TrafficFlowSankey
            llmProviders={llmProviders}
            modelUsage={metrics.data?.modelUsage ?? []}
            height={340}
          />
        )}
      </Panel>
      {tfExpanded && (
        <TrafficFlowExpand
          llmProviders={llmProviders}
          modelUsage={metrics.data?.modelUsage ?? []}
          onClose={() => setTfExpanded(false)}
        />
      )}

      <SectionBar title="05 · service topology" right={<span style={{ color: 'var(--fg-3)' }}>k8s deployments · live status · 30s refresh</span>} />
      <Panel>
        <PanelHead
          title="Cluster Topology"
          right={<span style={{ color: 'var(--fg-3)', fontSize: 11 }}>hover a node for detail</span>}
        />
        <ServiceTopologySvg height={380} />
      </Panel>

      <SectionBar title="06 · health" right={<span style={{ color: 'var(--fg-3)' }}>providers · mcp fleet · audit</span>} />

      <Grid cols={3}>
        <Panel>
          <PanelHead title="Provider Health" count={providerTotal != null ? `${providerHealthy ?? 0} / ${providerTotal}` : '—'} right={<a>view all →</a>} />
          {(() => {
            if (llmProviders.isLoading) return <EmptyInline pad>loading…</EmptyInline>
            if (llmProviders.isError) return <Banner level="err" label="error">failed to fetch /api/admin/llm-providers</Banner>
            const provHealthMap = new Map<string, { healthy?: boolean; status?: string }>()
            for (const h of providerHealth.data?.providers ?? []) {
              if (h.provider) provHealthMap.set(h.provider, { healthy: h.healthy, status: h.status })
            }
            const rows = (llmProviders.data?.providers ?? []).map((p) => ({
              name: p.displayName ?? p.name,
              type: p.type,
              tier: p.priority != null ? `P${p.priority}` : '—',
              status: provHealthMap.get(p.name)?.healthy === true || provHealthMap.get(p.name)?.status === 'healthy'
                ? 'healthy'
                : p.enabled === false ? 'disabled' : provHealthMap.get(p.name)?.status ?? 'unknown',
              models: p.models?.length ?? 0,
              region: p.config?.region ?? p.config?.deployment ?? '—',
              raw: p,
            }))
            if (rows.length === 0) return <EmptyInline pad>no providers configured</EmptyInline>
            return (
              <Dt
                columns={[
                  { key: 'name',   label: 'Provider', render: (r: any) => r.name },
                  { key: 'tier',   label: 'Tier',   width: '50px', render: (r: any) => r.tier },
                  { key: 'status', label: 'Status', width: '80px', render: (r: any) => (
                    <span style={{ color: r.status === 'healthy' ? 'var(--ok)' : r.status === 'disabled' ? 'var(--fg-3)' : 'var(--warn)' }}>
                      {r.status}
                    </span>
                  ) },
                  { key: 'models', label: 'Models', width: '60px', align: 'right', className: 'num', render: (r: any) => r.models },
                ]}
                rows={rows}
                rowKey={(r) => r.name}
                onRowDoubleClick={(r) => onDrill({ kind: 'provider', name: r.name, row: r.raw })}
              />
            )
          })()}
        </Panel>
        <Panel>
          {(() => {
            const list: McpServerRow[] = Array.isArray(mcpServers.data) ? mcpServers.data : mcpServers.data?.servers ?? []
            const total = list.length
            const totalTools = list.reduce((n, s) => n + (s.toolCount ?? 0), 0)
            return (
              <>
                <PanelHead title="MCP Fleet" count={total > 0 ? `${total} · ${totalTools} tools` : '—'} right={<a>view all →</a>} />
                {(() => {
                  if (mcpServers.isLoading) return <EmptyInline pad>loading…</EmptyInline>
                  if (mcpServers.isError) return <Banner level="err" label="error">failed to fetch /api/admin/mcp/servers</Banner>
                  if (total === 0) return <EmptyInline pad>no MCP servers configured</EmptyInline>
                  const rows = list.map((s) => {
                    const statusRaw = (s.status ?? s.health ?? '').toLowerCase()
                    const status = !statusRaw || statusRaw === 'healthy' || statusRaw === 'up' || statusRaw === 'ok' ? 'healthy' : statusRaw
                    return {
                      name: s.displayName ?? s.name ?? s.id ?? '—',
                      tier: s.tier ?? '—',
                      status,
                      tools: s.toolCount ?? 0,
                      raw: s,
                    }
                  })
                  return (
                    <Dt
                      columns={[
                        { key: 'name',   label: 'Server', render: (r: any) => r.name },
                        { key: 'tier',   label: 'Tier',   width: '50px', render: (r: any) => r.tier },
                        { key: 'status', label: 'Status', width: '80px', render: (r: any) => (
                          <span style={{ color: r.status === 'healthy' ? 'var(--ok)' : 'var(--warn)' }}>{r.status}</span>
                        ) },
                        { key: 'tools',  label: 'Tools',  width: '60px', align: 'right', className: 'num', render: (r: any) => r.tools },
                      ]}
                      rows={rows}
                      rowKey={(r) => r.name}
                      onRowDoubleClick={(r) => onDrill({ kind: 'mcp-server', name: r.name, row: r.raw })}
                    />
                  )
                })()}
              </>
            )
          })()}
        </Panel>
        <Panel>
          <PanelHead title="Active Signals" count={auditLogs.data?.logs?.length ?? 0} right={<a>acknowledge →</a>} />
          {auditLogs.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!auditLogs.isLoading && (auditLogs.data?.logs?.length ?? 0) === 0 && (
            <EmptyInline pad>no recent admin events</EmptyInline>
          )}
          {!auditLogs.isLoading && (auditLogs.data?.logs?.length ?? 0) > 0 && (
            <Feed>
              {(auditLogs.data?.logs ?? []).slice(0, 8).map((s, i) => {
                const status: 'ok' | 'warn' | 'err' | 'idle' =
                  s.success === false ? 'err' : (s.error ? 'warn' : 'ok')
                return (
                  <div
                    key={s.id ?? i}
                    onDoubleClick={() => onDrill({ kind: 'signal', row: s })}
                    title="double-click to drill in"
                    style={{ cursor: 'pointer' }}
                  >
                    <FeedRow
                      ts={shortRelative(s.timestamp)}
                      status={status}
                      who={s.userName ?? s.userEmail}
                      act={<>{s.action ?? s.intent ?? '(unspecified action)'}{s.resourceType ? <> · <span className="accent">{s.resourceType}</span></> : null}</>}
                      right={s.error ? 'err' : undefined}
                    />
                  </div>
                )
              })}
            </Feed>
          )}
        </Panel>
      </Grid>

      <SectionBar title="07 · live activity" right={<span style={{ color: 'var(--fg-3)' }}>recent mcp tool calls · streaming</span>} />

      <Panel>
        <PanelHead title="Live Activity" count={`${mcpLogs.data?.logs?.length ?? 0} recent calls`} right={<a>filter</a>} />
        {mcpLogs.isLoading && <EmptyInline pad>loading…</EmptyInline>}
        {!mcpLogs.isLoading && (mcpLogs.data?.logs?.length ?? 0) === 0 && (
          <EmptyInline pad>no recent mcp calls</EmptyInline>
        )}
        {!mcpLogs.isLoading && (mcpLogs.data?.logs?.length ?? 0) > 0 && (
          <Feed>
            {(mcpLogs.data?.logs ?? []).map((r) => (
              <FeedRow
                key={r.id}
                ts={shortRelative(r.timestamp)}
                status={r.status === 'success' ? 'ok' : 'err'}
                who={r.userName ?? r.userEmail ?? '—'}
                act={<>{r.serverId} · <span className="accent">{r.toolName}</span>{r.modelUsed ? <> · {r.modelUsed}</> : null}</>}
                right={`${Math.round(r.executionTime)}ms`}
              />
            ))}
          </Feed>
        )}
      </Panel>

      {/* B.4 — Extended Thinking Usage tile (Task B.4, 2026-05-19).
          Extracted to ExtendedThinkingSection for testability. */}
      <ExtendedThinkingSection timeRange={timeRange} />
    </>
  )
}

// short relative-time formatter for feed rows ("2m", "1h", "12s")
function shortRelative(iso?: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Color palette for multi-series charts (CSS-token names so theme/accent
// swaps repaint via MutationObserver in MetricChart).
const PALETTE = ['accent', 'info', 'ok', 'warn', 'err'] as const

/* ============================================================
   2. USAGE & TOKENS
   ============================================================ */
const UsagePane = ({ metrics, onDrill }: PaneProps & { onDrill: DrillFn }) => {
  const summary = metrics.data?.summary
  const tokenSeries = metrics.data?.timeSeries?.tokenUsage
  const codeTokenSeries = metrics.data?.timeSeries?.codeTokenUsage
  const period = metrics.data?.period
  const reqsPerMin = calcPerMin(summary?.totalApiRequests, period?.start, period?.end)
  const codePct = summary && summary.totalTokens > 0
    ? (summary.totalCodeTokens / summary.totalTokens) * 100
    : undefined
  const embedPct = summary && summary.totalTokens > 0 && summary.totalEmbeddings > 0
    ? (summary.totalEmbeddings / summary.totalTokens) * 100
    : undefined

  const userTokenRows = (metrics.data?.perUserUsage ?? []).slice(0, 10).map((u) => ({
    user: u.displayName || u.email,
    email: u.email,
    chat: fmtTokens(u.tokens),
    code: '—',  // perUserUsage doesn't yet split chat/code
    flows: '—', // ditto
    total: fmtTokens(u.tokens),
    raw: u,
  }))

  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="tokens 24h" value={loadingValue(metrics.isLoading, fmtTokens(summary?.totalTokens))} sub={summary?.messageChange != null ? `${summary.messageChange >= 0 ? '+' : ''}${summary.messageChange.toFixed(1)}% vs prior` : ''} />
        <Kpi label="requests 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalApiRequests))} sub={`${reqsPerMin}/min avg`} />
        <Kpi label="messages 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalMessages))} sub={summary?.sessionChange != null ? `${summary.sessionChange >= 0 ? '+' : ''}${summary.sessionChange.toFixed(1)}% vs prior` : ''} />
        <Kpi label="code-mode tokens" value={loadingValue(metrics.isLoading, fmtTokens(summary?.totalCodeTokens))} sub={`${summary?.totalCodeSessions ?? 0} sessions`} tone={summary?.totalCodeTokens === 0 ? 'dim' : undefined} />
        <Kpi label="embed tokens" value={loadingValue(metrics.isLoading, fmtTokens(summary?.totalEmbeddings))} sub={embedPct != null ? `${embedPct.toFixed(0)}% of total` : ''} />
        <Kpi label="agent tokens" value={loadingValue(metrics.isLoading, fmtTokens(summary?.agentTotalTokens))} sub={`${summary?.totalAgentExecutions ?? 0} runs`} />
      </KpiGrid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="tokens over time" count="24h · chat vs code" right={<a>{fmtTokens(summary?.totalTokens)} total</a>} />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat="tok"
                xLabels={tsToLabels(tokenSeries)}
                series={[
                  { name: 'chat', data: tsToValues(tokenSeries), color: 'accent' },
                  { name: 'code', data: tsToValues(codeTokenSeries), color: 'info' },
                ]}
                showLegend
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="per-user tokens" count={`${userTokenRows.length} users`} />
          {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!metrics.isLoading && userTokenRows.length === 0 && (
            <EmptyInline pad>no user activity in window</EmptyInline>
          )}
          {!metrics.isLoading && userTokenRows.length > 0 && (
            <Dt
              columns={USER_TOKEN_COLS}
              rows={userTokenRows}
              rowKey={(r) => r.email || r.user}
              onRowDoubleClick={(r) => onDrill({ kind: 'user', name: r.user, row: r.raw })}
            />
          )}
        </Panel>
      </Grid>
    </>
  )
}

type UserTokenRow = { user: string; email: string; chat: string; code: string; flows: string; total: string; raw: PerUserUsageRow }
const USER_TOKEN_COLS: DtCol<UserTokenRow>[] = [
  { key: 'user', label: 'user', className: 'name', render: (r) => r.user },
  { key: 'email', label: 'email', className: 'mono dim' as any, render: (r) => r.email },
  { key: 'chat', label: 'chat', className: 'num', render: (r) => r.chat },
  { key: 'total', label: 'total', className: 'num', render: (r) => r.total },
]

/* ============================================================
   3. COST ANALYSIS
   ============================================================ */
const CostPane = ({ metrics, onDrill }: PaneProps & { onDrill: DrillFn }) => {
  const summary = metrics.data?.summary
  const costSeries = metrics.data?.costByModel
  const modelUsage = metrics.data?.modelUsage ?? []
  const perUser = metrics.data?.perUserUsage ?? []
  const llmProviders = useLlmProviders()

  const avgCostPerUser = summary && summary.activeUsers > 0
    ? summary.totalCost / summary.activeUsers
    : undefined

  const userCostRows: BarItem[] = perUser.slice(0, 8).map((u) => ({
    name: u.displayName || u.email,
    value: u.cost,
    display: fmtUsd(u.cost),
  }))

  const modelCostRows: ModelCostRow[] = modelUsage.slice(0, 10).map((m) => ({
    model: m.model,
    cost: fmtUsd(m.cost),
    tokens: fmtTokens(m.tokens),
    per1k: fmtPer1k(m.cost, m.tokens),
    raw: m,
  }))

  // Spend by Tier — derive client-side from modelUsage joined with the
  // provider list (each provider carries a priority that maps to a
  // pricing tier band). We bucket P0/P1 → "frontier", P2 → "balanced",
  // P3+ → "cheap", everything else (incl. unknown) → "other".
  const tierBuckets = React.useMemo(() => {
    const modelToTier = new Map<string, string>()
    for (const p of llmProviders.data?.providers ?? []) {
      const pr = typeof p.priority === 'number' ? p.priority : null
      const tierLabel =
        pr == null ? 'other' :
        pr <= 1 ? 'frontier' :
        pr === 2 ? 'balanced' : 'cheap'
      for (const m of p.models ?? []) {
        const k = (m.name ?? m.id ?? '').toLowerCase()
        if (k) modelToTier.set(k, tierLabel)
      }
    }
    const agg = new Map<string, number>()
    for (const m of modelUsage) {
      const tier = modelToTier.get((m.model ?? '').toLowerCase()) ?? 'other'
      agg.set(tier, (agg.get(tier) ?? 0) + (m.cost ?? 0))
    }
    return [...agg.entries()]
      .map(([name, value]) => ({ name, value, display: fmtUsd(value) } as BarItem))
      .sort((a, b) => b.value - a.value)
  }, [llmProviders.data, modelUsage])

  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="spend 24h" value={loadingValue(metrics.isLoading, fmtUsd(summary?.totalCost))} sub={summary?.messageChange != null ? `${summary.messageChange >= 0 ? '+' : ''}${summary.messageChange.toFixed(1)}% vs prior` : ''} />
        <Kpi label="active users" value={loadingValue(metrics.isLoading, fmtNum(summary?.activeUsers))} sub={`of ${fmtNum(summary?.totalUsers)} registered`} />
        <Kpi label="avg / user 24h" value={loadingValue(metrics.isLoading, fmtUsd(avgCostPerUser))} sub="active only" />
        <Kpi label="code-mode cost" value={loadingValue(metrics.isLoading, fmtUsd(summary?.totalCodeCost))} sub={`${summary?.totalCodeSessions ?? 0} sessions`} />
        <Kpi label="agent cost" value={loadingValue(metrics.isLoading, fmtUsd(summary?.agentTotalCost))} sub={`${summary?.totalAgentExecutions ?? 0} runs`} />
        <Kpi label="models in use" value={loadingValue(metrics.isLoading, String(modelUsage.length))} sub="distinct" />
      </KpiGrid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="spend by model" count="24h · top 5" right={<a>{fmtUsd(summary?.totalCost)} total</a>} />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (costSeries?.length ?? 0) === 0 && <EmptyInline pad>no spend in window</EmptyInline>}
          {metrics.data && (costSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat="usd"
                xLabels={tsToLabels(costSeries![0]?.data)}
                series={costSeries!.slice(0, 5).map((s, i) => ({
                  name: s.model,
                  data: tsToValues(s.data),
                  color: PALETTE[i % PALETTE.length],
                }))}
                showLegend
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="top users · cost 24h" />
          {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!metrics.isLoading && userCostRows.length === 0 && (
            <EmptyInline pad>no user spend in window</EmptyInline>
          )}
          {!metrics.isLoading && userCostRows.length > 0 && <BarList items={userCostRows} />}
        </Panel>
      </Grid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="top models · cost 24h" count={`${modelCostRows.length} ranked`} />
          {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!metrics.isLoading && modelCostRows.length === 0 && <EmptyInline pad>no model spend</EmptyInline>}
          {!metrics.isLoading && modelCostRows.length > 0 && (
            <Dt
              columns={MODEL_COST_COLS}
              rows={modelCostRows}
              rowKey={(r) => r.model}
              onRowDoubleClick={(r) => onDrill({ kind: 'model', name: r.model, row: r.raw })}
            />
          )}
        </Panel>
        <Panel>
          <PanelHead title="spend by tier" count="24h · derived" />
          {/* Derived client-side: provider.priority ⇒ tier, then sum modelUsage.cost per tier. */}
          {(metrics.isLoading || llmProviders.isLoading) && <EmptyInline pad>loading…</EmptyInline>}
          {!metrics.isLoading && !llmProviders.isLoading && tierBuckets.length === 0 && (
            <EmptyInline pad>no spend in window</EmptyInline>
          )}
          {!metrics.isLoading && !llmProviders.isLoading && tierBuckets.length > 0 && (
            <BarList items={tierBuckets} />
          )}
        </Panel>
      </Grid>
    </>
  )
}

type ModelCostRow = { model: string; cost: string; tokens: string; per1k: string; raw: ModelUsageRow }
const MODEL_COST_COLS: DtCol<ModelCostRow>[] = [
  { key: 'model', label: 'model', className: 'name mono' as any, render: (r) => r.model },
  { key: 'cost', label: 'cost', className: 'num', render: (r) => r.cost },
  { key: 'tokens', label: 'tokens', className: 'num', render: (r) => r.tokens },
  { key: 'per1k', label: '$/1k', className: 'num', render: (r) => r.per1k },
]

/* ============================================================
   4. FLOWS & AGENTS
   ============================================================ */
const FlowsAgentsPane = ({ metrics }: PaneProps & { onDrill: DrillFn }) => {
  const summary = metrics.data?.summary
  const wfSeries = metrics.data?.timeSeries?.workflowExecutions
  const agentSeries = metrics.data?.timeSeries?.agentExecutions
  const failures = useFlowsRecentFailures(20)

  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="workflows" value={loadingValue(metrics.isLoading, String(summary?.totalWorkflows ?? '—'))} sub={`${summary?.activeWorkflows ?? 0} active`} />
        <Kpi label="flow runs 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalWorkflowExecutions))} />
        <Kpi label="flow success" value={loadingValue(metrics.isLoading, fmtPct(summary?.workflowSuccessRate))} tone={typeof summary?.workflowSuccessRate === 'number' && summary.workflowSuccessRate < 95 ? 'warn' : 'ok'} />
        <Kpi label="agent runs 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalAgentExecutions))} sub={summary?.totalAgentExecutions === 0 ? 'no executions' : ''} tone={summary?.totalAgentExecutions === 0 ? 'dim' : undefined} />
        <Kpi label="agent tokens" value={loadingValue(metrics.isLoading, fmtTokens(summary?.agentTotalTokens))} />
        <Kpi label="agent cost" value={loadingValue(metrics.isLoading, fmtUsd(summary?.agentTotalCost))} />
      </KpiGrid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="workflow executions · 24h" />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (wfSeries?.length ?? 0) === 0 && <EmptyInline pad>no workflow runs in window</EmptyInline>}
          {metrics.data && (wfSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(wfSeries)}
                series={[{ name: 'runs', data: tsToValues(wfSeries), color: 'accent' }]}
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="agent executions · 24h" />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (agentSeries?.length ?? 0) === 0 && <EmptyInline pad>no agent runs in window</EmptyInline>}
          {metrics.data && (agentSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(agentSeries)}
                series={[{ name: 'runs', data: tsToValues(agentSeries), color: 'info' }]}
              />
            </div>
          )}
        </Panel>
      </Grid>
      <Panel>
        <PanelHead title="recent flow failures" count={failures.data?.failures?.length ?? 0} />
        {failures.isLoading && <EmptyInline pad>loading…</EmptyInline>}
        {failures.isError && (
          <Banner level="err" label="error">
            failed to fetch <span className="accent">/api/admin/flows/recent-failures</span>
          </Banner>
        )}
        {!failures.isLoading && !failures.isError && (failures.data?.failures?.length ?? 0) === 0 && (
          <EmptyInline pad>no failures in window</EmptyInline>
        )}
        {!failures.isLoading && !failures.isError && (failures.data?.failures?.length ?? 0) > 0 && (
          <Dt
            columns={FLOW_FAILURE_COLS}
            rows={failures.data!.failures}
            rowKey={(r) => r.executionId}
          />
        )}
      </Panel>
    </>
  )
}

const FLOW_FAILURE_COLS: DtCol<FlowFailureRow>[] = [
  { key: 'when', label: 'when', className: 'mono dim' as any, width: '70px', render: (r) => shortRelative(r.timestamp) },
  { key: 'workflow', label: 'workflow', className: 'name', render: (r) => r.workflowName },
  { key: 'node', label: 'failed node', className: 'mono' as any, render: (r) => r.failedNodeId ?? '—' },
  { key: 'error', label: 'error', className: 'dim' as any, render: (r) => (
    r.error ? (r.error.length > 80 ? `${r.error.slice(0, 80)}…` : r.error) : '—'
  ) },
  { key: 'dur', label: 'ms', className: 'num', width: '70px', render: (r) => r.executionTimeMs != null ? r.executionTimeMs.toLocaleString() : '—' },
]

/* ============================================================
   5. MCP & TOOLS
   ============================================================ */
const McpToolsPane = ({
  metrics,
  mcpHealth,
  onDrill,
}: {
  metrics: DashboardMetricsState
  mcpHealth: ReturnType<typeof useMcpHealth>
  onDrill: DrillFn
}) => {
  const summary = metrics.data?.summary
  const mcpToolUsage: McpToolUsageRow[] = metrics.data?.mcpToolUsage ?? []
  const period = metrics.data?.period
  const callsPerMin = calcPerMin(summary?.totalMcpCalls, period?.start, period?.end)
  // Derive success-rate / p95 latency from the recent mcp-logs sample.
  // Not a full 24h roll-up — but real signal that doesn't require a new
  // server endpoint.  Limit 200 keeps the request light.
  const recentMcpLogs = useMcpLogs(200)
  const mcpStats = React.useMemo(() => {
    const rows = recentMcpLogs.data?.logs ?? []
    if (rows.length === 0) return { successRate: undefined as number | undefined, p95: undefined as number | undefined }
    const ok = rows.filter((r) => r.status === 'success').length
    const successRate = (ok / rows.length) * 100
    const lats = rows.map((r) => r.executionTime).filter((n): n is number => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    const p95 = lats.length > 0 ? lats[Math.min(lats.length - 1, Math.floor(lats.length * 0.95))] : undefined
    return { successRate, p95 }
  }, [recentMcpLogs.data])

  // Derive "calls by server" by namespacing the mcpToolUsage tool prefix.
  // Tool names land as "<server>:<tool>" in the registry; fall back to the
  // first dotted/colon segment, else "(unprefixed)".
  const callsByServer = React.useMemo(() => {
    const agg = new Map<string, number>()
    for (const t of mcpToolUsage) {
      const tool = t.tool ?? ''
      let server = '(unprefixed)'
      if (tool.includes(':')) server = tool.split(':')[0] ?? '(unprefixed)'
      else if (tool.includes('.')) server = tool.split('.')[0] ?? '(unprefixed)'
      else if (tool.includes('__')) server = tool.split('__')[0] ?? '(unprefixed)'
      agg.set(server, (agg.get(server) ?? 0) + (t.count ?? 0))
    }
    return [...agg.entries()]
      .map(([name, value]) => ({ name, value, display: value.toLocaleString() } as BarItem))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)
  }, [mcpToolUsage])

  // Latency histogram — prefer the server-side /mcp-logs/histogram aggregate
  // (24h window, all calls) and fall back to client-side bucketing of the
  // recentMcpLogs sample (last 200) when the endpoint isn't available.
  const histogramQ = useMcpLogsHistogram('24h')
  const serverHistogram = React.useMemo<BarItem[]>(() => {
    const buckets = histogramQ.data?.buckets ?? []
    if (buckets.length === 0) return []
    const fmt = (lo: number, hi: number | null): string => {
      if (hi == null) return `>${lo >= 1000 ? `${lo / 1000}s` : `${lo}ms`}`
      if (hi < 1000) return `${lo}-${hi}ms`
      return `${lo / 1000}-${hi / 1000}s`
    }
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({
        name: fmt(b.lo, b.hi),
        value: b.count,
        display: b.count.toLocaleString(),
      } as BarItem))
  }, [histogramQ.data])

  const latencyHistogram = React.useMemo(() => {
    if (serverHistogram.length > 0) return serverHistogram
    const rows = recentMcpLogs.data?.logs ?? []
    const lats = rows.map((r) => r.executionTime).filter((n): n is number => Number.isFinite(n) && n > 0)
    if (lats.length === 0) return [] as BarItem[]
    const buckets: Array<{ label: string; max: number; count: number }> = [
      { label: '<100ms', max: 100, count: 0 },
      { label: '100-250ms', max: 250, count: 0 },
      { label: '250-500ms', max: 500, count: 0 },
      { label: '500-1000ms', max: 1000, count: 0 },
      { label: '1-2.5s', max: 2500, count: 0 },
      { label: '2.5-5s', max: 5000, count: 0 },
      { label: '5-10s', max: 10000, count: 0 },
      { label: '>10s', max: Infinity, count: 0 },
    ]
    for (const l of lats) {
      for (const b of buckets) {
        if (l <= b.max) { b.count += 1; break }
      }
    }
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({ name: b.label, value: b.count, display: b.count.toLocaleString() } as BarItem))
  }, [serverHistogram, recentMcpLogs.data])

  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="servers" value={loadingValue(mcpHealth.isLoading, mcpHealth.data?.totalServers != null ? String(mcpHealth.data.totalServers) : '—')} sub={mcpHealth.data?.healthyServers != null && mcpHealth.data?.totalServers != null ? `${mcpHealth.data.healthyServers} healthy` : ''} />
        <Kpi label="tools indexed" value={loadingValue(mcpHealth.isLoading, mcpHealth.data?.toolsIndexed != null ? String(mcpHealth.data.toolsIndexed) : '—')} sub="milvus L3" />
        <Kpi label="calls 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalMcpCalls))} sub={`${callsPerMin}/min avg`} />
        <Kpi label="distinct tools" value={loadingValue(metrics.isLoading, String(mcpToolUsage.length))} sub="last 24h" />
        {/* Derived from /api/admin/mcp-logs (last 200 calls) — closest available real signal. */}
        <Kpi label="success rate" value={loadingValue(recentMcpLogs.isLoading, fmtPct(mcpStats.successRate))} sub="last 200 calls" />
        <Kpi label="p95 latency" value={loadingValue(recentMcpLogs.isLoading, fmtMs(mcpStats.p95))} sub="last 200 calls" />
      </KpiGrid>

      <Grid cols={2}>
        <Panel>
          <PanelHead
            title="mcp tool usage"
            count={mcpToolUsage.length > 0 ? `top ${Math.min(5, mcpToolUsage.length)} of ${mcpToolUsage.length}` : '—'}
            right={<a>double-click row to drill</a>}
          />
          {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!metrics.isLoading && mcpToolUsage.length === 0 && (
            <EmptyInline pad>no mcp tool calls in window</EmptyInline>
          )}
          {!metrics.isLoading && mcpToolUsage.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', padding: 12, gap: 14 }}>
              <div style={{ flex: '0 0 50%' }}>
                <MetricChart
                  variant="donut"
                  yFormat={(v) => `${v} calls`}
                  data={mcpToolUsage.slice(0, 5).map((d, i) => ({
                    name: d.tool,
                    value: d.count,
                    color: DONUT_PALETTE[i] as any,
                  }))}
                  height={200}
                  centerLabel={{
                    primary: mcpToolUsage.slice(0, 5).reduce((s, d) => s + d.count, 0).toLocaleString(),
                    secondary: 'calls 24h',
                  }}
                />
              </div>
              <div style={{ flex: 1, fontFamily: 'var(--font-v3-mono)', fontSize: 'var(--v3-t-meta)' }}>
                {mcpToolUsage.slice(0, 5).map((d, i) => (
                  <div
                    key={d.tool}
                    onDoubleClick={() => onDrill({ kind: 'mcp-server', name: d.tool, row: d })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 0',
                      cursor: 'pointer',
                    }}
                    title="double-click to drill in"
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: `var(--${DONUT_PALETTE[i]})`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: 'var(--fg-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.tool}
                      </span>
                    </span>
                    <span style={{ color: 'var(--fg-0)', fontFeatureSettings: '"tnum"', marginLeft: 8 }}>
                      {d.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="top tools · calls 24h" count={mcpToolUsage.length} />
          {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!metrics.isLoading && mcpToolUsage.length === 0 && (
            <EmptyInline pad>no mcp tool calls in window</EmptyInline>
          )}
          {!metrics.isLoading && mcpToolUsage.length > 0 && (
            <Dt
              columns={TOOL_CALL_COLS}
              rows={mcpToolUsage.slice(0, 20)}
              rowKey={(r) => r.tool}
              onRowDoubleClick={(r) => onDrill({ kind: 'mcp-server', name: r.tool, row: r })}
            />
          )}
        </Panel>
      </Grid>

      <Grid cols={2}>
        <Panel>
          <PanelHead title="calls by server" count={callsByServer.length > 0 ? `${callsByServer.length} servers` : '—'} />
          {/* Derived from mcpToolUsage by namespacing the tool prefix (server:tool / server.tool). */}
          {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!metrics.isLoading && callsByServer.length === 0 && (
            <EmptyInline pad>no mcp tool calls in window</EmptyInline>
          )}
          {!metrics.isLoading && callsByServer.length > 0 && <BarList items={callsByServer} />}
        </Panel>
        <Panel>
          <PanelHead
            title="latency distribution"
            count={serverHistogram.length > 0 ? '24h · all calls' : 'last 200 calls'}
            right={serverHistogram.length > 0 && histogramQ.data?.source ? <span className="dim">{histogramQ.data.source}</span> : undefined}
          />
          {(histogramQ.isLoading && recentMcpLogs.isLoading) && <EmptyInline pad>loading…</EmptyInline>}
          {!histogramQ.isLoading && !recentMcpLogs.isLoading && latencyHistogram.length === 0 && (
            <EmptyInline pad>no latency samples</EmptyInline>
          )}
          {latencyHistogram.length > 0 && <BarList items={latencyHistogram} />}
        </Panel>
      </Grid>
    </>
  )
}

// Color rotation for the donut — accent + 4 status colors. All
// CSS-var names so the palette repaints on theme/accent toggle.
const DONUT_PALETTE = ['accent', 'ok', 'info', 'warn', 'err'] as const

const TOOL_CALL_COLS: DtCol<McpToolUsageRow>[] = [
  { key: 'tool', label: 'tool', className: 'name mono' as any, render: (r) => r.tool },
  { key: 'count', label: 'calls', className: 'num', render: (r) => r.count.toLocaleString() },
]

/* ============================================================
   6. API & LIMITS
   ============================================================ */
const ApiLimitsPane = ({ metrics }: PaneProps) => {
  const summary = metrics.data?.summary
  const apiSeries = metrics.data?.timeSeries?.apiRequests
  const errPct = summary?.apiErrorRate
  const topEndpoints = useTopEndpoints(20, '24h')
  const statusCodes = useStatusCodes('24h')
  const authMethods = useAuthMethods('24h')
  const throttles = useApiThrottles('24h')

  // Status-code histogram → BarList (sorted desc, with status colors).
  const statusCodeBars: BarItem[] = React.useMemo(() => {
    const codes = statusCodes.data?.codes ?? {}
    return Object.entries(codes)
      .map(([code, count]) => ({
        name: <span style={{ color: codeColor(code) }}>{code}</span>,
        value: typeof count === 'number' ? count : 0,
        display: typeof count === 'number' ? count.toLocaleString() : '0',
      } as BarItem))
      .sort((a, b) => b.value - a.value)
  }, [statusCodes.data])

  const authMethodBars: BarItem[] = React.useMemo(() => {
    const m = authMethods.data?.methods ?? {}
    return Object.entries(m)
      .map(([method, count]) => ({
        name: method,
        value: typeof count === 'number' ? count : 0,
        display: typeof count === 'number' ? count.toLocaleString() : '0',
      } as BarItem))
      .sort((a, b) => b.value - a.value)
  }, [authMethods.data])

  // Top users at quota (rate-limit hits over the window).
  const usersAtQuotaRows = throttles.data?.usersAtQuota ?? []
  const usersAtQuotaBars: BarItem[] = React.useMemo(() => {
    return usersAtQuotaRows.slice(0, 8).map((u) => ({
      name: u.email || u.userId,
      value: u.hits,
      display: u.hits.toLocaleString(),
    } as BarItem))
  }, [usersAtQuotaRows])

  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="api requests 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalApiRequests))} />
        <Kpi label="error rate" value={loadingValue(metrics.isLoading, fmtPct(errPct))} tone={typeof errPct === 'number' && errPct > 1 ? 'warn' : 'ok'} />
        <Kpi label="avg response" value={loadingValue(metrics.isLoading, fmtMs(summary?.apiAvgResponseTime))} />
        <Kpi
          label="rate-limit hits 24h"
          value={loadingValue(throttles.isLoading, fmtNum(throttles.data?.rateLimitHits))}
          tone={(throttles.data?.rateLimitHits ?? 0) > 0 ? 'warn' : undefined}
          sub={(throttles.data?.rateLimitHits ?? 0) === 0 ? 'no throttles' : ''}
        />
        <Kpi
          label="total throttles"
          value={loadingValue(throttles.isLoading, fmtNum(throttles.data?.throttles))}
          sub={throttles.data?.sources ? `${throttles.data.sources.rateLimitViolation}+${throttles.data.sources.llmRequestLog}+${throttles.data.sources.adminAuditLog}` : ''}
        />
        <Kpi
          label="users at quota"
          value={loadingValue(throttles.isLoading, fmtNum(throttles.data?.usersAtQuota?.length))}
          sub={(throttles.data?.usersAtQuota?.length ?? 0) === 0 ? 'none' : ''}
          tone={(throttles.data?.usersAtQuota?.length ?? 0) === 0 ? 'dim' : undefined}
        />
      </KpiGrid>
      {throttles.isError && (
        <Banner level="err" label="error">failed to fetch /api/admin/api-requests/throttles</Banner>
      )}
      <Grid cols={2}>
        <Panel>
          <PanelHead title="api requests over time" count="24h" />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (apiSeries?.length ?? 0) === 0 && <EmptyInline pad>no api requests in window</EmptyInline>}
          {metrics.data && (apiSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(apiSeries)}
                series={[{ name: 'requests', data: tsToValues(apiSeries), color: 'accent' }]}
              />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="top endpoints" count={topEndpoints.data?.endpoints?.length ?? 0} right={topEndpoints.data?.source ? <span className="dim">{topEndpoints.data.source}</span> : undefined} />
          {topEndpoints.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {topEndpoints.isError && (
            <Banner level="err" label="error">failed to fetch /api/admin/api-requests/top-endpoints</Banner>
          )}
          {!topEndpoints.isLoading && !topEndpoints.isError && (topEndpoints.data?.endpoints?.length ?? 0) === 0 && (
            <EmptyInline pad>no api requests in window</EmptyInline>
          )}
          {!topEndpoints.isLoading && !topEndpoints.isError && (topEndpoints.data?.endpoints?.length ?? 0) > 0 && (
            <Dt
              columns={TOP_ENDPOINT_COLS}
              rows={topEndpoints.data!.endpoints}
              rowKey={(r) => r.path}
            />
          )}
        </Panel>
      </Grid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="status code breakdown" count={statusCodeBars.length > 0 ? `${statusCodeBars.length} codes` : '—'} />
          {statusCodes.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {statusCodes.isError && (
            <Banner level="err" label="error">failed to fetch /api/admin/api-requests/status-codes</Banner>
          )}
          {!statusCodes.isLoading && !statusCodes.isError && statusCodeBars.length === 0 && (
            <EmptyInline pad>no api requests in window</EmptyInline>
          )}
          {!statusCodes.isLoading && !statusCodes.isError && statusCodeBars.length > 0 && (
            <BarList items={statusCodeBars} />
          )}
        </Panel>
        <Panel>
          <PanelHead title="auth method breakdown" count={authMethodBars.length > 0 ? `${authMethodBars.length} methods` : '—'} />
          {authMethods.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {authMethods.isError && (
            <Banner level="err" label="error">failed to fetch /api/admin/api-requests/auth-methods</Banner>
          )}
          {!authMethods.isLoading && !authMethods.isError && authMethodBars.length === 0 && (
            <EmptyInline pad>no api requests in window</EmptyInline>
          )}
          {!authMethods.isLoading && !authMethods.isError && authMethodBars.length > 0 && (
            <BarList items={authMethodBars} />
          )}
        </Panel>
      </Grid>
      <Panel>
        <PanelHead
          title="top users at quota"
          count={usersAtQuotaRows.length > 0 ? `${usersAtQuotaRows.length} users` : '—'}
        />
        {throttles.isLoading && <EmptyInline pad>loading…</EmptyInline>}
        {!throttles.isLoading && !throttles.isError && usersAtQuotaBars.length === 0 && (
          <EmptyInline pad>no rate-limit hits in window</EmptyInline>
        )}
        {!throttles.isLoading && !throttles.isError && usersAtQuotaBars.length > 0 && (
          <BarList items={usersAtQuotaBars} />
        )}
      </Panel>
    </>
  )
}

const TOP_ENDPOINT_COLS: DtCol<TopEndpointRow>[] = [
  { key: 'path', label: 'endpoint', className: 'mono' as any, render: (r) => r.path },
  { key: 'calls', label: 'calls', className: 'num', render: (r) => r.calls.toLocaleString() },
  { key: 'err', label: 'err %', className: 'num', render: (r) => fmtPct(r.errorRate * 100, 2) },
  { key: 'avg', label: 'avg ms', className: 'num', render: (r) => r.avgMs > 0 ? r.avgMs.toLocaleString() : '—' },
]

// HTTP status-code colorizer (2xx ok, 3xx info, 4xx warn, 5xx err)
function codeColor(code: string): string {
  if (code === 'unknown') return 'var(--fg-3)'
  const n = parseInt(code, 10)
  if (!Number.isFinite(n)) return 'var(--fg-2)'
  if (n >= 500) return 'var(--err)'
  if (n >= 400) return 'var(--warn)'
  if (n >= 300) return 'var(--info)'
  if (n >= 200) return 'var(--ok)'
  return 'var(--fg-2)'
}

/* ============================================================
   7. INFRASTRUCTURE
   ============================================================ */
// Identical PromQL fragments to monitoring/ClusterPane so the operator
// sees the same numbers in both shells.
const Q_NODES_READY = 'sum(kube_node_status_condition{condition="Ready",status="true"})'
const Q_PODS_RUNNING = 'sum(kube_pod_status_phase{phase="Running"})'
const Q_PODS_PENDING = 'sum(kube_pod_status_phase{phase="Pending"})'
const Q_PODS_FAILED = 'sum(kube_pod_status_phase{phase="Failed"})'
// Cluster CPU/mem usage — fraction of allocatable consumed.
const Q_CLUSTER_CPU = 'sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(machine_cpu_cores)'
const Q_CLUSTER_MEM = '1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)'
// Milvus collection / pgvector row counters. The previous `or vector(0)`
// suffix here was a bug — it made promScalar return 0 when no exporter
// existed, which short-circuited the `?? storage.data?...` fallback and
// pinned the KPI to "0 collections" even when the api had real counts.
// Letting the query return an empty vector keeps promScalar undefined so
// the storage-endpoint fallback engages cleanly. Audit 2026-05-13.
const Q_MILVUS_COLLECTIONS = 'sum(milvus_collection_count)'
const Q_PGVECTOR_ROWS = 'sum(pg_stat_user_tables_n_live_tup{relname=~".*vector.*|.*embedding.*"})'

function promScalar(samples: PromSample[] | undefined): number | undefined {
  if (!samples || samples.length === 0) return undefined
  const v = samples[0]?.value?.[1]
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const InfraPane = () => {
  const nodesReady = usePromInstant(Q_NODES_READY)
  const podsRunning = usePromInstant(Q_PODS_RUNNING)
  const podsPending = usePromInstant(Q_PODS_PENDING)
  const podsFailed = usePromInstant(Q_PODS_FAILED)
  const cpuUtil = usePromInstant(Q_CLUSTER_CPU)
  const memUtil = usePromInstant(Q_CLUSTER_MEM)
  const milvusCol = usePromInstant(Q_MILVUS_COLLECTIONS)
  const pgvecRows = usePromInstant(Q_PGVECTOR_ROWS)
  // Aggregate fallbacks via the api so we still render numbers when the
  // direct prom-proxy path fails (e.g. NetworkPolicy missing egress).
  const cluster = useClusterHealth()
  const storage = useStorage()
  const promHealth = usePromHealth()

  const nodes = promScalar(nodesReady.data) ?? cluster.data?.nodes?.ready
  const running = promScalar(podsRunning.data) ?? cluster.data?.pods?.running
  const pending = promScalar(podsPending.data) ?? cluster.data?.pods?.pending
  const failed = promScalar(podsFailed.data) ?? cluster.data?.pods?.failed
  const cpuRaw = promScalar(cpuUtil.data)
  const memRaw = promScalar(memUtil.data)
  // Direct prom returns 0..1; cluster/health returns 0..100. Normalize to 0..1.
  const cpuPct = cpuRaw != null ? cpuRaw : (cluster.data?.cpu?.used_pct != null ? cluster.data.cpu.used_pct / 100 : undefined)
  const memPct = memRaw != null ? memRaw : (cluster.data?.memory?.used_pct != null ? cluster.data.memory.used_pct / 100 : undefined)
  const milvusCount = promScalar(milvusCol.data) ?? storage.data?.milvus?.collections
  const pgvecCount = promScalar(pgvecRows.data) ?? storage.data?.pgvector?.total_rows
  const milvusVectors = storage.data?.milvus?.total_vectors
  const redisKeys = storage.data?.redis?.keys
  const redisMemMb = storage.data?.redis?.memory_mb

  // Show the prom-unreachable banner only when EVERY signal source errors
  // (direct prom-proxy queries + the aggregate /cluster/health endpoint).
  const directPromAllError =
    nodesReady.isError && podsRunning.isError && cpuUtil.isError && memUtil.isError
  const promUnreachable = directPromAllError && (cluster.isError || cluster.data?.success === false)

  return (
    <>
      {promUnreachable && (
        <Banner level="err" label="prometheus unreachable">
          Cluster Health unavailable — Prometheus proxy returned an error.{' '}
          {promHealth.data?.error ? <>Reason: <span className="accent">{promHealth.data.error}</span>. </> : ''}
          Check that <span className="accent">monitoring-stack/prometheus</span> is healthy and the api{' '}
          <span className="accent">NetworkPolicy</span> allows egress to it.
        </Banner>
      )}
      <KpiGrid cols={6}>
        <Kpi label="nodes ready" value={loadingValue(nodesReady.isLoading && cluster.isLoading, nodes != null ? String(Math.round(nodes)) : '—')} />
        <Kpi
          label="pods running"
          value={loadingValue(podsRunning.isLoading && cluster.isLoading, running != null ? String(Math.round(running)) : '—')}
          sub={pending != null || failed != null ? `${Math.round(pending ?? 0)} pending · ${Math.round(failed ?? 0)} failed` : ''}
          tone={(failed ?? 0) > 0 ? 'err' : (pending ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <Kpi label="cluster cpu" value={loadingValue(cpuUtil.isLoading && cluster.isLoading, cpuPct != null ? fmtPct(cpuPct * 100) : '—')} tone={cpuPct != null && cpuPct > 0.85 ? 'warn' : undefined} />
        <Kpi label="cluster mem" value={loadingValue(memUtil.isLoading && cluster.isLoading, memPct != null ? fmtPct(memPct * 100) : '—')} tone={memPct != null && memPct > 0.85 ? 'warn' : undefined} />
        <Kpi label="milvus collections" value={loadingValue(milvusCol.isLoading && storage.isLoading, milvusCount != null ? fmtNum(milvusCount) : '—')} tone={milvusCount === 0 ? 'dim' : undefined} sub={milvusVectors != null ? `${fmtNum(milvusVectors)} vectors` : (milvusCount === 0 ? 'no exporter' : '')} />
        <Kpi label="pgvector rows" value={loadingValue(pgvecRows.isLoading && storage.isLoading, pgvecCount != null ? fmtNum(pgvecCount) : '—')} tone={pgvecCount === 0 ? 'dim' : undefined} sub={pgvecCount === 0 ? 'no exporter' : ''} />
      </KpiGrid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="cluster utilization" />
          {(cpuUtil.isLoading || memUtil.isLoading) && cluster.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!cluster.isLoading && cpuPct == null && memPct == null && (
            <EmptyInline pad>no Prometheus signal</EmptyInline>
          )}
          {(cpuPct != null || memPct != null) && (
            <BarList
              items={[
                ...(cpuPct != null ? [{ name: 'cpu', value: Math.round(cpuPct * 100), display: fmtPct(cpuPct * 100) } as BarItem] : []),
                ...(memPct != null ? [{ name: 'mem', value: Math.round(memPct * 100), display: fmtPct(memPct * 100) } as BarItem] : []),
              ]}
            />
          )}
        </Panel>
        <Panel>
          <PanelHead title="storage" right={storage.data?.redis?.error ? <span className="dim">redis: {storage.data.redis.error}</span> : undefined} />
          {storage.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!storage.isLoading && (
            <BarList
              items={[
                { name: 'milvus collections', value: milvusCount ?? 0, display: milvusCount != null ? fmtNum(milvusCount) : '—' } as BarItem,
                { name: 'milvus vectors', value: milvusVectors ?? 0, display: milvusVectors != null ? fmtNum(milvusVectors) : '—' } as BarItem,
                { name: 'pgvector rows', value: pgvecCount ?? 0, display: pgvecCount != null ? fmtNum(pgvecCount) : '—' } as BarItem,
                { name: 'redis keys', value: redisKeys ?? 0, display: redisKeys != null ? fmtNum(redisKeys) : '—' } as BarItem,
                ...(redisMemMb != null ? [{ name: 'redis mem (mb)', value: redisMemMb, display: redisMemMb.toFixed(2) } as BarItem] : []),
              ]}
            />
          )}
        </Panel>
      </Grid>
    </>
  )
}

/* ============================================================
   8. PERFORMANCE
   ============================================================ */
const PerformancePane = ({ metrics }: PaneProps) => {
  const summary = metrics.data?.summary
  const apiSeries = metrics.data?.timeSeries?.apiRequests
  const tokenSeries = metrics.data?.timeSeries?.tokenUsage
  const period = metrics.data?.period
  const callsPerMin = calcPerMin(summary?.totalMcpCalls, period?.start, period?.end)
  const costPerKReq = summary && summary.totalApiRequests > 0
    ? (summary.totalCost / summary.totalApiRequests) * 1000
    : undefined
  const percentiles = usePerfPercentiles('24h')
  const throughput = usePerfThroughput('24h')

  return (
    <>
      <KpiGrid cols={6}>
        <Kpi label="total queries 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalApiRequests))} />
        <Kpi label="total tokens" value={loadingValue(metrics.isLoading, fmtTokens(summary?.totalTokens))} />
        <Kpi label="total cost" value={loadingValue(metrics.isLoading, fmtUsd(summary?.totalCost))} sub={costPerKReq != null ? `${fmtUsd(costPerKReq)} / 1k req` : ''} />
        <Kpi label="mcp calls/min" value={callsPerMin} />
        <Kpi label="avg response" value={loadingValue(metrics.isLoading, fmtMs(summary?.apiAvgResponseTime))} />
        <Kpi label="error rate" value={loadingValue(metrics.isLoading, fmtPct(summary?.apiErrorRate))} tone={typeof summary?.apiErrorRate === 'number' && summary.apiErrorRate > 1 ? 'warn' : 'ok'} />
      </KpiGrid>

      <Grid cols={2}>
        <Panel>
          <PanelHead title="requests over time" count="24h" right={<a>{fmtNum(summary?.totalApiRequests)} total</a>} />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (apiSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(apiSeries)}
                series={[{ name: 'requests', data: tsToValues(apiSeries), color: 'accent' }]}
              />
            </div>
          )}
          {metrics.data && (apiSeries?.length ?? 0) === 0 && <EmptyInline pad>no api requests in window</EmptyInline>}
        </Panel>
        <Panel>
          <PanelHead title="tokens over time" count="24h" right={<a>{fmtTokens(summary?.totalTokens)} total</a>} />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (tokenSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat="tok"
                xLabels={tsToLabels(tokenSeries)}
                series={[{ name: 'tokens', data: tsToValues(tokenSeries), color: 'warn' }]}
              />
            </div>
          )}
          {metrics.data && (tokenSeries?.length ?? 0) === 0 && <EmptyInline pad>no tokens in window</EmptyInline>}
        </Panel>
      </Grid>

      <Grid cols={2}>
        <Panel>
          <PanelHead title="latency percentiles" count={percentiles.data?.rows?.length ?? 0} right={percentiles.data?.source ? <span className="dim">{percentiles.data.source}</span> : undefined} />
          {percentiles.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {percentiles.isError && (
            <Banner level="err" label="error">failed to fetch /api/admin/perf/percentiles</Banner>
          )}
          {!percentiles.isLoading && !percentiles.isError && (percentiles.data?.rows?.length ?? 0) === 0 && (
            <EmptyInline pad>no latency samples in window</EmptyInline>
          )}
          {!percentiles.isLoading && !percentiles.isError && (percentiles.data?.rows?.length ?? 0) > 0 && (
            <Dt
              columns={PERCENTILE_COLS}
              rows={percentiles.data!.rows.slice(0, 12)}
              rowKey={(r) => r.endpoint}
            />
          )}
        </Panel>
        <Panel>
          <PanelHead
            title="throughput & concurrency"
            count={throughput.data?.sample != null ? `${throughput.data.sample} samples` : undefined}
            right={throughput.data?.source ? <span className="dim">{throughput.data.source}</span> : undefined}
          />
          {throughput.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {throughput.isError && (
            <Banner level="err" label="error">failed to fetch /api/admin/perf/throughput</Banner>
          )}
          {!throughput.isLoading && !throughput.isError && throughput.data && (throughput.data.sample ?? 0) === 0 && (
            <EmptyInline pad>no llm requests in window</EmptyInline>
          )}
          {!throughput.isLoading && !throughput.isError && throughput.data && (throughput.data.sample ?? 0) > 0 && (
            <KpiGrid cols={3}>
              <Kpi
                label="tokens/sec avg"
                value={fmtNum(throughput.data.tokens_per_sec_avg)}
                sub="per request"
              />
              <Kpi
                label="tokens/sec p95"
                value={fmtNum(throughput.data.tokens_per_sec_p95)}
                sub="per request"
              />
              <Kpi
                label="max concurrency"
                value={fmtNum(throughput.data.max_concurrency)}
                sub="in-flight peak"
              />
            </KpiGrid>
          )}
        </Panel>
      </Grid>
    </>
  )
}

const PERCENTILE_COLS: DtCol<PerfPercentileRow>[] = [
  { key: 'endpoint', label: 'endpoint', className: 'mono' as any, render: (r) => r.endpoint },
  { key: 'p50', label: 'p50', className: 'num', render: (r) => fmtMs(r.p50) },
  { key: 'p95', label: 'p95', className: 'num', render: (r) => fmtMs(r.p95) },
  { key: 'p99', label: 'p99', className: 'num', render: (r) => fmtMs(r.p99) },
  { key: 'count', label: 'count', className: 'num', render: (r) => r.count.toLocaleString() },
]

/* ============================================================
   9. OPENAGENTIC CLI
   ============================================================ */
const OpenagenticPane = ({ metrics }: PaneProps) => {
  const summary = metrics.data?.summary
  const codeSeries = metrics.data?.timeSeries?.codeTokenUsage
  const codeSessSeries = metrics.data?.timeSeries?.codeSessions
  const costPerSession = summary && summary.totalCodeSessions > 0
    ? summary.totalCodeCost / summary.totalCodeSessions
    : undefined
  const apiKeys = useOpenagenticApiKeys()

  return (
    <>
      <KpiGrid cols={5}>
        <Kpi label="code sessions 24h" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalCodeSessions))} sub={summary?.totalCodeSessions === 0 ? 'no sessions' : ''} tone={summary?.totalCodeSessions === 0 ? 'dim' : undefined} />
        <Kpi label="code messages" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalCodeMessages))} />
        <Kpi label="code tokens" value={loadingValue(metrics.isLoading, fmtTokens(summary?.totalCodeTokens))} />
        <Kpi label="code cost" value={loadingValue(metrics.isLoading, fmtUsd(summary?.totalCodeCost))} sub={costPerSession != null ? `${fmtUsd(costPerSession)} / session avg` : ''} />
        <Kpi label="active api keys" value={loadingValue(apiKeys.isLoading, fmtNum(apiKeys.data?.count ?? apiKeys.data?.keys?.length))} sub={apiKeys.data?.keys?.length === 0 ? 'none issued' : ''} tone={apiKeys.data?.keys?.length === 0 ? 'dim' : undefined} />
      </KpiGrid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="code sessions over time" count="24h" />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (codeSessSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat={(v) => v.toFixed(0)}
                xLabels={tsToLabels(codeSessSeries)}
                series={[{ name: 'sessions', data: tsToValues(codeSessSeries), color: 'info' }]}
              />
            </div>
          )}
          {metrics.data && (codeSessSeries?.length ?? 0) === 0 && <EmptyInline pad>no code-mode sessions in window</EmptyInline>}
        </Panel>
        <Panel>
          <PanelHead title="code-mode tokens over time" count="24h" />
          {!metrics.data && <EmptyInline pad>loading…</EmptyInline>}
          {metrics.data && (codeSeries?.length ?? 0) > 0 && (
            <div style={{ padding: 8 }}>
              <MetricChart
                variant="area"
                yFormat="tok"
                xLabels={tsToLabels(codeSeries)}
                series={[{ name: 'tokens', data: tsToValues(codeSeries), color: 'accent' }]}
              />
            </div>
          )}
          {metrics.data && (codeSeries?.length ?? 0) === 0 && <EmptyInline pad>no code tokens in window</EmptyInline>}
        </Panel>
      </Grid>
      <Panel>
        <PanelHead title="cli usage by api key" count={apiKeys.data?.count ?? apiKeys.data?.keys?.length ?? 0} />
        {apiKeys.isLoading && <EmptyInline pad>loading…</EmptyInline>}
        {apiKeys.isError && (
          <Banner level="err" label="error">failed to fetch /api/admin/openagentic/api-keys</Banner>
        )}
        {!apiKeys.isLoading && !apiKeys.isError && (apiKeys.data?.keys?.length ?? 0) === 0 && (
          <EmptyInline pad>no active api keys issued</EmptyInline>
        )}
        {!apiKeys.isLoading && !apiKeys.isError && (apiKeys.data?.keys?.length ?? 0) > 0 && (
          <Dt
            columns={OPENAGENTIC_KEY_COLS}
            rows={apiKeys.data!.keys}
            rowKey={(r) => r.id}
          />
        )}
      </Panel>
    </>
  )
}

const OPENAGENTIC_KEY_COLS: DtCol<OpenagenticApiKeyRow>[] = [
  { key: 'name', label: 'name', className: 'name', render: (r) => r.name },
  { key: 'owner', label: 'owner', className: 'mono dim' as any, render: (r) => r.owner },
  { key: 'prefix', label: 'prefix', className: 'mono' as any, width: '90px', render: (r) => r.prefix ?? '—' },
  { key: 'tier', label: 'tier', className: 'mono' as any, width: '80px', render: (r) => r.rateLimitTier ?? '—' },
  { key: 'lastUsed', label: 'last used', className: 'mono' as any, width: '100px', render: (r) => r.lastUsed ? `${shortRelative(r.lastUsed)} ago` : 'never' },
  { key: 'created', label: 'created', className: 'mono dim' as any, width: '100px', render: (r) => `${shortRelative(r.createdAt)} ago` },
]

/* ============================================================
   10. USER ANALYTICS
   ============================================================ */
const UserAnalyticsPane = ({ metrics, onDrill }: PaneProps & { onDrill: DrillFn }) => {
  const summary = metrics.data?.summary
  const perUser = metrics.data?.perUserUsage ?? []
  const modelUsage = metrics.data?.modelUsage ?? []

  const sysModelRows: SysModelRow[] = modelUsage.slice(0, 10).map((m, i) => ({
    rank: i + 1,
    model: m.model,
    reqs: fmtNum(m.count),
    spend: fmtUsd(m.cost),
    per: m.count > 0 ? `$${(m.cost / m.count).toFixed(4)}` : '—',
    fill: modelUsage[0]?.cost ? Math.round((m.cost / modelUsage[0].cost) * 100) : 0,
    raw: m,
  }))

  const userBreakdownRows: UserBreakdownRow[] = perUser.slice(0, 20).map((u) => ({
    user: u.displayName || u.email,
    email: u.email,
    spend: fmtUsd(u.cost),
    reqs: fmtNum(u.messages),
    tokens: fmtTokens(u.tokens),
    per: u.messages > 0 ? `$${(u.cost / u.messages).toFixed(4)}` : '—',
    last: shortRelative(u.lastActive) + ' ago',
    raw: u,
  }))

  const avgCostPerReq = summary && summary.totalApiRequests > 0
    ? summary.totalCost / summary.totalApiRequests
    : undefined

  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="total spend 24h" value={loadingValue(metrics.isLoading, fmtUsd(summary?.totalCost))} sub={`${perUser.length} active users`} />
        <Kpi label="total messages" value={loadingValue(metrics.isLoading, fmtNum(summary?.totalMessages))} />
        <Kpi label="active users" value={loadingValue(metrics.isLoading, fmtNum(summary?.activeUsers))} sub={`of ${fmtNum(summary?.totalUsers)} registered`} />
        <Kpi label="avg cost / req" value={loadingValue(metrics.isLoading, avgCostPerReq != null ? `$${avgCostPerReq.toFixed(4)}` : '—')} />
      </KpiGrid>
      <Panel>
        <PanelHead title="top models · system-wide" count={`${sysModelRows.length} ranked by spend`} />
        {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
        {!metrics.isLoading && sysModelRows.length === 0 && <EmptyInline pad>no model usage in window</EmptyInline>}
        {!metrics.isLoading && sysModelRows.length > 0 && (
          <Dt
            columns={SYS_MODEL_COLS}
            rows={sysModelRows}
            rowKey={(r) => r.model}
            onRowDoubleClick={(r) => onDrill({ kind: 'model', name: r.model, row: r.raw })}
          />
        )}
      </Panel>
      <Panel>
        <PanelHead title="per-user cost breakdown" count={`${userBreakdownRows.length} users · double-click to drill`} />
        {metrics.isLoading && <EmptyInline pad>loading…</EmptyInline>}
        {!metrics.isLoading && userBreakdownRows.length === 0 && <EmptyInline pad>no user activity in window</EmptyInline>}
        {!metrics.isLoading && userBreakdownRows.length > 0 && (
          <Dt
            columns={USER_BREAKDOWN_COLS}
            rows={userBreakdownRows}
            rowKey={(r) => r.email || r.user}
            onRowDoubleClick={(r) => onDrill({ kind: 'user', name: r.user, row: r.raw })}
          />
        )}
      </Panel>
    </>
  )
}

type SysModelRow = { rank: number; model: string; reqs: string; spend: string; per: string; fill: number; raw: ModelUsageRow }
const SYS_MODEL_COLS: DtCol<SysModelRow>[] = [
  { key: 'rank', label: '#', className: 'num dim' as any, render: (r) => r.rank },
  { key: 'model', label: 'model', className: 'name mono' as any, render: (r) => r.model },
  { key: 'reqs', label: 'requests', className: 'num', render: (r) => r.reqs },
  { key: 'spend', label: 'spend', className: 'num', render: (r) => r.spend },
  { key: 'per', label: 'cost / req', className: 'num', render: (r) => r.per },
  { key: 'fill', label: 'fill', render: (r) => <span style={{ display: 'inline-block', width: 60, height: 5, background: 'var(--bg-3)', position: 'relative' }}><span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: 'var(--accent)', width: `${r.fill}%` }} /></span> },
]

type UserBreakdownRow = { user: string; email: string; spend: string; reqs: string; tokens: string; per: string; last: string; raw: PerUserUsageRow }
const USER_BREAKDOWN_COLS: DtCol<UserBreakdownRow>[] = [
  { key: 'user', label: 'user', className: 'name', render: (r) => r.user },
  { key: 'email', label: 'email', className: 'mono dim' as any, render: (r) => r.email },
  { key: 'spend', label: 'spend', className: 'num', render: (r) => r.spend },
  { key: 'reqs', label: 'messages', className: 'num', render: (r) => r.reqs },
  { key: 'tokens', label: 'tokens', className: 'num', render: (r) => r.tokens },
  { key: 'per', label: '$ / msg', className: 'num', render: (r) => r.per },
  { key: 'last', label: 'last active', className: 'mono' as any, render: (r) => r.last },
]

/* ============================================================
   11. ROUTER HEALTH
   ============================================================ */
const RouterHealthPane = () => {
  const decisionsQ = useRouterDecisions(200)
  const tuningQ = useRouterTuning()
  const escalationsQ = useRouterEscalationTriggers('24h')
  const registryQ = useLlmRegistry(false)

  // Resolve chosen-model rows into { id → priority } so we can compute
  // the frontier % (decisions hitting a P0/P1 model). Use the registry
  // (provides priority) joined on either model name or model id.
  const priorityMap = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const r of registryQ.data ?? []) {
      const key = (r.model ?? '').toLowerCase()
      if (key) m.set(key, r.priority)
      const idKey = (r.id ?? '').toLowerCase()
      if (idKey) m.set(idKey, r.priority)
    }
    return m
  }, [registryQ.data])

  const decisions = (decisionsQ.data?.decisions ?? decisionsQ.data?.logs ?? []) as RouterDecisionEntry[]
  const decisions24h = decisions.length
  const cutoff1h = Date.now() - 3600_000
  const cutoff24h = Date.now() - 86400_000
  const decisionsLast24h = decisions.filter((d) => {
    if (!d.timestamp) return false
    const t = new Date(d.timestamp).getTime()
    return Number.isFinite(t) && t >= cutoff24h
  })

  // Frontier % — decisions whose chosen model has registry priority <= 1.
  // Only count decisions where we can resolve a priority — otherwise the
  // ratio gets distorted by unknown rows.
  const { frontier, resolvable } = React.useMemo(() => {
    let f = 0
    let r = 0
    for (const d of decisionsLast24h) {
      const id = (d.chosenModel ?? d.selectedModelId ?? '').toLowerCase()
      if (!id) continue
      const p = priorityMap.get(id)
      if (typeof p !== 'number') continue
      r += 1
      if (p <= 1) f += 1
    }
    return { frontier: r > 0 ? (f / r) * 100 : undefined, resolvable: r }
  }, [decisionsLast24h, priorityMap])

  // Decision-overhead p95 — taken from per-decision `latencyMs` when
  // emitted (router pipeline overhead, not provider latency).
  const overheadP95 = React.useMemo(() => {
    const lats = decisionsLast24h
      .map((d) => d.latencyMs)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b)
    if (lats.length === 0) return undefined
    return lats[Math.min(lats.length - 1, Math.floor(lats.length * 0.95))]
  }, [decisionsLast24h])

  // Tier-bucketed routing decisions (frontier / balanced / cheap / other).
  const decisionsByTier = React.useMemo(() => {
    const agg = new Map<string, number>()
    for (const d of decisionsLast24h) {
      const id = (d.chosenModel ?? d.selectedModelId ?? '').toLowerCase()
      const p = id ? priorityMap.get(id) : undefined
      const bucket =
        p == null ? 'other' :
        p <= 1 ? 'frontier' :
        p === 2 ? 'balanced' : 'cheap'
      agg.set(bucket, (agg.get(bucket) ?? 0) + 1)
    }
    return [...agg.entries()]
      .map(([name, value]) => ({ name, value, display: value.toLocaleString() } as BarItem))
      .sort((a, b) => b.value - a.value)
  }, [decisionsLast24h, priorityMap])

  // Tuning changes 1h — counted via lastUpdatedAt heuristic. The
  // RouterTuningService only exposes the most-recent timestamp;
  // surface a binary "1 in last hour" / "0 in last hour" rather than
  // fabricating a count we don't have.
  const tuningRecentlyChanged =
    typeof tuningQ.data?.lastUpdatedAt === 'string' &&
    new Date(tuningQ.data.lastUpdatedAt).getTime() >= cutoff1h
  const tuningChangesLabel = tuningQ.isLoading
    ? '…'
    : tuningRecentlyChanged ? '≥1' : '0'

  // Recent decisions table (top 12).
  const recentRows = decisionsLast24h.slice(0, 12)

  return (
    <>
      {decisionsQ.isError && (
        <Banner level="err" label="error">
          failed to fetch <span className="accent">/api/admin/router/decisions</span>
        </Banner>
      )}
      <KpiGrid cols={5}>
        <Kpi label="routing decisions 24h" value={loadingValue(decisionsQ.isLoading, fmtNum(decisionsLast24h.length))} sub={decisions24h > 0 && decisionsLast24h.length === 0 ? 'none in window' : ''} />
        <Kpi label="frontier %" value={loadingValue(decisionsQ.isLoading, fmtPct(frontier))} sub={resolvable > 0 ? `${resolvable} resolvable` : 'no priority data'} tone={resolvable === 0 ? 'dim' : undefined} />
        <Kpi label="decision overhead p95" value={loadingValue(decisionsQ.isLoading, fmtMs(overheadP95))} sub={overheadP95 == null && decisionsLast24h.length > 0 ? 'no latencyMs emitted' : ''} tone={overheadP95 == null && decisionsLast24h.length > 0 ? 'dim' : undefined} />
        {/* Decision cache hits: no cache-hit counter is emitted in
            modelRoutingDecision rows.  Surface as dim '—' until the
            router emits a hit/miss flag. */}
        <Kpi label="decision cache hits" value="—" sub="no flag in row" tone="dim" />
        <Kpi label="tuning changes 1h" value={tuningChangesLabel} sub={tuningQ.data?.lastUpdatedAt ? `last: ${shortRelative(tuningQ.data.lastUpdatedAt)} ago` : 'never updated'} tone={!tuningRecentlyChanged ? 'dim' : undefined} />
      </KpiGrid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="routing decisions by tier" count={decisionsByTier.length > 0 ? decisionsByTier.reduce((s, b) => s + b.value, 0) : '—'} />
          {decisionsQ.isLoading && <EmptyInline pad>loading…</EmptyInline>}
          {!decisionsQ.isLoading && decisionsByTier.length === 0 && (
            <EmptyInline pad>no decisions captured in window</EmptyInline>
          )}
          {!decisionsQ.isLoading && decisionsByTier.length > 0 && <BarList items={decisionsByTier} />}
        </Panel>
        <Panel>
          <PanelHead
            title="escalation triggers"
            count={escalationsQ.data?.triggers?.length ?? '—'}
            right={escalationsQ.data?.source ? <span className="dim">{escalationsQ.data.source}</span> : undefined}
          />
          {/* Server-side bucketing across the 24h window via
              /api/admin/router/escalation-triggers (model_routing_decisions
              with context.escalated=true OR a model_from→model_to delta).
              Falls back to bucketing the in-memory `decisionsLast24h` set
              when the endpoint is empty (no rows). */}
          {(() => {
            if (escalationsQ.isLoading) return <EmptyInline pad>loading…</EmptyInline>
            if (escalationsQ.isError) {
              return <Banner level="err" label="error">failed to fetch /api/admin/router/escalation-triggers</Banner>
            }
            const serverTriggers = escalationsQ.data?.triggers ?? []
            if (serverTriggers.length > 0) {
              const items = serverTriggers.slice(0, 12).map((t) => ({
                name: t.trigger,
                value: t.count,
                display: t.count.toLocaleString(),
              } as BarItem))
              return <BarList items={items} />
            }
            // Fallback: bucket the in-memory recent decisions by reason keyword
            const buckets = new Map<string, number>()
            for (const d of decisionsLast24h) {
              const reason = (d.reason ?? '').toLowerCase()
              if (!reason) continue
              if (reason.includes('escalat')) buckets.set('escalation', (buckets.get('escalation') ?? 0) + 1)
              else if (reason.includes('fallback')) buckets.set('fallback', (buckets.get('fallback') ?? 0) + 1)
              else if (reason.includes('retry')) buckets.set('retry', (buckets.get('retry') ?? 0) + 1)
            }
            const items = [...buckets.entries()]
              .map(([name, value]) => ({ name, value, display: value.toLocaleString() } as BarItem))
              .sort((a, b) => b.value - a.value)
            if (items.length === 0) {
              return (
                <EmptyInline pad>
                  no escalation triggers in window — {decisionsLast24h.length} decisions, none flagged
                </EmptyInline>
              )
            }
            return <BarList items={items} />
          })()}
        </Panel>
      </Grid>
      <Panel>
        <PanelHead title="recent decisions" count={recentRows.length} right={<a className="accent">view all in router tuning →</a>} />
        {decisionsQ.isLoading && <EmptyInline pad>loading…</EmptyInline>}
        {!decisionsQ.isLoading && recentRows.length === 0 && (
          <EmptyInline pad>no decisions captured in window</EmptyInline>
        )}
        {!decisionsQ.isLoading && recentRows.length > 0 && (
          <Dt
            columns={ROUTER_DECISION_COLS}
            rows={recentRows}
            rowKey={(r, i) => r.id ?? r.timestamp ?? String(i)}
          />
        )}
      </Panel>
      <SectionBar title="current tuning values" right={<a className="accent">edit in router tuning →</a>} />
      {tuningQ.isLoading && <EmptyInline pad>loading…</EmptyInline>}
      {!tuningQ.isLoading && !tuningQ.data?.tuning && (
        <EmptyInline pad>no tuning values set</EmptyInline>
      )}
      {!tuningQ.isLoading && tuningQ.data?.tuning && (
        <KpiGrid cols={6}>
          <Kpi label="cost weight" value={String(tuningQ.data.tuning.costWeight)} />
          <Kpi label="quality weight" value={String(tuningQ.data.tuning.qualityWeight)} />
          <Kpi label="FCA quality floor" value={String(tuningQ.data.tuning.fcaQualityFloor)} />
          <Kpi label="FCA chat floor" value={String(tuningQ.data.tuning.fcaChatPoolFloor)} />
          <Kpi label="FCA destructive floor" value={String(tuningQ.data.tuning.fcaDestructiveFloor)} />
          <Kpi label="intent classifier" value={tuningQ.data.tuning.intentClassifierEnabled ? 'on' : 'off'} sub={tuningQ.data.tuning.intentClassifierModelId || ''} tone={tuningQ.data.tuning.intentClassifierEnabled ? 'ok' : 'dim'} />
        </KpiGrid>
      )}
    </>
  )
}

const ROUTER_DECISION_COLS: DtCol<RouterDecisionEntry>[] = [
  { key: 'when', label: 'when', className: 'mono dim' as any, width: '70px', render: (r) => r.timestamp ? shortRelative(r.timestamp) : '—' },
  { key: 'tier', label: 'tier', className: 'mono' as any, width: '90px', render: (r) => r.tier ?? '—' },
  { key: 'model', label: 'model', className: 'name mono' as any, render: (r) => r.chosenModel ?? r.selectedModelId ?? '—' },
  { key: 'resolved', label: 'resolved by', className: 'dim' as any, render: (r) => r.resolvedBy ?? '—' },
  { key: 'fca', label: 'FCA', className: 'num', width: '60px', render: (r) => typeof r.fca === 'number' ? `${r.fca.toFixed(2)}` : '—' },
  { key: 'lat', label: 'overhead', className: 'num', width: '80px', render: (r) => typeof r.latencyMs === 'number' ? fmtMs(r.latencyMs) : '—' },
  { key: 'prompt', label: 'prompt', className: 'dim' as any, render: (r) => r.prompt ? (r.prompt.length > 60 ? `${r.prompt.slice(0, 60)}…` : r.prompt) : '—' },
]
