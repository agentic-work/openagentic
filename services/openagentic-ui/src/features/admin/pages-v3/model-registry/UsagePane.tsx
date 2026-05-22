import * as React from 'react'
import {
  Panel,
  Dt,
  type DtCol,
  EmptyInline,
} from '../../primitives-v3'
import {
  type ModelRow,
  fmtNum,
  fmtUsd,
} from './types'
import type { ModelUsageRow } from '../../hooks/useDashboardMetrics'

export interface UsagePaneProps {
  rows: ModelRow[]
  modelUsage: ModelUsageRow[] | undefined
  isLoading: boolean
}

interface UsageDtRow {
  model: string
  provider: string
  count: number
  tokens: number
  cost: number
  registered: boolean
}

export const UsagePane: React.FC<UsagePaneProps> = ({ rows, modelUsage, isLoading }) => {
  const merged: UsageDtRow[] = React.useMemo(() => {
    const byModel = new Map<string, ModelRow>()
    for (const r of rows) byModel.set(r.model, r)
    const out: UsageDtRow[] = []
    for (const u of modelUsage ?? []) {
      if (!u?.model) continue
      const reg = byModel.get(u.model)
      out.push({
        model: u.model,
        provider: reg?.providerDisplay ?? '(unregistered)',
        count: u.count ?? 0,
        tokens: u.tokens ?? 0,
        cost: u.cost ?? 0,
        registered: !!reg,
      })
    }
    out.sort((a, b) => b.tokens - a.tokens)
    return out.slice(0, 20)
  }, [rows, modelUsage])

  const cols: DtCol<UsageDtRow>[] = [
    {
      key: 'model',
      label: 'Model',
      className: 'name',
      render: (r) => (
        <>
          {r.model}
          <span className="sub mono">
            {' '}
            {r.provider}
            {!r.registered && (
              <span style={{ color: 'var(--err)', marginLeft: 6 }}>· not in registry</span>
            )}
          </span>
        </>
      ),
    },
    {
      key: 'req',
      label: 'Req (24h)',
      width: '100px',
      className: 'num',
      align: 'right',
      render: (r) => fmtNum(r.count),
    },
    {
      key: 'tokens',
      label: 'Tokens',
      width: '120px',
      className: 'num',
      align: 'right',
      render: (r) => fmtNum(r.tokens),
    },
    {
      key: 'cost',
      label: 'Cost',
      width: '90px',
      className: 'num',
      align: 'right',
      render: (r) => fmtUsd(r.cost),
    },
  ]

  return (
    <Panel>
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : merged.length === 0 ? (
        <EmptyInline pad>
          {/* TODO: window selector — currently locked to the dashboard 24h period. */}
          no model usage attributable in the last 24h
        </EmptyInline>
      ) : (
        <Dt<UsageDtRow>
          columns={cols}
          rows={merged}
          rowKey={(r) => r.model}
        />
      )}
    </Panel>
  )
}
