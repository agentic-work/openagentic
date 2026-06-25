import { useAdminQuery } from './useAdminQuery'
import type { FlowsKpiData, KpiWindow } from '../services/flowsAdminApi'

// ============================================================
// /api/admin/workflows — list shape
// ============================================================
export interface AdminWorkflowRow {
  id: string
  name: string
  description?: string
  user_id?: string
  user?: { id: string; email: string; name: string } | null
  nodeCount?: number
  visibility?: 'private' | 'team' | 'public' | string
  status?: string
  totalExecutions?: number
  successfulExecutions?: number
  failedExecutions?: number
  created_at?: string
  updated_at?: string
  is_active?: boolean
  is_public?: boolean
}

export interface AdminWorkflowsListResponse {
  workflows: AdminWorkflowRow[]
  total: number
  limit?: number
  offset?: number
}

export interface UseWorkflowsOptions {
  search?: string
  visibility?: 'all' | 'private' | 'team' | 'public'
  limit?: number
}

export function useAdminWorkflows(opts: UseWorkflowsOptions = {}) {
  const { search = '', visibility = 'all', limit = 50 } = opts
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (visibility && visibility !== 'all') params.set('visibility', visibility)
  params.set('limit', String(limit))
  const qs = params.toString()
  return useAdminQuery<AdminWorkflowsListResponse>(
    ['admin-workflows', search, visibility, String(limit)],
    `/api/admin/workflows?${qs}`,
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

// ============================================================
// /api/admin/workflows/stats
// ============================================================
export interface AdminWorkflowStats {
  totalWorkflows: number
  activeWorkflows: number
  publicWorkflows: number
  totalExecutions: number
  runningExecutions: number
  failedExecutions: number
}

export function useAdminWorkflowStats() {
  return useAdminQuery<AdminWorkflowStats>(
    ['admin-workflow-stats'],
    '/api/admin/workflows/stats',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

// ============================================================
// /api/admin/workflows/executions — global execution feed
// ============================================================
export interface AdminWorkflowExecution {
  id: string
  workflowId: string
  workflowName: string
  user: { id: string; email: string; name: string } | null
  status: string
  triggerType: string
  totalNodes: number
  completedNodes: number
  executionTimeMs: number | null
  cost: number | null
  startedAt: string
  completedAt: string | null
  error: string | null
}

export interface AdminWorkflowExecutionsResponse {
  executions: AdminWorkflowExecution[]
  total: number
  limit?: number
  offset?: number
}

export interface UseExecutionsOptions {
  status?: string
  user_id?: string
  limit?: number
}

export function useAdminWorkflowExecutions(opts: UseExecutionsOptions = {}) {
  const { status, user_id, limit = 50 } = opts
  const params = new URLSearchParams()
  if (status && status !== 'all') params.set('status', status)
  if (user_id) params.set('user_id', user_id)
  params.set('limit', String(limit))
  const qs = params.toString()
  return useAdminQuery<AdminWorkflowExecutionsResponse>(
    ['admin-workflow-executions', status ?? 'all', user_id ?? '', String(limit)],
    `/api/admin/workflows/executions?${qs}`,
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
}

// ============================================================
// /api/admin/workflows/:id/executions (per-workflow drill)
// Falls back to the global executions endpoint with a workflowId
// filter when this nested route is missing on older API builds.
// ============================================================
export function useAdminWorkflowRuns(workflowId: string | undefined, limit = 50) {
  return useAdminQuery<AdminWorkflowExecutionsResponse>(
    ['admin-workflow-runs', workflowId ?? '', String(limit)],
    workflowId
      ? `/api/admin/workflows/${encodeURIComponent(workflowId)}/executions?limit=${limit}`
      : '',
    { staleTime: 15_000, enabled: Boolean(workflowId) },
  )
}

// ============================================================
// /api/admin/workflows/cost?period=30d&groupBy=workflow
// ============================================================
export interface ModelCostRow {
  model: string
  tokens: number
  cost: number
  calls: number
}
export interface CostGroupRow {
  key: string
  label: string
  totalCost: number
  totalExecutions: number
  totalTokens: number
  avgCostPerExecution: number
  models: ModelCostRow[]
}
export interface FlowCostResponse {
  success: boolean
  period: string
  groupBy: string
  summary: {
    totalCost: number
    totalExecutions: number
    totalTokens: number
    avgCostPerExecution: number
  }
  results: CostGroupRow[]
}

export function useFlowCost(period: '7d' | '30d' | '90d' = '30d', groupBy: 'workflow' | 'user' = 'workflow') {
  return useAdminQuery<FlowCostResponse>(
    ['flow-cost', period, groupBy],
    `/api/admin/workflows/cost?period=${period}&groupBy=${groupBy}`,
    { staleTime: 60_000, refetchInterval: 120_000 },
  )
}

// ============================================================
// /api/admin/flows/kpis?window=24h — KPI / failures / expensive
// ============================================================
export function useFlowsKpis(window: KpiWindow = '24h') {
  return useAdminQuery<FlowsKpiData>(
    ['flows-kpis', window],
    `/api/admin/flows/kpis?window=${window}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// /api/admin/flows/audit-logs — workflow-scoped audit slice
// Falls back to the generic /api/admin/audit-logs?resourceType=Workflow
// if the dedicated endpoint is unavailable on older API builds.
// ============================================================
export interface FlowAuditLogEntry {
  id: string
  timestamp: string
  actor?: string
  action?: string
  target_type?: string
  target_id?: string
  outcome?: 'success' | 'denied' | 'error' | string
  metadata?: Record<string, unknown>
}

export interface FlowAuditLogsResponse {
  logs?: FlowAuditLogEntry[]
  total?: number
  limit?: number
  offset?: number
}

export function useFlowAuditLogs(limit = 50) {
  return useAdminQuery<FlowAuditLogsResponse>(
    ['flow-audit-logs', String(limit)],
    `/api/admin/flows/audit-logs?limit=${limit}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}
