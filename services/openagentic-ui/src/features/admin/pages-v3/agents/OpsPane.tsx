import * as React from 'react'
import {
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  Grid,
  MetricChart,
  Feed,
  FeedRow,
  Dt,
  type DtCol,
  EmptyInline,
  Banner,
  StatusDot,
} from '../../primitives-v3'
import {
  fmtRelative,
  fmtClock,
  fmtDuration,
  fmtPct,
  fmtUsdFromCents,
  execStatusDot,
} from './types'
import {
  type AdminAgentExecutionStats,
  type AdminAgentLiveExecution,
  type FleetMetricsAgent,
  type DashboardTimeSeries,
} from '../../hooks/useDashboardMetrics'
import { usePromRange } from '../../hooks/useProm'

export interface OpsPaneProps {
  stats?: AdminAgentExecutionStats
  statsLoading: boolean
  statsError: boolean

  live?: AdminAgentLiveExecution[]
  liveLoading: boolean
  liveError: boolean

  fleet?: FleetMetricsAgent[]
  fleetLoading: boolean
  fleetError: boolean

  /** From useDashboardMetrics — optional, may be undefined while
   * the dashboard payload is in flight. Used to draw the executions
   * area chart. */
  timeSeries?: DashboardTimeSeries

  onPickAgentId: (agentId: string) => void
}

function liveAgentLabel(e: AdminAgentLiveExecution): string {
  const role = e.agent_specs?.[0]?.role ?? e.results?.[0]?.role
  if (role) return role
  if (e.orchestration) return e.orchestration
  return e.id?.slice(0, 8) ?? 'unknown'
}

