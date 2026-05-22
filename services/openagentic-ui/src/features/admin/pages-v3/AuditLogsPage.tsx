import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  Chip,
  FilterRow,
  Panel,
  PanelHead,
  SectionBar,
  Feed,
  FeedRow,
  EmptyInline,
  SidePanel,
  StatusDot,
  type Status,
} from '../primitives-v3'
import {
  useAuditLogs,
  type AuditLogEntry,
} from '../hooks/useDashboardMetrics'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { apiEndpoint } from '../../../utils/api'

// ============================================================
// Types
// ============================================================
type Scope = 'all' | 'admin' | 'user'
type SubTab = 'all' | 'admin' | 'errors' | 'auth' | 'sessions' | 'resource'
type StatusFilter = 'all' | 'success' | 'error'
type Range = '1h' | '6h' | '24h' | '7d' | '30d'

interface AuditStats {
  admin?: { totalActions?: number; recent24h?: number; recent7d?: number }
  user?: { totalQueries?: number; recent24h?: number; failedQueries24h?: number }
}

interface ErrorRow {
  id: string
  userId?: string
  userName?: string
  userEmail?: string
  query?: string
  queryType?: string
  errorMessage?: string
  errorCode?: string
  sessionId?: string
  messageId?: string
  ipAddress?: string
  timestamp: string
}

interface SessionRow {
  id: string
  userId?: string
  userName?: string
  userEmail?: string
  title?: string
  messageCount?: number
  userQueries?: number
  aiResponses?: number
  model?: string
  totalTokens?: number | string | null
  totalCost?: number | string | null
  createdAt: string
  updatedAt?: string
}

const RESOURCE_TYPES = [
  'LLMProvider',
  'MCPServer',
  'Workflow',
  'User',
  'Token',
  'Prompt',
] as const

// Resource types that the existing AdminAuditLog table actually populates.
// The chips bind to the server-side `resourceType` filter (substring match).
type ResourceType = (typeof RESOURCE_TYPES)[number] | 'all'

// ============================================================
// Helpers
// ============================================================
function rangeToStartIso(r: Range): string {
  const ms: Record<Range, number> = {
    '1h': 3_600_000,
    '6h': 6 * 3_600_000,
    '24h': 86_400_000,
    '7d': 7 * 86_400_000,
    '30d': 30 * 86_400_000,
  }
  return new Date(Date.now() - ms[r]).toISOString()
}

function fmtTs(ts: string): string {
  try {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  } catch {
    return ts
  }
}

function fmtAbs(ts: string): string {
  try {
    return new Date(ts).toUTCString()
  } catch {
    return ts
  }
}

function entryStatus(e: AuditLogEntry): Status {
  if (e.success === false) return 'err'
  if (e.type === 'admin') return 'info'
  return 'ok'
}

// Best-effort secret masking for the JSON detail view. We never trust the
// server payload to be sanitized — the detail panel renders text the
// operator may copy-paste, so we redact common secret-shaped keys.
const SECRET_KEY_PATTERN = /(?:secret|token|api[_-]?key|password|passwd|authorization)/i

function maskSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k) && typeof v === 'string') {
        out[k] = v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-2)}` : '***'
      } else {
        out[k] = maskSecrets(v, depth + 1)
      }
    }
    return out
  }
  return value
}

// ============================================================
// Hooks — sub-tab data
// ============================================================
function useAuditStats() {
  return useAdminQuery<{ success: boolean } & AuditStats>(
    ['audit-logs', 'stats'],
    '/api/admin/audit-logs/stats',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

function useAuditErrors(limit = 50) {
  return useAdminQuery<{ success: boolean; errors: ErrorRow[] }>(
    ['audit-logs', 'errors', String(limit)],
    `/api/admin/audit-logs/errors?page=1&limit=${limit}`,
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

function useAuditSessions(limit = 50) {
  return useAdminQuery<{ success: boolean; sessions: SessionRow[] }>(
    ['audit-logs', 'sessions', String(limit)],
    `/api/admin/audit-logs/sessions?page=1&limit=${limit}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// Build the filtered list endpoint. We build the URL inline so the
