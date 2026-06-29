/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console primitives — DataTable.
 *
 * Toolbar search + filter chips + sortable sticky-header table + bulk
 * action bar + pager. Token-only. Ported from the mock `dataTable` to a
 * controlled React component. Generic over row type `T`.
 */
import * as React from 'react'

export interface DtColumn<T> {
  key?: keyof T | string
  label: React.ReactNode
  r?: boolean
  cls?: string
  /** Cell renderer (returns a React node). */
  render?: (row: T) => React.ReactNode
  /** Text value used for search + default sort. */
  val?: (row: T) => string | number
  /** Override sort value. */
  sortVal?: (row: T) => string | number
}

export interface DtChips {
  active?: string | null
  opts: { id: string; label: React.ReactNode; cnt?: number }[]
  filter?: (row: unknown, chip: string) => boolean
}

export interface DataTableProps<T> {
  cols: DtColumn<T>[]
  rows: T[]
  onRow?: (row: T) => void
  search?: string
  chips?: DtChips
  bulk?: boolean
  pageSize?: number
  /** Row dim if this key is falsy. */
  dimKey?: keyof T
  empty?: React.ReactNode
  /** Bulk action labels (default enable/disable/delete). */
  bulkActions?: string[]
  onBulk?: (action: string, rows: T[]) => void
}

export function DataTable<T extends Record<string, unknown>>({
  cols,
  rows,
  onRow,
  search = 'filter rows…',
  chips,
  bulk = false,
  pageSize = 12,
  dimKey,
  empty = 'No rows match',
  bulkActions = ['enable', 'disable', 'delete'],
  onBulk,
}: DataTableProps<T>) {
  const [q, setQ] = React.useState('')
  const [sort, setSort] = React.useState<number | null>(null)
  const [dir, setDir] = React.useState(1)
  const [page, setPage] = React.useState(0)
  const [chip, setChip] = React.useState<string | null>(chips?.active ?? null)
  const [sel, setSel] = React.useState<Set<T>>(() => new Set())

  const colVal = (c: DtColumn<T>, row: T): string | number => {
    if (c.val) return c.val(row)
    if (c.key) return (row[c.key as keyof T] as unknown as string | number) ?? ''
    return ''
  }

  const filtered = React.useMemo(() => {
    let r = rows.slice()
    if (chips && chip && chips.filter) r = r.filter((row) => chips.filter!(row, chip))
    if (q) r = r.filter((row) => cols.some((c) => String(colVal(c, row)).toLowerCase().includes(q)))
    if (sort != null) {
      const c = cols[sort]
      r.sort((a, b) => {
        const x = c.sortVal ? c.sortVal(a) : colVal(c, a)
        const y = c.sortVal ? c.sortVal(b) : colVal(c, b)
        if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y) * dir
        return (x > y ? 1 : x < y ? -1 : 0) * dir
      })
    }
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, chip, q, sort, dir])

  const total = filtered.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pages - 1)
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const toggleSel = (row: T) => {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  return (
    <div className="awc-tablewrap">
      <div className="awc-toolbar">
        <div className="awc-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            placeholder={search}
            value={q}
            onChange={(e) => {
              setQ(e.target.value.toLowerCase())
              setPage(0)
            }}
          />
        </div>
        {chips && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chips.opts.map((o) => (
              <button
                key={o.id}
                className={'awc-chipbtn' + (chip === o.id ? ' awc-on' : '')}
                onClick={() => {
                  setChip(o.id)
                  setPage(0)
                }}
              >
                {o.label}
                {o.cnt != null && <span className="awc-cc">{o.cnt}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {bulk && sel.size > 0 && (
        <div className="awc-bulkbar">
          <span className="awc-bulkbar__n">{sel.size} selected</span>
          {bulkActions.map((a) => (
            <button
              key={a}
              className={'awc-btn awc-sm' + (a === 'delete' ? ' awc-danger' : '')}
              onClick={() => {
                onBulk?.(a, Array.from(sel))
                if (a === 'delete') setSel(new Set())
              }}
            >
              {a}
            </button>
          ))}
          <button className="awc-btn awc-sm awc-ghost" style={{ marginLeft: 'auto' }} onClick={() => setSel(new Set())}>
            clear
          </button>
        </div>
      )}

      <div style={{ maxHeight: 620, overflow: 'auto' }}>
        <table className="awc-dt">
          <thead>
            <tr>
              {bulk && <th style={{ width: 34 }} />}
              {cols.map((c, ci) => (
                <th
                  key={ci}
                  className={(c.r ? 'awc-r' : '') + (ci === sort ? ' awc-sorted' : '')}
                  onClick={() => {
                    setDir((d) => (sort === ci ? -d : 1))
                    setSort(ci)
                  }}
                >
                  {c.label}
                  <span className="awc-arr">{ci === sort ? (dir > 0 ? '↑' : '↓') : '↕'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, ri) => (
              <tr
                key={ri}
                className={dimKey && !row[dimKey] ? 'awc-dim' : ''}
                onClick={() => onRow?.(row)}
              >
                {bulk && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(row)} onChange={() => toggleSel(row)} />
                  </td>
                )}
                {cols.map((c, ci) => (
                  <td key={ci} className={(c.r ? 'awc-r' : '') + (c.cls ? ' ' + c.cls : '')}>
                    {c.render ? c.render(row) : (colVal(c, row) as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))}
            {!slice.length && (
              <tr>
                <td colSpan={cols.length + (bulk ? 1 : 0)}>
                  <div className="awc-empty">
                    <div className="awc-empty__ei">∅</div>
                    {empty}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="awc-tfoot">
        <span>
          {total} {total === 1 ? 'item' : 'items'}
        </span>
        <div className="awc-pager">
          <span style={{ marginRight: 6, fontFamily: 'var(--font-v3-mono)' }}>
            page {safePage + 1}/{pages}
          </span>
          <button disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ‹
          </button>
          <button disabled={safePage >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
