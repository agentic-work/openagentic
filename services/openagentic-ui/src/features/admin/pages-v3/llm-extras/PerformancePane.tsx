import * as React from 'react'
import {
  Panel,
  PanelHead,
  EmptyInline,
  Banner,
  KpiGrid,
  Kpi,
  SectionBar,
  MetricChart,
  type ChartSeries,
  Chip,
} from '../../primitives-v3'
import {
  useLlmPerformance,
  useLlmPerformanceTrends,
  type LlmPerformanceTrendPoint,
} from '../../hooks/useDashboardMetrics'

function fmtMs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1000) return `${Math.round(n)}ms`
  return `${(n / 1000).toFixed(2)}s`
}

function fmtTokensPerSecond(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(1)} tok/s`
}

function fmtLabelFromIso(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getHours())}:${z(d.getMinutes())}`
}

const HOUR_OPTIONS: Array<{ id: '1' | '6' | '24' | '168'; label: string }> = [
  { id: '1',   label: '1h' },
  { id: '6',   label: '6h' },
  { id: '24',  label: '24h' },
  { id: '168', label: '7d' },
]

export const PerformancePane: React.FC = () => {
  const [hoursStr, setHoursStr] = React.useState<'1' | '6' | '24' | '168'>('24')
  const hours = parseInt(hoursStr, 10)

  const perfQ = useLlmPerformance(hours)
  const trendsQ = useLlmPerformanceTrends(hours)

  const kpis = perfQ.data?.kpis
  const trends: LlmPerformanceTrendPoint[] = trendsQ.data?.trends ?? []

  // Build latency time-series — P50/P95/P99 of total response time
  // mapped onto trends[].avgTotalLatency / p95TotalLatency. P99 isn't
  // bucketed by the api so we fall back to the aggregate from /performance
  // when needed (single point).
  const xLabels = trends.map((t) => fmtLabelFromIso(String(t.timestamp ?? '')))
  const latencySeries: ChartSeries[] = [
    {
      name: 'p50',
      data: trends.map((t) => t.avgTotalLatency ?? 0),
      color: 'accent',
    },
    {
      name: 'p95',
      data: trends.map((t) => t.p95TotalLatency ?? 0),
      color: 'warn',
    },
  ]

  // Throughput — TTFT vs total latency average per bucket.
  const ttftSeries: ChartSeries[] = [
    {
      name: 'ttft p50',
      data: trends.map((t) => t.avgTTFT ?? 0),
      color: 'info',
    },
    {
      name: 'ttft p95',
      data: trends.map((t) => t.p95TTFT ?? 0),
      color: 'err',
    },
  ]

  // Per-model latency bar chart from KPIs.
  const modelLatencyData = (kpis?.modelLatencyByModel ?? [])
    .slice()
    .sort((a, b) => b.avgLatency - a.avgLatency)
    .slice(0, 10)
    .map((m) => ({ name: m.model, value: m.avgLatency }))

  const totalRequests = trends.reduce((acc, t) => acc + (t.requestCount ?? 0), 0)
  const anyError = perfQ.isError || trendsQ.isError
  const anyLoading = perfQ.isLoading || trendsQ.isLoading

  return (
    <>
      {anyError && (
        <Banner level="warn" label="warn">
          failed to load <span className="accent">/api/admin/metrics/llm/performance*</span> —
          values below may be partial
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="avg ttft"
          value={anyLoading ? '…' : fmtMs(kpis?.avgTTFT)}
          sub={kpis ? `p95 ${fmtMs(kpis.p95TTFT)} · p99 ${fmtMs(kpis.p99TTFT)}` : 'time to first token'}
        />
        <Kpi
          label="avg response"
          value={anyLoading ? '…' : fmtMs(kpis?.avgResponseTime)}
          sub={
            kpis
              ? `p95 ${fmtMs(kpis.p95ResponseTime)} · p99 ${fmtMs(kpis.p99ResponseTime)}`
              : 'end-to-end'
          }
        />
        <Kpi
          label="throughput"
          value={anyLoading ? '…' : fmtTokensPerSecond(kpis?.avgTokensPerSecond)}
          sub={
            kpis
              ? `p95 ${fmtTokensPerSecond(kpis.p95TokensPerSecond)}`
              : 'completion stream'
          }
        />
        <Kpi
          label="requests"
          value={
            anyLoading
              ? '…'
              : totalRequests > 0
                ? totalRequests.toLocaleString()
                : kpis?.totalTokens != null
                  ? '—'
                  : '0'
          }
          sub={`window ${HOUR_OPTIONS.find((h) => h.id === hoursStr)?.label ?? hoursStr}`}
        />
      </KpiGrid>

      <SectionBar
        title="window"
        right={
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {HOUR_OPTIONS.map((h) => (
              <Chip
                key={h.id}
                label={h.label}
                on={hoursStr === h.id}
                onClick={() => setHoursStr(h.id)}
              />
            ))}
          </span>
        }
      />

      <SectionBar
        title="response time"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            p50 / p95 over time · ms · {trends.length} buckets
          </span>
        }
      />
      <Panel>
        <PanelHead
          title="total latency"
          right={
            trendsQ.data?.timeRange?.bucketMinutes != null ? (
              <span className="mono" style={{ color: 'var(--fg-3)' }}>
                {trendsQ.data.timeRange.bucketMinutes}m buckets
              </span>
            ) : null
          }
        />
        {trendsQ.isLoading && trends.length === 0 ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : trends.length === 0 ? (
          <EmptyInline pad>
            no LLM requests in the selected window — try widening to <span className="accent">7d</span>
          </EmptyInline>
        ) : (
          <div style={{ padding: 14 }}>
            <MetricChart
              variant="area"
              series={latencySeries}
              xLabels={xLabels}
              yFormat="ms"
              height={200}
              showLegend
            />
          </div>
        )}
      </Panel>

      <SectionBar
        title="time to first token"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            p50 / p95 ttft · ms
          </span>
        }
      />
      <Panel>
        <PanelHead title="ttft" />
        {trendsQ.isLoading && trends.length === 0 ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : trends.length === 0 ? (
          <EmptyInline pad>no ttft data in this window</EmptyInline>
        ) : (
          <div style={{ padding: 14 }}>
            <MetricChart
              variant="area"
              series={ttftSeries}
              xLabels={xLabels}
              yFormat="ms"
              height={180}
              showLegend
            />
          </div>
        )}
      </Panel>

      <SectionBar
        title="latency by model"
        count={modelLatencyData.length}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            top 10 · avg latency · sourced from kpis.modelLatencyByModel
          </span>
        }
      />
      <Panel>
        <PanelHead
          title="per-model"
          right={
            kpis?.errorRateByModel && kpis.errorRateByModel.length > 0 ? (
              <span style={{ color: 'var(--fg-3)' }}>
                {kpis.errorRateByModel.length} models with error data
              </span>
            ) : null
          }
        />
        {perfQ.isLoading && modelLatencyData.length === 0 ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : modelLatencyData.length === 0 ? (
          <EmptyInline pad>
            no per-model latency yet — populated once{' '}
            <span className="accent">LLMRequestLog</span> has rows in this window
          </EmptyInline>
        ) : (
          <div style={{ padding: 14 }}>
            <MetricChart
              variant="bar-h"
              data={modelLatencyData}
              yFormat="ms"
              height={Math.max(180, modelLatencyData.length * 24 + 40)}
            />
          </div>
        )}
      </Panel>
    </>
  )
}