// useAdminQuery cache key matches the exact server query.
function buildLogsEndpoint(
  scope: Scope,
  resource: ResourceType,
  range: Range,
  limit = 100,
): { key: string[]; url: string } {
  const params = new URLSearchParams({
    page: '1',
    limit: String(limit),
    logType: scope,
    startDate: rangeToStartIso(range),
  })
  if (resource !== 'all') params.set('resourceType', resource)
  const url = `/api/admin/audit-logs?${params.toString()}`
  return { key: ['audit-logs', 'list', scope, resource, range, String(limit)], url }
}

// ============================================================
// Page
// ============================================================
export interface AuditLogsPageProps {
  /**
   * Initial scope (mapped from the leaf id by the host shell).
   * - leaf `audit-logs`  → Flows-context defaults to `all` so the operator
   *   sees both admin + user events; resource chip pre-selects Workflow.
   * - leaf `audit`       → Monitoring-context defaults to `admin`.
   */
  initialScope?: Scope
  initialResource?: ResourceType
}

export const AuditLogsPage: React.FC<AuditLogsPageProps> = ({
  initialScope = 'all',
  initialResource = 'all',
}) => {
  const [tab, setTab] = React.useState<SubTab>('all')
  const [scope, setScope] = React.useState<Scope>(initialScope)
  const [resource, setResource] = React.useState<ResourceType>(initialResource)
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
  const [search, setSearch] = React.useState('')
  const [range, setRange] = React.useState<Range>('24h')
  const [paused, setPaused] = React.useState(false)
  const [detail, setDetail] = React.useState<AuditLogEntry | null>(null)

  // Keep scope synced with the host-prop on leaf change so navigating from
  // Monitoring/Audit → Flows/AuditLogs doesn't carry stale scope.
  React.useEffect(() => {
    setScope(initialScope)
    setResource(initialResource)
  }, [initialScope, initialResource])

  const stats = useAuditStats()
  const totalEvents24h =
    (stats.data?.admin?.recent24h ?? 0) + (stats.data?.user?.recent24h ?? 0)
  const failed24h = stats.data?.user?.failedQueries24h ?? 0
  const adminActions24h = stats.data?.admin?.recent24h ?? 0

  // Main feed query — re-keys whenever scope / resource / range change so
  // the cache stays consistent.
  const { key: logsKey, url: logsUrl } = React.useMemo(
    () => buildLogsEndpoint(scope, resource, range, 100),
    [scope, resource, range],
  )
  const logsQ = useAdminQuery<{ success: boolean; logs: AuditLogEntry[] }>(
    logsKey,
    logsUrl,
    // When paused, drop the auto-refetch by leaving refetchInterval undefined.
    // The user can still manually refetch via the refresh button.
    { staleTime: 5_000, refetchInterval: paused ? undefined : 5_000 },
  )

  // SSE live feed — best-effort. If unauthenticated we drop straight to
  // the 5s REST poll cadence above.
  const [sseStatus, setSseStatus] = React.useState<'idle' | 'open' | 'error' | 'unauth'>('idle')
  const [liveBuf, setLiveBuf] = React.useState<AuditLogEntry[]>([])
  React.useEffect(() => {
    if (paused) {
      setSseStatus('idle')
      return
    }
    setLiveBuf([])
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('auth_token') : ''
    if (!token) {
      setSseStatus('unauth')
      return
    }
    const url = apiEndpoint(
      `/admin/audit/logs/stream?token=${encodeURIComponent(token)}`,
    )
    let es: EventSource | null = null
    try {
      es = new EventSource(url)
      es.onopen = () => setSseStatus('open')
      es.onerror = () => setSseStatus('error')
      es.onmessage = (ev) => {
        let parsed: any
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          return
        }
        if (!parsed || parsed.message === 'Audit log stream connected') return
        // Reshape SSE event → AuditLogEntry so it merges with REST rows.
        const entry: AuditLogEntry = {
          id: parsed.id,
          type: parsed.queryType === 'admin_action' ? 'admin' : 'user',
          userId: parsed.userId,
          userEmail: parsed.userEmail,
          action: parsed.queryType,
          query: parsed.rawQuery,
          mcpServer: parsed.mcpServer,
          success: parsed.success !== false,
          error: parsed.errorMessage,
          timestamp: parsed.timestamp,
        }
        setLiveBuf((prev) => [entry, ...prev].slice(0, 200))
      }
    } catch {
      setSseStatus('error')
    }
    return () => es?.close()
  }, [paused])

  // Merge live SSE rows with REST poll rows, dedupe by id.
  const allRows: AuditLogEntry[] = React.useMemo(() => {
    const rest = logsQ.data?.logs ?? []
    const seen = new Set<string>()
    const out: AuditLogEntry[] = []
    for (const e of [...liveBuf, ...rest]) {
      if (!e.id || seen.has(e.id)) continue
      seen.add(e.id)
      out.push(e)
    }
    return out
  }, [liveBuf, logsQ.data])

  // Apply client-side tab + status + search filters. The scope/resource
  // chips already pushed through to the server query.
  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter((e) => {
      // Tab gating
      if (tab === 'admin' && e.type !== 'admin') return false
      if (tab === 'auth') {
        const a = (e.action ?? '').toLowerCase()
        if (!/login|logout|auth|token|sso|sign.?(in|out)/.test(a)) return false
      }
      if (tab === 'resource' && resource !== 'all' && e.resourceType !== resource)
        return false
      // Status gate
      if (statusFilter === 'success' && e.success === false) return false
      if (statusFilter === 'error' && e.success !== false) return false
      // Search across user / action / resource / query
      if (q) {
        const hay = [
          e.userName,
          e.userEmail,
          e.action,
          e.resourceType,
          e.resourceId,
          e.query,
          e.error,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [allRows, tab, statusFilter, search, resource])

  // Errors / Sessions sub-tabs use dedicated endpoints — only mount their
  // queries when the tab is active so we don't poll dead endpoints.
  const errorsQ = useAuditErrors(50)
  const sessionsQ = useAuditSessions(50)

  // Export CSV — calls the existing /export endpoint with current filters.
  const onExport = React.useCallback(() => {
    const params = new URLSearchParams({
      format: 'csv',
      logType: scope,
      startDate: rangeToStartIso(range),
    })
    if (resource !== 'all') params.set('resourceType', resource)
    if (search.trim()) params.set('searchTerm', search.trim())
    if (statusFilter !== 'all') params.set('success', String(statusFilter === 'success'))
    const a = document.createElement('a')
    a.href = apiEndpoint(`/admin/audit-logs/export?${params.toString()}`)
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [scope, range, resource, search, statusFilter])

  const meta = (
    <>
      <span style={{ marginRight: 8 }}>
        {logsQ.isLoading ? '…' : `${allRows.length} events loaded`}
      </span>
      <span style={{ color: 'var(--fg-3)' }}>·</span>
      <StatusDot
        status={
          paused ? 'idle' : sseStatus === 'open' ? 'ok' : sseStatus === 'error' ? 'warn' : 'idle'
        }
      />
      <span style={{ marginLeft: 6 }}>
        {paused
          ? 'paused'
          : sseStatus === 'open'
          ? 'live · sse'
          : sseStatus === 'error'
          ? '5s poll (sse disconnected)'
          : sseStatus === 'unauth'
          ? '5s poll (no sse token)'
          : '5s poll'}
      </span>
      <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
      <span style={{ color: failed24h > 0 ? 'var(--err)' : 'var(--fg-2)' }}>
        {failed24h} errors (24h)
      </span>
    </>
  )

  return (
    <>
      <PageHead
        title="Audit Logs"
        meta={meta}
        actions={
          <>
            <Btn variant="ghost" onClick={() => setPaused((p) => !p)}>
              {paused ? 'resume' : 'pause'}
            </Btn>
            <Btn variant="ghost" onClick={() => logsQ.refetch()}>
              refresh
            </Btn>
            <Btn variant="primary" onClick={onExport}>
              export csv
            </Btn>
          </>
        }
      />

      <Subtabs
        items={[
          { id: 'all',      label: 'all',      count: allRows.length },
          { id: 'admin',    label: 'admin',    count: allRows.filter((e) => e.type === 'admin').length },
          { id: 'errors',   label: 'errors',   count: errorsQ.data?.errors?.length ?? 0 },
          { id: 'auth',     label: 'auth' },
          { id: 'sessions', label: 'sessions', count: sessionsQ.data?.sessions?.length ?? 0 },
          { id: 'resource', label: 'resource' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as SubTab)}
      />

      {logsQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">{logsUrl}</span> — feed below
          shows last cached values
        </Banner>
      )}
      {sseStatus === 'unauth' && (
        <Banner level="info" label="sse">
          no auth_token in localStorage — falling back to 5s REST poll
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="events (24h)"
          value={stats.isLoading ? '…' : totalEvents24h.toLocaleString()}
          sub="admin + user activity"
        />
        <Kpi
          label="errors (24h)"
          value={stats.isLoading ? '…' : failed24h.toLocaleString()}
          sub="failed user queries"
          tone={failed24h > 0 ? 'err' : 'default'}
        />
        <Kpi
          label="auth events"
          value={
            stats.isLoading
              ? '…'
              : allRows
                  .filter((e) =>
                    /login|logout|auth|token|sso|sign.?(in|out)/i.test(
                      e.action ?? '',
                    ),
                  )
                  .length.toLocaleString()
          }
          sub="from current view"
        />
        <Kpi
          label="admin actions (24h)"
          value={stats.isLoading ? '…' : adminActions24h.toLocaleString()}
          sub="config + write paths"
        />
      </KpiGrid>

      {/* Filter row — scope + resourceType + status + search + range */}
      <FilterRow
        value={search}
        onSearch={setSearch}
        searchPlaceholder="search user / action / resource / query…"
        right={
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {(['1h', '6h', '24h', '7d', '30d'] as Range[]).map((r) => (
              <Chip
                key={r}
                label="range"
                value={r}
                on={range === r}
                onClick={() => setRange(r)}
              />
            ))}
          </div>
        }
      >
        {/* Scope chips */}
        <Chip label="scope" value="all"   on={scope === 'all'}   onClick={() => setScope('all')} />
        <Chip label="scope" value="admin" on={scope === 'admin'} onClick={() => setScope('admin')} />
        <Chip label="scope" value="user"  on={scope === 'user'}  onClick={() => setScope('user')} />

        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-1)', margin: '0 4px' }} />

        {/* Resource chips */}
        <Chip label="resource" value="all" on={resource === 'all'} onClick={() => setResource('all')} />
        {RESOURCE_TYPES.map((rt) => (
          <Chip
            key={rt}
            value={rt}
            on={resource === rt}
            onClick={() => setResource(rt)}
          />
        ))}

        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-1)', margin: '0 4px' }} />

        {/* Status chips */}
        <Chip label="status" value="all"     on={statusFilter === 'all'}     onClick={() => setStatusFilter('all')} />
        <Chip               value="success" on={statusFilter === 'success'} onClick={() => setStatusFilter('success')} />
        <Chip               value="error"   on={statusFilter === 'error'}   onClick={() => setStatusFilter('error')} />
      </FilterRow>

      {/* Tab body */}
      {(tab === 'all' || tab === 'admin' || tab === 'auth' || tab === 'resource') && (
        <LiveFeed
          rows={filteredRows}
          isLoading={logsQ.isLoading}
          isError={logsQ.isError}
          onRowClick={setDetail}
          headerLabel={
            tab === 'admin'
              ? 'admin actions'
              : tab === 'auth'
              ? 'auth events'
              : tab === 'resource'
              ? `resource: ${resource}`
              : 'all events'
          }
        />
      )}

      {tab === 'errors' && (
        <ErrorsPane
          rows={errorsQ.data?.errors ?? []}
          isLoading={errorsQ.isLoading}
          isError={errorsQ.isError}
        />
      )}

      {tab === 'sessions' && (
        <SessionsPane
          rows={sessionsQ.data?.sessions ?? []}
          isLoading={sessionsQ.isLoading}
          isError={sessionsQ.isError}
        />
      )}

      {/* Detail side-panel */}
      <SidePanel
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.action ?? detail?.intent ?? '—'}
        meta={detail ? `${detail.type} · ${fmtAbs(detail.timestamp)}` : ''}
      >
        {detail && <EventDetail entry={detail} />}
      </SidePanel>
    </>
  )
}

// ============================================================
// LiveFeed — main feed body for the all/admin/auth/resource tabs
// ============================================================
const LiveFeed: React.FC<{
  rows: AuditLogEntry[]
  isLoading: boolean
  isError: boolean
  onRowClick: (e: AuditLogEntry) => void
  headerLabel: string
}> = ({ rows, isLoading, isError, onRowClick, headerLabel }) => {
  return (
    <Panel>
      <PanelHead title={headerLabel} count={rows.length} />
      {isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : isError && rows.length === 0 ? (
        <EmptyInline pad>failed to fetch /api/admin/audit-logs</EmptyInline>
      ) : rows.length === 0 ? (
        <EmptyInline pad>
          no events match the current scope / resource / status / search filters
        </EmptyInline>
      ) : (
        <Feed>
          {rows.slice(0, 200).map((e, i) => (
            <div
              key={e.id ?? `${e.timestamp}-${i}`}
              onClick={() => onRowClick(e)}
              style={{ cursor: 'pointer' }}
            >
              <FeedRow
                ts={fmtTs(e.timestamp)}
                status={entryStatus(e)}
                who={e.userName ?? e.userEmail ?? 'system'}
                act={
                  <>
                    <span style={{ color: 'var(--fg-2)', marginRight: 6 }}>
                      [{e.type}]
                    </span>
                    <span className="accent">{e.action ?? e.intent ?? '—'}</span>
                    {e.resourceType && (
                      <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>
                        on {e.resourceType}
                        {e.resourceId ? ` · ${e.resourceId.slice(0, 12)}` : ''}
                      </span>
                    )}
                    {e.error && (
                      <span style={{ color: 'var(--err)', marginLeft: 6 }}>
                        · {e.error.slice(0, 80)}
                      </span>
                    )}
                  </>
                }
                right={
                  <span style={{ color: e.success === false ? 'var(--err)' : 'var(--ok)' }}>
                    {e.success === false ? 'fail' : 'ok'}
                  </span>
                }
              />
            </div>
          ))}
        </Feed>
      )}
    </Panel>
  )
}

// ============================================================
// ErrorsPane — /api/admin/audit-logs/errors
// ============================================================
const ErrorsPane: React.FC<{
  rows: ErrorRow[]
  isLoading: boolean
  isError: boolean
}> = ({ rows, isLoading, isError }) => {
  return (
    <Panel>
      <PanelHead title="failed user queries" count={rows.length} />
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : isError ? (
        <EmptyInline pad>failed to fetch /api/admin/audit-logs/errors</EmptyInline>
      ) : rows.length === 0 ? (
        <EmptyInline pad>no errors recorded</EmptyInline>
      ) : (
        <Feed>
          {rows.map((e) => (
            <FeedRow
              key={e.id}
              ts={fmtTs(e.timestamp)}
              status="err"
              who={e.userName ?? e.userEmail ?? '—'}
              act={
                <>
                  <span className="accent">{e.queryType ?? '—'}</span>
                  {e.errorMessage && (
                    <span style={{ color: 'var(--fg-2)', marginLeft: 6 }}>
                      · {e.errorMessage.slice(0, 120)}
                    </span>
                  )}
                </>
              }
              right={e.errorCode ?? ''}
            />
          ))}
        </Feed>
      )}
    </Panel>
  )
}

// ============================================================
// SessionsPane — /api/admin/audit-logs/sessions
// ============================================================
const SessionsPane: React.FC<{
  rows: SessionRow[]
  isLoading: boolean
  isError: boolean
}> = ({ rows, isLoading, isError }) => {
  return (
    <Panel>
      <PanelHead title="chat sessions" count={rows.length} />
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : isError ? (
        <EmptyInline pad>failed to fetch /api/admin/audit-logs/sessions</EmptyInline>
      ) : rows.length === 0 ? (
        <EmptyInline pad>no sessions in the selected window</EmptyInline>
      ) : (
        <Feed>
          {rows.map((s) => (
            <FeedRow
              key={s.id}
              ts={fmtTs(s.createdAt)}
              status="info"
              who={s.userEmail ?? s.userName ?? '—'}
              act={
                <>
                  <span className="accent">
                    {s.title?.slice(0, 80) || '(untitled)'}
                  </span>
                  <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>
                    · {s.messageCount ?? 0} msg
                  </span>
                  {s.model && (
                    <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>· {s.model}</span>
                  )}
                </>
              }
              right={
                <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
                  {String(s.id).slice(0, 8)}
                </span>
              }
            />
          ))}
        </Feed>
      )}
    </Panel>
  )
}

