import * as React from 'react'
import './styles.css'

export interface BarItem {
  name: React.ReactNode
  value: number
  display?: React.ReactNode // override the right-side display
  className?: string
}

export const BarList = ({ items }: { items: BarItem[] }) => {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="aw-barlist">
      {items.map((it, i) => {
        const pct = (it.value / max) * 100
        return (
          <div key={i} className={`aw-bar ${it.className ?? ''}`}>
            <span className="aw-bar__name">{it.name}</span>
            <span className="aw-bar__track" style={{ ['--w' as any]: `${pct}%` }} />
            <span className="aw-bar__v">{it.display ?? it.value.toLocaleString()}</span>
          </div>
        )
      })}
    </div>
  )
}
