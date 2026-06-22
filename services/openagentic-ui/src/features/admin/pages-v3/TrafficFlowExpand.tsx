import * as React from 'react'

import type { ModelUsageRow } from '../hooks/useDashboardMetrics'
import { Sankey as AwSankey, type SankeyData as AwSankeyData } from '../../../lib/charts/components/Sankey'
import { Heatmap as AwHeatmap, type HeatmapData as AwHeatmapData } from '../../../lib/charts/components/Heatmap'
import { Donut as AwDonut, type DonutData as AwDonutData } from '../../../lib/charts/components/Donut'

const fmtTokens = (n?: number): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
const fmtNum = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'

type UseLlmProvidersData = {
  data?: {
    providers?: Array<{
      name: string
      displayName?: string
      models?: Array<{ name?: string } | string>
    }>
  }
}

type AggregatedRow = {
  provider: string
  model: string
  tokens: number
}

/** Build the aggregated provider→model rows once and share across views. */
function useAggregatedFlow(
  llmProviders: UseLlmProvidersData,
  modelUsage: ModelUsageRow[],
) {
  return React.useMemo(() => {
    const providers = llmProviders.data?.providers ?? []
    const modelToProvider = new Map<string, string>()
    for (const p of providers) {
      const pname = p.displayName ?? p.name
      for (const m of p.models ?? []) {
        const mname = typeof m === 'string' ? m : m?.name
        if (mname) modelToProvider.set(mname, pname)
      }
    }
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
    const rows: AggregatedRow[] = [...modelTotals.entries()].map(
      ([model, info]) => ({ provider: info.provider, model, tokens: info.value }),
    )
    rows.sort((a, b) => b.tokens - a.tokens)
    const total = rows.reduce((a, r) => a + r.tokens, 0)
    return {
      rows,
      providers: [...providerTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value })),
      total,
    }
  }, [llmProviders.data, modelUsage])
}

// ============================================================================
// SANKEY VIEW (d3-sankey via AwSankey)
// ============================================================================

