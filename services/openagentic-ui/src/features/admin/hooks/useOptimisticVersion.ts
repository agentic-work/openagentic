/**
 * useOptimisticVersion — Phase 1.5/1.6 of the admin overhaul (§11.5).
 *
 * Wraps a versioned admin endpoint:
 *   GET   {endpoint}                returns { ...row, version, ... }
 *   POST  {endpoint}    body: { ...payload, version }
 *                         200 → bumped row, 409 → { currentRow, conflictingFields }
 *
 * The hook returns a save() that automatically attaches the current version,
 * surfaces 409 as `conflict` state (no throw), and exposes a resolveAndSave()
 * helper that re-reads the latest row + retries with the new version.
 *
 * Designed to feed primitives-v2/Modal (typed-confirm) and a future
 * ConflictModal (3-col diff) so every admin-write surface uses one contract.
 */

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

export interface VersionedRow {
  version: number
  [key: string]: unknown
}

export interface ConflictState<TPayload> {
  currentRow: VersionedRow
  conflictingFields: string[]
  attemptedPayload: TPayload
}

export interface UseOptimisticVersionOptions {
  endpoint: string
  queryKey: readonly unknown[]
  /** ms — when to consider cached data stale. Defaults to 0 (always refetch on mount). */
  staleTime?: number
}

export interface UseOptimisticVersionResult<TPayload, TState extends VersionedRow> {
  state: TState | undefined
  isLoading: boolean
  isSaving: boolean
  error: Error | null
  conflict: ConflictState<TPayload> | null
  /** POST {endpoint} with version attached. On 409 sets `conflict` (does NOT throw). */
  save: (payload: TPayload) => Promise<void>
  /** Re-read the row, then POST with the latest version. Use after the operator chooses
   *  "Re-apply mine" in the ConflictModal. */
  resolveAndSave: (payload: TPayload) => Promise<void>
  /** Drop the conflict state. Use after operator chooses "Take theirs" in the modal. */
  dismissConflict: () => void
  /** Force a refetch of the row (Take theirs, Refresh button, etc.). */
  refetch: () => Promise<unknown>
}

async function fetchJson(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...init })
}

export function useOptimisticVersion<
  TPayload extends Record<string, unknown>,
  TState extends VersionedRow = VersionedRow & TPayload
>(opts: UseOptimisticVersionOptions): UseOptimisticVersionResult<TPayload, TState> {
  const qc = useQueryClient()
  const [conflict, setConflict] = useState<ConflictState<TPayload> | null>(null)

  const query = useQuery<TState>({
    queryKey: opts.queryKey,
    queryFn: async () => {
      const r = await fetchJson(opts.endpoint, { method: 'GET' })
      if (!r.ok) throw new Error(`GET ${opts.endpoint} ${r.status}`)
      return (await r.json()) as TState
    },
    staleTime: opts.staleTime ?? 0,
  })

  const mutation = useMutation({
    mutationFn: async (vars: { payload: TPayload; version: number }) => {
      const body = { ...vars.payload, version: vars.version }
      const r = await fetchJson(opts.endpoint, { method: 'POST', body: JSON.stringify(body) })
      const json = await r.json().catch(() => ({}))
      if (r.status === 409) {
        // Surface conflict — do not throw.
        return { kind: 'conflict' as const, body: json, attempted: vars.payload }
      }
      if (!r.ok) {
        throw new Error(json?.error ?? `POST ${opts.endpoint} ${r.status}`)
      }
      return { kind: 'ok' as const, body: json as TState }
    },
  })

  const save = useCallback(async (payload: TPayload) => {
    const currentVersion = query.data?.version ?? 0
    const result = await mutation.mutateAsync({ payload, version: currentVersion })
    if (result.kind === 'conflict') {
      setConflict({
        currentRow: result.body.currentRow,
        conflictingFields: Array.isArray(result.body.conflictingFields) ? result.body.conflictingFields : [],
        attemptedPayload: result.attempted,
      })
      // Sync the cache to the truth so next save uses the new version automatically.
      qc.setQueryData(opts.queryKey, result.body.currentRow)
      return
    }
    setConflict(null)
    qc.setQueryData(opts.queryKey, result.body)
    await qc.invalidateQueries({ queryKey: opts.queryKey })
  }, [query.data?.version, mutation, qc, opts.queryKey])

  const resolveAndSave = useCallback(async (payload: TPayload) => {
    // Refetch first to pick up the latest version (cache may already have it
    // from the 409 sync, but a fresh GET is safest before retrying).
    const fresh = await qc.fetchQuery({
      queryKey: opts.queryKey,
      queryFn: async () => {
        const r = await fetchJson(opts.endpoint, { method: 'GET' })
        if (!r.ok) throw new Error(`GET ${opts.endpoint} ${r.status}`)
        return (await r.json()) as TState
      },
    }) as TState | undefined

    const v = fresh?.version ?? query.data?.version ?? 0
    const result = await mutation.mutateAsync({ payload, version: v })
    if (result.kind === 'conflict') {
      // Still conflicting (rare — someone wrote again between fetch and POST).
      setConflict({
        currentRow: result.body.currentRow,
        conflictingFields: Array.isArray(result.body.conflictingFields) ? result.body.conflictingFields : [],
        attemptedPayload: result.attempted,
      })
      qc.setQueryData(opts.queryKey, result.body.currentRow)
      return
    }
    setConflict(null)
    qc.setQueryData(opts.queryKey, result.body)
    await qc.invalidateQueries({ queryKey: opts.queryKey })
  }, [query.data?.version, mutation, qc, opts.queryKey, opts.endpoint])

  const dismissConflict = useCallback(() => setConflict(null), [])

  return {
    state: query.data,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    error: (query.error as Error | null) ?? null,
    conflict,
    save,
    resolveAndSave,
    dismissConflict,
    refetch: () => query.refetch(),
  }
}
