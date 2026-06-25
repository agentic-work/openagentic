/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * tools.tsx — the admin v4 "Tools & MCP" domain page bodies, at mock fidelity
 * (the admin-console mock PAGES['mcp-fleet'] + invSet specs) and
 * WIRED to real admin endpoints. Three leaves:
 *
 *   mcp-fleet        → GET /api/admin/mcp/servers (DB ∪ live status + toolCount)
 *                      + the derived fleet-health select + scoped MCPServer audit
 *                      + dashboard mcpToolUsage for the Tools pane.
 *   enriched-tools   → GET /api/admin/enriched-tools ({ success, tools, count }).
 *   skills-ecosystem → GET /api/admin/skills (skills), /skills/repos (sources),
 *                      /skills/metrics (per-skill invocations).
 *
 * Contract (every leaf):
 *   - renders ONLY the page BODY (PageHead + content); AdminConsole appends the
 *     OptionSpec (the two-part leaf contract),
 *   - every number comes from a live hook or renders an honest "—" / empty-state
 *     Banner — NEVER a fabricated value or invented row,
 *   - every color resolves via a global theme token (var(--*)); zero hex,
 *   - unknown payloads are stringified before they reach a JSX child (no React
 *     #31), loading + error states are honest.
 */
import * as React from 'react'
import {
  Banner,
  DataTable,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  StatusDot,
  TabsBar,
  Tag,
  Toggle,
  type DtColumn,
  type Kpi,
  type TabItem,
} from '../primitives'
import type { LeafPageProps } from './registry'
import type { Tone } from '../types'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import {
  useMcpFleetHealth,
  useMcpServers,
  useScopedAuditLogs,
  useDashboardMetrics,
  useDashboardStructuralCounts,
  type McpServerRow,
  type AuditLogEntry,
  type McpToolUsageRow,
} from '../../hooks/useDashboardMetrics'

/**
 * DataTable<T> constrains T to `Record<string, unknown>`; the typed admin row
 * interfaces (optional fields) don't structurally satisfy that index
 * constraint, so we widen with a local alias and cast the row arrays once at
 * each call site. Purely a typing convenience — no runtime shape change.
 * (Same pattern as pages/agents.tsx.)
 */
type DtRow<T> = T & Record<string, unknown>

/* ============================================================
   format helpers — honest "—" on missing (mirror HomePage)
   ============================================================ */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function feedTime(ts: string | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
}
function relTime(ts: string | undefined | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
/** Coerce any unknown payload to a string so it never lands as a JSX child. */
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

/* ---- MCP server status → tone + label (mock parity) ---- */
function serverStatus(s: McpServerRow): string {
  return (s.status ?? s.health ?? 'unknown').toString().toLowerCase()
}
function statusTone(status: string): Tone {
  if (['healthy', 'connected', 'running', 'ok'].includes(status)) return 'ok'
  if (['degraded', 'warn', 'warning'].includes(status)) return 'warn'
  if (['down', 'failed', 'error', 'err'].includes(status)) return 'err'
  return 'muted'
}
function statusLabel(status: string): string {
  const tone = statusTone(status)
  return tone === 'ok' ? 'healthy' : tone === 'warn' ? 'degraded' : tone === 'err' ? 'down' : 'unknown'
}

/* ============================================================
   LEAF 1 — MCP Fleet  (mcp-fleet · tf)
   MCP fleet table + topology (healthy/degraded/down).
   ============================================================ */
type FleetTab = 'overview' | 'health' | 'tools' | 'activity'

function McpFleetPage(_props: LeafPageProps) {
  const serversQ = useMcpServers()
  const health = useMcpFleetHealth()
  const metrics = useDashboardMetrics('24h')
  const structural = useDashboardStructuralCounts()
  const audit = useScopedAuditLogs({ resourceType: 'MCPServer', limit: 50 })
  const [tab, setTab] = React.useState<FleetTab>('overview')

  const raw = serversQ.data
  const servers: McpServerRow[] = Array.isArray(raw) ? raw : (raw?.servers ?? [])
  const total = health.data?.totalServers ?? (servers.length || undefined)
  const healthy = health.data?.healthyServers ?? 0
  const degraded = health.data?.degraded ?? 0
  const down = health.data?.down ?? 0
  // Prefer the REAL indexed-tool count from /dashboard/counts (the mcp_tools
  // table, ~352 on a fresh box). The per-server toolCount sum is often 0 on
  // the fleet endpoint, so fall back to it only when the structural count is
  // absent — never show a blank where the real catalog size is known.
  const perServerTools = health.data?.toolsIndexed
  const toolsIndexed =
    structural.data?.mcpTools != null && structural.data.mcpTools > 0
      ? structural.data.mcpTools
      : perServerTools
  const calls24h = servers.reduce((a, s) => a + (s.callsPerHour ?? 0) * 24, 0)
  const haveCalls = servers.some((s) => s.callsPerHour != null)

  const kpis: Kpi[] = [
    {
      label: 'Total servers',
      val: total != null ? total : '—',
      tone: 'accent',
      sub: total != null ? `${healthy} healthy · ${degraded + down} attention` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Health',
      val: total != null ? `${healthy} / ${degraded} / ${down}` : '—',
      tone: down > 0 ? 'err' : degraded > 0 ? 'warn' : 'ok',
      sub: 'healthy · degraded · down',
      deltaDir: 'flat',
    },
    {
      label: 'Tools indexed',
      val: toolsIndexed != null ? fmtNum(toolsIndexed) : '—',
      tone: 'info',
      deltaDir: 'flat',
    },
    {
      label: 'Calls (24h)',
      val: haveCalls ? fmtNum(calls24h) : '—',
      tone: 'accent',
      deltaDir: 'flat',
    },
  ]

  /* ---- servers table (Overview) ---- */
  const serverCols: DtColumn<DtRow<McpServerRow>>[] = [
    {
      label: 'Server',
      val: (r) => r.displayName ?? r.name ?? r.id ?? '',
      render: (r) => (
        <div>
          <span className="awc-name">{r.displayName ?? r.name ?? r.id ?? '—'}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {(r.id ?? '—') + (r.tier ? ' · ' + r.tier : '')}
          </div>
        </div>
      ),
    },
    {
      label: 'Status',
      val: (r) => serverStatus(r),
      render: (r) => {
        const st = serverStatus(r)
        return (
          <Pill tone={statusTone(st)} dot>
            {statusLabel(st)}
          </Pill>
        )
      },
    },
    { label: 'Tools', r: true, val: (r) => r.toolCount ?? 0, render: (r) => (r.toolCount != null ? r.toolCount : '—') },
    {
      label: 'Calls (24h)',
      r: true,
      val: (r) => (r.callsPerHour ?? 0) * 24,
      render: (r) => (r.callsPerHour != null ? fmtNum(r.callsPerHour * 24) : '—'),
    },
    { label: 'Transport', val: (r) => r.category ?? r.hosted ?? '—' },
    { label: 'Host', val: (r) => r.hosted ?? '—' },
    { label: 'Last seen', val: (r) => relTime(r.lastSeen), sortVal: (r) => r.lastSeen ?? '' },
    {
      label: 'Enabled',
      val: (r) => (serverStatus(r) === 'down' ? 0 : 1),
      render: (r) => <Toggle on={serverStatus(r) !== 'down'} />,
    },
  ]

  /* ---- health pane ---- */
  const healthCols: DtColumn<DtRow<McpServerRow>>[] = [
    { label: 'Server', val: (r) => r.displayName ?? r.name ?? r.id ?? '' },
    {
      label: 'Status',
      val: (r) => serverStatus(r),
      render: (r) => {
        const st = serverStatus(r)
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusDot tone={statusTone(st)} />
            {statusLabel(st)}
          </span>
        )
      },
    },
    { label: 'Last probe', val: (r) => relTime(r.lastSeen), sortVal: (r) => r.lastSeen ?? '' },
    { label: 'Tools', r: true, val: (r) => r.toolCount ?? 0, render: (r) => (r.toolCount != null ? r.toolCount : '—') },
    { label: 'Transport', val: (r) => r.category ?? '—' },
  ]

  /* ---- tools pane (real per-tool usage from dashboard metrics) ---- */
  const toolUsage: McpToolUsageRow[] = metrics.data?.mcpToolUsage ?? []
  const toolCols: DtColumn<DtRow<McpToolUsageRow>>[] = [
    { label: 'Tool', val: (r) => r.tool, render: (r) => <span className="awc-name">{r.tool}</span> },
    { label: 'Calls (24h)', r: true, val: (r) => r.count, render: (r) => fmtNum(r.count) },
  ]

  /* ---- activity pane (scoped audit) ---- */
  const feed: AuditLogEntry[] = audit.data?.logs ?? []
  const feedCols: DtColumn<DtRow<AuditLogEntry>>[] = [
    { label: 'When', val: (r) => feedTime(r.timestamp), sortVal: (r) => r.timestamp },
    { label: 'Actor', val: (r) => r.userName ?? r.userEmail ?? r.userId ?? 'system' },
    { label: 'Action', val: (r) => r.action ?? '—' },
    { label: 'Resource', val: (r) => r.resourceId ?? r.mcpServer ?? '—' },
    {
      label: 'Result',
      val: (r) => (r.success === false ? 'error' : 'ok'),
      render: (r) =>
        r.success === false ? <Pill tone="err">error</Pill> : <Pill tone="ok">ok</Pill>,
    },
  ]

  const tabs: TabItem[] = [
    { id: 'overview', label: 'overview', cnt: servers.length || undefined },
    { id: 'health', label: 'health' },
    { id: 'tools', label: 'tools', cnt: toolUsage.length || undefined },
    { id: 'activity', label: 'activity', cnt: feed.length || undefined },
  ]

  return (
    <>
      <PageHead
        title="MCP Fleet"
        sub={
          total != null
            ? `${total} servers · ${healthy} healthy · ${toolsIndexed != null ? fmtNum(toolsIndexed) : '—'} tools indexed`
            : 'MCP servers (DB ∪ live status + indexed tools)'
        }
        mode="editable"
        actions={[
          { label: 'bulk actions', ic: '☰ ' },
          { label: 'add server', ic: '＋ ', primary: true },
        ]}
      />

      {serversQ.isError ? (
        <Banner tone="err">
          Failed to load the MCP fleet from <b>/api/admin/mcp/servers</b>. The list is unavailable
          right now — retry shortly.
        </Banner>
      ) : down > 0 || degraded > 0 ? (
        <Banner tone={down > 0 ? 'err' : 'warn'}>
          <span>
            <b>
              {down} server{down === 1 ? '' : 's'} down
            </b>
            {degraded > 0 && (
              <>
                {' · '}
                <b>{degraded} degraded</b>
              </>
            )}{' '}
            — open the affected rows below to re-probe.
          </span>
        </Banner>
      ) : null}

      <KpiStrip kpis={kpis} />

      <Section title="Servers" sub="overview · health · tools · activity" />
      <TabsBar items={tabs} active={tab} onTab={(id) => setTab(id as FleetTab)} />

      {tab === 'overview' && (
        <DataTable<DtRow<McpServerRow>>
          rows={servers as DtRow<McpServerRow>[]}
          cols={serverCols}
          search="server, transport, host…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: servers.length },
              { id: 'healthy', label: 'healthy', cnt: healthy },
              { id: 'degraded', label: 'degraded', cnt: degraded },
              { id: 'down', label: 'down', cnt: down },
            ],
            filter: (row, chip) => {
              const st = serverStatus(row as McpServerRow)
              const tone = statusTone(st)
              if (chip === 'all') return true
              if (chip === 'healthy') return tone === 'ok'
              if (chip === 'degraded') return tone === 'warn'
              if (chip === 'down') return tone === 'err'
              return true
            },
          }}
          empty={
            serversQ.isLoading ? 'Loading the MCP fleet…' : 'No MCP servers registered.'
          }
        />
      )}

      {tab === 'health' && (
        <DataTable<DtRow<McpServerRow>>
          rows={servers as DtRow<McpServerRow>[]}
          cols={healthCols}
          search="server…"
          empty={serversQ.isLoading ? 'Loading health…' : 'No MCP servers registered.'}
        />
      )}

      {tab === 'tools' && (
        <DataTable<DtRow<McpToolUsageRow>>
          rows={toolUsage as DtRow<McpToolUsageRow>[]}
          cols={toolCols}
          search="tool…"
          empty={
            metrics.isLoading
              ? 'Loading tool usage…'
              : metrics.isError
                ? 'Tool usage unavailable (dashboard metrics error).'
                : 'No MCP tool calls recorded in the last 24h.'
          }
        />
      )}

      {tab === 'activity' && (
        <DataTable<DtRow<AuditLogEntry>>
          rows={feed as DtRow<AuditLogEntry>[]}
          cols={feedCols}
          search="actor, action, resource…"
          empty={
            audit.isLoading
              ? 'Loading activity…'
              : audit.isError
                ? 'Activity feed unavailable (audit error).'
                : 'No MCPServer activity recorded yet.'
          }
        />
      )}
    </>
  )
}

