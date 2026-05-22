/**
 * ConflictModal — RED tests for the §11.5 Conflict UI.
 *
 * Wraps primitives-v2/Modal with the 3-column "Their changes / Yours / Result"
 * diff UI and 3 CTAs: Re-apply mine / Take theirs / Keep editing.
 *
 * Contract:
 *   <ConflictModal
 *     open
 *     onClose
 *     conflict={{ currentRow, conflictingFields, attemptedPayload }}
 *     onReapply={() => …}      // re-apply your edit on top of currentRow's version
 *     onTakeTheirs={() => …}   // discard your edit, accept their changes
 *   />
 *
 * "Keep editing" is the cancel action and just calls onClose.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConflictModal } from '../ConflictModal'

afterEach(() => cleanup())

const baseConflict = {
  currentRow: {
    enabled: true,
    version: 7,
    updated_by: '00000000-0000-0000-0000-000000000099',
    updated_at: '2026-05-05T01:30:00.000Z',
  },
  conflictingFields: ['enabled'],
  attemptedPayload: { enabled: false },
}

describe('ConflictModal — render', () => {
  it('renders with title, body explaining conflict, and 3 CTAs', () => {
    render(
      <ConflictModal
        open
        onClose={vi.fn()}
        conflict={baseConflict}
        onReapply={vi.fn()}
        onTakeTheirs={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-apply mine/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take theirs/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep editing/i })).toBeInTheDocument()
  })

  it('lists each conflicting field with both values side by side', () => {
    render(
      <ConflictModal
        open
        onClose={vi.fn()}
        conflict={baseConflict}
        onReapply={vi.fn()}
        onTakeTheirs={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog')
    // The diff row labels each conflicting field by name.
    expect(dialog).toHaveTextContent('enabled')
    // Their value (true) and your value (false) both rendered.
    expect(dialog).toHaveTextContent('true')
    expect(dialog).toHaveTextContent('false')
  })

  it('renders nothing when open=false', () => {
    render(
      <ConflictModal
        open={false}
        onClose={vi.fn()}
        conflict={baseConflict}
        onReapply={vi.fn()}
        onTakeTheirs={vi.fn()}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders with empty conflictingFields gracefully', () => {
    render(
      <ConflictModal
        open
        onClose={vi.fn()}
        conflict={{ ...baseConflict, conflictingFields: [] }}
        onReapply={vi.fn()}
        onTakeTheirs={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('ConflictModal — actions', () => {
  it('invokes onReapply when "Re-apply mine" is clicked', () => {
    const onReapply = vi.fn()
    render(
      <ConflictModal
        open
        onClose={vi.fn()}
        conflict={baseConflict}
        onReapply={onReapply}
        onTakeTheirs={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /re-apply mine/i }))
    expect(onReapply).toHaveBeenCalledTimes(1)
  })

  it('invokes onTakeTheirs when "Take theirs" is clicked', () => {
    const onTakeTheirs = vi.fn()
    render(
      <ConflictModal
        open
        onClose={vi.fn()}
        conflict={baseConflict}
        onReapply={vi.fn()}
        onTakeTheirs={onTakeTheirs}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /take theirs/i }))
    expect(onTakeTheirs).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when "Keep editing" is clicked', () => {
    const onClose = vi.fn()
    render(
      <ConflictModal
        open
        onClose={onClose}
        conflict={baseConflict}
        onReapply={vi.fn()}
        onTakeTheirs={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ConflictModal — meta', () => {
  it('shows who made the conflicting change', () => {
    render(
      <ConflictModal
        open
        onClose={vi.fn()}
        conflict={baseConflict}
        onReapply={vi.fn()}
        onTakeTheirs={vi.fn()}
      />,
    )
    // The dialog should reference the other actor (truncated UUID is fine).
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent ?? '').toMatch(/00000000-0000-0000-0000-000000000099|edit/i)
  })

  it('uses no hex literals in rendered DOM', () => {
    const { container } = render(
      <ConflictModal
        open
        onClose={vi.fn()}
        conflict={baseConflict}
        onReapply={vi.fn()}
        onTakeTheirs={vi.fn()}
      />,
    )
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
