import * as React from 'react'
import {
  Panel,
  PanelHead,
  Grid,
  Dt,
  EmptyInline,
  MetricChart,
} from '../../primitives-v3'
import { type ProviderRow, fmtUsd } from './types'
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics'
import { usePromRange } from '../../hooks/useProm'

const PALETTE = ['accent', 'info', 'ok', 'warn', 'err'] as const

export interface CostPaneProps {
  rows: ProviderRow[]
  metrics: ReturnType<typeof useDashboardMetrics>
}

const HHMM = (t: number): string => {
  const d = new Date(t * 1000)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
}

// Cost is derived live from Prometheus token-usage rate × per-token price.
//   gen_ai_client_token_usage_total{token_type="input"|"output", model}
// gives tokens/sec per model; multiplying by the model's costPerToken (from
// the provider registry rows) yields $/sec, which we then roll up per
// provider. This replaces the old metrics.data.costByModel path, which
// useDashboardMetrics hard-codes to [] now that /api/admin/dashboard/metrics
// is deleted — so the chart always showed "no spend recorded". 2026-06-04.
const COST_QUERY = 'sum by (model, token_type) (rate(gen_ai_client_token_usage_total[5m]))'

export const CostPane: React.FC<CostPaneProps> = ({ rows, metrics }) => {
  const summary = metrics.data?.summary

  // model id → { provider, prompt $/tok, completion $/tok }
  const priceByModel = React.useMemo(() => {
    const m = new Map<string, { provider: string; prompt: number; completion: number }>()
    for (const p of rows) {
      for (const mod of p.raw.models ?? []) {
        m.set(mod.id, {
          provider: p.displayName,
          prompt: mod.costPerToken?.prompt ?? 0,
          completion: mod.costPerToken?.completion ?? 0,
        })
      }
    }
    return m
  }, [rows])

  const q = usePromRange(COST_QUERY, { minutes: 1440, step: 120 })

  // Build a unified time axis, then per-provider $/sec series:
  //   $/sec = Σ_model ( input_tok/sec × prompt$ + output_tok/sec × completion$ )
  const { providerSeries, xLabels } = React.useMemo(() => {
    const samples = (q.data ?? []).filter((s) => (s.values?.length ?? 0) > 0)
    if (samples.length === 0) return { providerSeries: [] as Array<[string, number[]]>, xLabels: [] as string[] }

    const tsSet = new Set<number>()
    for (const s of samples) for (const [t] of s.values ?? []) tsSet.add(t)
    const ts = [...tsSet].sort((a, b) => a - b)
    const idxOf = new Map(ts.map((t, i) => [t, i]))

    const buckets = new Map<string, number[]>()
    for (const s of samples) {
      const model = s.metric?.model ?? ''
      const tokenType = s.metric?.token_type ?? ''
      const price = priceByModel.get(model)
      if (!price) continue // unknown/unpriced model — can't attribute cost
      const perTok =
        tokenType === 'output' || tokenType === 'completion'
          ? price.completion
          : tokenType === 'input' || tokenType === 'prompt'
            ? price.prompt
            : 0
      if (perTok === 0) continue
      let arr = buckets.get(price.provider)
      if (!arr) {
        arr = new Array(ts.length).fill(0)
        buckets.set(price.provider, arr)
      }
      for (const [t, v] of s.values ?? []) {
        const i = idxOf.get(t)
        if (i != null) arr[i] += (Number(v) || 0) * perTok
      }
    }
    return { providerSeries: Array.from(buckets.entries()), xLabels: ts.map(HHMM) }
  }, [q.data, priceByModel])

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
          count="$/sec · token-rate × price"
          right={<a>{fmtUsd(summary?.totalCost)}</a>}
        />
        {q.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : q.isError ? (
          <EmptyInline pad>prom query failed</EmptyInline>
        ) : providerSeries.length === 0 ? (
          <EmptyInline pad>
            {/* No priced token traffic in window. Cloud providers that */}
            {/* auto-discover models without per-token pricing in the */}
            {/* registry can't be attributed cost here. */}
            no priced spend in this window
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
        <PanelHead title="Provider Cost Rate · 24h" count={`${totalsByProvider.length} ranked`} />
        {totalsByProvider.length === 0 ? (
          <EmptyInline pad>no provider spend</EmptyInline>
        ) : (
          <Dt<{ name: string; total: number }>
            columns={[
              { key: 'name', label: 'Provider', className: 'name', render: (r) => r.name },
              {
                key: 'total',
                label: '$/sec (sum)',
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
