/**
 * MCP Fleet — consolidated tool-fleet operator view.
 *
 * Replaces the legacy 4-leaf split (mcp-management / mcp-logs /
 * mcp-kubernetes / tool-execution-mode) with a single GCP/AWS/Anthropic
 * console-style layout: status strip → filter bar → server card grid
 * → slide-in side panel with sub-tabs.
 *
 * Anatomy follows mocks/UX/Admin/03-mcp-fleet.html. Typography matches
 * the codemode scale (12-13px body, 11px meta, 10px uppercase labels)
 * — no bespoke font sizes. All copy is short by design; if an operator
 * needs explanation they ask the Admin Agent or open the Docs page.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../primitives-v2'
import { apiEndpoint } from '../../../../utils/api'

interface MCPServer {
  name: string
  status?: 'healthy' | 'degraded' | 'down' | 'unknown'
  tier?: 'T1' | 'T2' | 'T3'
  category?: string
  hosted?: 'pod' | 'remote' | string
  toolCount?: number
  lastCallAt?: string
  callsLastMinute?: number
  // Allow extra fields from /admin/mcp/servers without breaking the row.
  [k: string]: unknown
}

interface FleetHealth {
  total: number
  healthy: number
  degraded: number
  down: number
  toolsIndexed: number
  callsPerMin: number
  uptimePct: number
}

const initialHealth: FleetHealth = {
  total: 0, healthy: 0, degraded: 0, down: 0, toolsIndexed: 0, callsPerMin: 0, uptimePct: 0,
}

export function MCPFleet({ theme: _theme }: { theme?: 'light' | 'dark' } = {}) {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [health, setHealth] = useState<FleetHealth>(initialHealth)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'degraded' | 'down'>('all')
  const [selected, setSelected] = useState<MCPServer | null>(null)
  const [panelTab, setPanelTab] = useState<'overview' | 'tools' | 'logs' | 'config'>('overview')
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        setLoading(true)
        const [serversRes, healthRes] = await Promise.all([
          fetch(apiEndpoint('/admin/mcp/servers'), { credentials: 'include' }),
          fetch(apiEndpoint('/admin/mcp/health'), { credentials: 'include' }).catch(() => null),
        ])
        if (cancel) return
        const serversBody = await serversRes.json().catch(() => ({}))
        const list: MCPServer[] = Array.isArray(serversBody) ? serversBody
          : Array.isArray((serversBody as any)?.servers) ? (serversBody as any).servers
          : []
        const healthBody = healthRes ? await healthRes.json().catch(() => ({})) : {}
        const summary = (healthBody as any)?.summary ?? healthBody
        setServers(list)
        const healthy = list.filter(s => s.status === 'healthy').length
        const degraded = list.filter(s => s.status === 'degraded').length
        const down = list.filter(s => s.status === 'down').length
        setHealth({
          total: typeof (summary as any)?.total === 'number' ? (summary as any).total : list.length,
          healthy: typeof (summary as any)?.healthy === 'number' ? (summary as any).healthy : healthy,
          degraded: typeof (summary as any)?.degraded === 'number' ? (summary as any).degraded : degraded,
          down: typeof (summary as any)?.down === 'number' ? (summary as any).down : down,
          toolsIndexed: typeof (summary as any)?.toolsIndexed === 'number' ? (summary as any).toolsIndexed : list.reduce((n, s) => n + (s.toolCount ?? 0), 0),
          callsPerMin: typeof (summary as any)?.callsPerMin === 'number' ? (summary as any).callsPerMin : 0,
          uptimePct: typeof (summary as any)?.uptimePct === 'number' ? (summary as any).uptimePct : 0,
        })
      } catch (e: any) {
        if (!cancel) setError(e?.message ?? 'Failed to load MCP fleet')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [])

  const filtered = useMemo(() => {
    return servers.filter(s => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${s.name} ${s.category ?? ''} ${s.hosted ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [servers, search, statusFilter])

  return (
    <div className="mcp-fleet" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <PageHeader
        crumbs={['Admin', 'Tools', 'MCP Fleet']}
        title="MCP Fleet"
        explainer={
          <>
            <strong>{health.total}</strong> servers · <strong>{health.toolsIndexed}</strong> tools indexed
          </>
        }
        actions={[
          { label: 'Refresh', onClick: () => window.location.reload() },
          { label: 'Add server', primary: true, onClick: () => setHelpOpen(true) },
        ]}
      />

      {helpOpen && <AddServerModal onClose={() => setHelpOpen(false)} />}

      {error && (
        <div className="mcp-fleet-error" style={{ margin: '12px 32px', padding: '10px 14px', border: '1px solid var(--ap-border)', borderRadius: 8, color: 'var(--ap-error)', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Status strip — 4 tiles, real data */}
      <div className="ss-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, padding: '0 32px', marginBottom: 18 }}>
        <Tile label="Total servers" val={health.total} meta={`${health.healthy} healthy · ${health.degraded + health.down} attention`} loading={loading} />
        <Tile label="Health" val={`${health.healthy}`} meta={`${health.degraded} degraded · ${health.down} down${health.uptimePct ? ` · ${health.uptimePct.toFixed(1)}% 24h` : ''}`} accent="var(--ap-accent)" loading={loading} />
        <Tile label="Tools indexed" val={health.toolsIndexed} meta={`across ${health.total} servers`} loading={loading} />
        <Tile label="Calls / min" val={health.callsPerMin} meta="rolling 60s" loading={loading} />
      </div>

      {/* Filter bar */}
      <div className="ff-bar" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '0 32px', marginBottom: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 32, padding: '0 12px',
          border: '1px solid var(--ap-border)', borderRadius: 8,
          background: 'var(--ap-bg-secondary)',
          fontSize: 12, color: 'var(--ap-text-secondary)',
          minWidth: 320,
        }}>
          <span aria-hidden>⌕</span>
          <input
            placeholder="server, tool, namespace, endpoint…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, height: 28,
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 12, color: 'var(--ap-text)',
            }}
          />
        </div>
        {(['all', 'healthy', 'degraded', 'down'] as const).map(s => (
          <FilterChip
            key={s}
            label={`Status · ${s}`}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
          />
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ap-text-muted)' }}>{filtered.length} / {servers.length}</span>
      </div>

      {/* Card grid */}
      <div className="srv-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 12, padding: '0 32px 32px',
      }}>
        {loading && servers.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: 'var(--ap-text-muted)', fontSize: 12 }}>
            Loading fleet…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: 'var(--ap-text-muted)', fontSize: 12 }}>
            No servers match the current filters.
          </div>
        ) : (
          filtered.map(s => (
            <ServerCard
              key={s.name}
              server={s}
              selected={selected?.name === s.name}
              onClick={() => setSelected(s)}
            />
          ))
        )}
      </div>

      {/* Side panel */}
      {selected && (
        <SidePanel
          server={selected}
          tab={panelTab}
          onTabChange={setPanelTab}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

/* ───────── primitives ───────── */

function Tile({ label, val, meta, accent, loading }: { label: string; val: string | number; meta: string; accent?: string; loading?: boolean }) {
  return (
    <div style={{
      padding: '14px 18px',
      border: '1px solid var(--ap-border)', borderRadius: 12,
      background: 'var(--ap-bg)',
    }}>
      <div style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.10em',
        fontWeight: 600, color: 'var(--ap-text-muted)',
      }}>
        {label}
      </div>
      <div style={{
        marginTop: 6,
        fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
        fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em',
        color: accent ?? 'var(--ap-text)',
        lineHeight: 1,
      }}>
        {loading ? '…' : val}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ap-text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
        {meta}
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center',
        height: 28, padding: '0 12px',
        border: `1px solid ${active ? 'var(--ap-accent)' : 'var(--ap-border)'}`,
        borderRadius: 999,
        background: active ? 'var(--ap-accent-soft, color-mix(in srgb, var(--ap-accent) 12%, transparent))' : 'var(--ap-bg-secondary)',
        color: active ? 'var(--ap-text)' : 'var(--ap-text-secondary)',
        fontSize: 11.5, fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function ServerCard({ server, selected, onClick }: { server: MCPServer; selected: boolean; onClick: () => void }) {
  const statusColor =
    server.status === 'healthy' ? 'var(--ap-success, #6BBA7B)' :
    server.status === 'degraded' ? 'var(--ap-warning, #E5B662)' :
    server.status === 'down' ? 'var(--ap-error, #E07873)' :
    'var(--ap-text-muted)'
  return (
    <div
      role="button"
      onClick={onClick}
      style={{
        padding: '14px 16px',
        border: `1px solid ${selected ? 'var(--ap-accent)' : 'var(--ap-border)'}`,
        borderRadius: 12,
        background: selected ? 'var(--ap-accent-soft, color-mix(in srgb, var(--ap-accent) 8%, transparent))' : 'var(--ap-bg)',
        cursor: 'pointer',
        transition: 'border-color .15s, background .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ap-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {server.name}
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ap-text-muted)' }}>
            {server.category ?? 'mcp'} · {server.hosted ?? 'remote'}
          </div>
        </div>
        {server.tier && (
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 999,
            border: '1px solid var(--ap-border)', color: 'var(--ap-text-secondary)',
            fontFamily: 'var(--font-mono, monospace)',
          }}>{server.tier}</span>
        )}
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--ap-text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
          <span>{server.status ?? 'unknown'}</span>
        </span>
        <span style={{ color: 'var(--ap-text-muted)' }}>·</span>
        <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{server.toolCount ?? 0} tools</span>
        {typeof server.callsLastMinute === 'number' && (
          <>
            <span style={{ color: 'var(--ap-text-muted)' }}>·</span>
            <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{server.callsLastMinute}/min</span>
          </>
        )}
      </div>
    </div>
  )
}

function SidePanel({ server, tab, onTabChange, onClose }: {
  server: MCPServer
  tab: 'overview' | 'tools' | 'logs' | 'config'
  onTabChange: (t: 'overview' | 'tools' | 'logs' | 'config') => void
  onClose: () => void
}) {
  return (
    <aside style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 520,
      background: 'var(--ap-bg)',
      borderLeft: '1px solid var(--ap-border)',
      boxShadow: '0 0 32px rgba(0,0,0,0.18)',
      display: 'flex', flexDirection: 'column',
      zIndex: 50,
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ap-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{server.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ap-text-muted)', marginTop: 2 }}>
            {server.category ?? 'mcp'} · {server.hosted ?? 'remote'} · {server.tier ?? '—'} · {server.toolCount ?? 0} tools
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 14, color: 'var(--ap-text-secondary)', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--ap-border)' }}>
        {(['overview', 'tools', 'logs', 'config'] as const).map(id => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            style={{
              padding: '10px 14px',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${tab === id ? 'var(--ap-accent)' : 'transparent'}`,
              color: tab === id ? 'var(--ap-text)' : 'var(--ap-text-secondary)',
              fontSize: 12, fontWeight: tab === id ? 600 : 500, cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {id}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', fontSize: 12, color: 'var(--ap-text-secondary)' }}>
        {tab === 'overview' && <OverviewTab server={server} />}
        {tab === 'tools' && <ToolsTab server={server} />}
        {tab === 'logs' && <LogsTab server={server} />}
        {tab === 'config' && <ConfigTab server={server} />}
      </div>
    </aside>
  )
}

function OverviewTab({ server }: { server: MCPServer }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Status', String(server.status ?? 'unknown')],
    ['Tier', String(server.tier ?? '—')],
    ['Hosted', String(server.hosted ?? '—')],
    ['Category', String(server.category ?? '—')],
    ['Tools', String(server.toolCount ?? 0)],
    ['Transport', String((server as any).transport ?? '—')],
    ['Last call', String(server.lastCallAt ?? '—')],
    ['Source', String((server as any).source ?? '—')],
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 8, columnGap: 16 }}>
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <div style={{ fontSize: 11, color: 'var(--ap-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
          <div style={{ fontSize: 12, color: 'var(--ap-text)' }}>{v}</div>
        </React.Fragment>
      ))}
    </div>
  )
}

/* ───────── Tools tab ───────── */

interface MCPTool {
  name: string
  description?: string
  server?: string
  inputSchema?: { properties?: Record<string, any>; required?: string[] }
}

function ToolsTab({ server }: { server: MCPServer }) {
  const [tools, setTools] = useState<MCPTool[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        setLoading(true); setErr(null)
        const r = await fetch(apiEndpoint('/admin/mcp/tools-list'), { credentials: 'include' })
        if (!r.ok) throw new Error(`tools-list returned ${r.status}`)
        const data: any = await r.json()
        if (cancel) return
        const all: MCPTool[] = Array.isArray(data?.tools) ? data.tools
          : Array.isArray(data) ? data
          : []
        // Filter by current server name (proxy attaches `server` per tool).
        const mine = all.filter(t => String(t.server ?? '').toLowerCase() === server.name.toLowerCase())
        setTools(mine)
      } catch (e: any) {
        if (!cancel) setErr(e?.message ?? 'failed')
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [server.name])

  const visible = useMemo(() => {
    if (!filter) return tools
    const q = filter.toLowerCase()
    return tools.filter(t => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q))
  }, [tools, filter])

  if (loading) return <div style={{ color: 'var(--ap-text-muted)' }}>Loading tools…</div>
  if (err) return <div style={{ color: 'var(--ap-error)' }}>Error: {err}</div>
  if (tools.length === 0) return <div style={{ color: 'var(--ap-text-muted)' }}>No tools registered for this server.</div>

  return (
    <div>
      <input
        placeholder={`filter ${tools.length} tool${tools.length === 1 ? '' : 's'}…`}
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{
          width: '100%', height: 28, padding: '0 10px', marginBottom: 12,
          border: '1px solid var(--ap-border)', borderRadius: 7,
          background: 'var(--ap-bg-secondary)', color: 'var(--ap-text)',
          fontSize: 12, outline: 'none',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map(t => {
          const args = Object.keys(t.inputSchema?.properties ?? {})
          const required = new Set(t.inputSchema?.required ?? [])
          return (
            <div key={t.name} style={{
              padding: '10px 12px',
              border: '1px solid var(--ap-border)', borderRadius: 8,
              background: 'var(--ap-bg-secondary)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ap-text)', fontFamily: 'var(--font-mono, monospace)' }}>
                {t.name}
              </div>
              {t.description && (
                <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--ap-text-secondary)', lineHeight: 1.45 }}>
                  {t.description.slice(0, 240)}{t.description.length > 240 ? '…' : ''}
                </div>
              )}
              {args.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ap-text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {args.map(a => required.has(a) ? `${a}*` : a).join(', ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ───────── Logs tab ───────── */

interface LogEvent {
  ts: string
  server?: string
  tool?: string
  level?: string
  message?: string
  duration_ms?: number
  raw?: any
}

function LogsTab({ server }: { server: MCPServer }) {
  const [events, setEvents] = useState<LogEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let es: EventSource | null = null
    let cancel = false
    setEvents([])
    setErr(null)

    try {
      const url = apiEndpoint('/admin/mcp/logs/stream')
      es = new EventSource(url, { withCredentials: true })
      es.onopen = () => { if (!cancel) setConnected(true) }
      es.onerror = () => { if (!cancel) { setConnected(false); setErr('stream disconnected') } }
      es.onmessage = (ev) => {
        if (cancel) return
        let parsed: any
        try { parsed = JSON.parse(ev.data) } catch { parsed = { raw: ev.data, ts: new Date().toISOString() } }
        // Filter to this server.
        const evServer = String(parsed.server ?? parsed.server_id ?? '').toLowerCase()
        if (evServer && evServer !== server.name.toLowerCase()) return
        setEvents(prev => {
          const next = [{ ts: parsed.ts ?? parsed.timestamp ?? new Date().toISOString(), ...parsed } as LogEvent, ...prev]
          // Keep last 200 events.
          return next.slice(0, 200)
        })
      }
    } catch (e: any) {
      setErr(e?.message ?? 'failed to open stream')
    }

    return () => { cancel = true; es?.close() }
  }, [server.name])

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10, fontSize: 11, color: 'var(--ap-text-muted)', fontFamily: 'var(--font-mono, monospace)',
      }}>
        <span>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            marginRight: 6, verticalAlign: 'middle',
            background: connected ? 'var(--ap-success, #6BBA7B)' : 'var(--ap-error, #E07873)',
          }} />
          {connected ? `streaming · ${events.length} events` : (err ?? 'connecting…')}
        </span>
        <span>filtered: {server.name}</span>
      </div>
      {events.length === 0 ? (
        <div style={{ color: 'var(--ap-text-muted)' }}>
          {connected
            ? 'No events received yet. The proxy emits events when this server handles tool calls.'
            : 'Waiting for connection…'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
          {events.map((e, i) => (
            <div key={i} style={{
              display: 'flex', gap: 8,
              padding: '5px 8px', borderRadius: 5,
              background: 'var(--ap-bg-secondary)',
              borderLeft: `2px solid ${e.level === 'error' ? 'var(--ap-error, #E07873)' : e.level === 'warn' ? 'var(--ap-warning, #E5B662)' : 'var(--ap-info, #7AAFE0)'}`,
            }}>
              <span style={{ color: 'var(--ap-text-muted)', flexShrink: 0 }}>
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              {e.tool && <span style={{ color: 'var(--ap-accent)' }}>{e.tool}</span>}
              <span style={{ color: 'var(--ap-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.message ?? JSON.stringify(e.raw ?? e)}
              </span>
              {typeof e.duration_ms === 'number' && (
                <span style={{ color: 'var(--ap-text-muted)' }}>{e.duration_ms}ms</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────── Config tab ───────── */

function ConfigTab({ server }: { server: MCPServer }) {
  const s: any = server
  const groups: Array<{ title: string; rows: Array<[string, React.ReactNode]> }> = [
    {
      title: 'Identity',
      rows: [
        ['Name', s.name],
        ['ID', s.id ?? '—'],
        ['Tier', s.tier ?? '—'],
        ['Category', s.category ?? '—'],
        ['Description', s.description ?? '—'],
      ],
    },
    {
      title: 'Runtime',
      rows: [
        ['Status', String(s.status ?? 'unknown')],
        ['Transport', s.transport ?? '—'],
        ['Hosted', s.hosted ?? '—'],
        ['PID', s.pid != null ? String(s.pid) : '—'],
        ['Last error', s.last_error ?? '—'],
        ['Tools', s.toolCount ?? 0],
      ],
    },
    {
      title: 'Sync',
      rows: [
        ['Source', s.source ?? '—'],
        ['Synced to proxy', s.synced_to_proxy ? 'yes' : 'no'],
        ['DB registered', s.db_registered ? 'yes' : 'no'],
        ['User isolated', s.user_isolated ? 'yes' : 'no'],
        ['Enabled', s.enabled === false ? 'no' : 'yes'],
      ],
    },
  ]

  return (
    <div>
      {groups.map(g => (
        <div key={g.title} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.10em',
            fontWeight: 600, color: 'var(--ap-text-muted)', marginBottom: 8,
          }}>{g.title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6, columnGap: 16 }}>
            {g.rows.map(([k, v]) => (
              <React.Fragment key={k}>
                <div style={{ fontSize: 11, color: 'var(--ap-text-muted)' }}>{k}</div>
                <div style={{ fontSize: 12, color: 'var(--ap-text)', fontFamily: typeof v === 'string' && /^[a-z0-9-_:.]+$/i.test(String(v)) && String(v).length > 4 ? 'var(--font-mono, monospace)' : 'inherit' }}>{String(v)}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}

      {/* Helm config pointer — the actual source of truth */}
      <div style={{
        padding: '10px 12px',
        border: '1px solid var(--ap-border)', borderRadius: 8,
        background: 'var(--ap-bg-secondary)',
        fontSize: 11.5, color: 'var(--ap-text-secondary)', lineHeight: 1.5,
      }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.10em', fontWeight: 600, color: 'var(--ap-text-muted)', marginBottom: 6 }}>Source of truth</div>
        Configured by per-MCP env flags on the <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>openagentic-mcp-proxy</code> Deployment.
        To enable / disable, edit <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>{toEnvFlag(s.name)}</code> in the openagentic-helm chart and re-apply.
      </div>
    </div>
  )
}

function toEnvFlag(name: string): string {
  return `${String(name).toUpperCase()}_MCP_DISABLED`
}

/* ───────── Add server modal ─────────
 *
 * Adding an MCP isn't a UI action — mcp-proxy reads its server set from
 * Deployment env flags. The modal documents the path so admins know
 * what to edit. Once helm-upgrade runs, the new server appears here
 * automatically.
 */
function AddServerModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.32)',
        display: 'grid', placeItems: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '92vw',
          background: 'var(--ap-bg)',
          border: '1px solid var(--ap-border)',
          borderRadius: 12,
          padding: '20px 22px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.30)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ap-text)' }}>Add MCP server</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ap-text-muted)' }}>
              The fleet is configured by helm — this UI mirrors what's running in mcp-proxy.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, fontSize: 14, color: 'var(--ap-text-secondary)', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--ap-text-secondary)', lineHeight: 1.55 }}>
          <p style={{ margin: '0 0 10px' }}>To add a new MCP server, edit the <code>openagentic-mcp-proxy</code> Deployment env in the helm chart and re-apply:</p>

          <pre style={{
            margin: '0 0 12px',
            padding: '12px 14px',
            background: 'var(--ap-bg-secondary)',
            border: '1px solid var(--ap-border)',
            borderRadius: 8,
            fontSize: 11, fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--ap-text)',
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
          }}>{`# helm/openagentic-helm chart values
mcpProxy:
  servers:
    openagentic_<name>:
      disabled: false
      transport: stdio | remote
      url: http://openagentic-openagentic-<name>-mcp:80XX  # if remote
      command: /path/to/binary                    # if stdio
`}</pre>

          <p style={{ margin: '0 0 8px', fontWeight: 500, color: 'var(--ap-text)' }}>Then:</p>
          <pre style={{
            margin: '0 0 12px',
            padding: '12px 14px',
            background: 'var(--ap-bg-secondary)',
            border: '1px solid var(--ap-border)',
            borderRadius: 8,
            fontSize: 11, fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--ap-text)',
            whiteSpace: 'pre-wrap',
          }}>{`helm upgrade openagentic ./helm/openagentic \\
  -f values-k3s-local.yaml -f values-local-registry.yaml \\
  -n agentic-dev --no-hooks
kubectl rollout restart deployment/openagentic-mcp-proxy -n agentic-dev`}</pre>

          <p style={{ margin: 0, fontSize: 11, color: 'var(--ap-text-muted)' }}>
            mcp-proxy picks up the new server, registers its tools at the <code>/tools</code> endpoint, and this page surfaces it on the next refresh.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              border: '1px solid var(--ap-border)',
              borderRadius: 7, background: 'var(--ap-accent)',
              color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

export default MCPFleet
