import * as React from 'react'
import './styles.css'

export interface FilterRowProps {
  children?: React.ReactNode
  searchPlaceholder?: string
  value?: string
  onSearch?: (s: string) => void
  right?: React.ReactNode
}

export const FilterRow = ({
  children,
  searchPlaceholder = 'search…',
  value,
  onSearch,
  right,
}: FilterRowProps) => (
  <div className="aw-filter-row">
    {children}
    {onSearch !== undefined && (
      <input
        className="aw-filter-row__search"
        type="search"
        placeholder={searchPlaceholder}
        value={value ?? ''}
        onChange={(e) => onSearch?.(e.target.value)}
      />
    )}
    {right && <div className="aw-filter-row__right">{right}</div>}
  </div>
)

// View tabs — small toggle group used in filter-row right slot
export interface ViewTabItem { id: string; label: string }
export const ViewTabs = ({
  items,
  active,
  onChange,
}: {
  items: ViewTabItem[]
  active: string
  onChange: (id: string) => void
}) => (
  <div className="aw-view-tabs" role="tablist">
    {items.map((it) => (
      <button
        key={it.id}
        role="tab"
        aria-selected={active === it.id}
        onClick={() => onChange(it.id)}
      >
        {it.label}
      </button>
    ))}
  </div>
)
