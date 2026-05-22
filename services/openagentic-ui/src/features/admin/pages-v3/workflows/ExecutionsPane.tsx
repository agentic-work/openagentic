import * as React from 'react'
import {
  FilterRow,
  Chip,
  Dt,
  type DtCol,
  StatusDot,
  Banner,
  EmptyInline,
} from '../../primitives-v3'
import {
  fmtClock,
  fmtDuration,
  fmtUsd,
  execStatusDot,
  type ExecStatusFilter,
} from './types'
import type {
  AdminWorkflowExecution,
  AdminWorkflowExecutionsResponse,
} from '../../hooks/useWorkflows'

export interface ExecutionsPaneProps {
  query: {
    data?: AdminWorkflowExecutionsResponse
    isLoading: boolean
    isError: boolean
  }
  search: string
  onSearch: (s: string) => void
  statusFilter: ExecStatusFilter
  onStatusFilter: (s: ExecStatusFilter) => void
  onPickExecution: (exec: AdminWorkflowExecution) => void
}

const STATUS_VALUES: ExecStatusFilter[] = [
  'all',
  'completed',
  'completed_with_errors',
  'running',
  'failed',
  'pending',
]

export const ExecutionsPane: React.FC<ExecutionsPaneProps> = ({
  query,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  onPickExecution,
}) => {
  const rows = query.data?.executions ?? []
  const total = query.data?.total ?? 0

  const filtered = React.useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(
      (r) =>
        (r.workflowName ?? '').toLowerCase().includes(q) ||
        (r.user?.email ?? '').toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.workflowId ?? '').toLowerCase().includes(q),
    )
  }, [rows, search])

  const cols: DtCol<AdminWorkflowExecution>[] = [
    {
      key: 'workflow',
      label: 'Workflow',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.workflowName}</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
            {r.triggerType} · {r.id.slice(0, 8)}
          </span>
        </span>
      ),
    },
    {
      key: 'user',
      label: 'User',
      width: '200px',
      className: 'dim',
      render: (r) => r.user?.email ?? '—',
    },
    {
      key: 'status',
      label: 'Status',
      width: '160px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={execStatusDot(r.status)} />
          <span>{(r.status ?? '').replace(/_/g, ' ') || '—'}</span>
        </span>
      ),
    },
    {
      key: 'nodes',
      label: 'Nodes',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => `${r.completedNodes}/${r.totalNodes}`,
    },
    {
      key: 'duration',
      label: 'Duration',
      width: '90px',
      align: 'right',
      className: 'mono',
      render: (r) => fmtDuration(r.executionTimeMs),
    },
    {
      key: 'cost',
      label: 'Cost',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) =>
        r.cost != null && r.cost > 0
          ? <span style={{ color: 'var(--accent)' }}>{fmtUsd(r.cost)}</span>
          : <span style={{ color: 'var(--fg-3)' }}>—</span>,
    },
    {
      key: 'started',
      label: 'Started',
      width: '110px',
      className: 'mono',
      render: (r) => fmtClock(r.startedAt),
    },
  ]

  return (
    <>
      <FilterRow
        searchPlaceholder="search executions · workflow · user · id…"
        value={search}
        onSearch={onSearch}
        right={
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
            {filtered.length}
            {filtered.length !== total ? ` / ${total}` : ''} executions
          </span>
        }
      >
        {STATUS_VALUES.map((v) => (
          <Chip
            key={v}
            label="status"
            value={v.replace(/_/g, ' ')}
            on={statusFilter === v}
            onClick={() => onStatusFilter(v)}
          />
        ))}
      </FilterRow>

      {query.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/workflows/executions</span>
        </Banner>
      )}

      {query.isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading executions…</EmptyInline>
      ) : filtered.length === 0 ? (
        <EmptyInline pad>
          {search || statusFilter !== 'all'
            ? 'no executions match the current filters.'
            : 'no executions in the selected window.'}
        </EmptyInline>
      ) : (
        <div style={{ padding: '4px 14px 12px' }}>
          <Dt
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={onPickExecution}
            onRowDoubleClick={onPickExecution}
            rowDataAttrs={(r: any) => {
              const s = String(r.status ?? '').toLowerCase()
              return {
                status: s === 'completed' || s === 'success' || s === 'succeeded' ? 'ok'
                  : s === 'failed' || s === 'error' || s === 'errored' ? 'err'
                  : s === 'running' || s === 'in_progress' || s === 'pending' || s === 'queued' ? 'warn'
                  : 'idle',
              }
            }}
          />
        </div>
      )}
    </>
  )
}

export default ExecutionsPane
