import * as React from 'react'
import {
  PageHead,
  Banner,
  KpiGrid,
  Kpi,
  FilterRow,
  ViewTabs,
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  Feed,
  FeedRow,
  EmptyInline,
  SectionBar,
  SidePanel,
  Btn,
  StatusDot,
  PriorityBadge,
  Chip,
  Spark,
  type Status,
} from '../primitives-v3'
import {
  useDashboardMetrics,
  useMcpServers,
  useMcpHealth,
  useMcpLogs,
  useMcpHealthcheckHistory,
  useMcpPermissions,
  type McpServerRow,
} from '../hooks/useDashboardMetrics'
import { apiEndpoint, apiRequest } from '../../../utils/api'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { Donut as AwDonut, type DonutData as AwDonutData } from '../../../lib/charts/components/Donut'
import {
  MCPServerModal,
  type MCPServerModalMode,
  type MCPServerPayload,
} from './mcp-fleet/MCPServerModal'

// ============================================================
// Types — narrow shapes for endpoint payloads we touch directly
// ============================================================
interface MCPServer extends McpServerRow {
  // additional fields that can come back from /admin/mcp/servers
  hosted?: 'pod' | 'remote' | string
  callsLastMinute?: number
  lastCallAt?: string
  source?: string
  synced_to_proxy?: boolean
  db_registered?: boolean
  user_isolated?: boolean
  enabled?: boolean
  description?: string
  transport?: string
  config?: Record<string, any>
  authConfig?: Record<string, any>
  endpoint?: string
  region?: string
  deployment?: string
  pid?: string | number
  last_error?: string
  [k: string]: unknown
}

interface MCPTool {
  name: string
  description?: string
  server?: string
  inputSchema?: { properties?: Record<string, any>; required?: string[] }
}

interface LogEvent {
  id?: string
  ts: string
  server?: string
  tool?: string
  level?: string
  message?: string
  duration_ms?: number
  status?: 'success' | 'error' | string
  user?: string
}

// ============================================================
// Helpers — server-list normalization, status mapping
// ============================================================
function normStatus(raw?: string): 'healthy' | 'degraded' | 'down' | 'unknown' {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'healthy' || s === 'up' || s === 'ok' || s === 'running' || s === 'connected') return 'healthy'
  if (s === 'degraded' || s === 'warn') return 'degraded'
  if (s === 'down' || s === 'failed' || s === 'unreachable' || s === 'error') return 'down'
  return 'unknown'
}

function statusDotKind(s: ReturnType<typeof normStatus>): Status {
  if (s === 'healthy') return 'ok'
  if (s === 'degraded') return 'warn'
  if (s === 'down') return 'err'
  return 'idle'
}

function normTier(raw?: string): 't1' | 't2' | 't3' | undefined {
  const t = String(raw ?? '').toLowerCase()
  if (t === 't1' || t === '1') return 't1'
  if (t === 't2' || t === '2') return 't2'
  if (t === 't3' || t === '3') return 't3'
  return undefined
}

