import * as React from 'react'
import './styles.css'

export interface RibbonCell {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'ok' | 'warn' | 'err'
}

export interface RibbonProps {
  cells: RibbonCell[]
  /** Right-aligned clock or generic right slot. */
  right?: React.ReactNode
}

export const Ribbon = ({ cells, right }: RibbonProps) => (
  <div className="aw-ribbon" role="status" aria-live="polite">
    <span className="aw-ribbon__mark">
      <span className="aw-ribbon__mark-led" />
      {' '}live
    </span>
    {cells.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span className="aw-ribbon__div">·</span>}
        <span className="aw-ribbon__cell">
          <span className="aw-ribbon__lab">{c.label}</span>
          <span className={`aw-ribbon__val ${c.tone && c.tone !== 'default' ? `aw-ribbon__val--${c.tone}` : ''}`}>
            {c.value}
          </span>
        </span>
      </React.Fragment>
    ))}
    {right && <span className="aw-ribbon__clock">{right}</span>}
  </div>
)
