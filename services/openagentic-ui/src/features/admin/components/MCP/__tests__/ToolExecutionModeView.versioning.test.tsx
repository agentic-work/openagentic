/**
 * ToolExecutionModeView — RED tests for the §11.5 optimistic-concurrency rewrite.
 *
 * Wiring contract (post-rewrite):
 *   • State + save flows through `useOptimisticVersion` (no raw fetch in component).
 *   • The toggle CTA opens the primitives-v2 Modal with typed-confirm.
 *   • The destructive "restore full access" confirm requires the operator to
 *     type the canonical phrase before the CTA is enabled.
 *   • A 409 surfaces the primitives-v2 ConflictModal (3-CTA diff).
 *   • The component no longer accepts a `theme` prop — uses --ap-* tokens.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToolExecutionModeView } from '../ToolExecutionModeView'

const originalFetch = globalThis.fetch
function mockFetchSequence(responses: Array<{ status: number; body: any }>) {
  let i = 0
  globalThis.fetch = vi.fn(async () => {
    const r = responses[i++] ?? responses[responses.length - 1]
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as unknown as Response
  })
}

beforeEach(() => { globalThis.fetch = vi.fn() })
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); cleanup() })

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('ToolExecutionModeView — read-only state', () => {
  it('shows "Enable Read-Only Mode" CTA when api reports enabled=false', async () => {
    mockFetchSequence([{ status: 200, body: { enabled: false, source: 'database', version: 3 } }])
    render(wrap(<ToolExecutionModeView />))
    const cta = await waitFor(() => screen.getByRole('button', { name: /enable read-only/i }))
    expect(cta).toBeInTheDocument()
  })

  it('shows "Restore Full Access" CTA when api reports enabled=true', async () => {
    mockFetchSequence([{ status: 200, body: { enabled: true, source: 'database', version: 5 } }])
    render(wrap(<ToolExecutionModeView />))
    const cta = await waitFor(() => screen.getByRole('button', { name: /restore full access/i }))
    expect(cta).toBeInTheDocument()
  })
})

describe('ToolExecutionModeView — typed-confirm modal', () => {
  it('opens a dialog with a typed-confirm input when "Enable Read-Only Mode" is clicked', async () => {
    mockFetchSequence([{ status: 200, body: { enabled: false, source: 'database', version: 3 } }])
    render(wrap(<ToolExecutionModeView />))
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /enable read-only/i })))
    const dialog = await waitFor(() => screen.getByRole('dialog'))
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox')).toBeInTheDocument()
  })

  it('keeps the modal primary CTA disabled until the typed phrase matches', async () => {
    mockFetchSequence([{ status: 200, body: { enabled: false, source: 'database', version: 3 } }])
    render(wrap(<ToolExecutionModeView />))
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /enable read-only/i })))
    const dialog = await waitFor(() => screen.getByRole('dialog'))
    // Modal primary lives inside the dialog footer; locate by its label.
    const primaryBtn = within(dialog).getByTestId('modal-primary')
    expect(primaryBtn).toBeDisabled()

    const input = within(dialog).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'wrong phrase' } })
    expect(primaryBtn).toBeDisabled()
  })

  it('enables the primary CTA once the canonical phrase is typed and POSTs the version', async () => {
    mockFetchSequence([
      { status: 200, body: { enabled: false, source: 'database', version: 3 } }, // GET
      { status: 200, body: { enabled: true, source: 'database', version: 4 } },  // POST
      { status: 200, body: { enabled: true, source: 'database', version: 4 } },  // refetch
    ])
    render(wrap(<ToolExecutionModeView />))
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /enable read-only/i })))
    const dialog = await waitFor(() => screen.getByRole('dialog'))
    const input = within(dialog).getByRole('textbox')
    // Canonical typed-confirm phrase — visible inside the dialog body.
    const phrase = within(dialog).getByText('enable read-only').textContent ?? 'enable read-only'
    fireEvent.change(input, { target: { value: phrase } })

    const primaryBtn = within(dialog).getByTestId('modal-primary')
    expect(primaryBtn).not.toBeDisabled()
    fireEvent.click(primaryBtn)

    await waitFor(() => {
      const postCall = (globalThis.fetch as any).mock.calls.find((c: any[]) => (c[1] as RequestInit | undefined)?.method === 'POST')
      expect(postCall).toBeDefined()
      const sent = JSON.parse((postCall[1] as RequestInit).body as string)
      expect(sent).toMatchObject({ enabled: true, version: 3 })
    })
  })
})

describe('ToolExecutionModeView — 409 conflict UI', () => {
  it('renders the ConflictModal when POST returns 409', async () => {
    mockFetchSequence([
      { status: 200, body: { enabled: false, source: 'database', version: 3 } },
      { status: 409, body: {
        error: 'Conflict',
        currentRow: { enabled: true, source: 'database', version: 7, updated_by: 'someone-else' },
        conflictingFields: ['enabled'],
      } },
    ])
    render(wrap(<ToolExecutionModeView />))
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /enable read-only/i })))
    const dialog = await waitFor(() => screen.getByRole('dialog'))
    const input = within(dialog).getByRole('textbox')
    const phrase = within(dialog).getByText('enable read-only').textContent ?? 'enable read-only'
    fireEvent.change(input, { target: { value: phrase } })
    fireEvent.click(within(dialog).getByTestId('modal-primary'))

    // Conflict modal eventually replaces the typed-confirm modal.
    await waitFor(() => {
      expect(screen.getByTestId('conflict-modal')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /re-apply mine/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take theirs/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep editing/i })).toBeInTheDocument()
  })
})

describe('ToolExecutionModeView — token discipline', () => {
  it('renders no hex literals in inline style attributes', async () => {
    mockFetchSequence([{ status: 200, body: { enabled: false, source: 'database', version: 3 } }])
    const { container } = render(wrap(<ToolExecutionModeView />))
    await waitFor(() => screen.getByTestId('page-header'))
    const html = container.innerHTML
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0])
    expect(styleHexes).toEqual([])
  })
})
