import { useAdminQuery } from './useAdminQuery'

interface DashboardMetricsResponse {
  summary?: {
    totalUsers?: number
    activeUsers?: number
    totalMcpCalls?: number
    totalEmbeddings?: number
    totalCost?: number
    totalWorkflows?: number
    totalWorkflowExecutions?: number
    totalAgentExecutions?: number
  }
  perUserUsage?: unknown[]
  modelUsage?: unknown[]
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
  // Legacy/alternate shape kept as a fallback.
  total?: number
  healthy?: number
}

interface ListResponse<T = unknown> {
  total?: number
  items?: T[]
  data?: T[]
}

export interface SidebarCountState {
  counts: Record<string, string | undefined>
  liveLeaves: Record<string, boolean>
  isLoading: boolean
}

const fmt = (n: number | undefined | null): string | undefined => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const fmtCost = (n: number | undefined | null): string | undefined =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(0)}` : undefined

export function useSidebarCounts(): SidebarCountState {
  const dash = useAdminQuery<DashboardMetricsResponse>(
    ['dashboard-metrics', '24h'],
    '/api/admin/dashboard/metrics?timeRange=24h',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const mcpServers = useAdminQuery<McpServersResponse>(
    ['mcp-servers'],
    '/api/admin/mcp/servers',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const prov = useAdminQuery<ProviderHealthResponse>(
    ['provider-health'],
    '/api/admin/llm-providers/health',
    { staleTime: 60_000, refetchInterval: 60_000 },
  )

  const users = useAdminQuery<ListResponse>(
    ['user-management', 'count'],
    '/api/admin/user-management?page=1&limit=1',
    { staleTime: 60_000, refetchInterval: 60_000 },
  )

  const tokens = useAdminQuery<ListResponse>(
    ['tokens', 'count'],
    '/api/admin/tokens?page=1&limit=1',
    { staleTime: 60_000, refetchInterval: 120_000 },
  )

  const summary = dash.data?.summary

  // Aggregate MCP server list (matches v2 MCPFleet pattern).
  const serverList: McpServer[] = Array.isArray(mcpServers.data)
    ? mcpServers.data
    : mcpServers.data?.servers ?? []
  const mcpTotal = serverList.length || undefined
  const toolsIndexed = mcpTotal != null
    ? serverList.reduce((n, s) => n + (s.toolCount ?? 0), 0)
    : undefined

  const counts: Record<string, string | undefined> = {
    // System Mgmt
    'users':           fmt(users.data?.total ?? summary?.totalUsers),
    'tokens':          fmt(tokens.data?.total),
    // LLM
    'providers':       fmt(
      Array.isArray(prov.data?.providers) ? prov.data!.providers!.length : prov.data?.total
    ),
    'model-management': fmt(dash.data?.modelUsage?.length),
    // Tools
    'mcp-fleet':       mcpTotal != null && toolsIndexed != null
      ? `${mcpTotal}/${toolsIndexed}`
      : undefined,
    // Flows
    'workflows':       fmt(summary?.totalWorkflows),
    'executions':      fmt(summary?.totalWorkflowExecutions),
    // Chargeback
    'chargeback':      fmtCost(summary?.totalCost),
    // Monitoring
    'embeddings':      fmt(summary?.totalEmbeddings),
  }

  // Streaming/live leaves — keep static (these don't have a count, just
  // indicate "data is flowing" via a green dot).
  const liveLeaves: Record<string, boolean> = {
    'dashboard': true,
    'router-tuning': !dash.isError,
    'llm-performance': !dash.isError,
    'kpi-dashboard': !dash.isError,
    'audit-logs': !dash.isError,
    'agent-ops': !dash.isError,
    'data-layer': !dash.isError,
    'user-activity': !dash.isError,
    'cluster-health': !dash.isError,
  }

  return {
    counts,
    liveLeaves,
    isLoading: dash.isLoading,
  }
}
