import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  EmptyInline,
  StatusDot,
  Banner,
  FilterRow,
  Chip,
} from '../../primitives-v3'
import {
  type TeamRow,
  fmtRelative,
  teamStatusDot,
} from './types'

export type TeamActiveFilter = 'all' | 'active' | 'inactive'

const ACTIVE_ORDER: TeamActiveFilter[] = ['all', 'active', 'inactive']

export interface TeamsPaneProps {
  rows: TeamRow[]
  isLoading: boolean
  isError: boolean
  search: string
  onSearch: (s: string) => void
  active: TeamActiveFilter
  onActive: (a: TeamActiveFilter) => void
}

export const TeamsPane: React.FC<TeamsPaneProps> = ({
  rows,
  isLoading,
  isError,
  search,
  onSearch,
  active,
  onActive,
}) => {
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: rows.length, active: 0, inactive: 0 }
    for (const r of rows) {
      if (r.is_active) c.active += 1
      else c.inactive += 1
    }
    return c
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (active === 'active' && !r.is_active) return false
      if (active === 'inactive' && r.is_active) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.display_name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.cost_center ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, active, search])

  const cols: DtCol<TeamRow>[] = [
    {
      key: 'name',
      label: 'NAME',
      className: 'name',
      render: (r) => (
        <>
          <div style={{ color: 'var(--fg-0)' }}>{r.display_name}</div>
          <div
            style={{ color: 'var(--fg-3)', fontSize: 11, marginTop: 2, fontFamily: 'var(--font-v3-mono)' }}
          >
            {r.name}
          </div>
        </>
      ),
    },
    {
      key: 'status',
      label: 'STATUS',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={teamStatusDot(r.is_active)} />
          <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
            {r.is_active ? 'active' : 'inactive'}
          </span>
        </span>
      ),
    },
    {
      key: 'members',
      label: 'MEMBERS',
      className: 'num',
      render: (r) => r.member_count.toLocaleString(),
    },
    {
      key: 'shared',
      label: 'SHARED FLOWS',
      className: 'num',
      render: (r) => r.shared_flows_count.toLocaleString(),
    },
    {
      key: 'cost-center',
      label: 'COST CENTER',
      className: 'mono',
      render: (r) => (
        <span style={{ color: 'var(--fg-2)' }}>{r.cost_center ?? '—'}</span>
      ),
    },
    {
      key: 'billing',
      label: 'BILLING CONTACT',
      className: 'mono',
      render: (r) => (
        <span style={{ color: 'var(--fg-2)' }}>{r.billing_contact_email ?? '—'}</span>
      ),
    },
    {
      key: 'updated',
      label: 'UPDATED',
      className: 'mono',
      render: (r) => <span style={{ color: 'var(--fg-3)' }}>{fmtRelative(r.updated_at)}</span>,
    },
  ]

  return (
    <>
      <FilterRow value={search} onSearch={onSearch} searchPlaceholder="search teams…">
        {ACTIVE_ORDER.map((a) => (
          <Chip
            key={a}
            label="status"
            value={a}
            count={counts[a] ?? 0}
            on={active === a}
            onClick={() => onActive(a)}
          />
        ))}
      </FilterRow>

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/teams</span>
        </Banner>
      )}

      <Panel>
        <PanelHead
          title="teams"
          count={isLoading ? '…' : filtered.length}
          right={
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
              read-only
            </span>
          }
        />
        {isLoading ? (
          <EmptyInline pad>loading /api/admin/teams…</EmptyInline>
        ) : filtered.length === 0 ? (
          <EmptyInline pad>
            {rows.length === 0 ? 'no teams configured yet' : 'no teams match the current filters'}
          </EmptyInline>
        ) : (
          <Dt columns={cols} rows={filtered} rowKey={(r) => r.id} />
        )}
      </Panel>
    </>
  )
}

export default TeamsPane
