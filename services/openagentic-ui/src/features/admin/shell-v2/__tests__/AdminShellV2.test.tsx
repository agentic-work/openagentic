import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { AdminShellV2 } from '../AdminShellV2'

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

describe('AdminShellV2', () => {
  it('renders with data-testid="admin-shell-v2"', () => {
    render(wrap(<AdminShellV2 />))
    expect(screen.getByTestId('admin-shell-v2')).toBeInTheDocument()
  })

  it('renders sidebar + topbar + overview dashboard by default', () => {
    render(wrap(<AdminShellV2 />))
    expect(screen.getAllByText(/OpenAgentic/).length).toBeGreaterThan(0)  // topbar brand
    expect(screen.getAllByText(/Dashboard Overview/).length).toBeGreaterThan(0)  // sidebar + page heading both have it
  })
})
