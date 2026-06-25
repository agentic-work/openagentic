import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  Chip,
  EmptyInline,
  StatusDot,
  Banner,
  FilterRow,
} from '../../primitives-v3'
import {
  type WorkflowSecretRow,
  fmtDate,
  fmtRelative,
  scopeStatusDot,
} from './types'

export type SecretScopeFilter = 'all' | 'global' | 'group' | 'workflow'

const SCOPE_ORDER: SecretScopeFilter[] = ['all', 'global', 'workflow', 'group']

export interface CredentialsPaneProps {
  rows: WorkflowSecretRow[]
  isLoading: boolean
  isError: boolean
  search: string
  onSearch: (s: string) => void
  scope: SecretScopeFilter
  onScope: (s: SecretScopeFilter) => void
}

export const CredentialsPane: React.FC<CredentialsPaneProps> = ({
  rows,
  isLoading,
  isError,
  search,
  onSearch,
  scope,
  onScope,
}) => {
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const r of rows) c[r.scope] = (c[r.scope] ?? 0) + 1
    return c
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (scope !== 'all' && r.scope !== scope) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, scope, search])

  const cols: DtCol<WorkflowSecretRow>[] = [
    {
      key: 'name',
      label: 'NAME',
      className: 'name',
      render: (r) => (
        <>
          <div style={{ color: 'var(--fg-0)', fontFamily: 'var(--font-mono)' }}>{r.name}</div>
          {r.description && (
            <div style={{ color: 'var(--fg-3)', fontSize: 11, marginTop: 2 }}>
              {r.description}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'scope',
      label: 'SCOPE',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={scopeStatusDot(r.scope)} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.scope}</span>
        </span>
      ),
    },
    {
      key: 'allowed',
      label: 'ALLOWED NODES',
      className: 'mono',
      render: (r) => (
        <span style={{ color: 'var(--fg-2)' }}>
          {r.allowed_node_types && r.allowed_node_types.length > 0
            ? r.allowed_node_types.join(', ')
            : 'all'}
        </span>
      ),
    },
    {
      key: 'access',
      label: 'ACCESSES',
      className: 'num',
      render: (r) => r.access_count.toLocaleString(),
    },
    {
      key: 'rotated',
      label: 'LAST ROTATED',
      className: 'mono',
      render: (r) => (
        <span style={{ color: 'var(--fg-3)' }}>{fmtDate(r.last_rotated_at) ?? 'never'}</span>
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
      <FilterRow value={search} onSearch={onSearch} searchPlaceholder="search secrets…">
        {SCOPE_ORDER.map((s) => (
          <Chip
            key={s}
            label="scope"
            value={s}
            count={counts[s] ?? 0}
            on={scope === s}
            onClick={() => onScope(s)}
          />
        ))}
      </FilterRow>

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/workflow-secrets</span>
        </Banner>
      )}

      <Panel>
        <PanelHead
          title="workflow secrets"
          count={isLoading ? '…' : filtered.length}
          right={
            <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              read-only · use {'{{secret:name}}'} in node fields
            </span>
          }
        />
        {isLoading ? (
          <EmptyInline pad>loading /api/admin/workflow-secrets…</EmptyInline>
        ) : filtered.length === 0 ? (
          <EmptyInline pad>
            {rows.length === 0
              ? 'no secrets configured yet'
              : 'no secrets match the current filters'}
          </EmptyInline>
        ) : (
          <Dt columns={cols} rows={filtered} rowKey={(r) => r.id} />
        )}
      </Panel>
    </>
  )
}

export default CredentialsPane