function fmtRelative(iso?: string): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const dt = (Date.now() - t) / 1000
  if (dt < 60) return `${Math.max(0, Math.floor(dt))}s ago`
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`
  return `${Math.floor(dt / 86400)}d ago`
}

function fmtClockShort(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}

function maskSecret(v: unknown): string {
  if (v == null) return '—'
  const s = String(v)
  if (s.length <= 6) return '••••'
  return `${s.slice(0, 2)}••••${s.slice(-2)}`
}

// Heuristic: treat any key matching these as secret material.
function isSecretKey(k: string): boolean {
  return /key|secret|token|password|credential|apikey/i.test(k)
}

// ============================================================
// Top-level page
// ============================================================
export const MCPFleetV3 = () => {
  const servers = useMcpServers()
  const health = useMcpHealth()
  const metrics = useDashboardMetrics('24h')

  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'healthy' | 'degraded' | 'down'>('all')
  const [tierFilter, setTierFilter] = React.useState<'all' | 't1' | 't2' | 't3'>('all')
  const [hostedFilter, setHostedFilter] = React.useState<'all' | 'pod' | 'remote'>('all')
  const [view, setView] = React.useState<'cards' | 'table'>('cards')
  const [selected, setSelected] = React.useState<MCPServer | null>(null)
  const [panelTab, setPanelTab] = React.useState<string>('overview')
  const [activityOpen, setActivityOpen] = React.useState(true)
  const [showAdd, setShowAdd] = React.useState(false)
  const [editingServer, setEditingServer] = React.useState<MCPServer | null>(null)
  const [modalBusy, setModalBusy] = React.useState(false)
  const [modalError, setModalError] = React.useState<string | null>(null)
  const [actionBusy, setActionBusy] = React.useState<string | null>(null)
  const [toast, setToast] = React.useState<{ level: 'ok' | 'err' | 'info'; msg: string } | null>(null)

  const showToast = React.useCallback((level: 'ok' | 'err' | 'info', msg: string) => {
    setToast({ level, msg })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  const onServerSubmit = React.useCallback(
    async (payload: MCPServerPayload, mode: MCPServerModalMode) => {
      setModalBusy(true)
      setModalError(null)
      try {
        const url =
          mode === 'edit'
            ? `/api/admin/mcp/servers/${encodeURIComponent(payload.id)}`
            : '/api/admin/mcp/servers'
        const resp = await apiRequest(url, {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`${mode === 'edit' ? 'PATCH' : 'POST'} failed: ${resp.status} ${txt}`)
        }
        showToast('ok', mode === 'edit' ? `MCP server "${payload.id}" saved` : `MCP server "${payload.id}" registered`)
        setShowAdd(false)
        setEditingServer(null)
        servers.refetch?.()
        health.refetch?.()
      } catch (err: any) {
        setModalError(err?.message ?? 'submit failed')
      } finally {
        setModalBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onServerDelete = React.useCallback(
    async (s: MCPServer) => {
      const sid = String(s.name ?? s.id ?? '')
      if (!sid) return
      if (!confirm(`Unregister MCP server "${sid}"? Active instances will block deletion.`)) return
      setActionBusy(`mcp-del-${sid}`)
      try {
        const resp = await apiRequest(`/api/admin/mcp/servers/${encodeURIComponent(sid)}`, {
          method: 'DELETE',
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`DELETE failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `MCP server "${sid}" unregistered`)
        if (selected && (selected.name === s.name || selected.id === s.id)) setSelected(null)
        servers.refetch?.()
        health.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'unregister failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, selected],
  )

  const list: MCPServer[] = React.useMemo(() => {
    const raw = servers.data
    if (!raw) return []
    if (Array.isArray(raw)) return raw as MCPServer[]
    return (raw as any).servers ?? []
  }, [servers.data])

  // Health summary — prefer /mcp/health, fall back to derived list counts.
  const summary = React.useMemo(() => {
    const total = list.length
    const healthy = list.filter((s) => normStatus(s.status ?? s.health as any) === 'healthy').length
    const degraded = list.filter((s) => normStatus(s.status ?? s.health as any) === 'degraded').length
    const down = list.filter((s) => normStatus(s.status ?? s.health as any) === 'down').length
    const tools = list.reduce((n, s) => n + (s.toolCount ?? 0), 0)
    const h = health.data ?? {}
    return {
      total: typeof h.totalServers === 'number' ? h.totalServers : total,
      healthy: typeof h.healthyServers === 'number' ? h.healthyServers : healthy,
      degraded,
      down,
      tools: typeof h.toolsIndexed === 'number' ? h.toolsIndexed : tools,
      callsPerMin: deriveCallsPerMin(metrics),
    }
  }, [list, health.data, metrics])

  // Filter pipeline: status → tier → hosted → search.
  const filtered = React.useMemo(() => {
    return list.filter((s) => {
      const st = normStatus(s.status ?? s.health as any)
      if (statusFilter !== 'all' && st !== statusFilter) return false
      const t = normTier(s.tier)
      if (tierFilter !== 'all' && t !== tierFilter) return false
      if (hostedFilter !== 'all') {
        const h = String(s.hosted ?? '').toLowerCase()
        if (hostedFilter === 'pod' && h !== 'pod') return false
        if (hostedFilter === 'remote' && h !== 'remote') return false
      }
      if (search) {
        const q = search.toLowerCase()
        const hay = [s.name, s.displayName, s.category, s.hosted, s.tier]
          .map((v) => String(v ?? '').toLowerCase())
          .join(' ')
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [list, search, statusFilter, tierFilter, hostedFilter])

  const openServer = (s: MCPServer) => {
    setSelected(s)
    setPanelTab('overview')
  }

  // metric for "calls/min" — used both in KPI and as last sample of spark.
  const apiSpark = React.useMemo(() => {
    const ts = metrics.data?.timeSeries?.apiRequests ?? []
    return ts.map((p) => Number(p.value) || 0)
  }, [metrics.data])

  return (
    <>
      <PageHead
        title="MCP Fleet"
        meta={
          <>
            {summary.total} servers · {summary.healthy} healthy · {summary.tools.toLocaleString()} tools indexed
          </>
        }
        actions={
          <>
            <Btn variant="ghost" onClick={() => setShowAdd(false)}>bulk actions</Btn>
            <Btn variant="primary" onClick={() => setShowAdd(true)}>+ add server</Btn>
          </>
        }
      />

      {servers.isError && (
        <Banner level="err" label="error">
          failed to fetch <span className="accent">/api/admin/mcp/servers</span> — values below may be stale
        </Banner>
      )}
      {toast && (
        <Banner level={toast.level} label={toast.level === 'err' ? 'error' : toast.level === 'ok' ? 'ok' : 'info'}>
          {toast.msg}
        </Banner>
      )}

      {/* Status strip */}
      <KpiGrid cols={4}>
        <Kpi
          label="total servers"
          value={servers.isLoading ? '…' : summary.total.toLocaleString()}
          sub={`${summary.healthy} healthy · ${summary.degraded + summary.down} attention`}
        />
        <Kpi
          label="health"
          value={
            <span style={{ display: 'inline-flex', gap: 12, alignItems: 'baseline', fontSize: 'inherit' }}>
              <span style={{ color: 'var(--ok)' }}>{summary.healthy}</span>
              <span style={{ color: 'var(--warn)', fontSize: '0.75em' }}>{summary.degraded}</span>
              <span style={{ color: 'var(--err)', fontSize: '0.75em' }}>{summary.down}</span>
            </span>
          }
          sub={`healthy · degraded · down`}
        />
        <Kpi
          label="tools indexed"
          value={servers.isLoading ? '…' : summary.tools.toLocaleString()}
          sub={`across ${summary.total} servers`}
        />
        <Kpi
          label="calls / min"
          value={
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
              <span>{summary.callsPerMin}</span>
              {apiSpark.length > 1 && <Spark values={apiSpark.slice(-24)} width={64} height={14} variant="ok" />}
            </span>
          }
          sub="rolling 24h sample"
        />
      </KpiGrid>

      {/* MCP fleet donut — tool count distribution across servers + live calls
          spark per server. Counts come from server.tools (server-side discovery)
          paired with mcpToolUsage groupings from the dashboard metrics. The user
          asked specifically for the v1-style ring back; this is its v3 home. */}
      <FleetDonut servers={list} mcpToolUsage={metrics.data?.mcpToolUsage ?? []} />

      {/* Filter row */}
      <FilterRow
        searchPlaceholder="server, tool, namespace, endpoint…"
        value={search}
        onSearch={setSearch}
        right={
          <ViewTabs
            items={[
              { id: 'cards', label: 'cards' },
              { id: 'table', label: 'table' },
            ]}
            active={view}
            onChange={(id) => setView(id as 'cards' | 'table')}
          />
        }
      >
        <Chip label="status" value={statusFilter} on={statusFilter !== 'all'} onClick={() => cycle(statusFilter, ['all', 'healthy', 'degraded', 'down'], setStatusFilter as any)} />
        <Chip label="tier" value={tierFilter} on={tierFilter !== 'all'} onClick={() => cycle(tierFilter, ['all', 't1', 't2', 't3'], setTierFilter as any)} />
        <Chip label="hosted" value={hostedFilter} on={hostedFilter !== 'all'} onClick={() => cycle(hostedFilter, ['all', 'pod', 'remote'], setHostedFilter as any)} />
        <Chip label="match" value={`${filtered.length} / ${list.length}`} />
      </FilterRow>

      {/* List view */}
      {servers.isLoading && list.length === 0 ? (
        <EmptyInline pad>loading fleet…</EmptyInline>
      ) : filtered.length === 0 ? (
        <EmptyInline pad>no servers match the current filters.</EmptyInline>
      ) : view === 'cards' ? (
        <ServerCardGrid servers={filtered} selectedKey={selected?.name as string | undefined} onPick={openServer} />
      ) : (
        <ServerTable servers={filtered} selectedKey={selected?.name as string | undefined} onPick={openServer} />
      )}

      {/* Live activity drawer (collapsible) */}
      <LiveActivityDrawer
        open={activityOpen}
        onToggle={() => setActivityOpen((o) => !o)}
        onPick={(serverName) => {
          const found = list.find(
            (s) => String(s.name ?? '').toLowerCase() === serverName.toLowerCase(),
          )
          if (found) {
            openServer(found)
            setPanelTab('logs')
          }
        }}
      />

      {/* Side panel */}
      <SidePanel
        open={selected != null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {selected.name}
              <StatusDot status={statusDotKind(normStatus(selected.status ?? selected.health as any))} />
              {normTier(selected.tier) && <PriorityBadge tier={normTier(selected.tier)!} />}
            </span>
          ) : (
            ''
          )
        }
        meta={
          selected ? (
            <>
              {String(selected.category ?? 'mcp')} · {String(selected.hosted ?? 'remote')} · {selected.toolCount ?? 0} tools · {fmtRelative(selected.lastCallAt ?? selected.lastSeen)}
            </>
          ) : undefined
        }
        tabs={[
          { id: 'overview', label: 'overview' },
          { id: 'tools', label: 'tools', count: selected?.toolCount ?? undefined },
          { id: 'logs', label: 'logs' },
          { id: 'config', label: 'config' },
          { id: 'iam', label: 'iam' },
          { id: 'cost', label: 'cost' },
        ]}
        activeTab={panelTab}
        onTabChange={setPanelTab}
        headActions={
          selected ? (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <Btn
                variant="ghost"
                onClick={() => {
                  setModalError(null)
                  setEditingServer(selected)
                }}
              >
                edit
              </Btn>
              <Btn
                variant="ghost"
                disabled={actionBusy === `mcp-del-${selected.name ?? selected.id}`}
                onClick={() => onServerDelete(selected)}
              >
                {actionBusy === `mcp-del-${selected.name ?? selected.id}` ? '…' : 'delete'}
              </Btn>
            </span>
          ) : undefined
        }
      >
        {selected && panelTab === 'overview' && <OverviewTab server={selected} />}
        {selected && panelTab === 'tools'    && <ToolsTab server={selected} />}
        {selected && panelTab === 'logs'     && <LogsTab server={selected} />}
        {selected && panelTab === 'config'   && <ConfigTab server={selected} />}
        {selected && panelTab === 'iam'      && <IamTab server={selected} />}
        {selected && panelTab === 'cost'     && <CostTab server={selected} metrics={metrics} />}
      </SidePanel>

      {/* Add / edit server modal */}
      <MCPServerModal
        open={showAdd || editingServer !== null}
        mode={editingServer ? 'edit' : 'create'}
        initial={
          editingServer
            ? {
                id: String(editingServer.id ?? editingServer.name ?? ''),
                name: String(editingServer.name ?? ''),
                description: editingServer.description,
                transport:
                  (editingServer.transport as 'stdio' | 'http' | 'sse') ??
                  ((editingServer.config as any)?.transport as any) ??
                  'http',
                server_url: editingServer.endpoint,
                capabilities: ((editingServer.capabilities ?? []) as string[]) || [],
                require_obo: (editingServer.authConfig as any)?.require_obo,
                user_isolated: editingServer.user_isolated,
                enabled: editingServer.enabled,
              }
            : null
        }
        onClose={() => {
          setShowAdd(false)
          setEditingServer(null)
        }}
        onSubmit={onServerSubmit}
        isSubmitting={modalBusy}
        error={modalError}
      />
    </>
  )
}

function cycle<T extends string>(curr: T, vals: readonly T[], set: (v: T) => void) {
  const i = vals.indexOf(curr)
  set(vals[(i + 1) % vals.length])
}

function deriveCallsPerMin(metrics: ReturnType<typeof useDashboardMetrics>): string {
  const total = metrics.data?.summary?.totalMcpCalls
  const start = metrics.data?.period?.start
  const end = metrics.data?.period?.end
  if (typeof total !== 'number' || !start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms <= 0) return '—'
  const minutes = ms / 60000
  return Math.max(0, Math.round(total / minutes)).toLocaleString()
}

// ============================================================
// Fleet Donut — v1-style MCP donut + label legend.
//
// Phase F-tel (2026-05-07): user complaint — "why havent you built
// back the v1 mcp donut diagram?". Restores the donut + per-segment
// label list pattern from `pages/dashboard/DashboardOverview.tsx`,
// scoped to the MCP Fleet page where it actually belongs.
//
// Two slices:
//   - Tools-by-server : count of tools each MCP server exposes
//   - Calls-by-tool   : top 8 tool-name frequencies from
//                       metrics.mcpToolUsage (populated by the
//                       MCPProxyClient → MCPUsage write path).
// ============================================================
// FLEET_DONUT_COLORS ripped 2026-05-13 — <AwDonut> uses theme tokens directly.
const FleetDonut = ({
  servers,
  mcpToolUsage,
}: {
  servers: McpServerRow[]
  mcpToolUsage: { tool: string; count: number }[]
}) => {
  const toolsByServer = React.useMemo(
    () =>
      [...(servers || [])]
        .map((s) => ({
          name: String(s.name ?? ''),
          // McpServerRow shape: `toolCount` is the canonical field; the
          // optional `tools` array is set on some sub-types but not here.
          tools: typeof (s as any).toolCount === 'number'
            ? (s as any).toolCount
            : (Array.isArray((s as any).tools) ? (s as any).tools.length : 0),
        }))
        .filter((s) => s.tools > 0)
        .sort((a, b) => b.tools - a.tools)
        .slice(0, 8),
    [servers],
  )
  const callsByTool = React.useMemo(
    () =>
      [...(mcpToolUsage || [])]
        .filter((r) => (r.count ?? 0) > 0)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 8),
    [mcpToolUsage],
  )

  if (toolsByServer.length === 0 && callsByTool.length === 0) {
    return null
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {toolsByServer.length > 0 && (
        <Panel>
          <PanelHead title="tools by server" right={<span style={{ color: 'var(--fg-3)', fontSize: 11 }}>top {toolsByServer.length}</span>} />
          <div style={{ padding: 12, height: 240 }}>
            <AwDonut
              data={{
                slices: toolsByServer.map((s) => ({ name: s.name, value: s.tools })),
                centerSubtitle: 'tools',
              } satisfies AwDonutData}
              height={220}
              disableFrame
            />
          </div>
        </Panel>
      )}
      {callsByTool.length > 0 && (
        <Panel>
          <PanelHead title="calls by tool (24h)" right={<span style={{ color: 'var(--fg-3)', fontSize: 11 }}>top {callsByTool.length}</span>} />
          <div style={{ padding: 12, height: 240 }}>
            <AwDonut
              data={{
                slices: callsByTool.map((t) => ({ name: t.tool, value: t.count })),
                centerSubtitle: 'calls · 24h',
              } satisfies AwDonutData}
              height={220}
              disableFrame
            />
          </div>
        </Panel>
      )}
    </div>
  )
}

// ============================================================
// Server card grid
// ============================================================
const ServerCardGrid = ({
  servers,
  selectedKey,
  onPick,
}: {
  servers: MCPServer[]
  selectedKey?: string
  onPick: (s: MCPServer) => void
}) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))',
      gap: 8,
      padding: '12px 14px',
    }}
  >
    {servers.map((s) => {
      const st = normStatus(s.status ?? s.health as any)
      const tier = normTier(s.tier)
      const isSelected = selectedKey === s.name
      // RIPPED: was a deterministic-from-name pseudoSpark — operators
      // mistook it for real probe data. The real /mcp/servers/:id/
      // healthcheck-history endpoint exists; per-card fetch is heavy
      // for fleet view, so we render NO spark on the card and surface
      // the real series in the side-panel detail view instead.
      return (
        <div
          key={s.name as string}
          role="button"
          onClick={() => onPick(s)}
          aria-selected={isSelected}
          style={{
            padding: '10px 12px',
            border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--line-1)'}`,
            background: isSelected ? 'color-mix(in srgb, var(--accent) 7%, var(--bg-1))' : 'var(--bg-1)',
            cursor: 'pointer',
            transition: 'border-color .12s, background .12s',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontFamily: 'var(--font-v3-mono)',
                  fontSize: 'var(--v3-t-body, 13px)',
                  color: 'var(--fg-0)',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {String(s.name ?? '—')}
              </div>
              <div
                style={{
                  marginTop: 1,
                  fontFamily: 'var(--font-v3-mono)',
                  fontSize: 'var(--v3-t-meta, 11px)',
                  color: 'var(--fg-3)',
                }}
              >
                {String(s.category ?? 'mcp')} · {String(s.hosted ?? 'remote')}
              </div>
            </div>
            {tier && <PriorityBadge tier={tier} />}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 'var(--v3-t-meta)',
              color: 'var(--fg-2)',
            }}
          >
            <StatusDot status={statusDotKind(st)} />
            <span style={{ color: 'var(--fg-2)' }}>{st}</span>
            <span style={{ color: 'var(--fg-3)' }}>·</span>
            <span>{s.toolCount ?? 0} tools</span>
            {typeof s.callsLastMinute === 'number' && (
              <>
                <span style={{ color: 'var(--fg-3)' }}>·</span>
                <span>{s.callsLastMinute}/min</span>
              </>
            )}
          </div>
        </div>
      )
    })}
  </div>
)

