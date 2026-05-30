/**
 * Phase B · primitive — `<BulkActionBar>` sticky multi-select toolbar.
 *
 * Rendered above a Dt when one or more rows are selected. Slides in
 * from the top of the table and stays sticky as the user scrolls
 * through results so the bulk actions stay reachable.
 *
 * Anatomy:
 *   - Selection-count chip ("3 selected · clear")
 *   - Up to 5 named bulk actions, each a Btn variant=ghost
 *   - Optional destructive action separated by hairline divider
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionBar } from '../BulkActionBar'

describe('BulkActionBar — sticky multi-select toolbar', () => {
  it('renders when count > 0 and hides itself when count === 0', () => {
    const { container, rerender } = render(
      <BulkActionBar count={3} onClear={() => {}} actions={[]} />,
    )
    expect(container.querySelector('.aw-bulk-action-bar')).toBeTruthy()
    rerender(<BulkActionBar count={0} onClear={() => {}} actions={[]} />)
    expect(container.querySelector('.aw-bulk-action-bar')).toBeNull()
  })

  it('renders the selection count', () => {
    render(<BulkActionBar count={5} onClear={() => {}} actions={[]} />)
    expect(screen.getByText(/5 selected/i)).toBeInTheDocument()
  })

  it('fires onClear when "clear" is clicked', () => {
    const onClear = vi.fn()
    render(<BulkActionBar count={2} onClear={onClear} actions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('renders each action and fires its onClick', () => {
    const onEnable = vi.fn()
    const onExport = vi.fn()
    render(
      <BulkActionBar
        count={2}
        onClear={() => {}}
        actions={[
          { id: 'enable', label: 'enable', onClick: onEnable },
          { id: 'export', label: 'export', onClick: onExport },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'enable' }))
    fireEvent.click(screen.getByRole('button', { name: 'export' }))
    expect(onEnable).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('marks destructive actions with data-tone="err"', () => {
    const { container } = render(
      <BulkActionBar
        count={2}
        onClear={() => {}}
        actions={[
          { id: 'enable', label: 'enable', onClick: () => {} },
          { id: 'delete', label: 'delete', onClick: () => {}, destructive: true },
        ]}
      />,
    )
    const del = container.querySelector('[data-tone="err"]')
    expect(del).toBeTruthy()
    expect(del?.textContent).toContain('delete')
  })

  it('disables an action when disabled=true', () => {
    render(
      <BulkActionBar
        count={2}
        onClear={() => {}}
        actions={[
          { id: 'enable', label: 'enable', onClick: () => {}, disabled: true },
        ]}
      />,
    )
    const btn = screen.getByRole('button', { name: 'enable' })
    expect(btn).toBeDisabled()
  })

  it('roots under .aw-bulk-action-bar so the override layer can scope it', () => {
    const { container } = render(
      <BulkActionBar count={1} onClear={() => {}} actions={[]} />,
    )
    expect(container.querySelector('.aw-bulk-action-bar')).toBeTruthy()
  })
})
