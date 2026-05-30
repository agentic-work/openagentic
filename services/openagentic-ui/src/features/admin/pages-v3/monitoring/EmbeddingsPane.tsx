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
  MetricChart,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'

interface EmbeddingsConfigShape {
  provider?: string
  model?: string
  dimensions?: number
  endpoint?: string
  enabled?: boolean
  fallbackProvider?: string
  // Older shapes nest under `config`, so we accept both.
  config?: {
    provider?: string
    model?: string
    dimensions?: number
    endpoint?: string
    enabled?: boolean
  }
}

interface ProviderRow {
  provider: string
  requests?: number
  tokens?: number
  cost?: number
  avgLatencyMs?: number
}

interface ModelRow {
  model: string
  requests?: number
  tokens?: number
  cost?: number
  avgLatencyMs?: number
}

interface DailyRow {
  date: string
  count?: number
}

interface EmbeddingsAnalytics {
  success?: boolean
  embeddings?: {
    summary?: {
      totalRequests?: number
      totalTokens?: number
      totalCost?: number
      avgLatencyMs?: number
    }
    byProvider?: ProviderRow[]
    byModel?: ModelRow[]
    dailyTrend?: DailyRow[]
  }
}

const fmtNum = (n: number | undefined | null): string =>
  typeof n !== 'number'
    ? '—'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n)

const fmtUsd = (n: number | undefined | null): string =>
  typeof n === 'number' ? (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`) : '—'

export const EmbeddingsPane: React.FC = () => {
  const cfgQ = useAdminQuery<EmbeddingsConfigShape>(
    ['embeddings', 'config'],
    '/api/admin/embeddings/config',
    { staleTime: 60_000, refetchInterval: 120_000 },
  )
  const aQ = useAdminQuery<EmbeddingsAnalytics>(
    ['analytics', 'embeddings', 'pane'],
    '/api/admin/analytics/embeddings',
    { staleTime: 60_000, refetchInterval: 60_000 },
  )

  const cfg = cfgQ.data ?? {}
  const provider = cfg.provider ?? cfg.config?.provider ?? '—'
  const model = cfg.model ?? cfg.config?.model ?? '—'
  const dims = cfg.dimensions ?? cfg.config?.dimensions
  const enabled = cfg.enabled ?? cfg.config?.enabled

  const sum = aQ.data?.embeddings?.summary ?? {}
  const byProvider = aQ.data?.embeddings?.byProvider ?? []
  const byModel = aQ.data?.embeddings?.byModel ?? []
  const trend = aQ.data?.embeddings?.dailyTrend ?? []

  const trendData = trend.map((p) => Number.isFinite(p.count) ? Number(p.count) : 0)
  const trendLabels = trend.map((p) => {
    try {
      const d = new Date(p.date)
      const z = (n: number) => String(n).padStart(2, '0')
      return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`.slice(5)
    } catch {
      return p.date
    }
  })

  const provCols: DtCol<ProviderRow>[] = [
    { key: 'provider', label: 'provider', className: 'name', render: (r) => r.provider },
    { key: 'reqs', label: 'requests', align: 'right', className: 'num', render: (r) => fmtNum(r.requests) },
    { key: 'tok', label: 'tokens', align: 'right', className: 'num', render: (r) => fmtNum(r.tokens) },
    { key: 'cost', label: 'cost', align: 'right', className: 'num', render: (r) => fmtUsd(r.cost) },
    {
      key: 'lat',
      label: 'avg latency',
      align: 'right',
      className: 'num',
      render: (r) =>
        typeof r.avgLatencyMs === 'number' ? `${Math.round(r.avgLatencyMs)}ms` : '—',
    },
  ]

  const modelCols: DtCol<ModelRow>[] = [
    { key: 'model', label: 'model', className: 'mono', render: (r) => r.model },
    { key: 'reqs', label: 'requests', align: 'right', className: 'num', render: (r) => fmtNum(r.requests) },
    { key: 'tok', label: 'tokens', align: 'right', className: 'num', render: (r) => fmtNum(r.tokens) },
    { key: 'cost', label: 'cost', align: 'right', className: 'num', render: (r) => fmtUsd(r.cost) },
    {
      key: 'lat',
      label: 'avg latency',
      align: 'right',
      className: 'num',
      render: (r) =>
        typeof r.avgLatencyMs === 'number' ? `${Math.round(r.avgLatencyMs)}ms` : '—',
    },
  ]

  return (
    <>
      <SectionBar title="active embeddings configuration" />

      {cfgQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/embeddings/config</span>
        </Banner>
      )}
      {!cfgQ.isLoading && !cfgQ.isError && (
        <Banner level={enabled === false ? 'warn' : 'info'} label="config">
          provider <span className="accent">{provider}</span> · model{' '}
          <span className="accent">{model}</span>
          {typeof dims === 'number' && (
            <>
              {' '}
              · dims <span className="accent">{dims}</span>
            </>
          )}
          {enabled === false && ' · DISABLED'}
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="requests"
          value={aQ.isLoading ? '…' : fmtNum(sum.totalRequests)}
          sub="from analytics endpoint"
        />
        <Kpi
          label="tokens"
          value={aQ.isLoading ? '…' : fmtNum(sum.totalTokens)}
          sub="processed for embeddings"
        />
        <Kpi
          label="cost"
          value={aQ.isLoading ? '…' : fmtUsd(sum.totalCost)}
          sub="estimated"
        />
        <Kpi
          label="avg latency"
          value={
            aQ.isLoading
              ? '…'
              : typeof sum.avgLatencyMs === 'number'
                ? `${Math.round(sum.avgLatencyMs)}ms`
                : '—'
          }
          sub="across providers"
        />
      </KpiGrid>

      <SectionBar title="by provider" />
      <Panel>
        <PanelHead title="provider breakdown" count={byProvider.length} />
        {aQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : aQ.isError ? (
          <EmptyInline pad>failed to fetch /api/admin/analytics/embeddings</EmptyInline>
        ) : byProvider.length === 0 ? (
          <EmptyInline pad>no per-provider embeddings usage</EmptyInline>
        ) : (
          <Dt columns={provCols} rows={byProvider} rowKey={(r) => r.provider} />
        )}
      </Panel>

      <SectionBar title="by model" />
      <Panel>
        <PanelHead title="model breakdown" count={byModel.length} />
        {aQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : byModel.length === 0 ? (
          <EmptyInline pad>no per-model embeddings usage</EmptyInline>
        ) : (
          <Dt columns={modelCols} rows={byModel} rowKey={(r) => r.model} />
        )}
      </Panel>

      <SectionBar title="daily trend" />
      <Panel>
        <PanelHead title="requests by day" count={`${trend.length} days`} />
        {aQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : trend.length === 0 ? (
          <EmptyInline pad>no daily trend data</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="bar"
              series={[{ name: 'requests', data: trendData, color: 'accent' }]}
              xLabels={trendLabels}
              height={180}
            />
          </div>
        )}
      </Panel>
    </>
  )
}

export default EmbeddingsPane