// pseudoSpark removed 2026-05-07 — was deterministic-from-name fake data
// that looked like real telemetry. Real per-server health series is at
// /api/admin/mcp/servers/:id/healthcheck-history (consumed by the side-
// panel detail view).

// ============================================================
// Server table view
// ============================================================
const ServerTable = ({
  servers,
  selectedKey,
  onPick,
}: {
  servers: MCPServer[]
  selectedKey?: string
  onPick: (s: MCPServer) => void
}) => {
  const cols: DtCol<MCPServer>[] = [
    {
      key: 'name',
      label: 'Server',
      className: 'name',
      render: (s) => String(s.name ?? '—'),
    },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (s) => {
        const st = normStatus(s.status ?? s.health as any)
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusDot status={statusDotKind(st)} />
            <span>{st}</span>
          </span>
        )
      },
    },
    {
      key: 'tier',
      label: 'Tier',
      width: '60px',
      render: (s) => {
        const t = normTier(s.tier)
        return t ? <PriorityBadge tier={t} /> : <span style={{ color: 'var(--fg-3)' }}>—</span>
      },
    },
    {
      key: 'hosted',
      label: 'Hosted',
      width: '90px',
      className: 'mono',
      render: (s) => String(s.hosted ?? '—'),
    },
    {
      key: 'category',
      label: 'Category',
      width: '120px',
      className: 'dim',
      render: (s) => String(s.category ?? '—'),
    },
    {
      key: 'tools',
      label: 'Tools',
      width: '70px',
      align: 'right',
      className: 'num',
      render: (s) => s.toolCount ?? 0,
    },
    {
      key: 'last',
      label: 'Last call',
      width: '110px',
      className: 'mono',
      render: (s) => fmtRelative(s.lastCallAt ?? s.lastSeen),
    },
  ]
  return (
    <div style={{ padding: '8px 14px' }}>
      <Dt
        columns={cols}
        rows={servers}
        rowKey={(s) => String(s.name ?? '')}
        selectedKey={selectedKey}
        onRowClick={(s) => onPick(s)}
        onRowDoubleClick={(s) => onPick(s)}
        rowDataAttrs={(s) => {
          const st = normStatus((s as any).status ?? (s as any).health)
          return {
            status: st === 'healthy' ? 'ok'
              : st === 'degraded' ? 'warn'
              : st === 'down' ? 'err'
              : 'idle',
          }
        }}
      />
    </div>
  )
}

