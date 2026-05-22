import { useAdminQuery } from './useAdminQuery'
import type { RibbonCell } from '../shell-v3/Ribbon'

interface DashboardSummary {
  totalUsers: number
  activeUsers: number
  totalSessions: number
  totalMessages: number
  totalTokens: number
  totalCost: number
  totalMcpCalls: number
  totalEmbeddings: number
  apiAvgResponseTime: number
}

interface DashboardMetricsResponse {
  summary?: DashboardSummary
  period?: { start: string; end: string }
}

interface McpServer {
  id?: string
  name?: string
  status?: string
  health?: string
  toolCount?: number
}

type McpServersResponse = McpServer[] | { servers?: McpServer[] }

interface ProviderHealthEntry {
  provider?: string
  status?: string
  healthy?: boolean
}

interface ProviderHealthResponse {
  overall?: string
  providers?: ProviderHealthEntry[]
  // Legacy/alternate shape — kept as a fallback.
  total?: number
  healthy?: number
}

const DASH = (n: number | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? String(n) : '—'

const fmtTokens = (n: number | undefined): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const fmtCost = (n: number | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—'

const fmtMs = (n: number | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? `${Math.round(n)}ms` : '—'

const fmtCallsPerMin = (totalCalls: number | undefined, periodStart: string | undefined, periodEnd: string | undefined): string => {
  if (typeof totalCalls !== 'number' || !periodStart || !periodEnd) return '—'
  const ms = new Date(periodEnd).getTime() - new Date(periodStart).getTime()
  const minutes = ms / 60000
  if (minutes <= 0) return '—'
  return Math.round(totalCalls / minutes).toString()
}

export interface AdminRibbonState {
  cells: RibbonCell[]
  isLoading: boolean
  isError: boolean
}

export function useAdminRibbon(): AdminRibbonState {
  const dash = useAdminQuery<DashboardMetricsResponse>(
    ['dashboard-metrics', '24h'],
    '/api/admin/dashboard/metrics?timeRange=24h',
    { staleTime: 15_000, refetchInterval: 15_000 },
  )

  // MCP fleet — aggregate the server list (same pattern as v2 MCPFleet
  // page). `/admin/mcp/health` returns proxy health, not fleet summary,
  // so we count servers + tools by walking the /admin/mcp/servers array.
  const mcpServers = useAdminQuery<McpServersResponse>(
    ['mcp-servers'],
    '/api/admin/mcp/servers',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )

  // Provider list (LLM providers up/total). Same fallback logic.
  const prov = useAdminQuery<ProviderHealthResponse>(
    ['provider-health'],
    '/api/admin/llm-providers/health',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )

  const summary = dash.data?.summary
  const period = dash.data?.period

  // Aggregate MCP server list into fleet totals.
  const serverList: McpServer[] = Array.isArray(mcpServers.data)
    ? mcpServers.data
    : mcpServers.data?.servers ?? []
  const mcpTotal = serverList.length || undefined
  const mcpHealthy = mcpTotal != null
    ? serverList.filter((s) => {
        const v = (s.status ?? s.health ?? '').toLowerCase()
        return !v || v === 'healthy' || v === 'up' || v === 'ok'
      }).length
    : undefined
  const toolsIndexed = mcpTotal != null
    ? serverList.reduce((n, s) => n + (s.toolCount ?? 0), 0)
    : undefined

  const cells: RibbonCell[] = [
    {
      label: 'api',
      value: dash.isError ? 'down' : dash.isLoading ? '…' : 'healthy',
      tone: dash.isError ? 'err' : 'ok',
    },
    {
      label: 'prov',
      value: (() => {
        const list = prov.data?.providers
        if (Array.isArray(list)) {
          const total = list.length
          const healthy = list.filter((p) => p.healthy === true || p.status === 'healthy').length
          return total > 0 ? `${healthy}/${total}` : '—'
        }
        if (prov.data?.total != null) return `${prov.data.healthy ?? 0}/${prov.data.total}`
        return '—'
      })(),
    },
    {
      label: 'mcp',
      value: mcpTotal != null ? `${mcpHealthy ?? 0}/${mcpTotal}` : '—',
    },
    {
      label: 'tools',
      value: DASH(toolsIndexed),
    },
    {
      label: 'mcp calls',
      value: fmtCallsPerMin(summary?.totalMcpCalls, period?.start, period?.end),
    },
    {
      label: 'p95',
      value: fmtMs(summary?.apiAvgResponseTime),
    },
    {
      label: '$today',
      value: fmtCost(summary?.totalCost),
    },
    {
      label: 'tokens',
      value: fmtTokens(summary?.totalTokens),
    },
  ]

  return {
    cells,
    isLoading: dash.isLoading,
    isError: dash.isError,
  }
}
