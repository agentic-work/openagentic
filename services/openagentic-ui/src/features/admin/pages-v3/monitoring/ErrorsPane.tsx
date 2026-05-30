import * as React from 'react'
import {
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  SectionBar,
  Dt,
  type DtCol,
  SidePanel,
  BarList,
  MetricChart,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import {
  useDashboardMetrics,
  type TimeSeriesPoint,
} from '../../hooks/useDashboardMetrics'

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

interface AuditStats {
  user?: { recent24h?: number; failedQueries24h?: number; totalQueries?: number }
  admin?: { recent24h?: number }
}

const fmtTs = (ts: string | undefined): string => {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

function pointsToSeries(points: TimeSeriesPoint[] | undefined): {
  data: number[]
  labels: string[]
} {
  const arr = points ?? []
  return {
    data: arr.map((p) => (Number.isFinite(p.value) ? p.value : 0)),
    labels: arr.map((p) => {
      const d = new Date(p.timestamp)
      const z = (n: number) => String(n).padStart(2, '0')
      return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
    }),
  }
}

export const ErrorsPane: React.FC = () => {
  const errorsQ = useAdminQuery<{ success?: boolean; errors?: ErrorRow[] }>(
    ['audit-logs', 'errors', 'pane'],
    '/api/admin/audit-logs/errors?page=1&limit=100',
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
  const statsQ = useAdminQuery<{ success?: boolean } & AuditStats>(
    ['audit-logs', 'stats', 'errors-pane'],
    '/api/admin/audit-logs/stats',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
  const dash = useDashboardMetrics('24h')

  const [detail, setDetail] = React.useState<ErrorRow | null>(null)

  const errors = errorsQ.data?.errors ?? []
  const stats = statsQ.data ?? {}
  const apiSeries = pointsToSeries(dash.data?.timeSeries?.apiRequests)
  const errorRate = dash.data?.summary?.apiErrorRate

  // Tally by error code
  const codeBars = React.useMemo(() => {
    const tally = new Map<string, number>()
    for (const e of errors) {
      const code = e.errorCode ?? 'unknown'
      tally.set(code, (tally.get(code) ?? 0) + 1)
    }
    return Array.from(tally.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [errors])

  const failed24h = stats.user?.failedQueries24h ?? 0
  const total24h = stats.user?.totalQueries ?? 0
  const failureRate = total24h > 0 ? failed24h / total24h : 0

  const errCols: DtCol<ErrorRow>[] = [
    { key: 'ts', label: 'time', className: 'mono', width: '90px', render: (r) => fmtTs(r.timestamp) },
    { key: 'user', label: 'user', className: 'name', render: (r) => r.userName ?? r.userEmail ?? '—' },
    { key: 'type', label: 'type', className: 'mono', render: (r) => r.queryType ?? '—' },
    { key: 'code', label: 'code', className: 'mono', render: (r) => r.errorCode ?? '—' },
    {
      key: 'msg',
      label: 'message',
      render: (r) => (
        <span style={{ color: 'var(--err)' }}>
          {(r.errorMessage ?? '').slice(0, 100)}
          {(r.errorMessage?.length ?? 0) > 100 ? '…' : ''}
        </span>
      ),
    },
  ]

  return (
    <>
      <SectionBar title="error overview (24h)" />
      {errorsQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/audit-logs/errors</span>
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="failed queries (24h)"
          value={statsQ.isLoading ? '…' : failed24h.toLocaleString()}
          sub={`${total24h.toLocaleString()} total`}
          tone={failed24h > 0 ? 'err' : 'default'}
        />
        <Kpi
          label="failure rate"
          value={
            statsQ.isLoading
              ? '…'
              : `${(failureRate * 100).toFixed(2)}%`
          }
          sub="user queries"
          tone={
            failureRate >= 0.05
              ? 'err'
              : failureRate >= 0.01
                ? 'warn'
                : 'default'
          }
        />
        <Kpi
          label="api error rate"
          value={
            dash.isLoading
              ? '…'
              : typeof errorRate === 'number'
                ? `${(errorRate * 100).toFixed(2)}%`
                : '—'
          }
          sub="dashboard summary"
          tone={
            typeof errorRate === 'number' && errorRate >= 0.05
              ? 'err'
              : typeof errorRate === 'number' && errorRate >= 0.01
                ? 'warn'
                : 'default'
          }
        />
        <Kpi
          label="distinct codes"
          value={errorsQ.isLoading ? '…' : codeBars.length.toLocaleString()}
          sub="from current view"
        />
      </KpiGrid>

      <SectionBar title="error code distribution" />
      <Panel>
        <PanelHead title="top error codes" count={codeBars.length} />
        {errorsQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : codeBars.length === 0 ? (
          <EmptyInline pad>no errors with codes in the current window</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <BarList items={codeBars} />
          </div>
        )}
      </Panel>

      <SectionBar title="api requests over time" />
      <Panel>
        <PanelHead title="api request volume" count={`${apiSeries.data.length} pts`} />
        {dash.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : apiSeries.data.length === 0 ? (
          <EmptyInline pad>no api request series in the last 24h</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="area"
              series={[{ name: 'requests', data: apiSeries.data, color: 'accent' }]}
              xLabels={apiSeries.labels}
              height={160}
            />
          </div>
        )}
      </Panel>

      <SectionBar title="failed queries" />
      <Panel>
        <PanelHead title="latest 100 failures" count={errors.length} />
        {errorsQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : errors.length === 0 ? (
          <EmptyInline pad>no failed queries recorded</EmptyInline>
        ) : (
          <Dt
            columns={errCols}
            rows={errors}
            rowKey={(r) => r.id}
            onRowClick={(r) => setDetail(r)}
            rowDataAttrs={() => ({ status: 'err' })}
          />
        )}
      </Panel>

      <SidePanel
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.errorCode ?? 'error detail'}
        meta={detail ? `${detail.userEmail ?? '—'} · ${detail.timestamp}` : ''}
      >
        {detail && (
          <>
            <SectionBar title="message" />
            <pre
              style={{
                margin: 0,
                padding: '10px 14px',
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-meta)',
                color: 'var(--err)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                borderBottom: '1px solid var(--line-1)',
              }}
            >
              {detail.errorMessage ?? '(no message)'}
            </pre>
            {detail.query && (
              <>
                <SectionBar title="failed query" />
                <pre
                  style={{
                    margin: 0,
                    padding: '10px 14px',
                    fontFamily: 'var(--font-v3-mono)',
                    fontSize: 'var(--v3-t-meta)',
                    color: 'var(--fg-1)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    background: 'var(--bg-0)',
                  }}
                >
                  {detail.query}
                </pre>
              </>
            )}
            <SectionBar title="raw record" />
            <pre
              style={{
                margin: 0,
                padding: '10px 14px',
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-meta)',
                color: 'var(--fg-1)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--bg-0)',
              }}
            >
              {JSON.stringify(detail, null, 2)}
            </pre>
          </>
        )}
      </SidePanel>
    </>
  )
}

export default ErrorsPane
