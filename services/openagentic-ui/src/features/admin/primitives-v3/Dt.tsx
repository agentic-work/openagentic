import * as React from 'react'
import './styles.css'

export type DtCol<T> = {
  key: string
  label: React.ReactNode
  align?: 'left' | 'right'
  className?: 'mono' | 'num' | 'dim' | 'name' | 'r-actions'
  width?: string
  render: (row: T, i: number) => React.ReactNode
}

export interface DtProps<T> {
  columns: DtCol<T>[]
  rows: T[]
  rowKey?: (row: T, i: number) => string
  selectedKey?: string
  /** Single click — typically selects/highlights the row. */
  onRowClick?: (row: T, i: number) => void
  /** Double click — typically opens detail panel. */
  onRowDoubleClick?: (row: T, i: number) => void
  empty?: React.ReactNode
  /**
   * Predicate that marks a row as DISABLED (B'-15). Disabled rows get
   * `data-row-disabled="true"` on the <tr> so the override layer can
   * dim text + add a left-rail strike to make on/off state obvious
   * without a separate column. Used for providers + models when
   * `enabled === false`.
   */
  isRowDisabled?: (row: T, i: number) => boolean
  /**
   * Optional row→data-attrs map (B'-30). Each k/v pair becomes a
   * `data-{key}="{value}"` attribute on the <tr>. Used to drive CSS
   * coloring without coupling Dt to specific domain concepts —
   * e.g. provider tables emit `{ 'provider-type': r.type }` so
   * the styles.css rails light up.
   */
  rowDataAttrs?: (row: T, i: number) => Record<string, string | undefined>
  /**
   * Phase E (2026-05-07): multi-select. When `selection` is provided
   * Dt renders a leading checkbox column + a thead-checkbox that
   * toggles all rows. Caller owns the Set of selected row keys
   * (typically derived from `rowKey`) and gets the new set on
   * change. Pair with `<BulkActionBar>` slot when count > 0.
   */
  selection?: {
    selectedKeys: Set<string>
    onChange: (next: Set<string>) => void
  }
}

export function Dt<T>({
  columns,
  rows,
  rowKey,
  selectedKey,
  onRowClick,
  onRowDoubleClick,
  empty,
  isRowDisabled,
  rowDataAttrs,
  selection,
}: DtProps<T>) {
  // Phase E: header checkbox state — checked when every row is in the
  // selected set; indeterminate when some rows are.
  const allSelected =
    selection != null && rows.length > 0 &&
    rows.every((r, i) => {
      const k = rowKey ? rowKey(r, i) : String(i)
      return selection.selectedKeys.has(k)
    })
  const someSelected =
    selection != null && !allSelected &&
    rows.some((r, i) => {
      const k = rowKey ? rowKey(r, i) : String(i)
      return selection.selectedKeys.has(k)
    })
  const headRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggleAll = () => {
    if (!selection) return
    if (allSelected) {
      selection.onChange(new Set())
    } else {
      const next = new Set<string>()
      rows.forEach((r, i) => {
        const k = rowKey ? rowKey(r, i) : String(i)
        next.add(k)
      })
      selection.onChange(next)
    }
  }
  const toggleRow = (k: string) => {
    if (!selection) return
    const next = new Set(selection.selectedKeys)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    selection.onChange(next)
  }
  // Selection-column header cell shared between empty + populated forms.
  const selectionTh = selection ? (
    <th key="__sel__" style={{ width: 28, textAlign: 'left' }}>
      <input
        ref={headRef}
        type="checkbox"
        aria-label="Select all rows"
        checked={allSelected}
        onChange={toggleAll}
        style={{ cursor: rows.length === 0 ? 'default' : 'pointer' }}
      />
    </th>
  ) : null

  if (rows.length === 0 && empty) {
    return (
      <table className="aw-dt">
        <thead>
          <tr>
            {selectionTh}
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'left' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={columns.length + (selection ? 1 : 0)} style={{ padding: 0 }}>
              {empty}
            </td>
          </tr>
        </tbody>
      </table>
    )
  }
  return (
    <table className="aw-dt">
      <thead>
        <tr>
          {selectionTh}
          {columns.map((c) => (
            <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'left' }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const k = rowKey ? rowKey(row, i) : String(i)
          const selected = k === selectedKey
          const isChecked = selection?.selectedKeys.has(k) ?? false
          const extra = rowDataAttrs?.(row, i) ?? {}
          const dataExtras: Record<string, string> = {}
          for (const [key, val] of Object.entries(extra)) {
            if (val == null) continue
            dataExtras[`data-${key}`] = val
          }
          return (
            <tr
              key={k}
              aria-selected={selected || isChecked || undefined}
              data-row-disabled={isRowDisabled?.(row, i) ? 'true' : undefined}
              {...dataExtras}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row, i) : undefined}
              style={{ cursor: onRowClick || onRowDoubleClick ? 'pointer' : undefined }}
              title={onRowDoubleClick ? 'double-click to drill in' : undefined}
            >
              {selection && (
                <td key="__sel__" style={{ width: 28 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={isChecked}
                    onChange={() => toggleRow(k)}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
              )}
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.className ?? ''}
                  style={{ textAlign: c.align ?? (c.className === 'num' ? 'right' : 'left') }}
                >
                  {c.render(row, i)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