const SankeyView: React.FC<{ agg: ReturnType<typeof useAggregatedFlow> }> = ({ agg }) => {
  const [topN, setTopN] = React.useState(20)

  const data = React.useMemo<AwSankeyData>(() => {
    if (agg.providers.length === 0 || agg.rows.length === 0) {
      return { nodes: [], links: [] }
    }
    const top = agg.rows.slice(0, topN)
    const rest = agg.rows.slice(topN)
    const restTotal = rest.reduce((a, r) => a + r.tokens, 0)
    if (restTotal > 0) {
      top.push({ provider: 'mixed', model: `+${rest.length} more`, tokens: restTotal })
    }
    const providersIncluded = new Set(top.map((r) => r.provider))
    return {
      nodes: [
        ...agg.providers
          .filter((p) => providersIncluded.has(p.name))
          .map((p) => ({ id: p.name, label: p.name, kind: 'source' as const })),
        ...top.map((r) => ({ id: `m:${r.model}`, label: r.model, kind: 'sink' as const })),
      ],
      links: top.map((r) => ({
        source: r.provider,
        target: `m:${r.model}`,
        value: r.tokens,
        sourceId: r.provider,
      })),
    }
  }, [agg, topN])

  if (data.nodes.length === 0) {
    return <div className="aw-tf-empty">no provider→model traffic in window</div>
  }

  return (
    <div className="aw-tf-canvas">
      <div className="aw-tf-canvas__toolbar">
        <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>top</span>
        {[10, 20, 50, 100].map((n) => (
          <button
            key={n}
            type="button"
            className={`aw-tf-chip ${topN === n ? 'aw-tf-chip--active' : ''}`}
            onClick={() => setTopN(n)}
          >
            {n}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--fg-3)', fontSize: 11 }}>
          wheel zoom · drag pan · dbl-click reset · right-click for menu
        </span>
      </div>
      <div style={{ padding: 8, height: 'calc(100% - 56px)', overflow: 'auto' }}>
        <AwSankey data={data} title="traffic-flow-sankey" height={Math.max(560, data.nodes.length * 32)} wheelZoom="always" />
      </div>
    </div>
  )
}

// ============================================================================
// HEATMAP VIEW (d3 inferno colorscale via AwHeatmap)
// ============================================================================

const HeatmapView: React.FC<{ agg: ReturnType<typeof useAggregatedFlow> }> = ({ agg }) => {
  const data = React.useMemo<AwHeatmapData>(() => {
    if (agg.rows.length === 0) return { rows: [], cols: [], cells: [] }
    const top = agg.rows.slice(0, 30)
    const models = [...new Set(top.map((r) => r.model))]
    const providers = agg.providers
      .filter((p) => top.some((r) => r.provider === p.name))
      .map((p) => p.name)
    return {
      rows: providers,
      cols: models,
      cells: top.map((r) => ({ row: r.provider, col: r.model, value: r.tokens })),
      legendLabel: 'tokens',
    }
  }, [agg])

  if (data.cells.length === 0) {
    return <div className="aw-tf-empty">no provider→model traffic in window</div>
  }

  return (
    <div className="aw-tf-canvas">
      <div className="aw-tf-canvas__toolbar">
        <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>
          {data.rows.length} providers × {data.cols.length} models · color = tokens (inferno scale)
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-3)', fontSize: 11 }}>
          wheel zoom · drag pan · right-click for menu
        </span>
      </div>
      <div style={{ padding: 8, height: 'calc(100% - 56px)' }}>
        <AwHeatmap data={data} title="traffic-flow-heatmap" height={560} wheelZoom="always" />
      </div>
    </div>
  )
}

// ============================================================================
// RING VIEW — provider donut + top-models rank list
// ============================================================================

const RingView: React.FC<{ agg: ReturnType<typeof useAggregatedFlow> }> = ({ agg }) => {
  const providerDonut = React.useMemo<AwDonutData>(() => {
    if (agg.providers.length === 0) return { slices: [] }
    return {
      slices: agg.providers.map((p) => ({ name: p.name, value: p.value })),
      centerSubtitle: `${fmtNum(agg.total)} tokens`,
    }
  }, [agg])

  const topModels = React.useMemo(() => agg.rows.slice(0, 15), [agg])

  if (agg.providers.length === 0) {
    return <div className="aw-tf-empty">no provider→model traffic in window</div>
  }

  return (
    <div className="aw-tf-canvas">
      <div className="aw-tf-canvas__toolbar">
        <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>
          {agg.providers.length} providers · top {topModels.length} models
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 600px) 1fr', gap: 24, padding: 16, height: 'calc(100% - 56px)' }}>
        <div>
          <AwDonut data={providerDonut} title="traffic-flow-providers" height={520} wheelZoom="always" />
        </div>
        <div style={{
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 8,
          padding: 16,
          overflow: 'auto',
        }}>
          <div style={{
            color: 'var(--fg-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            marginBottom: 10,
          }}>
            top {topModels.length} models — tokens
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(() => {
              const maxV = topModels[0]?.tokens ?? 1
              return topModels.map((r, i) => {
                const pct = (r.tokens / maxV) * 100
                return (
                  <div key={r.model} style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1fr 90px',
                    alignItems: 'center',
                    gap: 10,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                  }}>
                    <span style={{ color: 'var(--fg-3)' }}>#{i + 1}</span>
                    <div>
                      <div style={{ color: 'var(--fg-0)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.model}</div>
                      <div style={{ background: 'var(--line-2)', height: 6, borderRadius: 2 }}>
                        <div style={{ background: 'var(--accent)', width: `${pct}%`, height: '100%', borderRadius: 2, transition: 'width 240ms' }} />
                      </div>
                    </div>
                    <span style={{ color: 'var(--fg-0)', textAlign: 'right' }}>{fmtTokens(r.tokens)}</span>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Modal shell
// ============================================================================

type ViewKey = 'sankey' | 'heatmap' | 'ring'

export const TrafficFlowExpand: React.FC<{
  llmProviders: UseLlmProvidersData
  modelUsage: ModelUsageRow[]
  onClose: () => void
}> = ({ llmProviders, modelUsage, onClose }) => {
  const [view, setView] = React.useState<ViewKey>('sankey')
  const agg = useAggregatedFlow(llmProviders, modelUsage)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="aw-tf-modal-overlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onClose() } }}
    >
      <div className="aw-tf-modal" role="dialog" aria-modal="true" aria-label="Traffic flow — full-screen views">
        <header className="aw-tf-modal__head">
          <div className="aw-tf-modal__title">
            <span className="aw-tf-modal__num">02</span>
            <h2>Traffic Flow</h2>
            <span className="aw-tf-modal__meta">
              provider → model · {fmtNum(agg.total)} tokens · {agg.providers.length} providers · {agg.rows.length} models
            </span>
          </div>
          <div className="aw-tf-modal__viewtabs" role="tablist" aria-label="Visualisation">
            {([
              { id: 'sankey',  label: 'sankey'  },
              { id: 'heatmap', label: 'heatmap' },
              { id: 'ring',    label: 'ring'    },
            ] as const).map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                className={`aw-tf-modal__viewtab ${view === v.id ? 'aw-tf-modal__viewtab--active' : ''}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="aw-tf-modal__close"
            onClick={onClose}
            aria-label="Close traffic-flow expanded view"
          >
            ✕
          </button>
        </header>
        <div className="aw-tf-modal__body">
          {view === 'sankey'  && <SankeyView  agg={agg} />}
          {view === 'heatmap' && <HeatmapView agg={agg} />}
          {view === 'ring'    && <RingView    agg={agg} />}
        </div>
      </div>
    </div>
  )
}
