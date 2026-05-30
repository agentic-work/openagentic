import * as React from 'react'
import {
  Panel,
  Dt,
  type DtCol,
  EmptyInline,
  PriorityBadge,
  Banner,
} from '../../primitives-v3'
import {
  type RoleRow,
  fmtNum,
  fmtUsd,
  guessTier,
  AUTO_VALUE,
} from './types'

export interface RolesPaneProps {
  rows: RoleRow[]
  isLoading: boolean
  isError: boolean
  onOpen: (r: RoleRow) => void
}

export const RolesPane: React.FC<RolesPaneProps> = ({ rows, isLoading, isError, onOpen }) => {
  const staleCount = rows.filter((r) => r.isStale).length

  const cols: DtCol<RoleRow>[] = [
    {
      key: 'role',
      label: 'Role',
      className: 'name',
      render: (r) => (
        <>
          {r.meta.label}
          <span className="sub mono"> {r.meta.useCase}</span>
        </>
      ),
    },
    {
      key: 'assigned',
      label: 'Assigned Model',
      className: 'mono',
      render: (r) => {
        if (r.assignedModel == null) {
          return <span style={{ color: 'var(--fg-3)' }}>unset</span>
        }
        if (r.isAuto) {
          return <span style={{ color: 'var(--accent)' }}>{AUTO_VALUE}</span>
        }
        return (
          <span style={{ color: r.isStale ? 'var(--err)' : 'var(--fg-0)' }}>
            {r.assignedModel}
          </span>
        )
      },
    },
    {
      key: 'provider',
      label: 'Provider',
      className: 'mono',
      render: (r) => {
        if (r.isAuto) return <span style={{ color: 'var(--fg-3)' }}>smart-router</span>
        if (!r.match) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        return (
          (r.match as any).provider_display_name ?? r.match.provider
        )
      },
    },
    {
      key: 'tier',
      label: 'Tier',
      width: '60px',
      render: (r) => {
        if (r.isAuto) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const tier = guessTier(r.assignedModel)
        return <PriorityBadge tier={tier} />
      },
    },
    {
      key: 'fca',
      label: 'FCA',
      width: '70px',
      className: 'num',
      align: 'right',
      render: (r) => {
        const fca = (r.match?.functionCallingAccuracy as number | undefined) ?? null
        if (fca == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        return fca.toFixed(2)
      },
    },
    {
      key: 'cost',
      label: 'Cost / 1k',
      width: '90px',
      className: 'num',
      align: 'right',
      render: (r) => {
        const c = (r.match?.inputCostPer1k as number | undefined) ?? null
        if (c == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        return fmtUsd(c * 1000) // display per 1M for readability
      },
    },
    {
      key: 'req',
      label: 'Req (24h)',
      width: '90px',
      className: 'num',
      align: 'right',
      render: (r) => {
        if (!r.usage) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        return fmtNum(r.usage.count)
      },
    },
    {
      key: 'tokens',
      label: 'Tokens',
      width: '110px',
      className: 'num',
      align: 'right',
      render: (r) => {
        if (!r.usage) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        return fmtNum(r.usage.tokens)
      },
    },
  ]

  return (
    <Panel>
      {staleCount > 0 && (
        <Banner level="err" label="orphaned roles">
          <strong>{staleCount} role{staleCount === 1 ? '' : 's'}</strong> below {staleCount === 1 ? 'is' : 'are'} pinned
          to a model that has been deleted from the registry. Traffic for{' '}
          {staleCount === 1 ? 'that role' : 'those roles'} will silently fall through to your{' '}
          <em>chat-default</em> model instead of the one you intended — which can cause
          surprise cost spikes or quality regressions. Click the role row to pick a
          replacement model from the registry.
        </Banner>
      )}
      {isError ? (
        <EmptyInline pad>
          {/* TODO: surface fetch error in caller-side Banner instead. */}
          failed to load <span className="accent">/api/admin/llm-providers/default-models</span>
        </EmptyInline>
      ) : isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : (
        <Dt<RoleRow>
          columns={cols}
          rows={rows}
          rowKey={(r) => r.key}
          onRowDoubleClick={(r) => onOpen(r)}
        />
      )}
    </Panel>
  )
}
