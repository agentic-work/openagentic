import * as React from 'react'
import './styles.css'

export interface PickerColumn {
  key: string
  label: string
}

interface ColumnPickerProps {
  tableId: string
  columns: PickerColumn[]
  hidden: Set<string>
  onChange: (next: Set<string>) => void
}

const STORAGE_PREFIX = 'aw-cols-'

interface ColumnPickerComponent extends React.FC<ColumnPickerProps> {
  readHidden: (tableId: string) => Set<string>
}

const ColumnPickerImpl: React.FC<ColumnPickerProps> = ({
  tableId,
  columns,
  hidden,
  onChange,
}) => {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement | null>(null)

  // Close on outside click + Esc.
  React.useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(key: string) {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
    try {
      localStorage.setItem(STORAGE_PREFIX + tableId, JSON.stringify([...next]))
    } catch {
      // ignore storage quota / disabled
    }
  }

  return (
    <div className="aw-col-picker" ref={ref}>
      <button
        type="button"
        className="aw-col-picker__trigger"
        aria-label="Columns"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ☷ columns
      </button>
      {open && (
        <div className="aw-col-picker__pop" role="menu">
          {columns.map((c) => (
            <label key={c.key} className="aw-col-picker__row">
              <input
                type="checkbox"
                checked={!hidden.has(c.key)}
                onChange={() => toggle(c.key)}
                aria-label={c.label}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

const ColumnPicker = ColumnPickerImpl as ColumnPickerComponent

ColumnPicker.readHidden = (tableId: string): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableId)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((s): s is string => typeof s === 'string'))
  } catch {
    return new Set()
  }
}

export { ColumnPicker }
