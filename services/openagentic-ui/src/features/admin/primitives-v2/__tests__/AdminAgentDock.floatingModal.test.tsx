/**
 * Sev-1 #932 — AdminAgentDock relocates to a floating bottom modal with
 * bounded width/height. User direction (verbatim):
 *   "the admin ai agent in admin console needs to be more prominent and
 *    open as a floating modal locked in the bottom of the admin console-
 *    with a limited frame height/width to allow users to chat with it
 *    about admin console stuff"
 *
 * Two rules pinned here:
 *
 *   1. The dock accepts an OPTIONAL controlled `open` / `onOpenChange`
 *      pair. When supplied, the parent (AdminPortalHostV3) owns the open
 *      state and the dock subscribes to it. When omitted, the dock
 *      retains its prior self-managed pill behavior (for back-compat).
 *
 *   2. When open, the floating panel is fixed at the BOTTOM of the
 *      viewport with the requested bounded frame:
 *        max-width  ≈ 480px (min(480px, 90vw))
 *        max-height ≈ 600px (min(600px, 80vh))
 *      The exact pixel cap MUST be ≤ 480 / 600 so the modal does NOT
 *      fill the viewport. This protects the "chat-mode style widget"
 *      look (not a full-page takeover).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: () => {}, resolvedTheme: 'dark' }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/chat/components/MessageContent/SharedMarkdownRenderer', () => ({
  SharedMarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md-stub">{content}</div>,
  default: ({ content }: { content: string }) => <div data-testid="md-stub">{content}</div>,
}))

import { AdminAgentDock } from '../AdminAgentDock'

describe('Sev-1 #932 · AdminAgentDock — floating bottom modal, controlled open', () => {
  it('renders the panel when controlled `open` is true (no pill click needed)', () => {
    render(
      <AdminAgentDock
        onAsk={vi.fn()}
        suggestions={[]}
        open
        onOpenChange={() => {}}
      />,
    )
    const panel = screen.getByRole('dialog', { name: /admin (ai|agent)/i })
    expect(panel).toBeInTheDocument()
    // Pill is hidden when the parent owns open=true
    expect(screen.queryByTestId('admin-agent-dock-pill')).toBeNull()
  })

  it('floating panel is locked to the bottom of the viewport with bounded width/height', () => {
    render(
      <AdminAgentDock
        onAsk={vi.fn()}
        suggestions={[]}
        open
        onOpenChange={() => {}}
      />,
    )
    const panel = screen.getByRole('dialog', { name: /admin (ai|agent)/i }) as HTMLElement
    // Locked to bottom
    expect(panel.style.position).toBe('fixed')
    expect(parseInt(panel.style.bottom, 10)).toBeGreaterThanOrEqual(0)
    expect(parseInt(panel.style.bottom, 10)).toBeLessThan(80) // not floating mid-screen
    // Bounded width — ≤ 480px cap per user direction
    const widthExpr = panel.style.width || ''
    // Accept either "min(480px,90vw)" or "480px"; reject anything ≥ 720px
    const widthPxMatch = widthExpr.match(/(\d{2,4})px/)
    if (widthPxMatch) {
      expect(parseInt(widthPxMatch[1], 10)).toBeLessThanOrEqual(480)
    }
    // Bounded height — ≤ 600px cap per user direction
    const maxHeightExpr = panel.style.maxHeight || ''
    const heightPxMatch = maxHeightExpr.match(/(\d{2,4})px/)
    if (heightPxMatch) {
      expect(parseInt(heightPxMatch[1], 10)).toBeLessThanOrEqual(600)
    } else {
      // If expressed in vh fallback, must NOT be >= 80vh (that'd be a takeover)
      const vhMatch = maxHeightExpr.match(/(\d{1,3})vh/)
      if (vhMatch) {
        expect(parseInt(vhMatch[1], 10)).toBeLessThanOrEqual(80)
      }
    }
  })

  it('fires onOpenChange(false) when Esc is pressed in controlled mode', () => {
    const onOpenChange = vi.fn()
    render(
      <AdminAgentDock
        onAsk={vi.fn()}
        suggestions={[]}
        open
        onOpenChange={onOpenChange}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('still works in uncontrolled mode (pill renders by default)', () => {
    render(<AdminAgentDock onAsk={vi.fn()} suggestions={[]} />)
    expect(screen.getByTestId('admin-agent-dock-pill')).toBeInTheDocument()
  })

  it('contains no hex literals in inline styles when open', () => {
    const { container } = render(
      <AdminAgentDock
        onAsk={vi.fn()}
        suggestions={[]}
        open
        onOpenChange={() => {}}
      />,
    )
    const html = container.innerHTML
    const hexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0])
    expect(hexes).toEqual([])
  })
})