/* ============================================================
   LEAF 2 — Enriched Tools  (enriched-tools · te)
   Curated semantic descriptions + few-shot examples over raw MCP tools.
   ============================================================ */
interface EnrichedToolRow {
  slug: string
  display_name?: string
  description?: string
  mcp_server?: string | null
  category?: string
  tier?: number
  enabled?: boolean
  output_template?: string | null
  updated_at?: string
  updated_by?: string | null
  [k: string]: unknown
}
interface EnrichedToolsResponse {
  success: boolean
  tools?: EnrichedToolRow[]
  count?: number
}

function EnrichedToolsPage(_props: LeafPageProps) {
  const q = useAdminQuery<EnrichedToolsResponse>(
    ['enriched-tools'],
    '/api/admin/enriched-tools',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const tools: EnrichedToolRow[] = q.data?.tools ?? []
  const enriched = tools.length
  const enabledCount = tools.filter((t) => t.enabled).length
  /* distinct mcp servers covered (per-server filter chips below) */
  const servers = React.useMemo(() => {
    const set = new Set<string>()
    tools.forEach((t) => {
      if (t.mcp_server) set.add(String(t.mcp_server))
    })
    return Array.from(set).sort()
  }, [tools])

  const kpis: Kpi[] = [
    {
      label: 'Enriched tools',
      val: q.data ? enriched : '—',
      tone: 'accent',
      sub: q.data ? `${enabledCount} enabled` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Servers covered',
      val: q.data ? servers.length : '—',
      tone: 'info',
      sub: q.data ? 'distinct mcp_server' : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'With output template',
      val: q.data ? tools.filter((t) => t.output_template).length : '—',
      tone: 'ok',
      sub: q.data ? 'render override set' : undefined,
      deltaDir: 'flat',
    },
  ]

  const cols: DtColumn<EnrichedToolRow>[] = [
    {
      label: 'Tool',
      val: (r) => r.display_name ?? r.slug,
      render: (r) => (
        <div>
          <span className="awc-name">{r.display_name ?? r.slug}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.slug}
          </div>
        </div>
      ),
    },
    {
      label: 'Server',
      val: (r) => r.mcp_server ?? '—',
      render: (r) => (r.mcp_server ? <Tag>{String(r.mcp_server)}</Tag> : '—'),
    },
    {
      label: 'Category',
      val: (r) => r.category ?? '—',
      render: (r) => (r.category ? <Tag>{String(r.category)}</Tag> : '—'),
    },
    {
      label: 'Description override',
      val: (r) => r.description ?? '',
      render: (r) => (
        <span
          style={{
            display: 'inline-block',
            maxWidth: 360,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--fg-2)',
          }}
          title={r.description ? asText(r.description) : undefined}
        >
          {r.description ? asText(r.description) : '—'}
        </span>
      ),
    },
    {
      label: 'Template',
      val: (r) => (r.output_template ? 'yes' : 'no'),
      render: (r) =>
        r.output_template ? <Pill tone="ok">yes</Pill> : <Pill tone="muted">no</Pill>,
    },
    {
      label: 'Updated',
      val: (r) => relTime(r.updated_at),
      sortVal: (r) => r.updated_at ?? '',
    },
    {
      label: 'Enabled',
      val: (r) => (r.enabled ? 1 : 0),
      render: (r) => <Toggle on={!!r.enabled} />,
    },
  ]

  return (
    <>
      <PageHead
        title="Enriched Tools"
        sub="semantic descriptions + few-shot examples layered over raw MCP tools"
        mode="editable"
        actions={[
          { label: 'refresh', ic: '↻ ' },
          { label: 'add enrichment', ic: '＋ ', primary: true },
        ]}
      />

      {q.isError && (
        <Banner tone="err">
          Failed to load the enrichment registry from <b>/api/admin/enriched-tools</b>.
        </Banner>
      )}

      <KpiStrip kpis={kpis} />

      <Section title="Enriched tools" sub="curated description + render template per T1 tool" />
      <DataTable<EnrichedToolRow>
        rows={tools}
        cols={cols}
        search="tool, server, category…"
        chips={
          servers.length
            ? {
                active: 'all',
                opts: [
                  { id: 'all', label: 'all', cnt: tools.length },
                  ...servers.map((s) => ({
                    id: s,
                    label: s,
                    cnt: tools.filter((t) => t.mcp_server === s).length,
                  })),
                ],
                filter: (row, chip) =>
                  chip === 'all' ? true : (row as EnrichedToolRow).mcp_server === chip,
              }
            : undefined
        }
        empty={
          q.isLoading ? 'Loading enrichment registry…' : 'No enriched tools registered.'
        }
      />
    </>
  )
}

