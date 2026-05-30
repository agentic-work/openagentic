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
  formatHourLabel,
  statusTone,
  statusColor,
} from './types'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'

export interface HealthPaneProps {
  rows: ProviderRow[]
  isLoading: boolean
  metrics: ReturnType<typeof useDashboardMetrics>
  onOpen: (r: ProviderRow) => void
}

export const HealthPane: React.FC<HealthPaneProps> = ({ rows, isLoading, metrics, onOpen }) => {
  const apiSeries = metrics.data?.timeSeries?.apiRequests ?? []
  const xLabels = apiSeries.map((p) => formatHourLabel(p.timestamp))
  const yValues = apiSeries.map((p) => Number(p.value) || 0)

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
          count="proxy for provider load"
          right={<a>{fmtNum(metrics.data?.summary?.totalApiRequests)}</a>}
        />
        {!metrics.data ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : apiSeries.length === 0 ? (
          <EmptyInline pad>
            no api request series in window — per-provider health probe
            history is in the side-panel detail view at
            /api/admin/llm-providers/:id/health-history.
          </EmptyInline>
        ) : (
          <div style={{ padding: 8 }}>
            <MetricChart
              variant="area"
              yFormat={(v) => v.toFixed(0)}
              xLabels={xLabels}
              series={[{ name: 'requests', data: yValues, color: 'accent' }]}
            />
          </div>
        )}
      </Panel>
    </Grid>
  )
}
