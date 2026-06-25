import * as React from 'react'
import {
  FilterRow,
  Chip,
  Dt,
  type DtCol,
  StatusDot,
  Toggle,
  Btn,
  Banner,
  EmptyInline,
} from '../../primitives-v3'
import { EmptyState } from '../../primitives-v3/EmptyState'
import {
  fmtRelative,
  fmtPct,
  successRate,
  workflowStatusDot,
  type WorkflowStatusFilter,
} from './types'
import type { AdminWorkflowRow } from '../../hooks/useWorkflows'

export interface ListPaneProps {
  rows: AdminWorkflowRow[]
  isLoading: boolean
  isError: boolean
  total: number
  search: string
  onSearch: (s: string) => void
  statusFilter: WorkflowStatusFilter
  onStatusFilter: (s: WorkflowStatusFilter) => void
  selectedKey?: string
  onPick: (row: AdminWorkflowRow) => void
  onToggle: (row: AdminWorkflowRow) => void
  onEdit: (row: AdminWorkflowRow) => void
  onDelete: (row: AdminWorkflowRow) => void
  /** Phase H: when zero workflows exist, render EmptyState with CTA. */
  onAdd?: () => void
}

const STATUS_VALUES: WorkflowStatusFilter[] = ['all', 'active', 'disabled']

function isWorkflowActive(row: AdminWorkflowRow): boolean {
  if (typeof row.is_active === 'boolean') return row.is_active
  const s = String(row.status ?? '').toLowerCase()
  if (s === 'disabled' || s === 'paused' || s === 'archived') return false
  return true
}

export const ListPane: React.FC<ListPaneProps> = ({
  rows,
  isLoading,
  isError,
  total,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  selectedKey,
  onPick,
  onToggle,
  onEdit,
  onDelete,
  onAdd,
}) => {
  // Status filter is applied client-side because the v2 API does not yet
  // accept an `is_active` query param. Search + visibility are still
  // server-side via the hook query string.
  const filtered = React.useMemo(() => {
    if (statusFilter === 'all') return rows
    return rows.filter((r) =>
      statusFilter === 'active' ? isWorkflowActive(r) : !isWorkflowActive(r),
    )
  }, [rows, statusFilter])

  const cols: DtCol<AdminWorkflowRow>[] = [
    {
      key: 'name',
      label: 'Workflow',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Toggle
            on={isWorkflowActive(r)}
            label={isWorkflowActive(r) ? 'enabled' : 'disabled'}
            onChange={() => onToggle(r)}
          />
          <span style={{ minWidth: 0, display: 'inline-flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.name}</span>
            {r.description && (
              <span
                style={{
                  color: 'var(--fg-3)',
                  fontSize: 'var(--v3-t-meta, 11px)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 320,
                }}
              >
                {r.description}
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'visibility',
      label: 'Visibility',
      width: '100px',
      className: 'mono',
      render: (r) => String(r.visibility ?? 'private'),
    },
    {
      key: 'owner',
      label: 'Owner',
      width: '180px',
      className: 'dim',
      render: (r) => r.user?.email ?? r.user?.name ?? r.user_id?.slice(0, 8) ?? '—',
    },
    {
      key: 'status',
      label: 'Status',
      width: '90px',
      render: (r) => {
        const active = isWorkflowActive(r)
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusDot status={workflowStatusDot(active, r.status)} />
            <span>{active ? 'active' : 'disabled'}</span>
          </span>
        )
      },
    },
    {
      key: 'nodes',
      label: 'Nodes',
      width: '70px',
      align: 'right',
      className: 'num',
      render: (r) => r.nodeCount ?? 0,
    },
    {
      key: 'runs',
      label: 'Runs',
      width: '80px',
      align: 'right',
      className: 'num',
      render: (r) => (r.totalExecutions ?? 0).toLocaleString(),
    },
    {
      key: 'success',
      label: 'Success',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => {
        const pct = successRate(r.successfulExecutions, r.totalExecutions)
        if (pct == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const tone =
          pct >= 95 ? 'var(--ok)' : pct >= 80 ? 'var(--warn)' : 'var(--err)'
        return <span style={{ color: tone }}>{fmtPct(pct, 0)}</span>
      },
    },
    {
      key: 'updated',
      label: 'Updated',
      width: '110px',
      className: 'mono',
      render: (r) => fmtRelative(r.updated_at),
    },
    {
      key: 'actions',
      label: '',
      width: '110px',
      className: 'r-actions',
      align: 'right',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end' }}>
          <Btn
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onEdit(r)
            }}
          >
            edit
          </Btn>
          <Btn
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(r)
            }}
          >
            del
          </Btn>
        </span>
      ),
    },
  ]

  return (
    <div>
      <FilterRow
        searchPlaceholder="search workflows · names, descriptions, owners…"
        value={search}
        onSearch={onSearch}
        right={
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
            {filtered.length} / {total} match
          </span>
        }
      >
        {STATUS_VALUES.map((v) => (
          <Chip
            key={v}
            label="status"
            value={v}
            on={statusFilter === v}
            onClick={() => onStatusFilter(v)}
          />
        ))}
      </FilterRow>

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/workflows</span> — list may be stale
        </Banner>
      )}

      {isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading workflows…</EmptyInline>
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            title="No workflows yet"
            body={
              <>
                Workflows are deterministic pipelines that compose tools,
                agents, and prompts. Create one to start orchestrating
                multi-step automations.
              </>
            }
            ctaLabel={onAdd ? '+ new workflow' : undefined}
            onCtaClick={onAdd}
            learnMoreHref="/docs/admin/openagentic-flows"
          />
        ) : (
          <EmptyInline pad>no workflows match the current filters.</EmptyInline>
        )
      ) : (
        <div style={{ padding: '4px 14px 12px' }}>
          <Dt
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            selectedKey={selectedKey}
            onRowClick={onPick}
            onRowDoubleClick={onPick}
            isRowDisabled={(r) => !isWorkflowActive(r as AdminWorkflowRow)}
            rowDataAttrs={(r) => {
              const w = r as AdminWorkflowRow
              const s = String(w.status ?? '').toLowerCase()
              const tone = !isWorkflowActive(w) ? 'idle'
                : s === 'failed' || s === 'error' ? 'err'
                : s === 'paused' || s === 'pending' ? 'warn'
                : 'ok'
              return { status: tone }
            }}
          />
        </div>
      )}
    </div>
  )
}

export default ListPane
