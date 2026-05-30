import * as React from 'react'
import {
  Panel,
  PanelHead,
  Grid,
  Dt,
  EmptyInline,
  MetricChart,
} from '../../primitives-v3'
import { type ProviderRow, fmtUsd, formatHourLabel } from './types'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'

const PALETTE = ['accent', 'info', 'ok', 'warn', 'err'] as const

export interface CostPaneProps {
  rows: ProviderRow[]
  metrics: ReturnType<typeof useDashboardMetrics>
}

export const CostPane: React.FC<CostPaneProps> = ({ rows, metrics }) => {
  const summary = metrics.data?.summary
  const costByModel = metrics.data?.costByModel ?? []

  const modelToProvider = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const p of rows) {
      for (const mod of p.raw.models ?? []) m.set(mod.id, p.displayName)
    }
    return m
  }, [rows])

  const providerSeries = React.useMemo(() => {
    if (costByModel.length === 0) return [] as Array<[string, number[]]>
    const buckets = new Map<string, number[]>()
    const len = costByModel[0]?.data?.length ?? 0
    for (const s of costByModel) {
      const provider = modelToProvider.get(s.model) ?? 'unattributed'
      let arr = buckets.get(provider)
      if (!arr) {
        arr = new Array(len).fill(0)
        buckets.set(provider, arr)
      }
      s.data.forEach((p, i) => {
        arr![i] = (arr![i] ?? 0) + (Number(p.value) || 0)
      })
    }
    return Array.from(buckets.entries())
  }, [costByModel, modelToProvider])

  const xLabels = costByModel[0]?.data?.map((p) => formatHourLabel(p.timestamp)) ?? []

  const totalsByProvider = React.useMemo(
    () =>
      providerSeries
        .map(([name, vals]) => ({ name, total: vals.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total),
    [providerSeries],
  )

  return (
    <Grid cols={2}>
      <Panel>
        <PanelHead
          title="Spend by Provider · 24h"
          count="stacked area"
          right={<a>{fmtUsd(summary?.totalCost)}</a>}
        />
        {!metrics.data ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : providerSeries.length === 0 ? (
          <EmptyInline pad>
            {/* TODO: cloud providers that auto-discover models don't populate */}
            {/* models[], so cost can't be attributed back to them until */}
            {/* /api/admin/llm-providers/:id/cost-history exists. */}
            no spend recorded in this window
          </EmptyInline>
        ) : (
          <div style={{ padding: 8 }}>
            <MetricChart
              variant="area"
              yFormat="usd"
              xLabels={xLabels}
              series={providerSeries.slice(0, 5).map(([name, vals], i) => ({
                name,
                data: vals,
                color: PALETTE[i % PALETTE.length],
              }))}
              showLegend
            />
          </div>
        )}
      </Panel>
      <Panel>
        <PanelHead title="Provider Cost Totals · 24h" count={`${totalsByProvider.length} ranked`} />
        {totalsByProvider.length === 0 ? (
          <EmptyInline pad>no provider spend</EmptyInline>
        ) : (
          <Dt<{ name: string; total: number }>
            columns={[
              { key: 'name', label: 'Provider', className: 'name', render: (r) => r.name },
              {
                key: 'total',
                label: 'Cost (24h)',
                className: 'num',
                align: 'right',
                render: (r) => fmtUsd(r.total),
              },
            ]}
            rows={totalsByProvider}
            rowKey={(r) => r.name}
          />
        )}
      </Panel>
    </Grid>
  )
}
