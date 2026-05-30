import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopBar } from '../TopBar'

describe('TopBar', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.removeAttribute('data-theme')
    document.body.removeAttribute('data-accent')
  })

  it('renders brand, env switcher, cmd bar, live badge, theme button, avatar', () => {
    render(<TopBar user={{ initials: 'MT' }} env="openagentic-dev/agentic-dev" />)
    expect(screen.getByText(/OpenAgentic/)).toBeInTheDocument()
    expect(screen.getByText(/openagentic-dev/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/command or search/i)).toBeInTheDocument()
    expect(screen.getByTestId('live-badge')).toBeInTheDocument()
    expect(screen.getByTestId('theme-button')).toBeInTheDocument()
    expect(screen.getByText('MT')).toBeInTheDocument()
  })

  it('live badge starts as mock and toggles to LIVE on click', async () => {
    render(<TopBar user={{ initials: 'MT' }} env="x/y" />)
    const badge = screen.getByTestId('live-badge')
    expect(badge).toHaveTextContent(/mock/i)
    await userEvent.click(badge)
    expect(badge).toHaveTextContent(/LIVE/i)
  })

  it('theme button opens ThemePanel', async () => {
    render(<TopBar user={{ initials: 'MT' }} env="x/y" />)
    await userEvent.click(screen.getByTestId('theme-button'))
    expect(screen.getByTestId('theme-panel')).toBeInTheDocument()
  })

  it('theme button label reflects current mode + accent', async () => {
    render(<TopBar user={{ initials: 'MT' }} env="x/y" />)
    expect(screen.getByTestId('theme-button')).toHaveTextContent(/dark · gcp/i)
    await userEvent.click(screen.getByTestId('theme-button'))
    await userEvent.click(screen.getByRole('button', { name: /^Light$/ }))
    expect(screen.getByTestId('theme-button')).toHaveTextContent(/light · gcp/i)
  })

  it('does NOT render AdminAIBar (admin agent moved to bottom dock)', () => {
    render(<TopBar user={{ initials: 'MT' }} env="x" />)
    // The placeholder input bar used to live here; it should be gone.
    expect(screen.queryByPlaceholderText(/Ask Admin AI/i)).toBeNull()
  })
})
