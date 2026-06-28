import React from 'react'

export interface ResourceTableColumn {
  id: string
  label: string
  /** CSS width — string or number (px). */
  width?: string | number
}

export interface ResourceTableRow {
  id: string
  cells: Record<string, React.ReactNode>
  onClick?: () => void
}

export interface ResourceTableProps {
  columns: ResourceTableColumn[]
  rows: ResourceTableRow[]
  /** Rendered when rows.length === 0; supply an EmptyState. */
  emptyState?: React.ReactNode
}

/**
 * ResourceTable — opinionated wrapper around <table>. Enforces:
 *  • header rendered in <thead> with monospace small-caps
 *  • row body alternating-hover via CSS only
 *  • emptyState shown when rows is empty (replaces blank tables)
 *
 * Cells take any React node, so existing inline status pills, toggles, and
 * bar charts pass through unchanged. This matches what each existing list
 * page already builds — the wrapper just unifies the surrounding chrome.
 */
export function ResourceTable({ columns, rows, emptyState }: ResourceTableProps) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-chip)',
        boxShadow: 'var(--glass-card-shadow)',
        overflow: 'hidden',
      }}
    >
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.id}
              style={{
                textAlign: 'left',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--ap-fg-3, var(--fg-3))',
                padding: '10px 14px',
                borderBottom: '1px solid var(--glass-border)',
                background: 'var(--ctl-surf)',
                fontWeight: 500,
                width: c.width != null ? c.width : undefined,
              }}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            onClick={r.onClick}
            style={{ cursor: r.onClick ? 'pointer' : undefined }}
          >
            {columns.map((c) => (
              <td
                key={c.id}
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--ap-ln-1, var(--ln-1))',
                  color: 'var(--ap-fg-1, var(--fg-1))',
                  fontSize: 12.5,
                }}
              >
                {r.cells[c.id]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
