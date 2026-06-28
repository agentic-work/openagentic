import { useAdminQuery } from './useAdminQuery'

// ============================================================
// /api/admin/dashboard/counts shape (free OSS endpoint)
// Returns the 7 core platform counts at the top level, PLUS (2026-06,
// backward-compatible) structural counts that are REAL on a fresh install
// (mcpServers / mcpTools / models / providers) and a `summary` + `timeSeries`
// block shaped to DashboardSummary / DashboardTimeSeries. The added fields
// are optional so an older api build degrades to honest zeros / "—", never a
// crash and never a fabricated value.
// ============================================================
export interface DashboardCountsResponse {
  chats: number
  messages: number
  users: number
  workflows: number
  flowRuns: number
  agentRuns: number
  llmRequests: number
  // ── structural counts (REAL on a fresh box, even with zero usage) ──
  mcpServers?: number
  mcpTools?: number
  models?: number
  providers?: number
  // ── usage rollups + series (real once usage flows; zeros/[] on day 1) ──
  summary?: Partial<DashboardSummary>
  timeSeries?: Partial<DashboardTimeSeries>
}

// ============================================================
// /api/admin/dashboard/metrics shape (legacy — kept for
// type-compatibility only; the endpoint is deleted in OSS.
// DO NOT call this endpoint — use useDashboardMetrics() which
// now calls /api/admin/dashboard/counts instead.
// ============================================================
export interface DashboardSummary {
  totalUsers: number
  activeUsers: number
  totalSessions: number
  sessionChange: number
  totalMessages: number
  messageChange: number
  totalTokens: number
  totalCost: number
  totalImages: number
  totalMcpCalls: number
  totalEmbeddings: number
  contextWindowAvgUtil: number

  // Code-mode rollups — optional; emitted only when the (enterprise) code
  // surface is present, otherwise undefined → honest "—" on the console.
  totalCodeTokens?: number
  totalCodeCost?: number
  totalCodeMessages?: number
  totalCodeSessions?: number

  totalWorkflowExecutions: number
  totalWorkflows: number
  activeWorkflows: number
  workflowSuccessRate: number

  totalAgentExecutions: number
  agentTotalTokens: number
  agentTotalCost: number

  totalApiRequests: number
  apiErrorRate: number
  apiAvgResponseTime: number

  // Additive summary fields — the api emits these inside `summary:{…}`. All
  // optional so an older api build degrades to an honest "—", never fabricated.
  /** prev-period token Δ% (powers the Token Burn KPI delta). */
  tokensDeltaPct?: number
  /** prev-period cost Δ% (powers the Spend KPI delta). */
  costDeltaPct?: number
  /** is_active ≠ healthy → ok/warn/err flow rollup. */
  flowHealth?: { ok: number; warn: number; err: number }
  /** broadened active-user count (chat+api+agent+flow owners). */
  activeUsersBroad?: number
  activeUsersBroadDeltaPct?: number
  /** request-latency percentiles over total_duration_ms across the window. */
  requestLatencyP50Ms?: number
  requestLatencyP95Ms?: number
  requestLatencyP99Ms?: number
  /** compact token totals by router tier (floor/T2/T3/other). */
  tokenTotalsByTier?: Record<string, number>
}

export interface TimeSeriesPoint {
  timestamp: number
  value: number
}

export interface DashboardTimeSeries {
  sessions: TimeSeriesPoint[]
  messages: TimeSeriesPoint[]
  tokenUsage: TimeSeriesPoint[]
  images: TimeSeriesPoint[]
  embeddings: TimeSeriesPoint[]
  contextUtilization: TimeSeriesPoint[]
  workflowExecutions: TimeSeriesPoint[]
  agentExecutions: TimeSeriesPoint[]
  apiRequests: TimeSeriesPoint[]
  // Code-mode series — optional; present only when the code surface emits them.
  codeTokenUsage?: TimeSeriesPoint[]
  codeSessions?: TimeSeriesPoint[]
}

export interface ModelUsageRow {
  model: string
  count: number
  tokens: number
  cost: number
}

export interface CostByModelSeries {
  model: string
  data: TimeSeriesPoint[]
}

export interface McpToolUsageRow {
  tool: string
  count: number
}

export interface PerUserUsageRow {
  userId: string
  email: string
  displayName: string
  sessions: number
  messages: number
  tokens: number
  cost: number
  lastActive: string
}

export interface AgentByNameRow {
  name: string
  count: number
  tokens: number
  cost: number
  avgTime: number
  totalTime: number
}

export interface AgentStatusCounts {
  completed: number
  failed: number
  running: number
}

export interface AgentMetricsBlock {
  statusCounts: AgentStatusCounts
  byAgent: AgentByNameRow[]
}

export interface DashboardMetricsResponse {
  timeRange: string
  period: { start: string; end: string; bucketSize: string }
  summary: DashboardSummary
  timeSeries: DashboardTimeSeries
  modelUsage: ModelUsageRow[]
  costByModel: CostByModelSeries[]
  mcpToolUsage: McpToolUsageRow[]
  perUserUsage: PerUserUsageRow[]
  agentMetrics?: AgentMetricsBlock
}

export interface DashboardMetricsState {
  data?: DashboardMetricsResponse
  isLoading: boolean
  isError: boolean
  /** Wall-clock ms when react-query last successfully wrote `data`.
   *  0 if no data has loaded yet. Powers the "last refreshed Xs ago"
   *  indicator on the dashboard PageHead meta line. */
  dataUpdatedAt: number
  isFetching: boolean
}

