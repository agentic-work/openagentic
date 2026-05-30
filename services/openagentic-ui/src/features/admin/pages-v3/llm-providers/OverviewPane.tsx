import * as React from 'react'
import {
  Panel,
  Dt,
  type DtCol,
  Chip,
  EmptyInline,
  Pill,
  PriorityBadge,
  Toggle,
  FilterRow,
  Btn,
} from '../../primitives-v3'
import { BulkActionBar } from '../../primitives-v3/BulkActionBar'
import { EmptyState } from '../../primitives-v3/EmptyState'
import {
  type ProviderRow,
  type StatusFilter,
  fmtRel,
  statusTone,
  statusColor,
} from './types'

export interface OverviewPaneProps {
  rows: ProviderRow[]
  isLoading: boolean
  search: string
  onSearch: (s: string) => void
  statusFilter: StatusFilter
  onStatusFilter: (s: StatusFilter) => void
  onOpen: (r: ProviderRow) => void
  onToggle: (r: ProviderRow, next: boolean) => void
  onEdit: (r: ProviderRow) => void
  onDelete: (r: ProviderRow) => void
  /** Phase E (2026-05-07): bulk-action handlers fan out one PUT/DELETE
   *  per selected row — caller decides invalidation. Optional. */
  onBulkSetEnabled?: (rows: ProviderRow[], next: boolean) => void
  onBulkDelete?: (rows: ProviderRow[]) => void
  /** Phase H: when no providers configured, show EmptyState with CTA. */
  onAdd?: () => void
}

