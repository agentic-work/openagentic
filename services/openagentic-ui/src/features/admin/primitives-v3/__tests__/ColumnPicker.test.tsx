/**
 * Phase B · primitive — `<ColumnPicker>` show/hide column toggle popover.
 *
 * Lives in the top-right of every Dt. Click the gear icon → popover
 * shows checkboxes for every column. State is persisted via
 * `localStorage[`aw-cols-${tableId}`]` so the operator's choices
 * survive reloads.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ColumnPicker, type PickerColumn } from '../ColumnPicker'

const COLS: PickerColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'tier', label: 'Tier' },
  { key: 'cost', label: 'Cost' },
]

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('ColumnPicker — show/hide column toggle popover', () => {
  it('renders the gear trigger button', () => {
    render(
      <ColumnPicker tableId="t" columns={COLS} hidden={new Set()} onChange={() => {}} />,
    )
    expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument()
  })

  it('opens the popover on click and lists every column with a checkbox', () => {
    render(
      <ColumnPicker tableId="t" columns={COLS} hidden={new Set()} onChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    expect(screen.getByRole('checkbox', { name: 'Name' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Status' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Tier' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Cost' })).toBeChecked()
  })

  it('marks columns in the hidden set as unchecked', () => {
    render(
      <ColumnPicker
        tableId="t"
        columns={COLS}
        hidden={new Set(['cost'])}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    expect(screen.getByRole('checkbox', { name: 'Cost' })).not.toBeChecked()
  })

  it('fires onChange with the next hidden set when a checkbox toggles', () => {
    const onChange = vi.fn()
    render(
      <ColumnPicker
        tableId="t"
        columns={COLS}
        hidden={new Set()}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cost' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg: Set<string> = onChange.mock.calls[0][0]
    expect([...arg]).toEqual(['cost'])
  })

  it('persists hidden set to localStorage on change', () => {
    const { rerender } = render(
      <ColumnPicker
        tableId="my-table"
        columns={COLS}
        hidden={new Set()}
        onChange={(next) => {
          rerender(
            <ColumnPicker
              tableId="my-table"
              columns={COLS}
              hidden={next}
              onChange={() => {}}
            />,
          )
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cost' }))
    const stored = localStorage.getItem('aw-cols-my-table')
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!)).toEqual(['cost'])
  })

  it('exposes a static helper to read persisted hidden set by tableId', () => {
    localStorage.setItem('aw-cols-x', JSON.stringify(['tier', 'cost']))
    expect([...ColumnPicker.readHidden('x')]).toEqual(['tier', 'cost'])
  })

  it('helper returns empty set when no persisted state exists', () => {
    expect(ColumnPicker.readHidden('not-set').size).toBe(0)
  })
})
