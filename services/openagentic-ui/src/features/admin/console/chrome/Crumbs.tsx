/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Crumbs — breadcrumb bar: scope ◎ › Domain › Leaf. Clickable segments
 * call back into the router (scope opens the scope modal; domain navigates
 * to its landing). Matches the mock.
 */
import * as React from 'react'
import { DOMAIN_BY_ID, LEAF_INDEX } from '../ADMIN_IA'

export interface CrumbsProps {
  scopeName: string
  domainId: string
  leafId: string | null
  onScope: () => void
  onNavDomain: (domainId: string) => void
}

export function Crumbs({ scopeName, domainId, leafId, onScope, onNavDomain }: CrumbsProps) {
  const d = DOMAIN_BY_ID[domainId]
  const onHome = !d || d.id === 'home'
  return (
    <div className="awc-crumbs">
      <span className="awc-clk" onClick={onScope}>
        ◎ {scopeName}
      </span>
      <span className="awc-sep">›</span>
      {onHome ? (
        <span className="awc-cur">Home</span>
      ) : (
        <>
          <span
            className={leafId ? 'awc-clk' : 'awc-cur'}
            onClick={leafId ? () => onNavDomain(d.id) : undefined}
          >
            {d.name}
          </span>
          {leafId && LEAF_INDEX[leafId] && (
            <>
              <span className="awc-sep">›</span>
              <span className="awc-cur">{LEAF_INDEX[leafId].name}</span>
            </>
          )}
        </>
      )}
    </div>
  )
}
