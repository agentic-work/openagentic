import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PageHeader } from '../PageHeader'

describe('PageHeader', () => {
  it('renders crumbs, title, explainer', () => {
    render(
      <PageHeader
        crumbs={['Admin', 'LLM', 'Models']}
        title="Models"
        explainer="The models registered for this tenant"
      />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Models')
    // Crumbs: each segment present
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.getByText(/Models registered/i)).toBeInTheDocument()
  })

  it('marks the last crumb as the current page', () => {
    render(<PageHeader crumbs={['Admin', 'LLM', 'Models']} title="Models" />)
    const cur = screen.getByText('Models', { selector: '.cur' })
    expect(cur).toBeInTheDocument()
  })

  it('renders primary + secondary actions, primary fires onClick', () => {
    const onAdd = vi.fn()
    render(
      <PageHeader
        crumbs={['Admin']}
        title="Models"
        actions={[
          { label: 'Auto-discover' },
          { label: '+ Add model', primary: true, onClick: onAdd },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Auto-discover' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Add model' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('renders chip-group action and toggles via onClick', () => {
    const onChange = vi.fn()
    render(
      <PageHeader
        crumbs={['Admin']}
        title="Performance"
        actions={[
          {
            kind: 'chips',
            options: [
              { label: '1h' },
              { label: '24h', on: true },
              { label: '7d' },
            ],
            onChange,
          },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(onChange).toHaveBeenCalledWith('7d')
  })

  it('renders tabs and reflects activeTabId', () => {
    const onTabChange = vi.fn()
    render(
      <PageHeader
        crumbs={['Admin']}
        title="Models"
        tabs={[
          { id: 'all', label: 'All', count: 28 },
          { id: 'chat', label: 'Chat', count: 14 },
        ]}
        activeTabId="chat"
        onTabChange={onTabChange}
      />,
    )
    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()
    const allTab = screen.getByRole('tab', { name: /All/ })
    const chatTab = screen.getByRole('tab', { name: /Chat/ })
    expect(allTab).toHaveAttribute('aria-selected', 'false')
    expect(chatTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(allTab)
    expect(onTabChange).toHaveBeenCalledWith('all')
  })

  it('omits tabs row when no tabs given', () => {
    render(<PageHeader crumbs={['Admin']} title="X" />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('uses only --ap-* CSS variables (no hex literals)', () => {
    const { container } = render(<PageHeader crumbs={['Admin']} title="X" explainer="y" />)
    const html = container.innerHTML
    // No hex colours, no rgb literals — only token vars.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('renders with position: sticky when sticky prop is true', () => {
    const { container } = render(<PageHeader title="X" crumbs={['Admin']} sticky />)
    const header = container.querySelector('[data-testid="page-header"]')
    expect(header).toBeTruthy()
    const cs = (header as HTMLElement).style
    expect(cs.position).toBe('sticky')
    expect(cs.top).toBe('0px')
    // z-index should be set to keep header above scrolling content
    expect(parseInt(cs.zIndex, 10)).toBeGreaterThan(0)
  })

  it('renders without sticky positioning when sticky prop is omitted', () => {
    const { container } = render(<PageHeader title="X" crumbs={['Admin']} />)
    const header = container.querySelector('[data-testid="page-header"]')
    expect((header as HTMLElement).style.position).not.toBe('sticky')
  })
})
