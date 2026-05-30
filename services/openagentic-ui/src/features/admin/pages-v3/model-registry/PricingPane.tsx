import * as React from 'react'
import {
  Panel,
  Dt,
  type DtCol,
  EmptyInline,
} from '../../primitives-v3'
import {
  type ModelRow,
  fmtCostPer1M,
} from './types'

export interface PricingPaneProps {
  rows: ModelRow[]
  isLoading: boolean
}

interface PricingRow {
  id: string
  model: string
  provider: string
  inputPer1k: number | null
  outputPer1k: number | null
  costSource: ModelRow['costSource']
}

const CostSourceBadge: React.FC<{ source: ModelRow['costSource'] }> = ({ source }) => {
  const tone =
    source === 'registry' ? 'var(--ok)' : source === 'mcr-estimate' ? 'var(--warn)' : 'var(--fg-3)'
  return (
    <span
      style={{
        fontFamily: 'var(--font-v3-mono)',
        fontSize: 9,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '1px 5px',
        border: '1px solid var(--line-2)',
        color: tone,
      }}
    >
      {source}
    </span>
  )
}

export const PricingPane: React.FC<PricingPaneProps> = ({ rows, isLoading }) => {
  const sorted: PricingRow[] = React.useMemo(() => {
    const mapped = rows.map<PricingRow>((r) => ({
      id: r.id,
      model: r.model,
      provider: r.providerDisplay,
      inputPer1k: r.inputCostPer1k,
      outputPer1k: r.outputCostPer1k,
      costSource: r.costSource,
    }))
    mapped.sort((a, b) => (b.inputPer1k ?? -1) - (a.inputPer1k ?? -1))
    return mapped
  }, [rows])

  const stats = React.useMemo(() => {
    const valid = sorted.map((r) => r.inputPer1k).filter((n): n is number => typeof n === 'number' && n > 0)
    if (valid.length === 0) return { p50: null, max: null, min: null }
    const sortedNums = [...valid].sort((a, b) => a - b)
    const p50 = sortedNums[Math.floor(sortedNums.length / 2)]
    return { p50, max: sortedNums[sortedNums.length - 1], min: sortedNums[0] }
  }, [sorted])

  const cols: DtCol<PricingRow>[] = [
    {
      key: 'model',
      label: 'Model',
      className: 'name',
      render: (r) => (
        <>
          {r.model}
          <span className="sub mono"> {r.provider}</span>
        </>
      ),
    },
    {
      key: 'input',
      label: 'Input · /1M',
      width: '130px',
      className: 'num',
      align: 'right',
      render: (r) => {
        const isOutlier =
          r.inputPer1k != null && stats.p50 != null && r.inputPer1k > stats.p50 * 5
        return (
          <span style={{ color: isOutlier ? 'var(--warn)' : undefined }}>
            {fmtCostPer1M(r.inputPer1k)}
          </span>
        )
      },
    },
    {
      key: 'output',
      label: 'Output · /1M',
      width: '130px',
      className: 'num',
      align: 'right',
      render: (r) => fmtCostPer1M(r.outputPer1k),
    },
    {
      key: 'source',
      label: 'Source',
      width: '120px',
      render: (r) => <CostSourceBadge source={r.costSource} />,
    },
  ]

  return (
    <Panel>
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : sorted.length === 0 ? (
        <EmptyInline pad>no models in registry</EmptyInline>
      ) : (
        <Dt<PricingRow>
          columns={cols}
          rows={sorted}
          rowKey={(r) => r.id}
        />
      )}
    </Panel>
  )
}
