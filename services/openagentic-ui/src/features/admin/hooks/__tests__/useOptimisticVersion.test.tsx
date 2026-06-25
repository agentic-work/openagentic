/**
 * useOptimisticVersion — RED tests for the §11.5 concurrency contract.
 *
 * Wraps a versioned admin endpoint (GET returns `version`, POST requires
 * `version` in body, returns 409 on stale version with currentRow +
 * conflictingFields). Exposes a hook surface that:
 *   - fetches + caches the current row
 *   - save(payload) POSTs with the current version automatically attached
 *   - on 409: surfaces { currentRow, conflictingFields, attemptedPayload }
 *     to UI without throwing
 *   - dismissConflict() clears conflict state
 *   - resolveAndSave(payload) re-attaches the latest version + retries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useOptimisticVersion } from '../useOptimisticVersion'

// ---- fetch mock ----
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
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

const ENDPOINT = '/api/admin/tools/readonly'

describe('useOptimisticVersion — fetch + state', () => {
  it('fetches the row on mount and exposes data + version', async () => {
    mockFetchSequence([{ status: 200, body: { enabled: false, source: 'database', version: 3 } }])
    const { result } = renderHook(() => useOptimisticVersion<{ enabled: boolean }>({
      endpoint: ENDPOINT, queryKey: ['admin', 'tools', 'readonly'],
    }), { wrapper: wrap() })

    await waitFor(() => expect(result.current.state).toBeDefined())
    expect(result.current.state).toMatchObject({ enabled: false, version: 3 })
    expect(result.current.conflict).toBeNull()
  })
})

describe('useOptimisticVersion — happy save', () => {
  it('POST attaches the current version automatically', async () => {
    mockFetchSequence([
      { status: 200, body: { enabled: false, source: 'database', version: 3 } }, // initial GET
      { status: 200, body: { enabled: true, source: 'database', version: 4 } },  // POST response
      { status: 200, body: { enabled: true, source: 'database', version: 4 } },  // refetch after save
    ])
    const { result } = renderHook(() => useOptimisticVersion<{ enabled: boolean }>({
      endpoint: ENDPOINT, queryKey: ['admin', 'tools', 'readonly'],
    }), { wrapper: wrap() })

    await waitFor(() => expect(result.current.state?.version).toBe(3))

    await act(async () => { await result.current.save({ enabled: true }) })

    // Inspect what we POSTed.
    const postCall = (globalThis.fetch as any).mock.calls.find((c: any[]) => {
      const init = c[1] as RequestInit | undefined
      return init?.method === 'POST'
    })
    expect(postCall).toBeDefined()
    const sentBody = JSON.parse((postCall[1] as RequestInit).body as string)
    expect(sentBody).toMatchObject({ enabled: true, version: 3 })

    // After save, version is bumped.
    await waitFor(() => expect(result.current.state?.version).toBe(4))
    expect(result.current.conflict).toBeNull()
  })
})

describe('useOptimisticVersion — 409 conflict', () => {
  it('surfaces currentRow + conflictingFields without throwing', async () => {
    mockFetchSequence([
      { status: 200, body: { enabled: false, source: 'database', version: 3 } },
      { status: 409, body: {
        error: 'Conflict',
        currentRow: { enabled: true, source: 'database', version: 7, updated_by: 'someone-else' },
        conflictingFields: ['enabled'],
      } },
    ])
    const { result } = renderHook(() => useOptimisticVersion<{ enabled: boolean }>({
      endpoint: ENDPOINT, queryKey: ['admin', 'tools', 'readonly'],
    }), { wrapper: wrap() })

    await waitFor(() => expect(result.current.state?.version).toBe(3))

    await act(async () => {
      // Should NOT throw on 409 — caller checks `result.current.conflict`.
      await result.current.save({ enabled: true })
    })

    expect(result.current.conflict).not.toBeNull()
    expect(result.current.conflict?.currentRow).toMatchObject({ version: 7 })
    expect(result.current.conflict?.conflictingFields).toContain('enabled')
    expect(result.current.conflict?.attemptedPayload).toMatchObject({ enabled: true })
  })

  it('dismissConflict clears the conflict state', async () => {
    mockFetchSequence([
      { status: 200, body: { enabled: false, source: 'database', version: 3 } },
      { status: 409, body: {
        error: 'Conflict',
        currentRow: { enabled: true, source: 'database', version: 7 },
        conflictingFields: ['enabled'],
      } },
    ])
    const { result } = renderHook(() => useOptimisticVersion<{ enabled: boolean }>({
      endpoint: ENDPOINT, queryKey: ['admin', 'tools', 'readonly'],
    }), { wrapper: wrap() })

    await waitFor(() => expect(result.current.state?.version).toBe(3))
    await act(async () => { await result.current.save({ enabled: true }) })
    expect(result.current.conflict).not.toBeNull()

    act(() => result.current.dismissConflict())
    expect(result.current.conflict).toBeNull()
  })
})

describe('useOptimisticVersion — resolveAndSave', () => {
  it('refetches the latest row and retries with the new version', async () => {
    mockFetchSequence([
      { status: 200, body: { enabled: false, source: 'database', version: 3 } }, // initial GET
      { status: 409, body: {
        error: 'Conflict',
        currentRow: { enabled: true, source: 'database', version: 7 },
        conflictingFields: ['enabled'],
      } }, // first save: stale version
      { status: 200, body: { enabled: false, source: 'database', version: 7 } }, // refetch
      { status: 200, body: { enabled: true, source: 'database', version: 8 } },  // retry POST
      { status: 200, body: { enabled: true, source: 'database', version: 8 } },  // post-save refetch
    ])
    const { result } = renderHook(() => useOptimisticVersion<{ enabled: boolean }>({
      endpoint: ENDPOINT, queryKey: ['admin', 'tools', 'readonly'],
    }), { wrapper: wrap() })

    await waitFor(() => expect(result.current.state?.version).toBe(3))
    await act(async () => { await result.current.save({ enabled: true }) })
    expect(result.current.conflict).not.toBeNull()

    await act(async () => { await result.current.resolveAndSave({ enabled: true }) })

    // The retry POST should have used version=7 (from the conflict's currentRow).
    const calls = (globalThis.fetch as any).mock.calls.filter((c: any[]) => (c[1] as RequestInit | undefined)?.method === 'POST')
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const lastSent = JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string)
    expect(lastSent).toMatchObject({ enabled: true, version: 7 })

    await waitFor(() => expect(result.current.state?.version).toBe(8))
    expect(result.current.conflict).toBeNull()
  })
})
