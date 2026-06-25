import React from 'react'

export interface FilterChip {
  id: string
  label: string
  on?: boolean
}

export interface FilterRowProps {
  placeholder: string
  initialValue?: string
  onSearchChange?: (value: string) => void
  chips?: FilterChip[]
  onChipClick?: (id: string) => void
  rightLabel?: React.ReactNode
}

/**
 * FilterRow — search input + active filter chips + right-aligned count/status.
 * Shared by every Archetype B (resource list) and Archetype D (log stream)
 * page. Tokens only.
 */
export function FilterRow({
  placeholder,
  initialValue = '',
  onSearchChange,
  chips = [],
  onChipClick,
  rightLabel,
}: FilterRowProps) {
  const [val, setVal] = React.useState(initialValue)
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          flex: 1,
          maxWidth: 360,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--ctl-surf)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--ctl-radius-sm)',
          padding: '6px 12px',
          color: 'var(--ap-fg-2, var(--fg-2))',
        }}
      >
        <span aria-hidden="true" style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>⌕</span>
        <input
          value={val}
          placeholder={placeholder}
          onChange={(e) => {
            setVal(e.target.value)
            onSearchChange?.(e.target.value)
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--ap-fg-0, var(--fg-0))',
            font: 'inherit',
          }}
        />
      </span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={!!c.on}
          onClick={() => onChipClick?.(c.id)}
          style={{
            background: c.on ? 'var(--glass-accent-fill)' : 'var(--ctl-surf)',
            border: c.on
              ? '1px solid var(--ap-accent-line, var(--accent-line))'
              : '1px solid var(--glass-border)',
            color: c.on ? 'var(--ap-fg-0, var(--fg-0))' : 'var(--ap-fg-2, var(--fg-2))',
            padding: '5px 10px',
            borderRadius: 3,
            fontSize: 11.5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          {c.label}
          {c.on && <span style={{ color: 'var(--ap-fg-3, var(--fg-3))', marginLeft: 2 }}>×</span>}
        </button>
      ))}
      {rightLabel != null && (
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--ap-fg-3, var(--fg-3))',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
          }}
        >
          {rightLabel}
        </span>
      )}
    </div>
  )
}
