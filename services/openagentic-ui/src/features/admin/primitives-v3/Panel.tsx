import * as React from 'react'
import './styles.css'

export const Panel = ({
  children,
  glass = false,
  className,
}: {
  children: React.ReactNode
  /** Frosted-glass surface (theme.css `.glass`) instead of the flat `--bg-0`
   *  panel. Used by the analytics chart cards so they match the rest of the
   *  glass admin console. The glass tokens live in the ONE-SOT theme.css. */
  glass?: boolean
  className?: string
}) => (
  <div className={['aw-panel', glass ? 'aw-panel--glass glass' : '', className].filter(Boolean).join(' ')}>
    {children}
  </div>
)

export interface PanelHeadProps {
  title: React.ReactNode
  count?: React.ReactNode
  right?: React.ReactNode
}

export const PanelHead = ({ title, count, right }: PanelHeadProps) => (
  <div className="aw-panel-head">
    <span className="aw-panel-head__title">{title}</span>
    {count != null && <span className="aw-panel-head__ct">{count}</span>}
    {right && <span className="aw-panel-head__right">{right}</span>}
  </div>
)

export const Grid = ({
  cols = 2,
  children,
}: {
  cols?: 2 | 3 | 4
  children: React.ReactNode
}) => (
  <div className={`aw-grid aw-grid--c${cols}`}>{children}</div>
)
