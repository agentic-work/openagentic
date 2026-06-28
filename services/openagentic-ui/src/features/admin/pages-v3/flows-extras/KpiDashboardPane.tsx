import * as React from 'react'
import {
  Panel,
  PanelHead,
  Banner,
  EmptyInline,
  MiniGrid,
  Mini,
  BarList,
  Chip,
  FilterRow,
  SectionBar,
} from '../../primitives-v3'
import type { FlowsKpiData } from '../../services/flowsAdminApi'
import { type KpiWindow } from './hooks'
import { fmtNum, fmtUsd, fmtPct } from './types'

const WINDOWS: KpiWindow[] = ['1h', '6h', '24h', '7d', '30d', '90d']

export interface KpiDashboardPaneProps {
  data: FlowsKpiData | null | undefined
  isLoading: boolean
  isError: boolean
  window: KpiWindow
  onWindow: (w: KpiWindow) => void
}

export const KpiDashboardPane: React.FC<KpiDashboardPaneProps> = ({
  data,
  isLoading,
  isError,
  window,
  onWindow,
}) => {
  if (isError) {
    return (
      <Banner level="err" label="error">
        failed to load <span className="accent">/api/admin/flows/kpis</span>
      </Banner>
    )
  }

  const failing = data?.top_failing_nodes ?? []
  const expensive = data?.top_expensive_flows ?? []

  const successTone =
    data?.success_rate == null
      ? 'default'
      : data.success_rate >= 95
        ? 'ok'
        : data.success_rate >= 80
          ? 'warn'
          : 'err'

  return (
    <>
      <FilterRow>
        {WINDOWS.map((w) => (
          <Chip
            key={w}
            label="window"
            value={w}
            on={window === w}
            onClick={() => onWindow(w)}
          />
        ))}
      </FilterRow>

      <Panel>
        <PanelHead
          title="headline kpis"
          right={
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              window: {window}
            </span>
          }
        />
        {isLoading && !data ? (
          <EmptyInline pad>loading /api/admin/flows/kpis…</EmptyInline>
        ) : (
          <div style={{ padding: 12 }}>
            <MiniGrid cols={4}>
              <Mini
                label="executions"
                value={isLoading ? '…' : fmtNum(data?.total_executions)}
              />
              <Mini
                label="success rate"
                value={isLoading ? '…' : fmtPct(data?.success_rate, 1)}
                tone={successTone}
              />
              <Mini
                label="p95 latency"
                value={
                  isLoading
                    ? '…'
                    : data?.latency_p95_ms != null
                      ? `${Math.round(data.latency_p95_ms).toLocaleString()}ms`
                      : '—'
                }
              />
              <Mini
                label="avg cost / run"
                value={isLoading ? '…' : fmtUsd(data?.avg_cost_per_execution_usd)}
                sub={data?.total_cost_usd != null ? `total ${fmtUsd(data.total_cost_usd)}` : ''}
              />
            </MiniGrid>
            <div style={{ marginTop: 12 }}>
              <MiniGrid cols={3}>
                <Mini
                  label="latency p50"
                  value={
                    isLoading
                      ? '…'
                      : data?.latency_p50_ms != null
                        ? `${Math.round(data.latency_p50_ms).toLocaleString()}ms`
                        : '—'
                  }
                />
                <Mini
                  label="latency p99"
                  value={
                    isLoading
                      ? '…'
                      : data?.latency_p99_ms != null
                        ? `${Math.round(data.latency_p99_ms).toLocaleString()}ms`
                        : '—'
                  }
                />
                <Mini
                  label="failing node count"
                  value={isLoading ? '…' : String(failing.length)}
                  tone={failing.length > 0 ? 'warn' : 'default'}
                />
              </MiniGrid>
            </div>
          </div>
        )}
      </Panel>

      <SectionBar title="top failing nodes" count={failing.length} />
      <Panel>
        <PanelHead title="top failing nodes" count={failing.length} />
        {failing.length === 0 ? (
          <EmptyInline pad>no node failures in the {window} window.</EmptyInline>
        ) : (
          <div style={{ padding: 12 }}>
            <BarList
              items={failing.slice(0, 10).map((n) => ({
                name: (
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    {n.nodeType} <span style={{ color: 'var(--fg-3)' }}>· {n.nodeId.slice(0, 8)}</span>
                  </span>
                ),
                value: n.failureCount,
              }))}
            />
          </div>
        )}
      </Panel>

      <SectionBar title="top expensive flows" count={expensive.length} />
      <Panel>
        <PanelHead title="top expensive flows" count={expensive.length} />
        {expensive.length === 0 ? (
          <EmptyInline pad>no flow cost recorded in the {window} window.</EmptyInline>
        ) : (
          <div style={{ padding: 12 }}>
            <BarList
              items={expensive.slice(0, 10).map((f) => ({
                name: (
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    {f.flowName} <span style={{ color: 'var(--fg-3)' }}>· {f.flowId.slice(0, 8)}</span>
                  </span>
                ),
                value: f.totalCostUsd,
                display: fmtUsd(f.totalCostUsd),
              }))}
            />
          </div>
        )}
      </Panel>
    </>
  )
}

export default KpiDashboardPane
