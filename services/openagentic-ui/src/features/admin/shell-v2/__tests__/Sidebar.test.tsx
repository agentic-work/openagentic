import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// All feature flags on so all groups render
vi.mock('../../../../config/featureFlags', () => ({
  featureFlags: { mcp: true, synth: true, openagentic: true, adminV2: true, ollama: true, multiModel: true },
}))

// Sidebar reads useTheme but isn't tested through the real ThemeProvider here.
vi.mock('../../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: () => {}, resolvedTheme: 'dark' }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Sidebar pulls in SettingsMenu (footer) which is heavy; stub.
vi.mock('../../../../shared/components/SettingsMenu', () => ({
  __esModule: true,
  default: () => null,
  SettingsMenu: () => null,
}))

import { Sidebar } from '../Sidebar'

describe('Sidebar', () => {
  it('renders overview + all 11 group headers when all feature flags on', () => {
    // Security & Access merged into System Management (#92, 2026-04-26),
    // so 11 groups not 12.
    render(<Sidebar active="overview" onNavigate={() => {}} />)
    expect(screen.getByRole('button', { name: /Dashboard Overview/ })).toBeInTheDocument()
    ;['System Management','LLM','Tools Management','OpenAgentic Flows','Code Mode',
      'Agent Management','Integrations','Prompt Engineering','Content & Data',
      'Chargeback & Costs','Monitoring & Logs']
      .forEach(label => {
        expect(screen.getByRole('button', { name: new RegExp('^' + label) }), `missing group header: ${label}`).toBeInTheDocument()
      })
  })

  it('does NOT render a redundant lowercase header div above each group toggle', () => {
    // Bug fix 2026-04-26: every group rendered TWO labels — a small uppercase
    // header div + the toggle button — visually duplicating the group name
    // (e.g. "LLM | LLM"). Only the toggle button should carry the label.
    const { container } = render(<Sidebar active="overview" onNavigate={() => {}} />)
    const toggleButtons = container.querySelectorAll('[data-testid="sidebar-group-toggle"]')
    expect(toggleButtons.length).toBeGreaterThan(0)
    for (const btn of toggleButtons) {
      const labelSpan = btn.querySelector('span.flex-1')
      const groupLabel = labelSpan?.textContent?.trim().toLowerCase()
      if (!groupLabel) continue
      const prev = btn.previousElementSibling as HTMLElement | null
      if (prev && prev.tagName === 'DIV') {
        const prevText = prev.textContent?.trim().toLowerCase()
        expect(prevText, `group "${groupLabel}" still has redundant header div`).not.toBe(groupLabel)
      }
    }
  })

  it('marks the active leaf with aria-current="page" and auto-expands its group', () => {
    render(<Sidebar active="providers" onNavigate={() => {}} />)
    const active = screen.getByRole('button', { name: 'Provider Management' })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('onNavigate fires with the leaf id when a leaf is clicked', async () => {
    const onNavigate = vi.fn()
    render(<Sidebar active="overview" onNavigate={onNavigate} />)
    await userEvent.click(screen.getByRole('button', { name: /^System Management/ }))
    await userEvent.click(screen.getByRole('button', { name: 'User Management' }))
    expect(onNavigate).toHaveBeenCalledWith('users')
  })

  it('hides Tools Management when featureFlags.mcp is false', async () => {
    vi.resetModules()
    vi.doMock('../../../../config/featureFlags', () => ({
      featureFlags: { mcp: false, synth: false, openagentic: true, adminV2: true, ollama: false, multiModel: true },
    }))
    const { Sidebar: SidebarNoMcp } = await import('../Sidebar')
    render(<SidebarNoMcp active="overview" onNavigate={() => {}} />)
    expect(screen.queryByRole('button', { name: /^Tools Management/ })).not.toBeInTheDocument()
  })
})