export const OverviewPane: React.FC<OverviewPaneProps> = ({
  rows,
  isLoading,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  onOpen,
  onToggle,
  onEdit,
  onDelete,
  onBulkSetEnabled,
  onBulkDelete,
  onAdd,
}) => {
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set())
  const counts = React.useMemo(() => ({
    all: rows.length,
    healthy: rows.filter((r) => r.status === 'healthy').length,
    degraded: rows.filter((r) => r.status === 'degraded').length,
    disabled: rows.filter((r) => r.status === 'disabled').length,
  }), [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        (r.endpoint ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, statusFilter, search])

  const cols: DtCol<ProviderRow>[] = [
    {
      key: 'provider',
      label: 'Provider',
      className: 'name',
      render: (r) => {
        // B'-19: pack name + type + region + endpoint into a single
        // dense cell so operators see provider identity at a glance.
        // Endpoint is truncated to 36 chars to keep the cell tight.
        const ep = (r.endpoint ?? '').replace(/^https?:\/\//, '')
        const epShort = ep.length > 36 ? ep.slice(0, 33) + '…' : ep
        return (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.displayName}</span>
            <span className="sub mono" style={{ marginLeft: 0 }}>
              {r.type}
              {r.region !== '—' ? ` · ${r.region}` : ''}
              {epShort ? <span style={{ color: 'var(--fg-3)' }}> · {epShort}</span> : null}
            </span>
          </div>
        )
      },
    },
    {
      key: 'tier',
      label: 'Tier',
      width: '60px',
      render: (r) => {
        if (r.tier === 'P0' || r.tier === 'P1') return <PriorityBadge tier="t1" label={r.tier} />
        if (r.tier === 'P2') return <PriorityBadge tier="t2" label={r.tier} />
        if (r.tier === 'P3' || r.tier === 'P4' || r.tier === 'P5') return <PriorityBadge tier="t3" label={r.tier} />
        return <span style={{ color: 'var(--fg-3)' }}>{r.tier}</span>
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '140px',
      render: (r) => {
        // B'-19: render BOTH the health status AND the on/off state so
        // operators can't miss either. Disabled providers ALWAYS show
        // "off" first (the row treatment from B'-15 also dims the row).
        // Enabled providers show their health (healthy/degraded/unknown).
        if (!r.enabled) {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Pill tone="idle">off</Pill>
            </span>
          )
        }
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Pill tone={statusTone(r.status) === 'idle' ? 'info' : statusTone(r.status)}>
              {r.status}
            </Pill>
          </span>
        )
      },
    },
    {
      key: 'models',
      label: 'Models',
      width: '70px',
      className: 'num',
      align: 'right',
      render: (r) => r.modelCount,
    },
    {
      key: 'lastChecked',
      label: 'Last Check',
      width: '110px',
      className: 'mono',
      render: (r) => <span style={{ color: 'var(--fg-3)' }}>{fmtRel(r.lastChecked)}</span>,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: '80px',
      render: (r) => (
        <Toggle
          on={r.enabled}
          onChange={(next) => onToggle(r, next)}
          label={`toggle ${r.name}`}
        />
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '140px',
      className: 'r-actions',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); onEdit(r) }} aria-label="edit provider">edit</Btn>
          <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); onDelete(r) }} aria-label="delete provider">del</Btn>
        </span>
      ),
    },
  ]

  return (
    <Panel>
      <FilterRow value={search} onSearch={onSearch} searchPlaceholder="provider, type, endpoint…">
        <Chip label="status" value="all" count={counts.all} on={statusFilter === 'all'} onClick={() => onStatusFilter('all')} />
        <Chip label="healthy" count={counts.healthy} on={statusFilter === 'healthy'} onClick={() => onStatusFilter('healthy')} />
        <Chip label="degraded" count={counts.degraded} on={statusFilter === 'degraded'} onClick={() => onStatusFilter('degraded')} />
        <Chip label="disabled" count={counts.disabled} on={statusFilter === 'disabled'} onClick={() => onStatusFilter('disabled')} />
      </FilterRow>
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            title="No providers configured"
            body={
              <>
                Connect an LLM provider (Anthropic, OpenAI, Azure AI Foundry,
                Vertex, AWS Bedrock, Ollama) to start serving chat + code
                requests through the platform.
              </>
            }
            ctaLabel={onAdd ? '+ add provider' : undefined}
            onCtaClick={onAdd}
            learnMoreHref="/docs/admin/llm-providers"
          />
        ) : (
          <EmptyInline pad>no providers match the current filter</EmptyInline>
        )
      ) : (
        <>
          {(onBulkSetEnabled || onBulkDelete) && (
            <BulkActionBar
              count={selectedKeys.size}
              onClear={() => setSelectedKeys(new Set())}
              actions={[
                ...(onBulkSetEnabled ? [
                  {
                    id: 'enable',
                    label: 'enable',
                    onClick: () => {
                      const sel = filtered.filter((r) => selectedKeys.has(r.id))
                      onBulkSetEnabled(sel, true)
                      setSelectedKeys(new Set())
                    },
                  },
                  {
                    id: 'disable',
                    label: 'disable',
                    onClick: () => {
                      const sel = filtered.filter((r) => selectedKeys.has(r.id))
                      onBulkSetEnabled(sel, false)
                      setSelectedKeys(new Set())
                    },
                  },
                ] : []),
                ...(onBulkDelete ? [{
                  id: 'delete',
                  label: 'delete',
                  destructive: true,
                  onClick: () => {
                    const sel = filtered.filter((r) => selectedKeys.has(r.id))
                    onBulkDelete(sel)
                    setSelectedKeys(new Set())
                  },
                }] : []),
              ]}
            />
          )}
          <Dt<ProviderRow>
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowDoubleClick={(r) => onOpen(r)}
            isRowDisabled={(r) => !r.enabled}
            rowDataAttrs={(r) => ({
              'provider-type': (r.type || '').toLowerCase(),
              status: r.status === 'healthy' ? 'ok'
                : r.status === 'degraded' ? 'warn'
                : r.status === 'down' || r.status === 'error' ? 'err'
                : 'idle',
            })}
            selection={(onBulkSetEnabled || onBulkDelete) ? {
              selectedKeys,
              onChange: setSelectedKeys,
            } : undefined}
          />
        </>
      )}
    </Panel>
  )
}
