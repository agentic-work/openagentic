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
  type SharedKBSourceRow,
  type SharedKBType,
  fmtRelTime,
  fmtNum,
} from './hooks'

const TYPES: SharedKBType[] = ['webpage', 'document', 'rss', 'http', 'database', 'agent']

function statusOf(s: SharedKBSourceRow): 'ok' | 'warn' | 'err' | 'idle' {
  if (!s.enabled) return 'idle'
  if (s.last_ingest_status === 'success') return 'ok'
  if (s.last_ingest_status === 'partial') return 'warn'
  if (s.last_ingest_status === 'error' || s.last_ingest_error) return 'err'
  return 'idle'
}

export interface SharedKBPaneProps {
  rows: SharedKBSourceRow[]
  isLoading: boolean
  isError: boolean
  search: string
  onSearch: (s: string) => void
  typeFilter: 'all' | SharedKBType
  onTypeFilter: (t: 'all' | SharedKBType) => void
  onOpen: (row: SharedKBSourceRow) => void
  selectedId?: string
}

export const SharedKBPane: React.FC<SharedKBPaneProps> = ({
  rows,
  isLoading,
  isError,
  search,
  onSearch,
  typeFilter,
  onTypeFilter,
  onOpen,
  selectedId,
}) => {
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const r of rows) c[r.type] = (c[r.type] ?? 0) + 1
    return c
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (!q) return true
      const url = (r.config as Record<string, unknown>)?.url as string | undefined
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        (url ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, typeFilter, search])

  const cols: DtCol<SharedKBSourceRow>[] = [
    {
      key: 'name',
      label: 'NAME',
      className: 'name',
      render: (r) => {
        const url = (r.config as Record<string, unknown>)?.url as string | undefined
        return (
          <>
            <div style={{ color: 'var(--fg-0)' }}>{r.name}</div>
            {r.description && (
              <div style={{ color: 'var(--fg-3)', fontSize: 11, marginTop: 2 }}>
                {r.description}
              </div>
            )}
            {url && (
              <div
                style={{
                  color: 'var(--fg-3)',
                  fontSize: 10,
                  marginTop: 2,
                  fontFamily: 'var(--font-v3-mono)',
                  maxWidth: 360,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {url}
              </div>
            )}
          </>
        )
      },
    },
    {
      key: 'type',
      label: 'TYPE',
      className: 'mono',
      render: (r) => <span style={{ color: 'var(--fg-1)' }}>{r.type}</span>,
    },
    {
      key: 'docs',
      label: 'DOCS',
      className: 'num',
      render: (r) => fmtNum(r.doc_count),
    },
    {
      key: 'chunks',
      label: 'CHUNKS',
      className: 'num',
      render: (r) => fmtNum(r.chunk_count),
    },
    {
      key: 'last',
      label: 'LAST INGEST',
      className: 'dim',
      render: (r) => fmtRelTime(r.last_ingest_at),
    },
    {
      key: 'status',
      label: 'STATUS',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={statusOf(r)} />
          <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
            {!r.enabled
              ? 'disabled'
              : r.last_ingest_status ?? 'not ingested'}
          </span>
        </span>
      ),
    },
  ]

  return (
    <>
      <FilterRow value={search} onSearch={onSearch} searchPlaceholder="search sources…">
        <Chip
          label="type"
          value="all"
          count={counts['all'] ?? 0}
          on={typeFilter === 'all'}
          onClick={() => onTypeFilter('all')}
        />
        {TYPES.map((t) => (
          <Chip
            key={t}
            value={t}
            count={counts[t] ?? 0}
            on={typeFilter === t}
            onClick={() => onTypeFilter(t)}
          />
        ))}
      </FilterRow>

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/shared-kb/sources</span>
        </Banner>
      )}

      <Panel>
        <PanelHead title="kb sources" count={isLoading ? '…' : filtered.length} />
        {isLoading ? (
          <EmptyInline pad>loading /api/admin/shared-kb/sources…</EmptyInline>
        ) : filtered.length === 0 ? (
          <EmptyInline pad>
            {rows.length === 0
              ? 'no sources registered yet'
              : 'no sources match the current filters'}
          </EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            selectedKey={selectedId}
            onRowClick={onOpen}
            onRowDoubleClick={onOpen}
          />
        )}
      </Panel>
    </>
  )
}
