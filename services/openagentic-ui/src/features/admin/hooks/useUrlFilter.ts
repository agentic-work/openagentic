import * as React from 'react'

export interface UrlFilterChip {
  key: string
  value: string
}

export interface UrlFilterState {
  filters: Record<string, string>
  chips: UrlFilterChip[]
  set: (key: string, value: string | null) => void
  removeKey: (key: string) => void
  clear: () => void
}

export interface UseUrlFilterOptions {
  /** Query keys we should NOT touch (e.g. session, deep-link state). */
  ignore?: string[]
}

function parseQuery(search: string, ignore: Set<string>): Record<string, string> {
  const params = new URLSearchParams(search)
  const out: Record<string, string> = {}
  for (const [k, v] of params.entries()) {
    if (ignore.has(k)) continue
    out[k] = v
  }
  return out
}

function writeQuery(filters: Record<string, string>, ignore: Set<string>) {
  const params = new URLSearchParams(window.location.search)
  // Strip every non-ignored existing key first.
  for (const k of [...params.keys()]) {
    if (!ignore.has(k)) params.delete(k)
  }
  // Then write the new filter keys.
  for (const [k, v] of Object.entries(filters)) {
    params.set(k, v)
  }
  const next = params.toString()
  const url = next
    ? `${window.location.pathname}?${next}`
    : window.location.pathname
  window.history.replaceState({}, '', url)
}

export function useUrlFilter(
  _tableId: string,
  options: UseUrlFilterOptions = {},
): UrlFilterState {
  const ignore = React.useMemo(
    () => new Set(options.ignore ?? []),
    [options.ignore],
  )
  const [filters, setFilters] = React.useState<Record<string, string>>(() =>
    parseQuery(window.location.search, ignore),
  )

  const writeAndSet = React.useCallback(
    (next: Record<string, string>) => {
      setFilters(next)
      writeQuery(next, ignore)
    },
    [ignore],
  )

  const set = React.useCallback(
    (key: string, value: string | null) => {
      const next = { ...filters }
      if (value == null || value === '') {
        delete next[key]
      } else {
        next[key] = value
      }
      writeAndSet(next)
    },
    [filters, writeAndSet],
  )

  const removeKey = React.useCallback(
    (key: string) => {
      set(key, null)
    },
    [set],
  )

  const clear = React.useCallback(() => {
    writeAndSet({})
  }, [writeAndSet])

  const chips: UrlFilterChip[] = React.useMemo(
    () => Object.entries(filters).map(([key, value]) => ({ key, value })),
    [filters],
  )

  return { filters, chips, set, removeKey, clear }
}
