/**
 * Sev-1 #932 — the v3 TopBar's "admin agent" pill must be a button that
 * opens the floating Admin AI dock. Prior to this fix, the pill was a
 * static `<div>` with no onClick wired, so the user could not open the
 * Admin AI assistant from the top header.
 *
 * Rules pinned by this suite:
 *   1. The pill renders as a real, focusable button (`role="button"` or
 *      `<button>` element) with a clear aria-label.
 *   2. Clicking it fires the supplied `onOpenAgent` handler.
 *   3. When `onOpenAgent` is omitted the pill still renders (for backward
 *      compat / standalone usage) — clicking it is a no-op.
 *   4. The pill stays in the topbar actions cluster (visually close to
 *      the user avatar + close button) so operators can find it where
 *      they expect.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock CompanyLogo to avoid pulling its asset stack into this tight test.
vi.mock('@/components/CompanyLogo', () => ({
  CompanyLogo: () => <div data-testid="company-logo" />,
}))
// NotificationsBell uses react-query — stub so we don't need a QueryClient
// wrapper in this presentation-only test.
vi.mock('../NotificationsBell', () => ({
  NotificationsBell: () => <div data-testid="notifications-bell-stub" />,
}))
// useTheme is imported by TopBar — stub it so we don't pull theme state.
vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ density: 'cozy', setDensity: () => {} }),
}))

import { TopBar } from '../TopBar'

describe('Sev-1 #932 · TopBar admin-agent pill is a button that opens the AI dock', () => {
  it('renders a button with aria-label "Open Admin Agent"', () => {
    render(<TopBar crumbs={[{ label: 'admin' }]} onOpenAgent={() => {}} />)
    expect(
      screen.getByRole('button', { name: /open admin agent/i }),
    ).toBeInTheDocument()
  })

  it('fires onOpenAgent when the pill is clicked', () => {
    const onOpenAgent = vi.fn()
    render(<TopBar crumbs={[{ label: 'admin' }]} onOpenAgent={onOpenAgent} />)
    fireEvent.click(
      screen.getByRole('button', { name: /open admin agent/i }),
    )
    expect(onOpenAgent).toHaveBeenCalledTimes(1)
  })

  it('button is in the topbar actions cluster (not hidden in a popover)', () => {
    const { container } = render(
      <TopBar crumbs={[{ label: 'admin' }]} onOpenAgent={() => {}} />,
    )
    const pill = container.querySelector('[aria-label="Open Admin Agent"]')
    expect(pill).toBeTruthy()
    expect(pill?.closest('.aw-topbar__actions')).toBeTruthy()
  })

  it('still renders the pill (as a button) even when onOpenAgent is omitted', () => {
    render(<TopBar crumbs={[{ label: 'admin' }]} />)
    // Pill still present (so the visual surface is preserved); just a
    // no-op click handler when the caller doesn't supply onOpenAgent.
    expect(
      screen.getByRole('button', { name: /open admin agent/i }),
    ).toBeInTheDocument()
  })
})
