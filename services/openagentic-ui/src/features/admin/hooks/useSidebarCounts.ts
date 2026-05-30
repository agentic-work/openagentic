import { useAdminQuery } from './useAdminQuery'

// /api/admin/dashboard/counts response shape (free OSS endpoint)
interface DashboardMetricsResponse {
  chats?: number
  messages?: number
  users?: number
  workflows?: number
  flowRuns?: number
  agentRuns?: number
  llmRequests?: number
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


export function useSidebarCounts(): SidebarCountState {
  const dash = useAdminQuery<DashboardMetricsResponse>(
    ['dashboard-counts'],
    '/api/admin/dashboard/counts',
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

  const counts_data = dash.data

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
    'users':           fmt(users.data?.total ?? counts_data?.users),
    'tokens':          fmt(tokens.data?.total),
    // LLM
    'providers':       fmt(
      Array.isArray(prov.data?.providers) ? prov.data!.providers!.length : prov.data?.total
    ),
    'model-management': undefined,
    // Tools
    'mcp-fleet':       mcpTotal != null && toolsIndexed != null
      ? `${mcpTotal}/${toolsIndexed}`
      : undefined,
    // Flows
    'workflows':       fmt(counts_data?.workflows),
    'executions':      fmt(counts_data?.flowRuns),
    // Monitoring
    'embeddings':      undefined,
  }

  // Streaming/live leaves — indicate "data is flowing" via a green dot.
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
