import * as React from 'react'
import {
  Panel,
  Dt,
  type DtCol,
  Chip,
  EmptyInline,
  PriorityBadge,
  Toggle,
  FilterRow,
  Btn,
} from '../../primitives-v3'
import { EmptyState } from '../../primitives-v3/EmptyState'
import { BulkActionBar } from '../../primitives-v3/BulkActionBar'
import { ColumnPicker } from '../../primitives-v3/ColumnPicker'
import {
  type ModelRow,
  type StatusFilter,
  CapList,
  fmtNum,
  guessTier,
} from './types'

export interface CatalogPaneProps {
  rows: ModelRow[]
  isLoading: boolean
  search: string
  onSearch: (s: string) => void
  statusFilter: StatusFilter
  onStatusFilter: (s: StatusFilter) => void
  providerFilter: string | null
  onProviderFilter: (p: string | null) => void
  capabilityFilter: string | null
  onCapabilityFilter: (c: string | null) => void
  onOpen: (r: ModelRow) => void
  onToggle: (r: ModelRow, next: boolean) => void
  onEdit: (r: ModelRow) => void
  onDelete: (r: ModelRow) => void
  /** Phase E (2026-05-07): bulk-action handlers fan out one PUT/DELETE
   *  per selected row — caller decides invalidation. Optional. */
  onBulkSetEnabled?: (rows: ModelRow[], next: boolean) => void
  onBulkDelete?: (rows: ModelRow[]) => void
  /** Phase H (2026-05-07): when no models are configured, render
   *  EmptyState instead of inline copy. The CTA fires onAdd; the
   *  Learn more link points to the docs page. */
  onAdd?: () => void
}

const CAP_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'chat', label: 'chat' },
  { key: 'tools', label: 'tools' },
  { key: 'vision', label: 'vision' },
  { key: 'embeddings', label: 'embed' },
  { key: 'streaming', label: 'stream' },
  { key: 'thinking', label: 'think' },
  { key: 'imageGeneration', label: 'image-gen' },
]

export const CatalogPane: React.FC<CatalogPaneProps> = ({
  rows,
  isLoading,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  providerFilter,
  onProviderFilter,
  capabilityFilter,
  onCapabilityFilter,
  onOpen,
  onToggle,
  onEdit,
  onDelete,
  onBulkSetEnabled,
  onBulkDelete,
  onAdd,
}) => {
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set())
  // Phase B-5 wire: column picker state persisted via ColumnPicker.readHidden.
  const [hiddenCols, setHiddenCols] = React.useState<Set<string>>(() =>
    ColumnPicker.readHidden('model-registry-catalog'),
  )
  const counts = React.useMemo(() => ({
    all: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    disabled: rows.filter((r) => !r.enabled).length,
  }), [rows])

  const providerCounts = React.useMemo(() => {
    const m = new Map<string, { name: string; display: string; count: number }>()
    for (const r of rows) {
      const cur = m.get(r.provider) ?? { name: r.provider, display: r.providerDisplay, count: 0 }
      cur.count += 1
      m.set(r.provider, cur)
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count)
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter === 'enabled' && !r.enabled) return false
      if (statusFilter === 'disabled' && r.enabled) return false
      if (providerFilter && r.provider !== providerFilter) return false
      if (capabilityFilter && !((r.caps as any)[capabilityFilter])) return false
      if (!q) return true
      return (
        r.model.toLowerCase().includes(q) ||
        r.provider.toLowerCase().includes(q) ||
        r.providerDisplay.toLowerCase().includes(q) ||
        r.role.toLowerCase().includes(q)
      )
    })
  }, [rows, statusFilter, providerFilter, capabilityFilter, search])

  const cols: DtCol<ModelRow>[] = [
    {
      key: 'model',
      label: 'Model',
      className: 'name',
      render: (r) => {
        // B'-21: dense single-cell with model id + role + cost-per-1M
        // (when available) so operators can compare sticker prices
        // without opening the detail pane.
        const inP = r.costPerToken?.prompt
        const outP = r.costPerToken?.completion
        const priceLine =
          typeof inP === 'number' && typeof outP === 'number'
            ? `$${(inP * 1_000_000).toFixed(2)} in · $${(outP * 1_000_000).toFixed(2)} out per 1M`
            : null
        return (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.model}</span>
            <span className="sub mono" style={{ marginLeft: 0 }}>
              {r.role}
              {priceLine ? <span style={{ color: 'var(--fg-3)' }}> · {priceLine}</span> : null}
            </span>
          </div>
        )
      },
    },
    {
      key: 'provider',
      label: 'Provider',
      className: 'mono',
      render: (r) => r.providerDisplay,
    },
    {
      key: 'tier',
      label: 'Tier',
      width: '60px',
      render: (r) => <PriorityBadge tier={guessTier(r.model)} />,
    },
    {
      key: 'caps',
      label: 'Capabilities',
      render: (r) => <CapList caps={r.caps} />,
    },
    {
      key: 'maxTokens',
      label: 'Max Tokens',
      width: '110px',
      className: 'num',
      align: 'right',
      render: (r) => fmtNum(r.maxTokens),
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: '80px',
      render: (r) => (
        <Toggle
          on={r.enabled}
          onChange={(next) => onToggle(r, next)}
          label={`toggle ${r.model}`}
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
          <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); onEdit(r) }} aria-label="edit model">edit</Btn>
          <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); onDelete(r) }} aria-label="delete model">del</Btn>
        </span>
      ),
    },
  ]

  return (
    <Panel>
      <FilterRow value={search} onSearch={onSearch} searchPlaceholder="model, provider, role…">
        <Chip label="status" value="all" count={counts.all} on={statusFilter === 'all'} onClick={() => onStatusFilter('all')} />
        <Chip label="enabled" count={counts.enabled} on={statusFilter === 'enabled'} onClick={() => onStatusFilter('enabled')} />
        <Chip label="disabled" count={counts.disabled} on={statusFilter === 'disabled'} onClick={() => onStatusFilter('disabled')} />
        {providerCounts.slice(0, 6).map((p) => (
          <Chip
            key={p.name}
            label="provider"
            value={p.display}
            count={p.count}
            on={providerFilter === p.name}
            onClick={() => onProviderFilter(providerFilter === p.name ? null : p.name)}
          />
        ))}
        {CAP_CHIPS.map((c) => (
          <Chip
            key={c.key}
            label="cap"
            value={c.label}
            on={capabilityFilter === c.key}
            onClick={() =>
              onCapabilityFilter(capabilityFilter === c.key ? null : c.key)
            }
          />
        ))}
      </FilterRow>
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            title="No models in registry"
            body={
              <>
                Add a model manually or click <strong>refresh from providers</strong> to
                pull every model the configured providers can serve.
              </>
            }
            ctaLabel={onAdd ? '+ add model' : undefined}
            onCtaClick={onAdd}
            learnMoreHref="/docs/admin/llm-providers"
          />
        ) : (
          <EmptyInline pad>no models match the current filter</EmptyInline>
        )
      ) : (
        <>
          {/* Phase E: bulk-action bar appears above the table when ≥1
              row is selected. Hidden via component when count===0. */}
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
          <Dt<ModelRow>
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowDoubleClick={(r) => onOpen(r)}
            isRowDisabled={(r) => !r.enabled}
            rowDataAttrs={(r) => ({
              'provider-type': r.providerType,
              status: r.enabled ? 'ok' : 'idle',
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
