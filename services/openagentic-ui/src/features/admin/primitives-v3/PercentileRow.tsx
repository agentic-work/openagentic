import * as React from 'react'
import './styles.css'

export type PctTone = 'default' | 'ok' | 'warn' | 'err'

export interface PctCellSpec {
  label: 'avg' | 'p50' | 'p95' | 'p99' | string
  value: React.ReactNode
  tone?: PctTone
}

export interface PercentileRowProps {
  metric: React.ReactNode
  desc?: React.ReactNode
  cells: PctCellSpec[]
}

export const PercentileRow = ({ metric, desc, cells }: PercentileRowProps) => (
  <div className="aw-pct-row">
    <div className="aw-pct-row__name">
      {metric}
      {desc && <span className="desc">{desc}</span>}
    </div>
    {cells.map((c, i) => (
      <div
        key={i}
        className={`aw-pct-cell ${c.tone && c.tone !== 'default' ? `aw-pct-cell--${c.tone}` : ''}`}
      >
        <span className="lab">{c.label}</span>
        <span className="v">{c.value}</span>
      </div>
    ))}
  </div>
)

export const PercentileHead = ({
  cols = ['metric', 'avg', 'p50', 'p95', 'p99'],
}: {
  cols?: string[]
}) => (
  <div className="aw-pct-head">
    {cols.map((c, i) => (
      <div key={i}>{c}</div>
    ))}
  </div>
)

// Composite — head + rows together
export const PercentileTable = ({
  rows,
  cols = ['metric', 'avg', 'p50', 'p95', 'p99'],
}: {
  rows: PercentileRowProps[]
  cols?: string[]
}) => (
  <>
    <PercentileHead cols={cols} />
    {rows.map((r, i) => (
      <PercentileRow key={i} {...r} />
    ))}
  </>
)
