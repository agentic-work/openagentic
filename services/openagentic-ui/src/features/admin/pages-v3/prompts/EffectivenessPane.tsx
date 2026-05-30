import * as React from 'react'
import {
  Panel,
  PanelHead,
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  SectionBar,
  BarList,
  MetricChart,
  Dt,
  type DtCol,
} from '../../primitives-v3'
import { useEffectiveness } from './hooks'
import { fmtPct, moduleEffectivenessScore } from './types'

type ModuleUsageRow = {
  moduleName: string
  usageCount: number
  positiveCount: number
  negativeCount: number
  averageTokenCost?: number
}

const moduleBreakdownColumns: DtCol<ModuleUsageRow>[] = [
  {
    key: 'name',
    label: 'MODULE',
    className: 'name',
    render: (r) => r.moduleName,
  },
  {
    key: 'uses',
    label: 'USES',
    align: 'right',
    className: 'num',
    render: (r) => r.usageCount.toLocaleString(),
  },
  {
    key: 'pos',
    label: 'POS',
    align: 'right',
    className: 'num',
    render: (r) => <span style={{ color: 'var(--ok)' }}>{r.positiveCount}</span>,
  },
  {
    key: 'neg',
    label: 'NEG',
    align: 'right',
    className: 'num',
    render: (r) => <span style={{ color: 'var(--err)' }}>{r.negativeCount}</span>,
  },
  {
    key: 'win',
    label: 'WIN%',
    align: 'right',
    className: 'num',
    render: (r) => {
      const total = r.positiveCount + r.negativeCount
      const win = total > 0 ? Math.round((r.positiveCount / total) * 100) : null
      const color =
        win === null
          ? 'var(--fg-3)'
          : win >= 60
            ? 'var(--ok)'
            : win >= 40
              ? 'var(--warn)'
              : 'var(--err)'
      return <span style={{ color }}>{win === null ? '—' : `${win}%`}</span>
    },
  },
]

export const EffectivenessPane: React.FC = () => {
  const eff = useEffectiveness()
  const data = eff.data

  const usageBars = React.useMemo(() => {
    return (data?.moduleUsage ?? [])
      .slice(0, 12)
      .map((r) => ({
        name: r.moduleName,
        value: r.usageCount,
      }))
  }, [data])

  const winRateBars = React.useMemo(() => {
    return (data?.moduleUsage ?? [])
      .filter((r) => r.positiveCount + r.negativeCount > 0)
      .map((r) => ({
        name: r.moduleName,
        value: Math.round(moduleEffectivenessScore(r)),
        color: 'ok' as const,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)
  }, [data])

  const positiveRate =
    data && data.positiveOutcomes + data.negativeOutcomes > 0
      ? fmtPct(data.positiveOutcomes, data.positiveOutcomes + data.negativeOutcomes)
      : '—'

  return (
    <>
      <SectionBar
        title="effectiveness aggregate (30d)"
        right={<span style={{ color: 'var(--fg-3)' }}>/api/admin/prompts/effectiveness</span>}
      />
      {eff.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/prompts/effectiveness</span>
        </Banner>
      )}
      <KpiGrid cols={4}>
        <Kpi
          label="recent comps"
          value={eff.isLoading ? '…' : data?.recentCompositions ?? '—'}
          sub="last 30 days"
        />
        <Kpi
          label="positive rate"
          value={eff.isLoading ? '…' : positiveRate}
          sub={
            data
              ? `${data.positiveOutcomes} pos / ${data.negativeOutcomes} neg`
              : 'no rated outcomes yet'
          }
          tone={data && data.positiveOutcomes >= data.negativeOutcomes ? 'ok' : 'default'}
        />
        <Kpi
          label="pending"
          value={eff.isLoading ? '…' : data?.pendingOutcomes ?? '—'}
          sub="waiting for outcome"
        />
        <Kpi
          label="modules tracked"
          value={eff.isLoading ? '…' : data?.totalModules ?? '—'}
          sub="distinct module names in window"
        />
      </KpiGrid>

      <SectionBar title="top modules by usage" />
      <Panel>
        <PanelHead title="usage rank" count={usageBars.length} />
        {eff.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : usageBars.length === 0 ? (
          <EmptyInline pad>no module usage recorded in the last 30 days</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <BarList items={usageBars} />
          </div>
        )}
      </Panel>

      <SectionBar
        title="win rate by module"
        right={<span style={{ color: 'var(--fg-3)' }}>positive / (positive + negative)</span>}
      />
      <Panel>
        <PanelHead title="win-rate ranking" count={winRateBars.length} />
        {eff.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : winRateBars.length === 0 ? (
          <EmptyInline pad>no rated outcomes — needs positive/negative feedback first</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="bar-h"
              data={winRateBars}
              yFormat="pct"
              height={Math.max(140, winRateBars.length * 24)}
            />
          </div>
        )}
      </Panel>

      <SectionBar title="per-module breakdown" />
      <Panel>
        <PanelHead title="modules" count={data?.moduleUsage.length ?? 0} />
        {eff.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : !data || data.moduleUsage.length === 0 ? (
          <EmptyInline pad>no per-module rows yet</EmptyInline>
        ) : (
          <Dt
            rows={data.moduleUsage}
            rowKey={(r) => r.moduleName}
            columns={moduleBreakdownColumns}
          />
        )}
      </Panel>
    </>
  )
}