// ============================================================
// Sub-tab: Overview
// ============================================================
const OverviewTab = ({ server }: { server: MCPServer }) => {
  const st = normStatus(server.status ?? server.health as any)
  // Per-server healthcheck history (24h) — backed by v3-extras.ts:
  // GET /api/admin/mcp/servers/:id/healthcheck-history?hours=24
  const healthcheck = useMcpHealthcheckHistory(server.name ? String(server.name) : undefined, 24)

  const probeStats = React.useMemo(() => {
    const history = healthcheck.data?.history ?? []
    if (history.length === 0) return null
    const ok = history.filter((p) => p.status === 'success').length
    const fail = history.length - ok
    const lats = history.map((p) => p.latencyMs).filter((n): n is number => Number.isFinite(n) && (n ?? 0) > 0)
    const sorted = lats.slice().sort((a, b) => a - b)
    const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : undefined
    const p95 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : undefined
    return { total: history.length, ok, fail, p50, p95, history }
  }, [healthcheck.data])

  const rows: Array<[string, React.ReactNode]> = [
    ['status', (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <StatusDot status={statusDotKind(st)} />
        <span>{st}</span>
      </span>
    )],
    ['tier', normTier(server.tier) ? <PriorityBadge tier={normTier(server.tier)!} /> : '—'],
    ['hosted', String(server.hosted ?? '—')],
    ['category', String(server.category ?? '—')],
    ['tools', server.toolCount ?? 0],
    ['transport', String(server.transport ?? '—')],
    ['endpoint', String(server.endpoint ?? '—')],
    ['region', String(server.region ?? server.config?.region ?? '—')],
    ['last call', fmtRelative(server.lastCallAt ?? server.lastSeen)],
    ['source', String(server.source ?? '—')],
    ['db registered', server.db_registered ? 'yes' : 'no'],
    ['synced to proxy', server.synced_to_proxy ? 'yes' : 'no'],
  ]
  return (
    <>
      <SectionBar title="metadata" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          rowGap: 6,
          columnGap: 12,
          padding: '8px 0 12px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
        }}
      >
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
            <div style={{ color: 'var(--fg-1)' }}>{v}</div>
          </React.Fragment>
        ))}
      </div>

      <SectionBar
        title="probe history (24h)"
        right={probeStats ? <span style={{ color: 'var(--fg-3)' }}>{probeStats.total} probes</span> : undefined}
      />
      {healthcheck.isLoading && <EmptyInline pad>loading…</EmptyInline>}
      {healthcheck.isError && (
        <EmptyInline pad>
          failed to fetch <span className="accent">/api/admin/mcp/servers/{String(server.name ?? '')}/healthcheck-history</span>
        </EmptyInline>
      )}
      {!healthcheck.isLoading && !healthcheck.isError && (probeStats?.total ?? 0) === 0 && (
        <EmptyInline pad>no probes captured in window</EmptyInline>
      )}
      {probeStats && probeStats.total > 0 && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              padding: '4px 0 12px',
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 'var(--v3-t-meta)',
            }}
          >
            <div>
              <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>success</div>
              <div style={{ color: 'var(--ok)' }}>{probeStats.ok}</div>
            </div>
            <div>
              <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>fail</div>
              <div style={{ color: probeStats.fail > 0 ? 'var(--err)' : 'var(--fg-2)' }}>{probeStats.fail}</div>
            </div>
            <div>
              <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>p50 latency</div>
              <div style={{ color: 'var(--fg-1)' }}>{probeStats.p50 != null ? `${probeStats.p50}ms` : '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>p95 latency</div>
              <div style={{ color: 'var(--fg-1)' }}>{probeStats.p95 != null ? `${probeStats.p95}ms` : '—'}</div>
            </div>
          </div>
          {/* Render the most recent ~24 probes as a row of 6px-tall status pips. */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: '0 0 8px',
              flexWrap: 'wrap',
            }}
          >
            {probeStats.history.slice(0, 48).reverse().map((p, i) => (
              <span
                key={`${p.timestamp}-${i}`}
                title={`${p.timestamp} · ${p.status}${p.latencyMs != null ? ` · ${p.latencyMs}ms` : ''}${p.error ? ` · ${p.error}` : ''}`}
                style={{
                  width: 8,
                  height: 18,
                  background:
                    p.status === 'success'
                      ? 'color-mix(in srgb, var(--ok) 70%, var(--bg-2))'
                      : 'color-mix(in srgb, var(--err) 70%, var(--bg-2))',
                  borderRadius: 1,
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ============================================================
// Sub-tab: Tools
// ============================================================
const ToolsTab = ({ server }: { server: MCPServer }) => {
  const q = useAdminQuery<{ tools?: MCPTool[] } | MCPTool[]>(
    ['mcp-tools-list'],
    '/api/admin/mcp/tools-list',
    { staleTime: 30_000 },
  )
  const [filter, setFilter] = React.useState('')

  const tools = React.useMemo<MCPTool[]>(() => {
    const data: any = q.data
    const all: MCPTool[] = Array.isArray(data?.tools) ? data.tools : Array.isArray(data) ? data : []
    return all.filter(
      (t) => String(t.server ?? '').toLowerCase() === String(server.name ?? '').toLowerCase(),
    )
  }, [q.data, server.name])

  const visible = React.useMemo(() => {
    if (!filter) return tools
    const lc = filter.toLowerCase()
    return tools.filter((t) => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(lc))
  }, [tools, filter])

  if (q.isLoading) return <EmptyInline pad>loading tools…</EmptyInline>
  if (q.isError)   return <Banner level="err" label="error">failed to fetch /api/admin/mcp/tools-list</Banner>
  if (tools.length === 0) return <EmptyInline pad>no tools registered for this server.</EmptyInline>

  return (
    <>
      <SectionBar title={`tools`} count={tools.length} />
      <div style={{ padding: '6px 0 10px' }}>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`filter ${tools.length} tool${tools.length === 1 ? '' : 's'}…`}
          style={{
            width: '100%',
            background: 'var(--bg-2)',
            color: 'var(--fg-0)',
            border: '1px solid var(--line-1)',
            padding: '5px 9px',
            fontFamily: 'var(--font-v3-mono)',
            fontSize: 'var(--v3-t-meta)',
            outline: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map((t) => {
          const args = Object.keys(t.inputSchema?.properties ?? {})
          const required = new Set(t.inputSchema?.required ?? [])
          return (
            <div
              key={t.name}
              style={{
                padding: '8px 10px',
                border: '1px solid var(--line-1)',
                background: 'var(--bg-2)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-v3-mono)',
                  fontSize: 'var(--v3-t-body, 13px)',
                  color: 'var(--fg-0)',
                  fontWeight: 500,
                }}
              >
                {t.name}
              </div>
              {t.description && (
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 'var(--v3-t-meta)',
                    color: 'var(--fg-2)',
                    lineHeight: 1.45,
                  }}
                >
                  {t.description.length > 240 ? t.description.slice(0, 240) + '…' : t.description}
                </div>
              )}
              {args.length > 0 && (
                <div
                  style={{
                    marginTop: 5,
                    fontFamily: 'var(--font-v3-mono)',
                    fontSize: 10.5,
                    color: 'var(--fg-3)',
                  }}
                >
                  {args.map((a) => (required.has(a) ? `${a}*` : a)).join(', ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ============================================================
// Sub-tab: Logs (per-server) — REST poll + best-effort SSE
// ============================================================
const LogsTab = ({ server }: { server: MCPServer }) => {
  const serverName = String(server.name ?? '')
  // REST poll for the recent slice — server-side filter via query.
  const q = useAdminQuery<{ logs?: any[] }>(
    ['mcp-logs', serverName],
    `/api/admin/mcp-logs?page=1&limit=100&serverName=${encodeURIComponent(serverName)}`,
    { staleTime: 5_000, refetchInterval: 5_000 },
  )
  const [live, setLive] = React.useState<LogEvent[]>([])
  const [sseStatus, setSseStatus] = React.useState<'idle' | 'open' | 'error' | 'unauth'>('idle')

  // SSE: tries token auth via localStorage. If not allowed, falls back to
  // the 5s REST poll above (which already runs).
  React.useEffect(() => {
    setLive([])
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : ''
    if (!token) {
      setSseStatus('unauth')
      return
    }
    let es: EventSource | null = null
    try {
      const url = apiEndpoint(`/admin/mcp/logs/stream?token=${encodeURIComponent(token)}&server=${encodeURIComponent(serverName)}`)
      es = new EventSource(url)
      es.onopen = () => setSseStatus('open')
      es.onerror = () => setSseStatus('error')
      es.onmessage = (ev) => {
        let parsed: any
        try { parsed = JSON.parse(ev.data) } catch { parsed = { raw: ev.data } }
        if (!parsed || parsed.type === 'heartbeat') return
        const ev2: LogEvent = {
          ts: parsed.timestamp ?? parsed.ts ?? new Date().toISOString(),
          server: parsed.server,
          tool: parsed.tool ?? parsed.tool_name,
          level: parsed.level,
          message: parsed.message ?? parsed.raw,
        }
        setLive((prev) => [ev2, ...prev].slice(0, 200))
      }
    } catch {
      setSseStatus('error')
    }
    return () => es?.close()
  }, [serverName])

  // Combine: live SSE on top, REST poll below — dedupe by id+ts.
  const restRows: LogEvent[] = React.useMemo(() => {
    const r: any[] = q.data?.logs ?? []
    return r.map((e: any) => ({
      id: e.id,
      ts: e.timestamp,
      server: e.serverId ?? e.serverName,
      tool: e.toolName,
      level: e.status === 'error' ? 'error' : 'info',
      status: e.status,
      duration_ms: e.executionTime,
      user: e.userName ?? e.userEmail,
      message: e.error ?? `${e.toolName}${e.executionTime ? ` · ${e.executionTime}ms` : ''}`,
    }))
  }, [q.data])

  const merged: LogEvent[] = React.useMemo(() => {
    const seen = new Set<string>()
    const out: LogEvent[] = []
    for (const e of [...live, ...restRows]) {
      const k = `${e.id ?? ''}|${e.ts}|${e.tool ?? ''}|${e.message ?? ''}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(e)
    }
    return out.slice(0, 200)
  }, [live, restRows])

  const headerStatus =
    sseStatus === 'open' ? 'streaming · sse'
    : sseStatus === 'error' ? '5s poll (sse disconnected)'
    : sseStatus === 'unauth' ? '5s poll (no sse token)'
    : '5s poll'

  return (
    <>
      <SectionBar
        title="recent calls"
        count={merged.length}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-v3-mono)', fontSize: 'var(--v3-t-meta)', color: 'var(--fg-3)' }}>
            <StatusDot status={sseStatus === 'open' ? 'ok' : sseStatus === 'error' ? 'warn' : 'idle'} />
            {headerStatus}
          </span>
        }
      />
      {merged.length === 0 ? (
        <EmptyInline pad>
          {q.isLoading ? 'loading…' : 'no recent calls for this server.'}
        </EmptyInline>
      ) : (
        <Feed>
          {merged.map((e, i) => {
            const status: Status =
              e.status === 'error' || e.level === 'error' ? 'err'
              : e.level === 'warn' ? 'warn'
              : 'ok'
            return (
              <FeedRow
                key={`${e.id ?? ''}-${e.ts}-${i}`}
                ts={fmtClockShort(e.ts)}
                status={status}
                who={e.user}
                act={
                  <>
                    {e.tool && <span className="accent">{e.tool}</span>}
                    {e.tool && e.message && ' · '}
                    {e.message}
                  </>
                }
                right={typeof e.duration_ms === 'number' ? `${e.duration_ms}ms` : undefined}
              />
            )
          })}
        </Feed>
      )}
    </>
  )
}

// ============================================================
// Sub-tab: Config (read-only; secrets masked)
// ============================================================
const ConfigTab = ({ server }: { server: MCPServer }) => {
  const s: any = server
  const groups: Array<{ title: string; rows: Array<[string, React.ReactNode]> }> = [
    {
      title: 'identity',
      rows: [
        ['name', String(s.name ?? '—')],
        ['id', String(s.id ?? '—')],
        ['tier', s.tier ?? '—'],
        ['category', s.category ?? '—'],
        ['description', s.description ?? '—'],
      ],
    },
    {
      title: 'runtime',
      rows: [
        ['status', String(s.status ?? s.health ?? 'unknown')],
        ['transport', s.transport ?? '—'],
        ['hosted', s.hosted ?? '—'],
        ['endpoint', s.endpoint ?? s.config?.endpoint ?? '—'],
        ['region', s.region ?? s.config?.region ?? '—'],
        ['deployment', s.deployment ?? s.config?.deployment ?? '—'],
        ['pid', s.pid != null ? String(s.pid) : '—'],
        ['last error', s.last_error ?? '—'],
        ['tools', s.toolCount ?? 0],
      ],
    },
    {
      title: 'sync',
      rows: [
        ['source', s.source ?? '—'],
        ['synced to proxy', s.synced_to_proxy ? 'yes' : 'no'],
        ['db registered', s.db_registered ? 'yes' : 'no'],
        ['user isolated', s.user_isolated ? 'yes' : 'no'],
        ['enabled', s.enabled === false ? 'no' : 'yes'],
      ],
    },
  ]

  // provider_config + auth_config dumps (masked).
  const cfg = s.config ?? {}
  const auth = s.authConfig ?? s.auth_config ?? {}
  const cfgRows: Array<[string, React.ReactNode]> = Object.entries(cfg).map(([k, v]) => [k, isSecretKey(k) ? maskSecret(v) : String(v ?? '—')])
  const authRows: Array<[string, React.ReactNode]> = Object.entries(auth).map(([k, v]) => [k, isSecretKey(k) ? maskSecret(v) : String(v ?? '—')])

  if (cfgRows.length > 0) groups.push({ title: 'provider config', rows: cfgRows })
  if (authRows.length > 0) groups.push({ title: 'auth config', rows: authRows })

  return (
    <>
      {groups.map((g) => (
        <div key={g.title} style={{ marginBottom: 14 }}>
          <SectionBar title={g.title} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              rowGap: 4,
              columnGap: 12,
              padding: '6px 0',
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 'var(--v3-t-meta)',
            }}
          >
            {g.rows.map(([k, v]) => (
              <React.Fragment key={k}>
                <div style={{ color: 'var(--fg-3)' }}>{k}</div>
                <div
                  style={{
                    color: 'var(--fg-1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {v}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}

      <Banner level="info" label="source of truth">
        configured by per-MCP env flags on <code>openagentic-mcp-proxy</code>. Edit <code>{toEnvFlag(String(s.name ?? ''))}</code> in the helm chart and re-apply to enable / disable.
      </Banner>
    </>
  )
}

function toEnvFlag(name: string): string {
  return `${String(name).toUpperCase().replace(/-/g, '_')}_MCP_DISABLED`
}

// ============================================================
// Sub-tab: IAM (read-only; cross-ref available-mcps + per-server grants)
// ============================================================
const IamTab = ({ server }: { server: MCPServer }) => {
  const q = useAdminQuery<{ servers?: Array<{ id: string; name: string; description?: string | null }> }>(
    ['available-mcps'],
    '/api/admin/permissions/available-mcps',
    { staleTime: 60_000 },
  )
  // Per-server IAM rows from /api/admin/permissions?mcpServer=<name>
  const permsQ = useMcpPermissions(server.name ? String(server.name) : undefined)
  const isAvailable = React.useMemo(() => {
    if (!q.data?.servers) return undefined
    const target = String(server.name ?? '').toLowerCase()
    return q.data.servers.some(
      (s) => String(s.name).toLowerCase() === target || String(s.id).toLowerCase() === target,
    )
  }, [q.data, server.name])

  return (
    <>
      <SectionBar title="permission slot" />
      <div
        style={{
          padding: '8px 0 12px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-1)',
          display: 'grid',
          gridTemplateColumns: '140px 1fr',
          rowGap: 6,
          columnGap: 12,
        }}
      >
        <div style={{ color: 'var(--fg-3)' }}>assignable</div>
        <div>
          {q.isLoading
            ? '…'
            : isAvailable === undefined
              ? '—'
              : isAvailable
                ? <span style={{ color: 'var(--ok)' }}>yes — appears in available-mcps</span>
                : <span style={{ color: 'var(--warn)' }}>not in available-mcps (enable in db)</span>}
        </div>
        <div style={{ color: 'var(--fg-3)' }}>endpoint</div>
        <div className="accent">/api/admin/permissions/available-mcps</div>
      </div>

      <SectionBar
        title="users / groups with access"
        right={permsQ.data?.permissions ? <span style={{ color: 'var(--fg-3)' }}>{permsQ.data.permissions.length} grants</span> : undefined}
      />
      {permsQ.isLoading && <EmptyInline pad>loading…</EmptyInline>}
      {permsQ.isError && (
        <EmptyInline pad>
          failed to fetch <span className="accent">/api/admin/permissions?mcpServer={String(server.name ?? '')}</span>
        </EmptyInline>
      )}
      {!permsQ.isLoading && !permsQ.isError && (permsQ.data?.permissions?.length ?? 0) === 0 && (
        <EmptyInline pad>no users or groups granted — open the User Management leaf to add one</EmptyInline>
      )}
      {!permsQ.isLoading && !permsQ.isError && (permsQ.data?.permissions?.length ?? 0) > 0 && (
        <div
          style={{
            padding: '6px 0 12px',
            fontFamily: 'var(--font-v3-mono)',
            fontSize: 'var(--v3-t-meta)',
            display: 'grid',
            gridTemplateColumns: '110px 1fr 130px',
            rowGap: 4,
            columnGap: 12,
          }}
        >
          <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>type</div>
          <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>principal</div>
          <div style={{ color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>granted</div>
          {(permsQ.data?.permissions ?? []).slice(0, 50).map((p) => (
            <React.Fragment key={p.id}>
              <div style={{ color: 'var(--fg-2)' }}>{p.principalType}</div>
              <div style={{ color: 'var(--fg-1)' }}>{p.principalName ?? p.principalId}</div>
              <div style={{ color: 'var(--fg-3)' }}>{fmtRelative(p.grantedAt)}</div>
            </React.Fragment>
          ))}
        </div>
      )}

      <Banner level="info" label="read-only">
        IAM mutations (grant / revoke) flow through the User Management leaf.
      </Banner>
    </>
  )
}

// ============================================================
// Sub-tab: Cost
//
// Phase F-tel (2026-05-07): wired to /api/admin/mcp-cost backend
// (v3-extras.ts). Endpoint returns hourly buckets with calls/tokens/
// avgLatency aggregated from MCPUsage + a series.cost field that's
// 0 today (cost not tracked on mcp_usage). When the MCPProxyClient
// telemetry fix populates rows, this lights up automatically.
// ============================================================
const CostTab = ({
  server,
  metrics,
}: {
  server: MCPServer
  metrics: ReturnType<typeof useDashboardMetrics>
}) => {
  const serverName = String(server.name ?? '')
  const costQ = useAdminQuery<{
    success: boolean
    serverName: string
    windowHours: number
    series: { timestamp: string; cost: number; calls: number; tokens: number; avgLatencyMs: number }[]
    note?: string
  }>(
    ['mcp-cost', serverName, '24h'],
    `/api/admin/mcp-cost?serverName=${encodeURIComponent(serverName)}&window=24h`,
    { staleTime: 30_000, refetchInterval: 60_000, enabled: serverName.length > 0 },
  )

  const series = costQ.data?.series ?? []
  const totalCalls = series.reduce((s, p) => s + (p.calls || 0), 0)
  const totalTokens = series.reduce((s, p) => s + (p.tokens || 0), 0)

  const list = metrics.data?.mcpToolUsage ?? []
  const target = serverName.toLowerCase()
  const matching = list.filter((r) => String(r.tool ?? '').toLowerCase().includes(target))

  return (
    <>
      <SectionBar title="calls (24h)" count={totalCalls} />
      {costQ.isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : matching.length === 0 && totalCalls === 0 ? (
        <EmptyInline pad>
          no calls captured for <span className="accent">{serverName}</span> in the last 24h —
          MCPProxyClient writes a row to mcp_usage every callTool invocation, this populates
          when sub-agent flows fire tools on this server.
        </EmptyInline>
      ) : (
        <div style={{ padding: '8px 0' }}>
          <Dt
            columns={[
              { key: 'tool', label: 'Tool', render: (r: any) => r.tool },
              { key: 'count', label: 'Calls', width: '90px', align: 'right', className: 'num', render: (r: any) => r.count?.toLocaleString() ?? '—' },
            ]}
            rows={matching.length > 0 ? matching : [{ tool: 'aggregate', count: totalCalls }]}
            rowKey={(r: any) => r.tool}
          />
        </div>
      )}

      <SectionBar title="spend trend (24h)" />
      {costQ.isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : series.length === 0 ? (
        <EmptyInline pad>
          no series data yet — fires once MCPProxyClient.callTool is invoked on this server.
        </EmptyInline>
      ) : (
        <div style={{ padding: '8px 0' }}>
          <table className="aw-inline-table">
            <thead>
              <tr>
                <th>hour</th>
                <th className="num">calls</th>
                <th className="num">tokens</th>
                <th className="num">avg-latency</th>
                <th className="num">cost</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.timestamp}>
                  <td>{new Date(p.timestamp).toISOString().slice(11, 16)}Z</td>
                  <td className="num">{p.calls}</td>
                  <td className="num">{p.tokens.toLocaleString()}</td>
                  <td className="num">{p.avgLatencyMs}ms</td>
                  <td className="num">${p.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '6px 8px', color: 'var(--fg-3)', fontSize: 10 }}>
            totals: {totalCalls.toLocaleString()} calls, {totalTokens.toLocaleString()} tokens.
            {costQ.data?.note && <> · note: {costQ.data.note}</>}
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================
// Live Activity drawer (collapsible bottom strip)
// ============================================================
const LiveActivityDrawer = ({
  open,
  onToggle,
  onPick,
}: {
  open: boolean
  onToggle: () => void
  onPick: (serverName: string) => void
}) => {
  const [events, setEvents] = React.useState<LogEvent[]>([])
  const [sseStatus, setSseStatus] = React.useState<'idle' | 'open' | 'error' | 'unauth'>('idle')

  // SSE connection. Falls back to /api/admin/mcp-logs poll if SSE fails.
  React.useEffect(() => {
    if (!open) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : ''
    if (!token) {
      setSseStatus('unauth')
      return
    }
    let es: EventSource | null = null
    try {
      const url = apiEndpoint(`/admin/mcp/logs/stream?token=${encodeURIComponent(token)}`)
      es = new EventSource(url)
      es.onopen = () => setSseStatus('open')
      es.onerror = () => setSseStatus('error')
      es.onmessage = (ev) => {
        let parsed: any
        try { parsed = JSON.parse(ev.data) } catch { parsed = { raw: ev.data } }
        if (!parsed || parsed.type === 'heartbeat') return
        const ev2: LogEvent = {
          ts: parsed.timestamp ?? parsed.ts ?? new Date().toISOString(),
          server: parsed.server,
          tool: parsed.tool ?? parsed.tool_name,
          level: parsed.level,
          message: parsed.message ?? parsed.raw,
        }
        setEvents((prev) => [ev2, ...prev].slice(0, 100))
      }
    } catch {
      setSseStatus('error')
    }
    return () => es?.close()
  }, [open])

  // Poll fallback when SSE is dead — runs every 3s. Activates only when
  // SSE is in error/unauth state to keep load minimal.
  const poll = useAdminQuery<{ logs?: any[] }>(
    ['mcp-logs', 'fleet-live'],
    `/api/admin/mcp-logs?page=1&limit=30`,
    {
      staleTime: 3_000,
      refetchInterval: 3_000,
      enabled: open && (sseStatus === 'error' || sseStatus === 'unauth'),
    },
  )
  React.useEffect(() => {
    if (sseStatus !== 'error' && sseStatus !== 'unauth') return
    if (!poll.data?.logs) return
    setEvents(
      poll.data.logs.map((e: any) => ({
        id: e.id,
        ts: e.timestamp,
        server: e.serverId ?? e.serverName,
        tool: e.toolName,
        level: e.status === 'error' ? 'error' : 'info',
        status: e.status,
        duration_ms: e.executionTime,
        user: e.userName ?? e.userEmail,
        message: e.error ?? `${e.toolName}${e.executionTime ? ` · ${e.executionTime}ms` : ''}`,
      })),
    )
  }, [poll.data, sseStatus])

  const headerStatus =
    sseStatus === 'open' ? 'sse · live'
    : sseStatus === 'error' ? '3s poll'
    : sseStatus === 'unauth' ? '3s poll (no token)'
    : 'connecting…'

  return (
    <aside
      style={{
        position: 'fixed',
        left: 'var(--v3-sidebar-w, 220px)',
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.25)',
        maxHeight: open ? 240 : 28,
        overflow: 'hidden',
        transition: 'max-height 200ms ease',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          background: 'var(--bg-2)',
          border: 0,
          borderBottom: open ? '1px solid var(--line-1)' : 0,
          padding: '4px 14px',
          height: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-2)',
          cursor: 'pointer',
        }}
      >
        <StatusDot status={sseStatus === 'open' ? 'ok' : sseStatus === 'error' ? 'warn' : 'idle'} />
        <span>live activity</span>
        <span style={{ color: 'var(--fg-3)' }}>· {headerStatus}</span>
        <span style={{ color: 'var(--fg-3)' }}>· {events.length} events</span>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-3)' }}>{open ? '▼ collapse' : '▲ expand'}</span>
      </button>
      {open && (
        <div style={{ height: 212, overflowY: 'auto', padding: '6px 14px' }}>
          {events.length === 0 ? (
            <EmptyInline>waiting for events…</EmptyInline>
          ) : (
            <Feed>
              {events.map((e, i) => {
                const status: Status =
                  e.status === 'error' || e.level === 'error' ? 'err'
                  : e.level === 'warn' ? 'warn'
                  : 'ok'
                return (
                  <div
                    key={`${e.id ?? ''}-${e.ts}-${i}`}
                    onClick={() => e.server && onPick(String(e.server))}
                    title={e.server ? 'click to drill into this server' : undefined}
                    style={{ cursor: e.server ? 'pointer' : 'default' }}
                  >
                    <FeedRow
                      ts={fmtClockShort(e.ts)}
                      status={status}
                      who={e.server}
                      act={
                        <>
                          {e.tool && <span className="accent">{e.tool}</span>}
                          {e.tool && e.message && ' · '}
                          {e.message}
                        </>
                      }
                      right={typeof e.duration_ms === 'number' ? `${e.duration_ms}ms` : undefined}
                    />
                  </div>
                )
              })}
            </Feed>
          )}
        </div>
      )}
    </aside>
  )
}

export default MCPFleetV3
