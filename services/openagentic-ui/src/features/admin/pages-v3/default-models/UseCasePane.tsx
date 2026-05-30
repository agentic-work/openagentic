import * as React from 'react'
import {
  Panel,
  PanelHead,
  Grid,
  EmptyInline,
  PriorityBadge,
  StatusDot,
} from '../../primitives-v3'
import {
  type RoleRow,
  guessTier,
  fmtNum,
  AUTO_VALUE,
} from './types'

export interface UseCasePaneProps {
  rows: RoleRow[]
  isLoading: boolean
  isError: boolean
  onOpen: (r: RoleRow) => void
}

export const UseCasePane: React.FC<UseCasePaneProps> = ({ rows, isLoading, isError, onOpen }) => {
  if (isError) {
    return (
      <Panel>
        <EmptyInline pad>failed to load defaults — see Banner above</EmptyInline>
      </Panel>
    )
  }
  if (isLoading) {
    return (
      <Panel>
        <EmptyInline pad>loading…</EmptyInline>
      </Panel>
    )
  }
  return (
    <Grid cols={3}>
      {rows.map((r) => {
        const tier = r.isAuto ? null : guessTier(r.assignedModel)
        const provider = r.match
          ? ((r.match as any).provider_display_name ?? r.match.provider)
          : null
        return (
          <Panel key={r.key}>
            <PanelHead
              title={r.meta.useCase}
              count={r.meta.label}
              right={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot status={r.isStale ? 'err' : r.assignedModel ? 'ok' : 'idle'} />
                  {tier && <PriorityBadge tier={tier} />}
                </span>
              }
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(r)
                }
              }}
              style={{
                padding: '14px 16px',
                cursor: 'pointer',
                borderTop: '1px solid var(--line-1)',
                background: 'var(--bg-1)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-v3-mono)',
                  fontSize: 'var(--v3-t-display, 14px)',
                  color: r.isStale
                    ? 'var(--err)'
                    : r.isAuto
                    ? 'var(--accent)'
                    : r.assignedModel
                    ? 'var(--fg-0)'
                    : 'var(--fg-3)',
                  marginBottom: 6,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {r.isAuto ? AUTO_VALUE : r.assignedModel ?? 'unset'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-v3-mono)',
                  fontSize: 'var(--v3-t-meta, 11px)',
                  color: 'var(--fg-3)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>{provider ?? (r.isAuto ? 'smart-router' : '—')}</span>
                <span>
                  {r.usage ? `${fmtNum(r.usage.count)} req · 24h` : 'no req · 24h'}
                </span>
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 'var(--v3-t-meta, 11px)',
                  color: 'var(--fg-2)',
                  lineHeight: 1.4,
                }}
              >
                {r.meta.description}
              </div>
            </div>
          </Panel>
        )
      })}
    </Grid>
  )
}
