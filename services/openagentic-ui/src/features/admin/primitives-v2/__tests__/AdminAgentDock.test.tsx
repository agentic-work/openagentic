import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// AdminAIPanel calls useTheme + SharedMarkdownRenderer for AI message bodies.
// Stub both so this dock test stays tight and doesn't pull the chat-side
// markdown stack (Shiki, etc.) into the test runtime.
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: () => {}, resolvedTheme: 'dark' }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/chat/components/MessageContent/SharedMarkdownRenderer', () => ({
  SharedMarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md-stub">{content}</div>,
  default: ({ content }: { content: string }) => <div data-testid="md-stub">{content}</div>,
}))

import { AdminAgentDock } from '../AdminAgentDock'

describe('AdminAgentDock', () => {
  it('renders the collapsed pill with a discoverable label', () => {
    render(<AdminAgentDock onAsk={vi.fn()} suggestions={[]} />)
    const pill = screen.getByTestId('admin-agent-dock-pill')
    expect(pill).toBeInTheDocument()
    expect(pill.textContent).toMatch(/admin agent/i)
  })

  it('pill is anchored to the bottom of the viewport (position: fixed, bottom set)', () => {
    render(<AdminAgentDock onAsk={vi.fn()} suggestions={[]} />)
    const pill = screen.getByTestId('admin-agent-dock-pill')
    const cs = (pill as HTMLElement).style
    expect(cs.position).toBe('fixed')
    expect(parseInt(cs.bottom, 10)).toBeGreaterThan(0)
  })

  it('clicking the pill expands the panel and hides the pill', () => {
    render(<AdminAgentDock onAsk={vi.fn()} suggestions={[{ q: 'How many users?' }]} />)
    const pill = screen.getByTestId('admin-agent-dock-pill')
    fireEvent.click(pill)
    expect(screen.queryByTestId('admin-agent-dock-pill')).toBeNull()
    const panel = screen.getByRole('dialog', { name: /admin (ai|agent)/i })
    expect(panel).toBeInTheDocument()
    // Panel anchored to bottom (matches the "floating input toolbar at bottom" UX)
    expect((panel as HTMLElement).style.position).toBe('fixed')
    expect(parseInt((panel as HTMLElement).style.bottom, 10)).toBeGreaterThanOrEqual(0)
  })

  it('Esc closes the expanded panel and restores the pill', () => {
    render(<AdminAgentDock onAsk={vi.fn()} suggestions={[]} />)
    fireEvent.click(screen.getByTestId('admin-agent-dock-pill'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('admin-agent-dock-pill')).toBeInTheDocument()
  })

  it('Cmd-K / Ctrl-K opens the panel from anywhere', () => {
    render(<AdminAgentDock onAsk={vi.fn()} suggestions={[]} />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.queryByTestId('admin-agent-dock-pill')).toBeNull()
    expect(screen.getByRole('dialog', { name: /admin (ai|agent)/i })).toBeInTheDocument()
  })

  it('contains no hex literals in inline styles', () => {
    const { container } = render(<AdminAgentDock onAsk={vi.fn()} suggestions={[]} />)
    fireEvent.click(container.querySelector('[data-testid="admin-agent-dock-pill"]')!)
    const html = container.innerHTML
    const hexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0])
    expect(hexes).toEqual([])
  })
})