export const OpsPane: React.FC<OpsPaneProps> = ({
  stats,
  statsLoading,
  statsError,
  live,
  liveLoading,
  liveError,
  fleet,
  fleetLoading,
  fleetError,
  timeSeries,
  onPickAgentId,
}) => {
  const fleetRows = fleet ?? []
  const liveRows = live ?? []
  const successPct = stats?.successRate ?? null

  // "executions over time" is driven from Prometheus
  // gen_ai_agent_invocations_total (incremented by GenAITracer.withAgentSpan
  // on each sub-agent/Task dispatch), NOT timeSeries.agentExecutions —
  // useDashboardMetrics hard-codes that array to [] now that
  // /api/admin/dashboard/metrics is deleted, so it always read empty. This
  // metric only populates once a sub-agent dispatch runs; until then we keep
  // an honest zero-state. 2026-06-04.
  const execRange = usePromRange(
    'sum(rate(gen_ai_agent_invocations_total[5m]))',
    { minutes: 1440, step: 120 },
  )
  const chartSeries = React.useMemo(() => {
    const values = execRange.data?.[0]?.values ?? []
    if (values.length === 0) return null
    const data = values.map(([, v]) => Number(v) || 0)
    if (!data.some((v) => v !== 0)) return null
    const z = (n: number) => String(n).padStart(2, '0')
    const xLabels = values.map(([t]) => {
      const d = new Date(t * 1000)
      return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
    })
    return { data, xLabels }
  }, [execRange.data])

  const fleetCols: DtCol<FleetMetricsAgent>[] = [
    {
      key: 'agent',
      label: 'Agent',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.agentName}</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>{r.agentType}</span>
        </span>
      ),
    },
    {
      key: 'runs',
      label: 'Runs 24h',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => r.runCount24h.toLocaleString(),
    },
    {
      key: 'success',
      label: 'Success',
      width: '80px',
      align: 'right',
      className: 'num',
      render: (r) => {
        if (r.runCount24h === 0) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const pct = r.successRate * 100
        const tone = pct >= 95 ? 'var(--ok)' : pct >= 75 ? 'var(--warn)' : 'var(--err)'
        return <span style={{ color: tone }}>{fmtPct(pct, 0)}</span>
      },
    },
    {
      key: 'p50',
      label: 'p50',
      width: '80px',
      align: 'right',
      className: 'mono',
      render: (r) => fmtDuration(r.p50DurationMs),
    },
    {
      key: 'cost',
      label: 'Cost 24h',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => fmtUsdFromCents(r.totalCostCents),
    },
  ]

  return (
    <>
      {(statsError || liveError || fleetError) && (
        <Banner level="warn" label="partial">
          one or more agent ops endpoints are unreachable — view may be incomplete
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="active now"
          value={statsLoading ? '…' : (stats?.activeAgents ?? 0).toLocaleString()}
          tone={stats && stats.activeAgents > 0 ? 'ok' : 'default'}
          sub={`${liveRows.length} executions in flight`}
        />
        <Kpi
          label="runs today"
          value={statsLoading ? '…' : (stats?.totalToday ?? 0).toLocaleString()}
          sub={`${(stats?.failedToday ?? 0).toLocaleString()} failed`}
        />
        <Kpi
          label="runs (7d)"
          value={statsLoading ? '…' : (stats?.totalWeek ?? 0).toLocaleString()}
          sub={`avg ${fmtDuration(stats?.avgLatencyMs)} latency`}
        />
        <Kpi
          label="success rate (7d)"
          value={statsLoading ? '…' : successPct != null ? `${successPct}%` : '—'}
          tone={
            successPct == null
              ? 'default'
              : successPct >= 95
                ? 'ok'
                : successPct >= 75
                  ? 'warn'
                  : 'err'
          }
          sub={fmtUsdFromCents(stats?.costTodayCents ?? 0) + ' spent today'}
        />
      </KpiGrid>

      <Grid cols={2}>
        <Panel>
          <PanelHead
            title="executions over time"
            count="24h"
            right={
              <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
                gen_ai_agent_invocations_total
              </span>
            }
          />
          {execRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : execRange.isError ? (
            <EmptyInline pad>prom query failed</EmptyInline>
          ) : chartSeries == null ? (
            <EmptyInline pad>awaiting data — populates as sub-agents dispatch.</EmptyInline>
          ) : (
            <div style={{ padding: '8px 12px 12px' }}>
              <MetricChart
                variant="area"
                series={[{ name: 'invocations/sec', data: chartSeries.data, color: 'accent' }]}
                xLabels={chartSeries.xLabels}
                yFormat={(v) => v.toFixed(2)}
                height={200}
              />
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHead
            title="in flight"
            count={liveRows.length}
            right={
              <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
                /api/admin/agents/executions/live · 5s
              </span>
            }
          />
          {liveLoading && liveRows.length === 0 ? (
            <EmptyInline pad>loading live executions…</EmptyInline>
          ) : liveRows.length === 0 ? (
            <EmptyInline pad>no executions currently running.</EmptyInline>
          ) : (
            <Feed>
              {liveRows.slice(0, 12).map((e) => (
                <FeedRow
                  key={e.id}
                  ts={fmtClock(e.created_at ?? e.startedAt)}
                  status={execStatusDot(e.status)}
                  who={liveAgentLabel(e)}
                  act={
                    <>
                      <span className="accent">{e.status}</span>
                      {e.orchestration && (
                        <>
                          {' · '}
                          <span style={{ color: 'var(--fg-2)' }}>{e.orchestration}</span>
                        </>
                      )}
                    </>
                  }
                  right={
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {fmtUsdFromCents(e.total_cost_cents)}
                    </span>
                  }
                />
              ))}
            </Feed>
          )}
        </Panel>
      </Grid>

      <Panel>
        <PanelHead
          title="fleet health"
          count={fleetRows.length}
          right={
            <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
              /api/admin/agents/metrics/fleet · 24h window
            </span>
          }
        />
        {fleetLoading && fleetRows.length === 0 ? (
          <EmptyInline pad>loading fleet metrics…</EmptyInline>
        ) : fleetRows.length === 0 ? (
          <EmptyInline pad>no agents have produced runs in the last 24h.</EmptyInline>
        ) : (
          <div style={{ padding: '4px 14px 12px' }}>
            <Dt
              columns={fleetCols}
              rows={fleetRows}
              rowKey={(r) => r.agentId}
              onRowClick={(r) => onPickAgentId(r.agentId)}
              onRowDoubleClick={(r) => onPickAgentId(r.agentId)}
              rowDataAttrs={(r: any) => {
                const total = Number(r.totalRuns ?? r.runs ?? 0)
                const failed = Number(r.failedRuns ?? r.failed ?? 0)
                const failRate = total > 0 ? failed / total : 0
                return {
                  status: failRate > 0.2 ? 'err' : failRate > 0.05 ? 'warn' : total > 0 ? 'ok' : 'idle',
                }
              }}
            />
          </div>
        )}
      </Panel>

      {/* The Ops feed deliberately uses local refresh-on-poll — there's
          no manual refetch button here because every hook on this page
          auto-revalidates every 5–15s. The Banner above surfaces partial
          failures so operators know when a tile is stale. */}
      {fleetRows.length > 0 && (
        <div
          style={{
            padding: '6px 14px 0',
            color: 'var(--fg-3)',
            fontSize: 'var(--v3-t-meta)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <StatusDot status="info" />
          <span>auto-refresh: stats 15s · live 5s · fleet 15s</span>
        </div>
      )}
    </>
  )
}

export default OpsPane
