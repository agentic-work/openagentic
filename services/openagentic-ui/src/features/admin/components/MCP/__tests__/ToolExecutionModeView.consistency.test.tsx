/**
 * ToolExecutionModeView — chrome consistency tests (Bulk Batch A,
 * post Phase-1 §11.5 rewrite).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ToolExecutionModeView } from '../ToolExecutionModeView'

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ enabled: false, source: 'database', version: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  ) as any
})
afterEach(() => cleanup())

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('ToolExecutionModeView — chrome consistency', () => {
  it('renders the universal PageHeader primitive at the top', async () => {
    render(wrap(<ToolExecutionModeView />))
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined()
    })
  })

  it('PageHeader contains an <h1> with text matching /Tool Execution|Execution Mode/i', async () => {
    render(wrap(<ToolExecutionModeView />))
    const header = await waitFor(() => screen.getByTestId('page-header'))
    const h1 = within(header).getByRole('heading', { level: 1 })
    expect(h1.textContent || '').toMatch(/Tool Execution|Execution Mode/i)
  })

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(wrap(<ToolExecutionModeView />))
    await waitFor(() => screen.getByTestId('page-header'))

    const html = container.innerHTML
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0])
    expect(styleHexes).toEqual([])
  })
})
