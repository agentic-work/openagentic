import * as React from 'react'
import {
  KpiGrid,
  Kpi,
  SectionBar,
  Chip,
  Dt,
  type DtCol,
  Banner,
  EmptyInline,
} from '../../primitives-v3'
import { fmtUsd, fmtTokens } from './types'
import {
  useFlowCost,
  type CostGroupRow,
} from '../../hooks/useWorkflows'
import type { FlowsKpiData } from '../../services/flowsAdminApi'

type Period = '7d' | '30d' | '90d'

export interface CostsPaneProps {
  kpis: {
    data?: FlowsKpiData
    isLoading: boolean
    isError: boolean
  }
}

export const CostsPane: React.FC<CostsPaneProps> = ({ kpis }) => {
  const [period, setPeriod] = React.useState<Period>('30d')
  const cost = useFlowCost(period, 'workflow')
  const top5 = (kpis.data?.top_expensive_flows ?? []).slice(0, 5)

  return (
    <>
      <SectionBar
        title="top expensive flows"
        count={top5.length}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            window {kpis.data?.window ?? '24h'} · /api/admin/flows/kpis
          </span>
        }
      />
      {kpis.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/flows/kpis</span>
        </Banner>
      )}
      {top5.length === 0 ? (
        <EmptyInline pad>
          {kpis.isLoading ? 'loading kpis…' : 'no expensive flows in the selected window.'}
        </EmptyInline>
      ) : (
        <KpiGrid cols={top5.length === 5 ? 5 : (top5.length as 2 | 3 | 4 | 5)}>
          {top5.map((f) => (
            <Kpi
              key={f.flowId}
              label={f.flowName}
              value={fmtUsd(f.totalCostUsd)}
              sub={f.flowId.slice(0, 8)}
            />
          ))}
        </KpiGrid>
      )}

      <SectionBar
        title="cost rollup"
        right={
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <Chip
                key={p}
                label="period"
                value={p}
                on={period === p}
                onClick={() => setPeriod(p)}
              />
            ))}
          </span>
        }
      />
      {cost.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/workflows/cost</span>
        </Banner>
      )}

      {cost.data?.summary && (
        <KpiGrid cols={4}>
          <Kpi
            label="total cost"
            value={fmtUsd(cost.data.summary.totalCost)}
            sub={`period ${period}`}
          />
          <Kpi
            label="executions"
            value={cost.data.summary.totalExecutions.toLocaleString()}
            sub="cost-bearing only"
          />
          <Kpi
            label="tokens"
            value={fmtTokens(cost.data.summary.totalTokens)}
            sub="prompt + completion"
          />
          <Kpi
            label="avg / run"
            value={fmtUsd(cost.data.summary.avgCostPerExecution)}
            sub="across all flows"
          />
        </KpiGrid>
      )}

      {cost.isLoading && !cost.data ? (
        <EmptyInline pad>loading cost rollup…</EmptyInline>
      ) : !cost.data?.results?.length ? (
        <EmptyInline pad>no cost data for the selected period.</EmptyInline>
      ) : (
        <div style={{ padding: '4px 14px 12px' }}>
          <Dt<CostGroupRow>
            columns={[
              {
                key: 'name',
                label: 'Workflow',
                className: 'name',
                render: (r) => (
                  <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
                    <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.label}</span>
                    <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
                      {r.models.length} model{r.models.length === 1 ? '' : 's'}
                    </span>
                  </span>
                ),
              },
              {
                key: 'execs',
                label: 'Executions',
                width: '110px',
                align: 'right',
                className: 'num',
                render: (r) => r.totalExecutions.toLocaleString(),
              },
              {
                key: 'tokens',
                label: 'Tokens',
                width: '110px',
                align: 'right',
                className: 'num',
                render: (r) => fmtTokens(r.totalTokens),
              },
              {
                key: 'cost',
                label: 'Cost',
                width: '110px',
                align: 'right',
                className: 'num',
                render: (r) => (
                  <span style={{ color: 'var(--accent)' }}>{fmtUsd(r.totalCost)}</span>
                ),
              },
              {
                key: 'avg',
                label: 'Avg/Run',
                width: '110px',
                align: 'right',
                className: 'num',
                render: (r) => fmtUsd(r.avgCostPerExecution),
              },
            ]}
            rows={cost.data.results}
            rowKey={(r) => r.key}
          />
        </div>
      )}
    </>
  )
}

export default CostsPane