// ============================================================
// useDashboardCounts — public hook for the free OSS counts endpoint.
// Prefer this for any new code that needs aggregate counts.
// ============================================================
export function useDashboardCounts() {
  return useAdminQuery<DashboardCountsResponse>(
    ['dashboard-counts'],
    '/api/admin/dashboard/counts',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

// ============================================================
// useDashboardMetrics — wraps /api/admin/dashboard/counts and maps it onto a
// DashboardMetricsState so existing callers continue to work without calling
// the deleted /api/admin/dashboard/metrics endpoint.
//
// 2026-06: the counts endpoint now returns a `summary` + `timeSeries` block
// (usage rollups REAL once requests flow; honest zeros / empty series on a
// fresh box) alongside the structural counts. We prefer those server values
// and fall back to the top-level integer counts so an OLDER api build (no
// summary block) still surfaces sessions / workflows / agent-runs rather than
// flat zeros. Nothing here fabricates a value — a missing field stays 0 / [] /
// undefined and the page renders an honest zero-state.
// ============================================================
export function useDashboardMetrics(
  _timeRange: string = '24h',
): DashboardMetricsState {
  const q = useAdminQuery<DashboardCountsResponse>(
    ['dashboard-counts'],
    '/api/admin/dashboard/counts',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )

  // Map counts (+ the new summary/timeSeries blocks) → DashboardMetricsResponse
  // so existing consumers that read summary.totalTokens / .activeWorkflows etc.
  // get the REAL value when the api emits it, and the top-level count otherwise.
  const data: DashboardMetricsResponse | undefined = q.data
    ? (() => {
        const c = q.data
        const sum = c.summary ?? {}
        const series = c.timeSeries ?? {}
        const summary: DashboardSummary = {
          totalUsers: sum.totalUsers ?? c.users,
          activeUsers: sum.activeUsers ?? 0,
          totalSessions: sum.totalSessions ?? c.chats,
          sessionChange: sum.sessionChange ?? 0,
          totalMessages: sum.totalMessages ?? c.messages,
          messageChange: sum.messageChange ?? 0,
          totalTokens: sum.totalTokens ?? 0,
          totalCost: sum.totalCost ?? 0,
          totalImages: sum.totalImages ?? 0,
          totalMcpCalls: sum.totalMcpCalls ?? 0,
          totalEmbeddings: sum.totalEmbeddings ?? 0,
          contextWindowAvgUtil: sum.contextWindowAvgUtil ?? 0,
          totalWorkflowExecutions: sum.totalWorkflowExecutions ?? c.flowRuns,
          totalWorkflows: sum.totalWorkflows ?? c.workflows,
          activeWorkflows: sum.activeWorkflows ?? 0,
          workflowSuccessRate: sum.workflowSuccessRate ?? 0,
          totalAgentExecutions: sum.totalAgentExecutions ?? c.agentRuns,
          agentTotalTokens: sum.agentTotalTokens ?? 0,
          agentTotalCost: sum.agentTotalCost ?? 0,
          totalApiRequests: sum.totalApiRequests ?? c.llmRequests,
          apiErrorRate: sum.apiErrorRate ?? 0,
          apiAvgResponseTime: sum.apiAvgResponseTime ?? 0,
          // additive deltas — undefined renders an honest "—", never a fake number
          tokensDeltaPct: sum.tokensDeltaPct ?? undefined,
          costDeltaPct: sum.costDeltaPct ?? undefined,
          activeUsersBroad: sum.activeUsersBroad ?? undefined,
        }
        const ser = (k: keyof DashboardTimeSeries): TimeSeriesPoint[] =>
          (series[k] as TimeSeriesPoint[] | undefined) ?? []
        return {
          timeRange: 'all',
          period: { start: '', end: '', bucketSize: '' },
          summary,
          timeSeries: {
            sessions: ser('sessions'),
            messages: ser('messages'),
            tokenUsage: ser('tokenUsage'),
            images: ser('images'),
            embeddings: ser('embeddings'),
            contextUtilization: ser('contextUtilization'),
            workflowExecutions: ser('workflowExecutions'),
            agentExecutions: ser('agentExecutions'),
            apiRequests: ser('apiRequests'),
          },
          modelUsage: [],
          costByModel: [],
          mcpToolUsage: [],
          perUserUsage: [],
        }
      })()
    : undefined

  return {
    data,
    isLoading: q.isLoading,
    isError: q.isError,
    dataUpdatedAt: q.dataUpdatedAt ?? 0,
    isFetching: q.isFetching,
  }
}

// ============================================================
// Structural platform counts — REAL on a fresh install (MCP servers, indexed
// tools, models, providers). The HomePage surfaces these as KPI cards so a
// brand-new box shows substance even with zero usage. Backed by the same
// /api/admin/dashboard/counts payload; reuses the shared query cache key so
// there is no second network request.
// ============================================================
export interface DashboardStructuralCounts {
  mcpServers?: number
  mcpTools?: number
  models?: number
  providers?: number
}

export function useDashboardStructuralCounts(): {
  data?: DashboardStructuralCounts
  isLoading: boolean
  isError: boolean
} {
  const q = useAdminQuery<DashboardCountsResponse>(
    ['dashboard-counts'],
    '/api/admin/dashboard/counts',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
  return {
    data: q.data
      ? {
          mcpServers: q.data.mcpServers,
          mcpTools: q.data.mcpTools,
          models: q.data.models,
          providers: q.data.providers,
        }
      : undefined,
    isLoading: q.isLoading,
    isError: q.isError,
  }
}

// ============================================================
// Auxiliary hooks
// ============================================================

export interface McpHealth {
  totalServers?: number
  healthyServers?: number
  toolsIndexed?: number
}

export function useMcpHealth() {
  return useAdminQuery<McpHealth>(
    ['mcp-health'],
    '/api/admin/mcp/health',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

// ============================================================
// /api/admin/mcp-logs/stats — aggregate MCP-call stats from the
// mcp_usage table (admin-mcp-logs.ts, registered via admin.plugin.ts).
// Groups by server_name + tool_name so the V3 Fleet donut can render
// real "calls by server" / "calls by tool" slices WITHOUT Prometheus
// (the old /api/admin/dashboard/metrics.mcpToolUsage feed was deleted
// in OSS and useDashboardMetrics now hard-codes mcpToolUsage:[]).
// ============================================================
export interface McpStatsTopTool {
  toolId: string
  toolName: string
  serverId: string
  count: number
}
export interface McpStatsTopServer {
  serverId: string
  count: number
}
export interface McpStatsResponse {
  success?: boolean
  totalCalls?: number
  recentCalls24h?: number
  successfulCalls?: number
  failedCalls?: number
  successRate?: string
  avgExecutionTime?: number
  topTools?: McpStatsTopTool[]
  topServers?: McpStatsTopServer[]
}

export function useMcpStats() {
  return useAdminQuery<McpStatsResponse>(
    ['mcp-stats'],
    '/api/admin/mcp-logs/stats',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

export interface ProviderHealthEntry {
  provider?: string
  status?: string
  healthy?: boolean
  endpoint?: string
  lastChecked?: string
  error?: string
}

export interface ProviderHealth {
  overall?: string
  providers?: ProviderHealthEntry[]
  // Legacy/alternate shape kept as a fallback.
  total?: number
  healthy?: number
}

export function useProviderHealth() {
  return useAdminQuery<ProviderHealth>(
    ['provider-health'],
    '/api/admin/llm-providers/health',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

// /api/admin/llm-providers — per-row provider list with models[] etc.
export interface LlmProviderRow {
  id: string
  name: string
  displayName?: string
  type: string
  enabled: boolean
  priority?: number
  config?: { region?: string; endpoint?: string; deployment?: string }
  authConfig?: { type?: string; hasApiKey?: boolean; hasCredentials?: boolean }
  capabilities?: { chat?: boolean; tools?: boolean; vision?: boolean; streaming?: boolean; embeddings?: boolean }
  models?: Array<{
    id: string
    name?: string
    maxTokens?: number
    capabilities?: {
      chat?: boolean
      embeddings?: boolean
      tools?: boolean
      vision?: boolean
      streaming?: boolean
      dimensions?: number
    }
    costPerToken?: { prompt?: number; completion?: number }
  }>
}

export interface LlmProvidersResponse {
  providers: LlmProviderRow[]
  totalProviders: number
  totalModels: number
}

export function useLlmProviders() {
  return useAdminQuery<LlmProvidersResponse>(
    ['llm-providers'],
    '/api/admin/llm-providers',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// /api/admin/mcp/servers — per-server fleet list (used by v2 MCPFleet too).
export interface McpServerRow {
  id?: string
  name?: string
  displayName?: string
  category?: string
  hosted?: 'pod' | 'remote' | string
  tier?: string
  status?: string
  health?: string
  toolCount?: number
  callsPerHour?: number
  lastSeen?: string
}

export type McpServersResponse = McpServerRow[] | { servers?: McpServerRow[] }

export function useMcpServers() {
  return useAdminQuery<McpServersResponse>(
    ['mcp-servers'],
    '/api/admin/mcp/servers',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

// /api/admin/audit-logs returns { success, logs: AuditLogEntry[], pagination }.
// The unified feed (activityAggregator) normalizes EVERY source table into this
// one shape, so `type` is the full 8-source union — not just admin/user. Keep
// this in lockstep with ActivityType in
// services/openagentic-api/src/services/audit/activityAggregator.ts.
export type AuditLogType =
  | 'admin'
  | 'user'
  | 'tool-call'
  | 'flow'
  | 'agent'
  | 'webhook'
  | 'security'
  | 'auth'

export interface AuditLogEntry {
  id: string
  type: AuditLogType
  userId?: string | null
  userName?: string | null
  userEmail?: string | null
  action?: string | null
  resourceType?: string | null
  resourceId?: string | null
  query?: string | null
  intent?: string | null
  sessionId?: string | null
  messageId?: string | null
  mcpServer?: string | null
  toolsCalled?: string[] | null
  success?: boolean
  error?: string | null
  ipAddress?: string | null
  timestamp: string
}

export interface AuditLogsResponse {
  success: boolean
  logs: AuditLogEntry[]
  // The server pagination envelope is { page, limit, total, totalPages, hasMore }.
  // Older callers read totalItems; keep both optional so neither breaks.
  pagination?: {
    page: number
    limit: number
    totalPages: number
    total?: number
    totalItems?: number
    hasMore?: boolean
  }
}

/** /api/admin/audit-logs feed for global tabs (no resource scope). */
export function useAuditLogs(limit = 10) {
  return useAdminQuery<AuditLogsResponse>(
    ['audit-logs', String(limit)],
    `/api/admin/audit-logs?page=1&limit=${limit}`,
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

/**
 * /api/admin/audit-logs scoped to a specific resource. Used by detail
 * panes (ModelDetail.LogsTab, ProviderDetail.LogsTab) so the empty-state
 * doesn't trigger when the global last-50 doesn't happen to mention the
 * resource. Server-side filters via `resourceType` + `resourceId`
 * (both contains-mode insensitive). 2026-05-07.
 */
export function useScopedAuditLogs(args: {
  resourceType?: string
  resourceId?: string
  limit?: number
}) {
  const { resourceType, resourceId, limit = 50 } = args
  const q = new URLSearchParams({ page: '1', limit: String(limit) })
  if (resourceType) q.set('resourceType', resourceType)
  if (resourceId) q.set('resourceId', resourceId)
  return useAdminQuery<AuditLogsResponse>(
    ['audit-logs-scoped', resourceType ?? '', resourceId ?? '', String(limit)],
    `/api/admin/audit-logs?${q.toString()}`,
    {
      staleTime: 30_000,
      refetchInterval: 60_000,
      enabled: Boolean(resourceType || resourceId),
    },
  )
}

// /api/admin/mcp-logs returns { success, logs: McpLogEntry[], pagination }
export interface McpLogEntry {
  id: string
  toolName: string
  serverId: string
  method?: string
  userId?: string | null
  userName?: string
  userEmail?: string
  status: 'success' | 'error'
  executionTime: number
  error?: string
  timestamp: string
  modelUsed?: string
  modelProvider?: string
}

export interface McpLogsResponse {
  success: boolean
  logs: McpLogEntry[]
  pagination?: { page: number; limit: number; totalPages: number; totalItems: number; hasMore: boolean }
}

export function useMcpLogs(limit = 20) {
  return useAdminQuery<McpLogsResponse>(
    ['mcp-logs', String(limit)],
    `/api/admin/mcp-logs?page=1&limit=${limit}`,
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
}

// ============================================================
// /api/admin/router-tuning — Smart Router scoring weights + FCA floors
// Backed by RouterTuningService; mirrors the shape consumed by the v2
// RouterTuningView so the v3 page can read the same source of truth.
// ============================================================
export interface RouterTuningValues {
  costWeight: number
  qualityWeight: number
  costBonusMaxPoints: number
  latencyBonusMaxPoints: number
  toolCallingBonusMaxPoints: number
  reasoningBonusMaxPoints: number
  fcaQualityFloor: number
  fcaQualityMultiplier: number
  fcaQualityGatedByComplexity: boolean
  costNormalizationCeiling: number
  fcaChatPoolFloor: number
  fcaSimpleToolFloor: number
  fcaComplexToolFloor: number
  fcaDestructiveFloor: number
  fcaInfraOpsFloor: number
  fcaCloudListFloor: number
  fcaComplexityBiasFloor: number
  // T3 capability gate fields (added 2026-05-22 #1049) — ripped from
  // hardcoded T3_FCA_FLOOR / T3_CONTEXT_FLOOR / EXPLICIT_MOST_CAPABLE_RE
  // constants in SmartModelRouter.ts and the per-taskType
  // CAPABILITY_PROFILES literals in PromptClassifier.ts.
  fcaT3Floor: number
  contextT3Floor: number
  t3TriggerTaskTypes: string[]
  capabilityProfileFloors: Record<string, number>
  capabilityContextFloors: Record<string, number>
  intentClassifierEnabled: boolean
  intentClassifierModelId: string
}

export interface RouterTuningResponse {
  tuning: RouterTuningValues
  lastUpdatedAt?: string
  lastUpdatedBy?: string
  podCount?: number
}

export function useRouterTuning() {
  return useAdminQuery<RouterTuningResponse>(
    ['router-tuning'],
    '/api/admin/router-tuning',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/chat-loop-config — admin-tunable chat-loop knobs.
// Backed by ChatLoopConfigService (SoT:
// `admin.system_configuration` row keyed `chat_loop`).
// Only `maxTurns` is exposed today; the shape is forward-compatible
// with additional knobs (per_tool_timeout_ms, max_parallel_tools).
// ============================================================
export interface ChatLoopConfigValues {
  maxTurns: number
}

export interface ChatLoopConfigResponse {
  success: boolean
  config: ChatLoopConfigValues
  meta?: {
    maxTurnsFloor: number
    maxTurnsCeiling: number
  }
}

export function useChatLoopConfig() {
  return useAdminQuery<ChatLoopConfigResponse>(
    ['chat-loop-config'],
    '/api/admin/chat-loop-config',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

/**
 * Registry rows enriched with FCA / cost / latency, used for
 * client-side score breakdowns in the Live Scoring Lab. Older API
 * builds may surface those fields nested under `capabilities` — see
 * RouterTuningView.registryRowToLabModel for the fallback decode.
 */
export interface LlmRegistryRow {
  id: string
  model: string
  provider: string
  role: string
  priority: number
  enabled: boolean
  functionCallingAccuracy?: number
  inputCostPer1k?: number
  avgLatencyMs?: number
  capabilities?: Record<string, unknown> | null
  [key: string]: unknown
}

export function useLlmRegistry(enabledOnly = true) {
  const qs = enabledOnly ? '?enabledOnly=true' : ''
  return useAdminQuery<LlmRegistryRow[]>(
    ['llm-registry', enabledOnly ? 'enabled' : 'all'],
    `/api/admin/llm-providers/registry${qs}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/router/decisions — recent routing decisions feed.
// Backed by v3-extras.ts (modelRoutingDecision rows); permissive
// shape so the older selectedModelId consumers in RouterTuningLab
// continue to work alongside the canonical chosenModel field.
// ============================================================
export interface RouterDecisionEntry {
  id?: string
  timestamp?: string
  prompt?: string
  intent?: string
  selectedModelId?: string  // legacy alias (RouterTuningLab simulator path)
  chosenModel?: string      // canonical server field
  previousModel?: string
  alternates?: Array<{ modelId?: string; score?: number }>
  tier?: string
  resolvedBy?: string
  reason?: string
  fca?: number
  latencyMs?: number
  inputCostPer1k?: number
  avgLatencyMs?: number
  score?: number
  sessionId?: string
}

export interface RouterDecisionsResponse {
  success?: boolean
  decisions?: RouterDecisionEntry[]
  count?: number
  // Permissive fallback shape so we don't crash on different server
  // implementations of the same conceptual endpoint.
  logs?: RouterDecisionEntry[]
}

export function useRouterDecisions(limit = 20) {
  return useAdminQuery<RouterDecisionsResponse>(
    ['router-decisions', String(limit)],
    `/api/admin/router/decisions?limit=${limit}`,
    { staleTime: 15_000, refetchInterval: 30_000 },
  )
}

// ============================================================
// Dashboard auxiliary endpoints (v3-extras) — wired into the v3
// Dashboard panes.  Each follows the standard { success, ... }
// envelope from services/openagentic-api/src/routes/admin/v3-extras.ts.
// ============================================================

export interface FlowFailureRow {
  executionId: string
  workflowId: string
  workflowName: string
  failedNodeId: string | null
  error: string | null
  startedAt: string
  completedAt: string | null
  executionTimeMs: number | null
  startedBy: string | null
  timestamp: string
}

export interface FlowFailuresResponse {
  success: boolean
  failures: FlowFailureRow[]
  count: number
}

export function useFlowsRecentFailures(limit = 20) {
  return useAdminQuery<FlowFailuresResponse>(
    ['flows-recent-failures', String(limit)],
    `/api/admin/flows/recent-failures?limit=${limit}`,
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

export interface TopEndpointRow {
  path: string
  calls: number
  errorRate: number
  avgMs: number
}

export interface TopEndpointsResponse {
  success: boolean
  endpoints: TopEndpointRow[]
  source?: string
}

export function useTopEndpoints(limit = 20, window: string = '24h') {
  return useAdminQuery<TopEndpointsResponse>(
    ['top-endpoints', String(limit), window],
    `/api/admin/api-requests/top-endpoints?limit=${limit}&window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

export interface StatusCodesResponse {
  success: boolean
  codes: Record<string, number>
  source?: string
}

export function useStatusCodes(window: string = '24h') {
  return useAdminQuery<StatusCodesResponse>(
    ['status-codes', window],
    `/api/admin/api-requests/status-codes?window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

export interface AuthMethodsResponse {
  success: boolean
  methods: Record<string, number>
  source?: string
}

export function useAuthMethods(window: string = '24h') {
  return useAdminQuery<AuthMethodsResponse>(
    ['auth-methods', window],
    `/api/admin/api-requests/auth-methods?window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

export interface PerfPercentileRow {
  endpoint: string
  p50: number
  p95: number
  p99: number
  count: number
}

export interface PerfPercentilesResponse {
  success: boolean
  rows: PerfPercentileRow[]
  source?: string
}

export function usePerfPercentiles(window: string = '24h') {
  return useAdminQuery<PerfPercentilesResponse>(
    ['perf-percentiles', window],
    `/api/admin/perf/percentiles?window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/perf/throughput — tokens-per-second + concurrency
// rollup. Backed by v3-extras-misc.ts (LLMRequestLog).
// ============================================================
export interface PerfThroughputResponse {
  success: boolean
  windowHours?: number
  tokens_per_sec_avg?: number
  tokens_per_sec_p95?: number
  max_concurrency?: number
  sample?: number
  source?: string
}

export function usePerfThroughput(window: string = '24h') {
  return useAdminQuery<PerfThroughputResponse>(
    ['perf-throughput', window],
    `/api/admin/perf/throughput?window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/cluster/health — k8s node + pod + cpu/mem rollup
// from Prometheus. Aggregate version of the per-PromQL Q_*
// queries the InfraPane runs through usePromInstant. Returns 503
// (data: undefined, isError: true) when Prom is unreachable so
// the pane can fall back to a clear empty-state.
// ============================================================
export interface ClusterHealthResponse {
  success: boolean
  nodes?: { ready: number; total: number }
  pods?: { running: number; pending: number; failed: number; total: number }
  cpu?: { used_pct: number | null; capacity_cores: number | null }
  memory?: { used_pct: number | null; capacity_gb: number | null }
  source?: string
  error?: string
}

export function useClusterHealth() {
  return useAdminQuery<ClusterHealthResponse>(
    ['cluster-health'],
    '/api/admin/cluster/health',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

// ============================================================
// /api/admin/storage — milvus + pgvector + redis usage
// ============================================================
export interface StorageSection {
  collections?: number
  total_vectors?: number
  tables?: number
  total_rows?: number
  keys?: number
  memory_mb?: number | null
  error?: string
}
export interface StorageResponse {
  success: boolean
  milvus?: StorageSection
  pgvector?: StorageSection
  redis?: StorageSection
}

export function useStorage() {
  return useAdminQuery<StorageResponse>(
    ['storage'],
    '/api/admin/storage',
    { staleTime: 60_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/api-requests/throttles — rate-limit hit counts +
// users-at-quota. Backed by RateLimitViolation + LLMRequestLog
// rate_limit_hit + AdminAuditLog fallback.
// ============================================================
export interface ThrottleUserRow {
  userId: string
  email: string
  hits: number
}
export interface ApiThrottlesResponse {
  success: boolean
  windowHours?: number
  throttles?: number
  rateLimitHits?: number
  usersAtQuota?: ThrottleUserRow[]
  sources?: { rateLimitViolation: number; llmRequestLog: number; adminAuditLog: number }
}

export function useApiThrottles(window: string = '24h') {
  return useAdminQuery<ApiThrottlesResponse>(
    ['api-throttles', window],
    `/api/admin/api-requests/throttles?window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/router/escalation-triggers — what caused the smart
// router to escalate (intent → trigger → frequency).
// ============================================================
export interface EscalationTriggerRow {
  trigger: string
  count: number
  avgDelta: number | null
}
export interface RouterEscalationResponse {
  success: boolean
  windowHours?: number
  triggers?: EscalationTriggerRow[]
  sample?: number
  source?: string
}

export function useRouterEscalationTriggers(window: string = '24h') {
  return useAdminQuery<RouterEscalationResponse>(
    ['router-escalation', window],
    `/api/admin/router/escalation-triggers?window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/mcp-logs/histogram — latency bands for MCP calls
// ============================================================
export interface McpLatencyBucket {
  lo: number
  hi: number | null
  count: number
}
export interface McpLogsHistogramResponse {
  success: boolean
  buckets?: McpLatencyBucket[]
  source?: string
}

export function useMcpLogsHistogram(window: string = '24h') {
  return useAdminQuery<McpLogsHistogramResponse>(
    ['mcp-logs-histogram', window],
    `/api/admin/mcp-logs/histogram?window=${encodeURIComponent(window)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/mcp/servers/:id/healthcheck-history — per-server
// uptime/probe-history feed (used by MCPFleetV3 Overview pane).
// ============================================================
export interface McpHealthcheckEntry {
  timestamp: string
  status: 'success' | 'error' | string
  latencyMs?: number
  error?: string | null
}
export interface McpHealthcheckHistoryResponse {
  success: boolean
  history?: McpHealthcheckEntry[]
  count?: number
}

export function useMcpHealthcheckHistory(serverId: string | undefined, hours = 24) {
  const enabled = Boolean(serverId)
  return useAdminQuery<McpHealthcheckHistoryResponse>(
    ['mcp-healthcheck-history', String(serverId ?? ''), String(hours)],
    `/api/admin/mcp/servers/${encodeURIComponent(serverId ?? '')}/healthcheck-history?hours=${hours}`,
    { staleTime: 30_000, refetchInterval: 60_000, enabled },
  )
}

// ============================================================
// /api/admin/permissions?mcpServer=:name — IAM rows scoping
// access to a specific MCP server (used by MCPFleetV3 IAM tab).
// ============================================================
export interface McpPermissionRow {
  id: string
  principalType: 'user' | 'group' | string
  principalId: string
  principalName?: string
  scope?: string
  grantedAt?: string
}
export interface McpPermissionsResponse {
  success: boolean
  permissions?: McpPermissionRow[]
  count?: number
}

export function useMcpPermissions(mcpServer: string | undefined) {
  const enabled = Boolean(mcpServer)
  return useAdminQuery<McpPermissionsResponse>(
    ['mcp-permissions', String(mcpServer ?? '')],
    `/api/admin/permissions?mcpServer=${encodeURIComponent(mcpServer ?? '')}`,
    { staleTime: 30_000, refetchInterval: 60_000, enabled },
  )
}

// ============================================================
// /api/admin/prom/health — single-shot Prometheus reachability probe
// Used by Banner copy in Dashboard InfraPane to give operators a
// clearer error than "prom error".
// ============================================================
export interface PromHealthResponse {
  ok: boolean
  base?: string
  error?: string
  latencyMs?: number
}

export function usePromHealth() {
  return useAdminQuery<PromHealthResponse>(
    ['prom-health'],
    '/api/admin/prom/health',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// Agent Management — backs the AgentsHubPage (4 consolidated v2
// leaves: agent-registry, agent-ops, agent-skills, agent-executions).
// All hooks are read-only; mutation surface is stubbed in the page.
// Endpoints predate v3 and use snake_case envelopes from the API
// surface in admin-agents.ts + admin/agent-metrics.ts.
// ============================================================

// /api/admin/agents — registry list. Each row is a normalized v2
// AgentDefinition; we keep the field set permissive because the
// payload predates strict typing.
export interface AdminAgentRow {
  id: string
  name?: string
  display_name?: string
  description?: string
  agent_type?: string
  category?: string
  enabled?: boolean
  background?: Record<string, unknown> | null
  skills?: string[]
  tools_whitelist?: string[]
  tags?: string[]
  icon?: string
  color?: string
  created_at?: string
  created_by?: string
  model_config?: { primaryModel?: string; fallbackModel?: string; [k: string]: unknown }
  _count?: { executions?: number }
  prompt_strategy?: string
  prompt_modules?: string[]
}

export interface AdminAgentsListResponse {
  agents: AdminAgentRow[]
}

export function useAdminAgents() {
  return useAdminQuery<AdminAgentsListResponse>(
    ['admin-agents'],
    '/api/admin/agents',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// /api/admin/agents/metrics — aggregate roll-up.
export interface AdminAgentsMetrics {
  totalAgents: number
  totalExecutions: number
  totalSkills: number
}

export function useAdminAgentMetrics() {
  return useAdminQuery<AdminAgentsMetrics>(
    ['admin-agents-metrics'],
    '/api/admin/agents/metrics',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// /api/admin/agents/metrics/fleet — per-agent 24h health roll-up plus
// recent run feed used by AgentOpsView. The shape is { agents, runs }
// where each entry is already mapped to the AgentHealthMetrics /
// AgentRun structures via mapAgentToHealthMetrics in agentOpsApi.ts.
export interface FleetMetricsAgent {
  agentId: string
  agentName: string
  agentType: string
  runCount24h: number
  successRate: number
  p50DurationMs: number
  totalCostCents: number
}

export interface FleetMetricsRun {
  id: string
  agentId: string
  agentName: string
  status: 'success' | 'error' | 'running' | 'queued'
  durationMs: number
  costCents: number
  startedAt: string
  error?: string
}

export interface FleetMetricsResponse {
  agents?: FleetMetricsAgent[]
  runs?: FleetMetricsRun[]
}

export function useAdminAgentFleet() {
  return useAdminQuery<FleetMetricsResponse>(
    ['admin-agents-fleet'],
    '/api/admin/agents/metrics/fleet',
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
}

// /api/admin/agents/executions — global execution list. Returns the
// raw agentRunLog rows from prisma; the v2 page normalizes per-row.
// We expose the raw shape and let the pane massage as needed.
export interface AdminAgentExecutionRow {
  id: string
  loop_id?: string
  session_id?: string
  user_id?: string
  status: string
  model_used?: string | null
  fallback_used?: boolean
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  estimated_cost?: number | string | null
  duration_ms?: number | null
  error?: string | null
  started_at?: string
  completed_at?: string | null
  agent?: { agent_type?: string; name?: string }
}

export interface AdminAgentExecutionsResponse {
  executions: AdminAgentExecutionRow[]
}

export interface UseAgentExecutionsOptions {
  status?: string
  limit?: number
}

export function useAdminAgentExecutions(opts: UseAgentExecutionsOptions = {}) {
  const { status, limit = 50 } = opts
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  params.set('limit', String(limit))
  const qs = params.toString()
  return useAdminQuery<AdminAgentExecutionsResponse>(
    ['admin-agent-executions', status ?? 'all', String(limit)],
    `/api/admin/agents/executions?${qs}`,
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
}

// /api/admin/agents/executions/stats — aggregate metrics for the
// Ops + Executions tabs.
export interface AdminAgentExecutionStats {
  activeAgents: number
  totalToday: number
  totalWeek: number
  successRate: number
  failedToday: number
  costTodayCents: number
  tokensToday: number
  avgLatencyMs?: number
  promptTokensToday?: number
  completionTokensToday?: number
}

export function useAdminAgentExecutionStats() {
  return useAdminQuery<AdminAgentExecutionStats>(
    ['admin-agent-execution-stats'],
    '/api/admin/agents/executions/stats',
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
}

// /api/admin/agents/executions/live — currently running executions.
export interface AdminAgentLiveExecution {
  id: string
  agent_specs?: Array<{ agentId?: string; role?: string }>
  results?: Array<{ agentId?: string; role?: string }>
  status: string
  orchestration?: string
  total_cost_cents?: number | string | null
  tool_calls_count?: number | null
  user_id?: string | null
  created_at?: string
  startedAt?: string
}

export interface AdminAgentLiveExecutionsResponse {
  executions: AdminAgentLiveExecution[]
}

export function useAdminAgentLiveExecutions() {
  return useAdminQuery<AdminAgentLiveExecutionsResponse>(
    ['admin-agent-live-executions'],
    '/api/admin/agents/executions/live',
    { staleTime: 5_000, refetchInterval: 5_000 },
  )
}

// /api/admin/agents/skills — registered agent skills (composable
// prompt modules / tool bundles / workflows / templates).
export interface AdminAgentSkillRow {
  id: string
  name: string
  display_name?: string
  description?: string | null
  type?: string
  source?: string
  source_url?: string | null
  visibility?: string
  tags?: string[]
  usage_count?: number
  created_at?: string
}

export interface AdminAgentSkillsResponse {
  skills: AdminAgentSkillRow[]
}

export function useAdminAgentSkills() {
  return useAdminQuery<AdminAgentSkillsResponse>(
    ['admin-agent-skills'],
    '/api/admin/agents/skills',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// LLM Extras hub — Ollama hosts, Tiered FC, Performance metrics
// (re-added 2026-05-06 after concurrent-agent merge dropped them)
// ============================================================

export interface OllamaHostRow {
  id?: string
  name?: string
  displayName?: string
  endpoint?: string
  host?: string
  enabled?: boolean
  status?: string
  modelCount?: number
  runningCount?: number
  chatModel?: string
  priority?: number
  lastSync?: string
  error?: string | null
}

export interface OllamaHostsResponse {
  hosts: OllamaHostRow[]
}

export function useOllamaHosts() {
  return useAdminQuery<OllamaHostsResponse>(
    ['ollama-hosts'],
    '/api/admin/ollama/hosts',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// Phase W (2026-05-19): TieredFcTier, TieredFcResponse, useTieredFcConfig()
// removed — TFC replaced by SmartModelRouter FCA scoring (task #622).
// The config those hooks surfaced had zero effect on live routing.

// Permissive — backing endpoint returns a wide kpi grab-bag
// (avgResponseTime, avgTTFT, p95TTFT, errorRateByModel, modelLatencyByModel,
// avgTokensPerSecond, totalTokens, etc.). Permissive shape so consumers
// can type-narrow at the access point.
export type LlmPerformanceKpis = any

export interface LlmPerformanceSummary {
  kpis?: LlmPerformanceKpis
  perModel?: any
  [k: string]: any
}

export function useLlmPerformance(hours: number | string = 24) {
  const w = String(hours)
  // /api/admin/metrics/llm/performance returns { success, timeRange, kpis }
  // which is exactly what PerformancePane reads via .kpis.* — the older
  // /api/admin/llm-providers/metrics route returns ProviderManager metrics
  // (no kpis at all) so the pane was empty even when data existed.
  return useAdminQuery<LlmPerformanceSummary>(
    ['llm-performance', w],
    `/api/admin/metrics/llm/performance?hours=${encodeURIComponent(w)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

export interface LlmPerformanceTrendPoint {
  timestamp?: number | string
  bucket?: string
  avgTotalLatency?: number
  p50TotalLatency?: number
  p95TotalLatency?: number
  p99TotalLatency?: number
  avgTTFT?: number
  p50TTFT?: number
  p95TTFT?: number
  p99TTFT?: number
  requestCount?: number
  errorCount?: number
  [k: string]: unknown
}

export interface LlmPerformanceTrendsResponse {
  trends?: LlmPerformanceTrendPoint[]
  timeRange?: any
  bucketMinutes?: number
  [k: string]: any
}

export function useLlmPerformanceTrends(hours: number | string = 24) {
  const w = String(hours)
  // The bucketed series PerformancePane consumes lives at
  // /api/admin/metrics/llm/performance-trends — the /trends endpoint
  // returns a different shape (model breakdown, not TTFT/latency buckets).
  return useAdminQuery<LlmPerformanceTrendsResponse>(
    ['llm-performance-trends', w],
    `/api/admin/metrics/llm/performance-trends?hours=${encodeURIComponent(w)}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// v4 admin console — additional read-only query hooks consumed by the
// ported console pages (Tools/MCP, Code, Synthesis, Home, Flows, Obs).
// Each is a thin useAdminQuery wrapper over a real /api/admin route; the
// page renders an honest empty/error state when a route resolves to 404
// or undefined, so nothing is ever fabricated.
// ============================================================

/** MCP FLEET health — derives up/total from the per-server fleet array. */
export interface McpFleetHealth {
  totalServers?: number
  healthyServers?: number
  toolsIndexed?: number
  degraded?: number
  down?: number
}

export function useMcpFleetHealth() {
  return useAdminQuery<McpServersResponse, McpFleetHealth>(
    ['mcp-fleet-health'],
    '/api/admin/mcp/servers',
    {
      staleTime: 30_000,
      refetchInterval: 30_000,
      select: (raw): McpFleetHealth => {
        const servers: McpServerRow[] = Array.isArray(raw)
          ? raw
          : (raw?.servers ?? [])
        const total = servers.length
        const statusOf = (s: McpServerRow): string =>
          (s.status ?? s.health ?? 'unknown').toString().toLowerCase()
        const healthy = servers.filter((s) => ['healthy', 'connected', 'running'].includes(statusOf(s))).length
        const degraded = servers.filter((s) => statusOf(s) === 'degraded').length
        const down = servers.filter((s) => ['down', 'failed', 'error'].includes(statusOf(s))).length
        const toolsIndexed = servers.reduce((a, s) => a + (s.toolCount ?? 0), 0)
        return { totalServers: total, healthyServers: healthy, degraded, down, toolsIndexed }
      },
    },
  )
}

// --- Code Mode admin endpoints (permissive shapes; 404 → empty state) ---
export interface CodeModeFeatureSettings {
  defaultSecurityLevel?: 'strict' | 'permissive' | 'minimal'
  defaultNetworkEnabled?: boolean
  networkDomainAllowlist?: string[]
  filesystemReadPaths?: string[]
  filesystemWritePaths?: string[]
  maxSessionsPerUser?: number
  sessionIdleTimeout?: number
  sessionMaxLifetime?: number
  storageQuotaEnabled?: boolean
  defaultStorageLimitMb?: number
  defaultCpuLimit?: number
  defaultMemoryLimitMb?: number
  enabledForNewUsers?: boolean
  ghostpilotEnabled?: boolean
  [key: string]: unknown
}
export interface CodeFeatureSettingsResponse {
  settings?: CodeModeFeatureSettings
}

export function useCodeModeSettings() {
  return useAdminQuery<CodeFeatureSettingsResponse>(
    ['code-mode-settings'],
    '/api/admin/code/settings',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

export interface CodeModeGlobalSettings {
  lockdown?: boolean
  internet?: boolean
  [key: string]: unknown
}
export interface CodeModeGlobalSettingsResponse {
  settings?: CodeModeGlobalSettings
}

export function useCodeModeGlobalSettings() {
  return useAdminQuery<CodeModeGlobalSettingsResponse>(
    ['code-mode-global-settings'],
    '/api/admin/codemode/global-settings',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// --- Synthesis admin endpoints ---
export interface SynthConfig {
  enabled?: boolean
  visibleToLLM?: boolean
  provider?: string
  model?: string
  baseUrl?: string
  synthesisTemperature?: number
  maxSynthesisTokens?: number
  timeoutSeconds?: number
  executorUrl?: string
  maxMemoryMb?: number
  maxConcurrentExecutions?: number
  maxDailySynthesesPerUser?: number
  defaultUserDailyBudgetUsd?: number
  defaultGroupDailyBudgetUsd?: number
  autoApproveLowRisk?: boolean
  autoApproveMediumRisk?: boolean
  approvalTimeoutSeconds?: number
  approvalTimeoutAction?: 'reject' | 'approve' | string
  allowedCapabilities?: string[]
  blockedCapabilities?: string[]
  adminOnlyCapabilities?: string[]
  useSemanticToolSearch?: boolean
  semanticSearchTopK?: number
  authMode?: string
  credentialSource?: string
  sessionBasedOAuth?: boolean
}
export interface SynthConfigResponse {
  config?: SynthConfig
}

export function useSynthConfig() {
  return useAdminQuery<SynthConfigResponse>(
    ['synth', 'config'],
    '/api/admin/synth/config',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

export interface SynthApprovalRow {
  id: string
  toolId: string
  userId: string
  userEmail?: string
  userName?: string
  intent: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | string
  code: string
  status?: string
  expiresAt?: string
  createdAt: string
}
export interface SynthApprovalsResponse {
  approvals?: SynthApprovalRow[]
}

export function useSynthApprovals() {
  return useAdminQuery<SynthApprovalsResponse>(
    ['synth', 'approvals'],
    '/api/admin/synth/approvals',
    { staleTime: 10_000, refetchInterval: 15_000 },
  )
}

export interface SynthStatsRow {
  totalSyntheses: number
  successfulSyntheses: number
  failedSyntheses: number
  totalCostUsd: number
  avgExecutionMs: number
  riskBreakdown?: Record<string, number>
  topCapabilities?: Array<{ name: string; count: number }>
  dailyUsage?: Array<{ date: string; count: number; cost: number }>
}
export interface SynthStatsResponse {
  stats?: SynthStatsRow
}

export function useSynthStats(days = 7) {
  return useAdminQuery<SynthStatsResponse>(
    ['synth', 'stats', String(days)],
    `/api/admin/synth/stats?days=${days}`,
    { staleTime: 60_000, refetchInterval: 60_000 },
  )
}

export interface SynthHistoryRow {
  toolId: string
  userId: string
  userEmail?: string
  intent: string
  success: boolean
  riskLevel: string
  executionTimeMs: number
  costUsd: number
  createdAt: string
}
export interface SynthHistoryResponse {
  history?: SynthHistoryRow[]
}

export function useSynthHistory(limit = 50) {
  return useAdminQuery<SynthHistoryResponse>(
    ['synth', 'history', String(limit)],
    `/api/admin/synth/history?limit=${limit}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// --- /api/admin/recommendations — operator-advisory engine (home panel) ---
export type RecommendationSeverity = 'info' | 'warn' | 'err' | 'ok'

export interface RecommendationAction {
  label: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  endpoint: string
  payload?: Record<string, unknown>
}

export interface RecommendationCard {
  id: string
  type: string
  severity: RecommendationSeverity
  title: string
  detail?: string
  evidence?: string
  leaf?: string
  action?: RecommendationAction
}

export interface RecommendationsResponse {
  success: boolean
  recommendations?: RecommendationCard[]
  count?: number
}

export function useRecommendations() {
  return useAdminQuery<RecommendationsResponse>(
    ['recommendations'],
    '/api/admin/recommendations',
    { staleTime: 60_000, refetchInterval: 120_000 },
  )
}

// --- /api/admin/compliance/findings — control-findings summary (home KPI) ---
export interface ComplianceFinding {
  id: string
  controlId: string
  status: 'open' | 'pass' | 'warn' | string
  severity: 'low' | 'medium' | 'high' | 'critical' | string
  title: string
  detail: string
  evidence?: unknown
  lastEvaluatedAt?: string
}

export interface ComplianceFindingsSummary {
  total: number
  open: number
  pass: number
  warn: number
  byStatus?: Record<string, number>
  bySeverity?: Record<string, number>
}

export interface ComplianceFindingsResponse {
  findings?: ComplianceFinding[]
  summary?: ComplianceFindingsSummary
}

export function useComplianceFindings() {
  return useAdminQuery<ComplianceFindingsResponse>(
    ['compliance-findings'],
    '/api/admin/compliance/findings',
    { staleTime: 60_000, refetchInterval: 120_000 },
  )
}

// --- /api/admin/flows/kpis?window= — fleet-wide flow KPIs (home "Active Flows") ---
export interface FlowsKpisResponse {
  total_executions: number
  success_rate: number
  failed_count: number
  latency_p50: number
  latency_p95: number
  latency_p99: number
  total_cost_usd: number
  avg_cost_per_execution_usd: number
  top_failing_nodes?: Array<{ node_id: string; fail_count: number }>
  top_expensive_flows?: Array<{ workflow_id: string; total_cost_usd: number }>
}

export function useFlowsKpisHome(window: '24h' | '7d' | '30d' = '24h') {
  return useAdminQuery<FlowsKpisResponse>(
    ['flows-kpis-home', window],
    `/api/admin/flows/kpis?window=${window}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}
