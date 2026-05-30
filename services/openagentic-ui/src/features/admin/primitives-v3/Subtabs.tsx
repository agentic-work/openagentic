import * as React from 'react'
import './styles.css'

export interface SubtabItem {
  id: string
  label: string
  count?: number | string
}

export interface SubtabsProps {
  items: SubtabItem[]
  active: string
  onChange: (id: string) => void
  /** Optional right-aligned slot (e.g. time-range chips) shown inline with the
   *  tab buttons. Lets a single sticky bar carry both the section nav and the
   *  filter so operators can change either without scrolling. */
  right?: React.ReactNode
}

export const Subtabs = ({ items, active, onChange, right }: SubtabsProps) => (
  <div className="aw-subtabs" role="tablist">
    <div className="aw-subtabs__tabs">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={active === it.id}
          onClick={() => onChange(it.id)}
        >
          {it.label}
          {it.count != null && <span className="aw-subtabs__count">{it.count}</span>}
        </button>
      ))}
    </div>
    {right != null && <div className="aw-subtabs__right">{right}</div>}
  </div>
)
