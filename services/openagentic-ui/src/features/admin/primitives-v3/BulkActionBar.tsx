import * as React from 'react'
import './styles.css'

export interface BulkAction {
  id: string
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

export interface BulkActionBarProps {
  count: number
  onClear: () => void
  actions: BulkAction[]
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  count,
  onClear,
  actions,
}) => {
  if (count <= 0) return null

  // Split destructive actions to the end so they sit after a hairline
  // divider — discourages misclicks.
  const safe = actions.filter((a) => !a.destructive)
  const destructive = actions.filter((a) => a.destructive)

  return (
    <div className="aw-bulk-action-bar" role="toolbar" aria-label="Bulk actions">
      <div className="aw-bulk-action-bar__count">
        <span>{count} selected</span>
        <button
          type="button"
          className="aw-bulk-action-bar__clear"
          onClick={onClear}
          aria-label="Clear selection"
        >
          clear
        </button>
      </div>
      <div className="aw-bulk-action-bar__actions">
        {safe.map((a) => (
          <button
            key={a.id}
            type="button"
            className="aw-bulk-action-bar__action"
            onClick={a.onClick}
            disabled={a.disabled}
          >
            {a.label}
          </button>
        ))}
        {destructive.length > 0 && safe.length > 0 && (
          <span className="aw-bulk-action-bar__divider" aria-hidden="true" />
        )}
        {destructive.map((a) => (
          <button
            key={a.id}
            type="button"
            className="aw-bulk-action-bar__action"
            data-tone="err"
            onClick={a.onClick}
            disabled={a.disabled}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
