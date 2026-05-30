import * as React from 'react'
import './styles.css'

export interface PageHeadProps {
  title: string
  meta?: React.ReactNode
  /** Primary action — top-LEFT, accent solid. One per page. */
  primaryAction?: React.ReactNode
  /** Secondary actions — top-RIGHT cluster, ghost buttons. */
  secondaryActions?: React.ReactNode
  /** @deprecated use secondaryActions; retained for the 60 existing leaves. */
  actions?: React.ReactNode
}

export const PageHead = ({
  title,
  meta,
  primaryAction,
  secondaryActions,
  actions,
}: PageHeadProps) => {
  // New API takes precedence over the legacy `actions` slot.
  const right = secondaryActions ?? actions
  return (
    <div className="aw-page-head">
      <h1 className="aw-page-head__title">{title}</h1>
      {primaryAction && (
        <div className="aw-page-head__primary">{primaryAction}</div>
      )}
      {meta && <span className="aw-page-head__meta">{meta}</span>}
      {right && <div className="aw-page-head__actions">{right}</div>}
    </div>
  )
}