// ============================================================
// EventDetail — full record dump in the SidePanel
// ============================================================
const EventDetail: React.FC<{ entry: AuditLogEntry }> = ({ entry }) => {
  const masked = React.useMemo(() => maskSecrets(entry), [entry])
  const json = React.useMemo(() => JSON.stringify(masked, null, 2), [masked])
  return (
    <>
      <SectionBar title="summary" />
      <div
        style={{
          padding: '10px 14px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-1)',
          display: 'grid',
          gridTemplateColumns: '110px 1fr',
          rowGap: 4,
          columnGap: 12,
          borderBottom: '1px solid var(--line-1)',
        }}
      >
        <span style={{ color: 'var(--fg-3)' }}>type</span>
        <span>{entry.type}</span>
        <span style={{ color: 'var(--fg-3)' }}>actor</span>
        <span>{entry.userName ?? entry.userEmail ?? entry.userId ?? '—'}</span>
        <span style={{ color: 'var(--fg-3)' }}>action</span>
        <span className="accent">{entry.action ?? entry.intent ?? '—'}</span>
        {entry.resourceType && (
          <>
            <span style={{ color: 'var(--fg-3)' }}>resource</span>
            <span>
              {entry.resourceType}
              {entry.resourceId ? ` · ${entry.resourceId}` : ''}
            </span>
          </>
        )}
        {entry.sessionId && (
          <>
            <span style={{ color: 'var(--fg-3)' }}>session</span>
            <span>{entry.sessionId}</span>
          </>
        )}
        {entry.messageId && (
          <>
            <span style={{ color: 'var(--fg-3)' }}>message</span>
            <span>{entry.messageId}</span>
          </>
        )}
        {entry.ipAddress && (
          <>
            <span style={{ color: 'var(--fg-3)' }}>ip</span>
            <span>{entry.ipAddress}</span>
          </>
        )}
        <span style={{ color: 'var(--fg-3)' }}>status</span>
        <span style={{ color: entry.success === false ? 'var(--err)' : 'var(--ok)' }}>
          {entry.success === false ? 'fail' : 'ok'}
        </span>
        {entry.error && (
          <>
            <span style={{ color: 'var(--fg-3)' }}>error</span>
            <span style={{ color: 'var(--err)' }}>{entry.error}</span>
          </>
        )}
      </div>

      {entry.query && (
        <>
          <SectionBar title="query" />
          <pre
            style={{
              margin: 0,
              padding: '10px 14px',
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 'var(--v3-t-meta)',
              color: 'var(--fg-1)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              borderBottom: '1px solid var(--line-1)',
            }}
          >
            {entry.query}
          </pre>
        </>
      )}

      <SectionBar title="raw record (secrets masked)" />
      <pre
        style={{
          margin: 0,
          padding: '10px 14px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-1)',
          background: 'var(--bg-0)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {json}
      </pre>
    </>
  )
}

export default AuditLogsPage
