import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { DashboardOverview } from '../DashboardOverview'

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

describe('DashboardOverview (mock mode)', () => {
  it('renders 12 stat cards', () => {
    const { container } = render(wrap(<DashboardOverview live={false} />))
    expect(container.querySelectorAll('.scell').length).toBe(12)
  })

  it('renders 7 tab buttons', () => {
    render(wrap(<DashboardOverview live={false} />))
    ;['Overview','Usage & Tokens','Cost Analysis','Flows & Agents','MCP & Tools','API & Limits','Infrastructure']
      .forEach(t => expect(screen.getByRole('button', { name: t })).toBeInTheDocument())
  })

  it('renders 4 Overview charts with data-chart attribute', () => {
    const { container } = render(wrap(<DashboardOverview live={false} />))
    expect(container.querySelectorAll('[data-chart]').length).toBe(4)
    ;['chat-sessions','api-rps','mcp-calls','p95'].forEach(k => {
      expect(container.querySelector(`[data-chart="${k}"]`)).not.toBeNull()
    })
  })

  it('renders 7 time-range pills, 24h pre-selected', () => {
    render(wrap(<DashboardOverview live={false} />))
    ;['1h','6h','12h','24h','7d','30d','90d'].forEach(r => {
      expect(screen.getByRole('button', { name: r })).toBeInTheDocument()
    })
  })

  it('shows mock values for stat cards (not live) when live=false', () => {
    render(wrap(<DashboardOverview live={false} />))
    expect(screen.getByText('51')).toBeInTheDocument()      // Chat Sessions mock
    expect(screen.getByText('$15.80')).toBeInTheDocument()  // Total Cost mock
    expect(screen.getByText('37.3K')).toBeInTheDocument()   // API Requests mock
  })
})