/* ============================================================
   LEAF 3 — Skills Ecosystem  (skills-ecosystem · tk)
   Multi-source skill registry (own + upstream Apache-2.0).
   ============================================================ */
type EcoTab = 'installed' | 'sources'

interface SkillSummaryRow {
  id: string
  name: string
  description: string
  repo: string
  tags: string[]
}
interface SkillsListResponse {
  success: boolean
  skills?: SkillSummaryRow[]
}
interface SkillRepoRow {
  id: string
  name: string
  url: string
  isDefault: boolean
  enabled: boolean
  allowlisted: boolean
  lastSync: string | null
  skillCount: number
}
interface SkillReposResponse {
  success: boolean
  repos?: SkillRepoRow[]
}
interface SkillMetricRow {
  skillId: string
  invocations: number
  lastUsed: string | null
}
interface SkillMetricsResponse {
  success: boolean
  metrics?: SkillMetricRow[]
}

function SkillsEcosystemPage(_props: LeafPageProps) {
  const skillsQ = useAdminQuery<SkillsListResponse>(
    ['skills', 'list'],
    '/api/admin/skills',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const reposQ = useAdminQuery<SkillReposResponse>(
    ['skills', 'repos'],
    '/api/admin/skills/repos',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const metricsQ = useAdminQuery<SkillMetricsResponse>(
    ['skills', 'metrics'],
    '/api/admin/skills/metrics',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const [tab, setTab] = React.useState<EcoTab>('installed')

  const skills: SkillSummaryRow[] = skillsQ.data?.skills ?? []
  const repos: SkillRepoRow[] = reposQ.data?.repos ?? []
  const metrics: SkillMetricRow[] = metricsQ.data?.metrics ?? []
  const usedBy = React.useMemo(() => {
    const m = new Map<string, number>()
    metrics.forEach((x) => m.set(x.skillId, x.invocations))
    return m
  }, [metrics])

  const kpis: Kpi[] = [
    {
      label: 'Installed skills',
      val: skillsQ.data ? skills.length : '—',
      tone: 'accent',
      sub: skillsQ.data ? 'parsed from enabled repos' : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Sources',
      val: reposQ.data ? repos.length : '—',
      tone: 'info',
      sub: reposQ.data ? `${repos.filter((r) => r.enabled).length} enabled` : undefined,
      deltaDir: 'flat',
    },
    {
      label: 'Invocations',
      val: metricsQ.data ? fmtNum(metrics.reduce((a, x) => a + x.invocations, 0)) : '—',
      tone: 'ok',
      sub: metricsQ.data ? 'view_skill calls' : undefined,
      deltaDir: 'flat',
    },
  ]

  /* ---- sources table ---- */
  const repoCols: DtColumn<DtRow<SkillRepoRow>>[] = [
    {
      label: 'Source',
      val: (r) => r.name,
      render: (r) => (
        <div>
          <span className="awc-name">{r.name}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.url}
          </div>
        </div>
      ),
    },
    {
      label: 'Trust',
      val: (r) => (r.isDefault ? 'default' : r.allowlisted ? 'allowlisted' : 'external'),
      render: (r) =>
        r.isDefault ? (
          <Pill tone="ok" dot>
            default
          </Pill>
        ) : r.allowlisted ? (
          <Pill tone="info" dot>
            allowlisted
          </Pill>
        ) : (
          <Pill tone="warn" dot>
            external
          </Pill>
        ),
    },
    { label: 'Skills', r: true, val: (r) => r.skillCount ?? 0 },
    { label: 'Last sync', val: (r) => relTime(r.lastSync), sortVal: (r) => r.lastSync ?? '' },
    {
      label: 'Enabled',
      val: (r) => (r.enabled ? 1 : 0),
      render: (r) => <Toggle on={!!r.enabled} />,
    },
  ]

  /* ---- installed skills table ---- */
  const skillCols: DtColumn<DtRow<SkillSummaryRow>>[] = [
    {
      label: 'Skill',
      val: (r) => r.name,
      render: (r) => (
        <div>
          <span className="awc-name">{r.name}</span>
          <div
            style={{
              fontSize: 11,
              color: 'var(--fg-2)',
              maxWidth: 380,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={r.description ? asText(r.description) : undefined}
          >
            {r.description ? asText(r.description) : '—'}
          </div>
        </div>
      ),
    },
    { label: 'Source', val: (r) => r.repo, render: (r) => <Tag>{r.repo}</Tag> },
    {
      label: 'Tags',
      val: (r) => (r.tags ?? []).join(' '),
      render: (r) =>
        r.tags && r.tags.length ? (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {r.tags.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </span>
        ) : (
          '—'
        ),
    },
    {
      label: 'Used by',
      r: true,
      val: (r) => usedBy.get(r.id) ?? 0,
      render: (r) => {
        const n = usedBy.get(r.id)
        return n != null ? fmtNum(n) : metricsQ.data ? '0' : '—'
      },
    },
  ]

  const tabs: TabItem[] = [
    { id: 'installed', label: 'installed', cnt: skills.length || undefined },
    { id: 'sources', label: 'sources', cnt: repos.length || undefined },
  ]

  return (
    <>
      <PageHead
        title="Skills Ecosystem"
        sub="multi-source skill registry (own + upstream Apache-2.0)"
        mode="editable"
        actions={[{ label: 'add source', ic: '＋ ', primary: true }]}
      />

      {(skillsQ.isError || reposQ.isError) && (
        <Banner tone="err">
          Failed to load the skills registry from <b>/api/admin/skills</b>. Some panes are
          unavailable right now.
        </Banner>
      )}

      <KpiStrip kpis={kpis} />

      <Section title="Skills" sub="installed · sources" />
      <TabsBar items={tabs} active={tab} onTab={(id) => setTab(id as EcoTab)} />

      {tab === 'installed' && (
        <DataTable<DtRow<SkillSummaryRow>>
          rows={skills as DtRow<SkillSummaryRow>[]}
          cols={skillCols}
          search="skill, source, tag…"
          chips={
            repos.length
              ? {
                  active: 'all',
                  opts: [
                    { id: 'all', label: 'all', cnt: skills.length },
                    ...repos.map((r) => ({
                      id: r.id,
                      label: r.name,
                      cnt: skills.filter((s) => s.repo === r.id).length,
                    })),
                  ],
                  filter: (row, chip) =>
                    chip === 'all' ? true : (row as SkillSummaryRow).repo === chip,
                }
              : undefined
          }
          empty={
            skillsQ.isLoading ? 'Loading skills…' : 'No skills installed from the enabled repos.'
          }
        />
      )}

      {tab === 'sources' && (
        <DataTable<DtRow<SkillRepoRow>>
          rows={repos as DtRow<SkillRepoRow>[]}
          cols={repoCols}
          search="source, url…"
          empty={
            reposQ.isLoading ? 'Loading sources…' : 'No skill sources configured.'
          }
        />
      )}
    </>
  )
}

/* ============================================================
   Domain registry export — all 3 Tools & MCP leaves.
   ============================================================ */
export const toolsPages: Record<string, React.ComponentType<LeafPageProps>> = {
  'mcp-fleet': McpFleetPage,
  'enriched-tools': EnrichedToolsPage,
  'skills-ecosystem': SkillsEcosystemPage,
}
