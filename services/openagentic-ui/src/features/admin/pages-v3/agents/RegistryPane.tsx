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
  agentEnabledDot,
  type AgentRegistryFilter,
} from './types'
import type { AdminAgentRow } from '../../hooks/useDashboardMetrics'

export interface RegistryPaneProps {
  rows: AdminAgentRow[]
  isLoading: boolean
  isError: boolean
  total: number
  search: string
  onSearch: (s: string) => void
  filter: AgentRegistryFilter
  onFilter: (f: AgentRegistryFilter) => void
  selectedKey?: string
  onPick: (row: AdminAgentRow) => void
  onToggle: (row: AdminAgentRow) => void
  onEdit: (row: AdminAgentRow) => void
  onDelete: (row: AdminAgentRow) => void
  /** Phase H: when zero agents exist, render EmptyState with CTA. */
  onAdd?: () => void
}

const FILTER_VALUES: AgentRegistryFilter[] = ['all', 'platform', 'background', 'enabled', 'disabled']

function isPlatform(row: AdminAgentRow): boolean {
  return row.background == null
}

function isEnabled(row: AdminAgentRow): boolean {
  return row.enabled !== false
}

function matchesFilter(row: AdminAgentRow, f: AgentRegistryFilter): boolean {
  switch (f) {
    case 'platform':   return isPlatform(row)
    case 'background': return !isPlatform(row)
    case 'enabled':    return isEnabled(row)
    case 'disabled':   return !isEnabled(row)
    case 'all':
    default:           return true
  }
}

export const RegistryPane: React.FC<RegistryPaneProps> = ({
  rows,
  isLoading,
  isError,
  total,
  search,
  onSearch,
  filter,
  onFilter,
  selectedKey,
  onPick,
  onToggle,
  onEdit,
  onDelete,
  onAdd,
}) => {
  // Search + filter happen client-side: /api/admin/agents has no
  // server-side query params today and the registry rarely exceeds
  // a few dozen rows so this is fine.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (!matchesFilter(r, filter)) return false
      if (!q) return true
      return (
        (r.display_name ?? r.name ?? '').toLowerCase().includes(q) ||
        (r.agent_type ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, search, filter])

  const cols: DtCol<AdminAgentRow>[] = [
    {
      key: 'name',
      label: 'Agent',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Toggle
            on={isEnabled(r)}
            label={isEnabled(r) ? 'enabled' : 'disabled'}
            onChange={() => onToggle(r)}
          />
          <span style={{ minWidth: 0, display: 'inline-flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>
              {r.display_name ?? r.name ?? r.id}
            </span>
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
      key: 'type',
      label: 'Type',
      width: '130px',
      className: 'mono',
      render: (r) => r.agent_type ?? r.category ?? '—',
    },
    {
      key: 'kind',
      label: 'Kind',
      width: '110px',
      className: 'dim',
      render: (r) => (isPlatform(r) ? 'platform' : 'background'),
    },
    {
      key: 'model',
      label: 'Model',
      width: '160px',
      className: 'mono',
      render: (r) => r.model_config?.primaryModel ?? 'auto',
    },
    {
      key: 'skills',
      label: 'Skills',
      width: '70px',
      align: 'right',
      className: 'num',
      render: (r) => (r.skills?.length ?? 0),
    },
    {
      key: 'tools',
      label: 'Tools',
      width: '70px',
      align: 'right',
      className: 'num',
      render: (r) => (r.tools_whitelist?.length ?? 0),
    },
    {
      key: 'status',
      label: 'Status',
      width: '90px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={agentEnabledDot(isEnabled(r))} />
          <span>{isEnabled(r) ? 'active' : 'disabled'}</span>
        </span>
      ),
    },
    {
      key: 'created',
      label: 'Created',
      width: '110px',
      className: 'mono',
      render: (r) => fmtRelative(r.created_at),
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
    <>
      <FilterRow
        searchPlaceholder="search agents · names, types, descriptions…"
        value={search}
        onSearch={onSearch}
        right={
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
            {filtered.length} / {total} match
          </span>
        }
      >
        {FILTER_VALUES.map((v) => (
          <Chip
            key={v}
            label="kind"
            value={v}
            on={filter === v}
            onClick={() => onFilter(v)}
          />
        ))}
      </FilterRow>

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/agents</span> — list may be stale
        </Banner>
      )}

      {isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading agents…</EmptyInline>
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            title="No agents registered"
            body={
              <>
                Agents are LLM-powered actors with a defined role + skill set.
                Create one to start dispatching focused sub-tasks from the
                main chat or workflows.
              </>
            }
            ctaLabel={onAdd ? '+ new agent' : undefined}
            onCtaClick={onAdd}
            learnMoreHref="/docs/admin/agents"
          />
        ) : (
          <EmptyInline pad>no agents match the current filters.</EmptyInline>
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
            isRowDisabled={(r) => !isEnabled(r as AdminAgentRow)}
            rowDataAttrs={(r) => ({
              status: isEnabled(r as AdminAgentRow) ? 'ok' : 'idle',
            })}
          />
        </div>
      )}
    </>
  )
}

export default RegistryPane
