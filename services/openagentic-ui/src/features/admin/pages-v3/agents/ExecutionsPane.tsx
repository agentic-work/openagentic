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
  fmtUsdFromCents,
  fmtTokens,
  execStatusDot,
  type AgentExecStatusFilter,
} from './types'
import type {
  AdminAgentExecutionRow,
} from '../../hooks/useDashboardMetrics'

export interface ExecutionsPaneProps {
  rows: AdminAgentExecutionRow[]
  isLoading: boolean
  isError: boolean
  total: number
  search: string
  onSearch: (s: string) => void
  statusFilter: AgentExecStatusFilter
  onStatusFilter: (s: AgentExecStatusFilter) => void
  onPickExecution: (exec: AdminAgentExecutionRow) => void
}

const STATUS_VALUES: AgentExecStatusFilter[] = [
  'all',
  'completed',
  'running',
  'failed',
  'pending',
  'cancelled',
]

function agentLabel(r: AdminAgentExecutionRow): string {
  return r.agent?.name ?? r.agent?.agent_type ?? r.loop_id ?? r.id.slice(0, 8)
}

export const ExecutionsPane: React.FC<ExecutionsPaneProps> = ({
  rows,
  isLoading,
  isError,
  total,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  onPickExecution,
}) => {
  // Search filter is client-side because the v2 endpoint doesn't accept
  // a `search` param. We do honor `status` server-side via the hook.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        agentLabel(r).toLowerCase().includes(q) ||
        (r.model_used ?? '').toLowerCase().includes(q) ||
        (r.user_id ?? '').toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    )
  }, [rows, search])

  const cols: DtCol<AdminAgentExecutionRow>[] = [
    {
      key: 'agent',
      label: 'Agent',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{agentLabel(r)}</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
            {(r.agent?.agent_type ?? '—')} · {r.id.slice(0, 8)}
          </span>
        </span>
      ),
    },
    {
      key: 'user',
      label: 'User',
      width: '180px',
      className: 'dim',
      render: (r) => r.user_id?.slice(0, 12) ?? '—',
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={execStatusDot(r.status)} />
          <span>{(r.status ?? '').replace(/_/g, ' ') || '—'}</span>
        </span>
      ),
    },
    {
      key: 'model',
      label: 'Model',
      width: '160px',
      className: 'mono',
      render: (r) => r.model_used ?? '—',
    },
    {
      key: 'duration',
      label: 'Duration',
      width: '90px',
      align: 'right',
      className: 'mono',
      render: (r) => fmtDuration(r.duration_ms ?? null),
    },
    {
      key: 'tokens',
      label: 'Tokens',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => fmtTokens(r.total_tokens ?? null),
    },
    {
      key: 'cost',
      label: 'Cost',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => {
        // estimated_cost lands as a Decimal — Prisma serializes to string.
        // The API surface stores it in cents *after* the JSON marshaller
        // (see admin-agents executions/stats path) so we treat it as
        // dollars when it's a sub-unit, cents otherwise. Conservative:
        // anything < 1 is dollars, anything >= 1 is cents — matches
        // observed payloads from agentRunLog.
        const raw = r.estimated_cost
        if (raw == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const n = typeof raw === 'string' ? Number.parseFloat(raw) : raw
        if (!Number.isFinite(n)) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const dollars = n < 1 ? n : n / 100
        if (dollars === 0) return <span style={{ color: 'var(--fg-3)' }}>$0.00</span>
        if (dollars < 0.01) return <span style={{ color: 'var(--accent)' }}>&lt;$0.01</span>
        return <span style={{ color: 'var(--accent)' }}>${dollars.toFixed(2)}</span>
      },
    },
    {
      key: 'started',
      label: 'Started',
      width: '110px',
      className: 'mono',
      render: (r) => fmtClock(r.started_at),
    },
  ]

  return (
    <>
      <FilterRow
        searchPlaceholder="search executions · agent · model · user · id…"
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

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/agents/executions</span>
        </Banner>
      )}

      {isLoading && rows.length === 0 ? (
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
                  : s === 'failed' || s === 'error' ? 'err'
                  : s === 'running' || s === 'pending' ? 'warn'
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
