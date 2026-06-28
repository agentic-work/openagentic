/**
 * Phase B'-3 — TopBar must render a CLEAR close-admin button so the
 * operator can return to chat / code / flows without knowing the
 * keyboard shortcut.
 *
 * The button:
 *   - Lives at the right edge of the TopBar (after user avatar)
 *   - Has aria-label="Close admin console" so screen readers can find it
 *   - Fires the supplied onClose handler
 *   - Renders an X glyph (visible to sighted users — not icon-only)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from '../TopBar'

describe('Phase B-prime · TopBar exposes a close-admin button', () => {
  it('renders a button with aria-label "Close admin console" when onClose is supplied', () => {
    render(<TopBar crumbs={[{ label: 'admin' }]} onClose={() => {}} />)
    expect(
      screen.getByRole('button', { name: /close admin console/i }),
    ).toBeInTheDocument()
  })

  it('does NOT render the close button when onClose is omitted', () => {
    render(<TopBar crumbs={[{ label: 'admin' }]} />)
    expect(
      screen.queryByRole('button', { name: /close admin console/i }),
    ).toBeNull()
  })

  it('fires onClose when the button is clicked', () => {
    const onClose = vi.fn()
    render(<TopBar crumbs={[{ label: 'admin' }]} onClose={onClose} />)
    fireEvent.click(
      screen.getByRole('button', { name: /close admin console/i }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('button is in the topbar actions cluster (not hidden in a popover)', () => {
    const { container } = render(
      <TopBar crumbs={[{ label: 'admin' }]} onClose={() => {}} />,
    )
    const close = container.querySelector('[aria-label="Close admin console"]')
    expect(close).toBeTruthy()
    expect(close?.closest('.aw-topbar__actions')).toBeTruthy()
  })
})
