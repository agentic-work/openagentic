import * as React from 'react'
import {
  Panel,
  PanelHead,
  Banner,
  EmptyInline,
  BarList,
  type BarItem,
  SectionBar,
  Dt,
  type DtCol,
} from '../../primitives-v3'
import {
  type CostBudgetRow,
  type ChargebackGroupRow,
  type DashboardMetricsCostShape,
  type UsageSummary,
  fmtUsd,
  fmtPct,
  fmtNum,
} from './hooks'

export interface InsightsPaneProps {
  usage?: UsageSummary
  usageLoading: boolean
  usageError: boolean
  dashboard?: DashboardMetricsCostShape
  budgets: CostBudgetRow[]
  groups: ChargebackGroupRow[]
}

export const InsightsPane: React.FC<InsightsPaneProps> = ({
  usage,
  usageLoading,
  usageError,
  dashboard,
  budgets,
  groups,
}) => {
  // Cost-by-model: prefer the chargeback usage map, fall back to the
  // dashboard modelUsage rollup. Top 10 only.
  const modelBars: BarItem[] = React.useMemo(() => {
    const direct = usage?.byModel
    if (direct && Object.keys(direct).length > 0) {
      return Object.entries(direct)
        .map(([model, cost]) => ({
          name: model,
          value: cost ?? 0,
          display: fmtUsd(cost ?? 0),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
    }
    const fallback = dashboard?.modelUsage
    if (fallback && fallback.length > 0) {
      return [...fallback]
        .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
        .slice(0, 10)
        .map((m) => ({
          name: m.model,
          value: m.cost ?? 0,
          display: fmtUsd(m.cost ?? 0),
        }))
    }
    return []
  }, [usage, dashboard])

  const providerBars: BarItem[] = React.useMemo(() => {
    const map = usage?.byProvider
    if (!map) return []
    return Object.entries(map)
      .map(([provider, cost]) => ({
        name: provider,
        value: cost ?? 0,
        display: fmtUsd(cost ?? 0),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [usage])

  // Flags: any budget at >= 90%, any group over its budget pct.
  const flaggedBudgets = budgets.filter(
    (b) => typeof b.usagePercent === 'number' && b.usagePercent >= 90,
  )
  const flaggedGroups = groups.filter(
    (g) => typeof g.budgetUsagePercent === 'number' && g.budgetUsagePercent >= 90,
  )

  interface FlagRow {
    target: string
    detail: string
    pct: number
    _id: string
  }
  const flagCols: DtCol<FlagRow>[] = [
    {
      key: 'target',
      label: 'TARGET',
      className: 'name',
      render: (r) => r.target,
    },
    {
      key: 'detail',
      label: 'DETAIL',
      className: 'mono',
      render: (r) => r.detail,
    },
    {
      key: 'pct',
      label: 'USAGE',
      className: 'num',
      render: (r) => (
        <span style={{ color: r.pct >= 100 ? 'var(--err)' : 'var(--warn)' }}>{fmtPct(r.pct)}</span>
      ),
    },
  ]

  const flagRows = [
    ...flaggedBudgets.map((b, i) => ({
      target:
        b.userName ??
        b.userEmail ??
        b.groupName ??
        (b.userId
          ? `user:${b.userId.slice(0, 8)}`
          : b.groupId
            ? `group:${b.groupId.slice(0, 8)}`
            : 'global'),
      detail: `${b.budgetType} budget`,
      pct: b.usagePercent,
      _id: `b:${b.id}:${i}`,
    })),
    ...flaggedGroups.map((g, i) => ({
      target: g.name,
      detail: `group · ${fmtNum(g.userCount)} users`,
      pct: g.budgetUsagePercent ?? 0,
      _id: `g:${g.id}:${i}`,
    })),
  ]

  return (
    <>
      {usageError && (
        <Banner level="warn" label="warn">
          /api/admin/chargeback/usage failed — model / provider bars will use the dashboard
          fallback only
        </Banner>
      )}

      <SectionBar title="expensive models" count={modelBars.length} />
      <Panel>
        <PanelHead title="cost by model · top 10" />
        {usageLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : modelBars.length === 0 ? (
          <EmptyInline pad>no cost-by-model data in the current window</EmptyInline>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <BarList items={modelBars} />
          </div>
        )}
      </Panel>

      <SectionBar title="expensive providers" count={providerBars.length} />
      <Panel>
        <PanelHead title="cost by provider · top 10" />
        {usageLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : providerBars.length === 0 ? (
          <EmptyInline pad>
            no cost-by-provider data — /api/admin/chargeback/usage returned no byProvider
          </EmptyInline>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <BarList items={providerBars} />
          </div>
        )}
      </Panel>

      <SectionBar title="usage flags" count={flagRows.length} />
      <Panel>
        <PanelHead
          title="budgets / groups at ≥90%"
          count={flagRows.length}
          right={
            <span style={{ color: 'var(--fg-3)' }}>
              source · /api/admin/chargeback/budgets + /groups
            </span>
          }
        />
        {flagRows.length === 0 ? (
          <EmptyInline pad>no budgets or groups at or above 90% usage</EmptyInline>
        ) : (
          <Dt
            columns={flagCols}
            rows={flagRows}
            rowKey={(r) => r._id}
            rowDataAttrs={(r: any) => {
              const ratio = Number(r.usageRatio ?? r.ratio ?? r.pct ?? 0)
              return {
                status: ratio >= 1 ? 'err' : ratio >= 0.9 ? 'warn' : 'idle',
              }
            }}
          />
        )}
      </Panel>
    </>
  )
}
