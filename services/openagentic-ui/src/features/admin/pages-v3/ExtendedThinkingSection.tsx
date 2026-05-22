import * as React from 'react'
import {
  Grid,
  Panel,
  PanelHead,
  EmptyInline,
  SectionBar,
  MetricChart,
} from '../primitives-v3'
import { useAdminQuery } from '../hooks/useAdminQuery'

// ─── types ───────────────────────────────────────────────────────────────────

export interface ExtThinkingTotals {
  requested: number
  delivered: number
  requestedNotDelivered: number
  avgThinkingTokens: number
  avgThinkingDurationMs: number
}

export interface ExtThinkingByModel {
  model: string
  requested: number
  delivered: number
  avgTokens: number
}

export interface ExtThinkingByDay {
  date: string
  requested: number
  delivered: number
}

export interface ExtThinkingResp {
  success: boolean
  windowStart: string
  windowEnd: string
  totals: ExtThinkingTotals
  byModel: ExtThinkingByModel[]
  byDay: ExtThinkingByDay[]
}

// ─── component ───────────────────────────────────────────────────────────────

interface ExtendedThinkingSectionProps {
  timeRange: string
}

function fmtNum(n: number | undefined | null): string {
  if (typeof n !== 'number') return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export const ExtendedThinkingSection: React.FC<ExtendedThinkingSectionProps> = ({ timeRange }) => {
  const etQuery = useAdminQuery<ExtThinkingResp>(
    ['extended-thinking', timeRange],
    `/admin/analytics/extended-thinking?window=${timeRange}`,
    { staleTime: 60_000 },
  )

  return (
    <>
      <SectionBar
        data-testid="et-section-bar"
        title="08 · extended thinking usage"
        right={<span style={{ color: 'var(--fg-3)' }}>brain-toggle usage · requested vs delivered · last {timeRange}</span>}
      />

      {etQuery.isLoading && (
        <EmptyInline pad data-testid="et-loading">loading extended thinking metrics…</EmptyInline>
      )}
      {!etQuery.isLoading && etQuery.isError && (
        <EmptyInline pad data-testid="et-error">failed to load extended thinking metrics</EmptyInline>
      )}

      {!etQuery.isLoading && !etQuery.isError && (() => {
        const et = etQuery.data
        const totals = et?.totals
        const byDay = et?.byDay ?? []
        const byModel = et?.byModel ?? []
        const deliveryRate = totals && totals.requested > 0
          ? Math.round((totals.delivered / totals.requested) * 100)
          : null

        return (
          <>
            {/* KPI strip */}
            <Grid cols={4}>
              <Panel data-testid="et-kpi-requested">
                <PanelHead title="Requested" />
                <div style={{ padding: '12px 16px', fontSize: 28, fontWeight: 600, color: 'var(--cm-fg)' }}>
                  {totals ? fmtNum(totals.requested) : '—'}
                </div>
                <div style={{ padding: '0 16px 12px', fontSize: 12, color: 'var(--fg-3)' }}>turns with Brain ON + model capable</div>
              </Panel>
              <Panel data-testid="et-kpi-delivery-rate">
                <PanelHead title="Delivery Rate" />
                <div
                  style={{
                    padding: '12px 16px',
                    fontSize: 28,
                    fontWeight: 600,
                    color: deliveryRate != null && deliveryRate > 80 ? 'var(--cm-success)' : 'var(--cm-warn)',
                  }}
                >
                  {deliveryRate != null ? `${deliveryRate}%` : '—'}
                </div>
                <div style={{ padding: '0 16px 12px', fontSize: 12, color: 'var(--fg-3)' }}>delivered / requested</div>
              </Panel>
              <Panel data-testid="et-kpi-avg-tokens">
                <PanelHead title="Avg Thinking Tokens" />
                <div style={{ padding: '12px 16px', fontSize: 28, fontWeight: 600, color: 'var(--cm-fg)' }}>
                  {totals ? fmtNum(totals.avgThinkingTokens) : '—'}
                </div>
                <div style={{ padding: '0 16px 12px', fontSize: 12, color: 'var(--fg-3)' }}>approx chars÷4 per turn</div>
              </Panel>
              <Panel data-testid="et-kpi-c2-suppressed">
                <PanelHead title="C2 Suppressed" count="requested but not delivered" />
                <div style={{ padding: '12px 16px', fontSize: 28, fontWeight: 600, color: 'var(--cm-warn)' }}>
                  {totals ? fmtNum(totals.requestedNotDelivered) : '—'}
                </div>
                <div style={{ padding: '0 16px 12px', fontSize: 12, color: 'var(--fg-3)' }}>tool_choice forced — thinking stripped</div>
              </Panel>
            </Grid>

            {/* Requested vs Delivered line chart + by-model bar chart */}
            <Grid cols={2}>
              <Panel>
                <PanelHead title="Requested vs Delivered" count={`${timeRange} · by day`} />
                {byDay.length === 0 && <EmptyInline pad>no thinking usage in window</EmptyInline>}
                {byDay.length > 0 && (
                  <div style={{ padding: 8 }}>
                    <MetricChart
                      data-testid="et-line-chart"
                      variant="line"
                      yFormat={(v: number) => String(v)}
                      xLabels={byDay.map((d) => d.date.slice(5))}
                      series={[
                        { name: 'requested', data: byDay.map((d) => d.requested), color: 'accent' },
                        { name: 'delivered', data: byDay.map((d) => d.delivered), color: 'ok' },
                      ]}
                      showLegend
                    />
                  </div>
                )}
              </Panel>
              <Panel>
                <PanelHead title="By Model" count={`${timeRange} · top ${Math.min(byModel.length, 8)}`} />
                {byModel.length === 0 && <EmptyInline pad>no per-model thinking data in window</EmptyInline>}
                {byModel.length > 0 && (
                  <div style={{ padding: 8 }}>
                    <MetricChart
                      data-testid="et-bar-chart"
                      variant="bar"
                      yFormat={(v: number) => String(v)}
                      xLabels={byModel.slice(0, 8).map((m) => m.model.split('.').pop() ?? m.model)}
                      series={[
                        { name: 'requested', data: byModel.slice(0, 8).map((m) => m.requested), color: 'accent' },
                        { name: 'delivered', data: byModel.slice(0, 8).map((m) => m.delivered), color: 'ok' },
                      ]}
                      showLegend
                    />
                  </div>
                )}
              </Panel>
            </Grid>
          </>
        )
      })()}
    </>
  )
}

export default ExtendedThinkingSection
