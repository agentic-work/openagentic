import { useQuery } from '@tanstack/react-query'

export type PromSample = { metric: Record<string, string>; value?: [number, string]; values?: [number, string][] }

async function post(path: string, body: unknown): Promise<PromSample[]> {
  const token = (() => {
    try { return localStorage.getItem('auth_token') ?? '' } catch { return '' }
  })()
  const res = await fetch(`/api/admin/prom${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`prom ${res.status}`)
  const j = await res.json()
  if (j?.status !== 'success') throw new Error(j?.error ?? 'prom error')
  return j.data?.result ?? []
}

/** Instant PromQL query. `refetchInterval` defaults to 30s. */
export function usePromInstant(query: string, opts: { refetchInterval?: number | false } = {}) {
  return useQuery<PromSample[], Error>({
    queryKey: ['prom', 'instant', query],
    queryFn: () => post('/query', { query }),
    staleTime: 10_000,
    refetchInterval: opts.refetchInterval ?? 30_000,
    enabled: Boolean(query),
  })
}

/** Range PromQL query. `minutes` default 1440 (24h). `step` auto-derived to give ~60 samples. */
export function usePromRange(
  query: string,
  opts: { minutes?: number; step?: number; refetchInterval?: number | false } = {},
) {
  const minutes = opts.minutes ?? 1440
  const step = opts.step ?? Math.max(60, Math.round((minutes * 60) / 60))
  return useQuery<PromSample[], Error>({
    queryKey: ['prom', 'range', query, minutes, step],
    queryFn: () => {
      const end = Math.floor(Date.now() / 1000)
      const start = end - minutes * 60
      return post('/query_range', { query, start, end, step })
    },
    staleTime: 10_000,
    refetchInterval: opts.refetchInterval ?? 30_000,
    enabled: Boolean(query),
  })
}
