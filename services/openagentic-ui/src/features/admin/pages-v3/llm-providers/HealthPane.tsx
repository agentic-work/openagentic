import * as React from 'react'
import {
  Panel,
  PanelHead,
  Grid,
  Dt,
  type DtCol,
  EmptyInline,
  StatusDot,
  MetricChart,
} from '../../primitives-v3'
import {
  type ProviderRow,
  fmtRel,
  fmtNum,
  statusTone,
  statusColor,
} from './types'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'
import { usePromRange } from '../../hooks/useProm'

export interface HealthPaneProps {
  rows: ProviderRow[]
  isLoading: boolean
  metrics: ReturnType<typeof useDashboardMetrics>
  onOpen: (r: ProviderRow) => void
}

// http_requests_total is a standard Fastify/Prom counter emitted on every
// request, so this range query returns real points immediately (proven ~61
// points over a 24h/120s-step window live). The old path read
// metrics.data.timeSeries.apiRequests, which useDashboardMetrics hard-codes
// to [] now that /api/admin/dashboard/metrics is deleted — so it always
// rendered the empty-state. Repoint at Prometheus directly. 2026-06-04.
const HHMM = (t: number): string => {
  const d = new Date(t * 1000)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
}

export const HealthPane: React.FC<HealthPaneProps> = ({ rows, isLoading, metrics, onOpen }) => {
  // 24h window, 120s step → ~720 points capped by Prom; honest live request rate.
  const apiReq = usePromRange('sum(rate(http_requests_total[5m]))', {
    minutes: 1440,
    step: 120,
  })
  const apiPoints = apiReq.data?.[0]?.values ?? []
  const xLabels = apiPoints.map(([t]) => HHMM(t))
  const yValues = apiPoints.map(([, v]) => Number(v) || 0)
  const hasApiSeries = yValues.some((v) => v !== 0)

  const cols: DtCol<ProviderRow>[] = [
    { key: 'name', label: 'Provider', className: 'name', render: (r) => r.displayName },
    {
      key: 'status',
      label: 'Status',
      width: '110px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={statusTone(r.status)} />
          <span style={{ color: statusColor(r.status) }}>{r.status}</span>
        </span>
      ),
    },
    {
      key: 'endpoint',
      label: 'Endpoint',
      className: 'mono',
      render: (r) => r.endpoint ?? '—',
    },
    {
      key: 'last',
      label: 'Last Check',
      width: '110px',
      className: 'mono',
      render: (r) => <span style={{ color: 'var(--fg-3)' }}>{fmtRel(r.lastChecked)}</span>,
    },
    {
      key: 'error',
      label: 'Last Error',
      render: (r) =>
        r.error ? <span style={{ color: 'var(--err)' }}>{r.error}</span>
                : <span style={{ color: 'var(--fg-3)' }}>—</span>,
    },
  ]

  return (
    <Grid cols={2}>
      <Panel>
        <PanelHead
          title="Provider Health"
          count={`${rows.filter((r) => r.status === 'healthy').length} / ${rows.length || 0}`}
        />
        {isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : rows.length === 0 ? (
          <EmptyInline pad>no providers configured</EmptyInline>
        ) : (
          <Dt<ProviderRow>
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            onRowDoubleClick={(r) => onOpen(r)}
          />
        )}
      </Panel>
      <Panel>
        <PanelHead
          title="API Requests · 24h"
          count="req/sec · http_requests_total"
          right={<a>{fmtNum(metrics.data?.summary?.totalApiRequests)}</a>}
        />
        {apiReq.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : apiReq.isError ? (
          <EmptyInline pad>prom query failed</EmptyInline>
        ) : !hasApiSeries ? (
          <EmptyInline pad>
            no api request rate in this window — per-provider health probe
            history is in the side-panel detail view at
            /api/admin/llm-providers/:id/health-history.
          </EmptyInline>
        ) : (
          <div style={{ padding: 8 }}>
            <MetricChart
              variant="area"
              yFormat={(v) => v.toFixed(2)}
              xLabels={xLabels}
              series={[{ name: 'req/sec', data: yValues, color: 'accent' }]}
            />
          </div>
        )}
      </Panel>
    </Grid>
  )
}
