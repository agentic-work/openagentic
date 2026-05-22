import { useQueries } from '@tanstack/react-query'
import { apiRequestJson } from '@/utils/api'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import {
  type IntegrationsResponse,
  type IntegrationLogsResponse,
  type IntegrationLogEntry,
  type IntegrationRow,
} from './types'

// ============================================================
// /api/admin/integrations
// ============================================================
export function useIntegrationsList() {
  return useAdminQuery<IntegrationsResponse>(
    ['integrations'],
    '/api/admin/integrations',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/integrations/:id/logs (per-integration)
// ============================================================
export function useIntegrationLogs(id: string | null) {
  return useAdminQuery<IntegrationLogsResponse>(
    ['integration-logs', id ?? '_none'],
    id ? `/api/admin/integrations/${encodeURIComponent(id)}/logs` : '/api/admin/integrations',
    { enabled: !!id, staleTime: 30_000 },
  )
}

// ============================================================
// All-integrations log feed (Logs tab).
//
// Fans out one /:id/logs call per integration, then merges + sorts the
// resulting entries by timestamp descending. Returned `logs` is empty
// while any sub-query is still loading; isLoading reflects "all done".
// ============================================================
export interface UnionLogsResult {
  logs: IntegrationLogEntry[]
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

export function useAllIntegrationLogs(integrations: IntegrationRow[]): UnionLogsResult {
  const queries = useQueries({
    queries: integrations.map((i) => ({
      queryKey: ['admin', 'integration-logs', i.id],
      queryFn: () =>
        apiRequestJson<IntegrationLogsResponse>(
          `/api/admin/integrations/${encodeURIComponent(i.id)}/logs`,
        ),
      staleTime: 30_000,
    })),
  })

  const isLoading = queries.some((q) => q.isLoading)
  const isError = queries.length > 0 && queries.every((q) => q.isError)

  const logs: IntegrationLogEntry[] = []
  queries.forEach((q, idx) => {
    const integration = integrations[idx]
    const list = q.data?.logs ?? []
    for (const e of list) {
      logs.push({
        ...e,
        integrationId: e.integrationId ?? integration.id,
        integrationName: e.integrationName ?? integration.name,
        platform: e.platform ?? integration.platform,
      })
    }
  })
  logs.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
  })

  const refetch = () => {
    for (const q of queries) q.refetch()
  }

  return { logs, isLoading, isError, refetch }
}
