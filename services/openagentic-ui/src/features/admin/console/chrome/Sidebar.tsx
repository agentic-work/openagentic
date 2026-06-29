/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Sidebar — the rewrite's collapsible 12-domain tree over ADMIN_IA.
 *
 * Matches the mock: domain rows (.awc-navitem) with icon + label + count
 * badge + chevron; expanded groups render .awc-navchild leaves with
 * leafdot + label + 2-char mnemonic. The active leaf carries the gradient
 * active-rail (a token expression — NOT a hardcoded gradient hex).
 *
 * Groups models/flows/agents open by default; per-group collapse state is
 * lifted to the Shell (and persisted to localStorage there). The active
 * domain auto-opens.
 */
import * as React from 'react'
import { ADMIN_DOMAINS } from '../ADMIN_IA'
import { DomainIcon } from './DomainIcon'

export interface SidebarProps {
  /** active leaf id (null when on a domain landing / home). */
  activeLeaf: string | null
  /** active domain id. */
  activeDomain: string
  /** open group ids. */
  openGroups: ReadonlySet<string>
  /** toggle a group's open/closed state. */
  onToggleGroup: (domainId: string) => void
  /** navigate to a domain landing. */
  onNavDomain: (domainId: string) => void
  /** navigate to a leaf. */
  onNavLeaf: (domainId: string, leafId: string) => void
  /** open the command palette (rail quick-jump). */
  onQuickJump: () => void
  /** collapsed (icon-only) rail. */
  collapsed?: boolean
  /** api version + region for the footer. */
  version?: string
  region?: string
}

const Chevron = () => (
  <svg
    className="awc-navitem__chev"
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
)

export function Sidebar({
  activeLeaf,
  activeDomain,
  openGroups,
  onToggleGroup,
  onNavDomain,
  onNavLeaf,
  onQuickJump,
  collapsed = false,
  version = '0.8.0',
  region = 'us-gov-east-1',
}: SidebarProps) {
  return (
    <nav className={'awc-rail' + (collapsed ? ' awc-collapsed' : '')} aria-label="Admin navigation">
      <button className="awc-rail-search" onClick={onQuickJump}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Quick jump…</span>
      </button>

      <div>
        {ADMIN_DOMAINS.map((d) => {
          const onDomain = activeDomain === d.id && !activeLeaf
          const open = openGroups.has(d.id)
          const hasLeaves = d.leaves.length > 0
          return (
            <React.Fragment key={d.id}>
              <button
                className={
                  'awc-navitem' + (onDomain ? ' awc-on' : '') + (open ? ' awc-exp' : '')
                }
                onClick={() => {
                  if (hasLeaves) onToggleGroup(d.id)
                  onNavDomain(d.id)
                }}
                title={d.name}
              >
                <span className="awc-ico">
                  <DomainIcon path={d.icon} />
                </span>
                <span className="awc-navitem__lbl">{d.name}</span>
                {hasLeaves && <span className="awc-navitem__cnt">{d.leaves.length}</span>}
                {hasLeaves && <Chevron />}
              </button>

              {hasLeaves && open && (
                <div className="awc-navchildren">
                  {d.leaves.map((l) => {
                    const on = activeLeaf === l.id
                    return (
                      <button
                        key={l.id}
                        className={'awc-navchild' + (on ? ' awc-on' : '')}
                        onClick={(e) => {
                          e.stopPropagation()
                          onNavLeaf(d.id, l.id)
                        }}
                      >
                        <span className="awc-leafdot" />
                        <span className="awc-navchild__lbl">{l.name}</span>
                        <span className="awc-navchild__mn">{l.mn}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>

      <div className="awc-railftr">
        <div className="awc-railftr__row">
          <span>api {version}</span>
          <span>{region}</span>
        </div>
      </div>
    </nav>
  )
}
