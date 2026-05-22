import { useAdminQuery } from '../../hooks/useAdminQuery'

// ============================================================
// CostBudget — /api/admin/chargeback/budgets
// ============================================================
export interface CostBudgetRow {
  id: string
  userId?: string
  groupId?: string
  budgetType: 'daily' | 'weekly' | 'monthly' | 'annual'
  limitCents: number
  alertThresholds: number[]
  actionOnLimit: 'warn' | 'throttle' | 'block'
  throttleToModel?: string
  currentSpendCents: number
  usagePercent: number
  notifications?: { email: boolean; slack: boolean }
  userName?: string
  userEmail?: string
  groupName?: string
}

// Server returns either a bare array or { budgets: [...] }, depending on
// caller. We normalize at the hook boundary.
export function useChargebackBudgets() {
  return useAdminQuery<CostBudgetRow[] | { budgets?: CostBudgetRow[] }>(
    ['chargeback', 'budgets'],
    '/api/admin/chargeback/budgets',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// ChargebackReport — /api/admin/chargeback/reports
// ============================================================
export type ReportStatus = 'draft' | 'finalized' | 'exported' | 'paid'

export interface ChargebackReportRow {
  id: string
  period: string
  userId?: string
  groupId?: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCachedTokens: number
  totalThinkingTokens: number
  totalLlmCost: number
  totalMcpCost: number
  totalComputeCost: number
  totalStorageCost: number
  totalCost: number
  costByProvider?: Record<string, number>
  costByModel?: Record<string, number>
  requestCount: number
  status: ReportStatus
  userName?: string
  userEmail?: string
  groupName?: string
  createdAt?: string
}

export function useChargebackReports() {
  return useAdminQuery<ChargebackReportRow[] | { reports?: ChargebackReportRow[] }>(
    ['chargeback', 'reports'],
    '/api/admin/chargeback/reports',
    { staleTime: 30_000, refetchInterval: 120_000 },
  )
}

// ============================================================
// ChargebackGroup — /api/admin/chargeback/groups
// ============================================================
export interface ChargebackGroupRow {
  id: string
  name: string
  costCenter?: string
  userCount: number
  totalTokens: number
  totalCost: number
  budgetLimitCents?: number
  budgetUsagePercent?: number
  members?: Array<{
    userId: string
    email: string
    name: string
    cost: number
    tokens: number
  }>
}

export function useChargebackGroups() {
  return useAdminQuery<ChargebackGroupRow[] | { groups?: ChargebackGroupRow[] }>(
    ['chargeback', 'groups'],
    '/api/admin/chargeback/groups',
    { staleTime: 30_000, refetchInterval: 120_000 },
  )
}

// ============================================================
// UsageSummary — /api/admin/chargeback/usage
// ============================================================
export interface UsageByUserRow {
  userId: string
  email: string
  name: string
  cost: number
  tokens: number
  requests: number
}

export interface UsageByGroupRow {
  groupId: string
  name: string
  cost: number
  tokens: number
}

export interface UsageSummary {
  totalCost: number
  totalTokens: number
  totalRequests: number
  byUser?: UsageByUserRow[]
  byGroup?: UsageByGroupRow[]
  byProvider?: Record<string, number>
  byModel?: Record<string, number>
}

export function useChargebackUsage() {
  return useAdminQuery<UsageSummary>(
    ['chargeback', 'usage'],
    '/api/admin/chargeback/usage',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// DashboardMetrics — 30d window (for Overview chart + KPI fallbacks)
// ============================================================
export interface CostByModelTimeSeries {
  model: string
  data: Array<{ timestamp: string | number; value: number }>
}

export interface DashboardMetricsCostShape {
  summary?: {
    totalCost?: number
    totalTokens?: number
    totalMessages?: number
    totalUsers?: number
    activeUsers?: number
  }
  perUserUsage?: Array<{
    userId: string
    email: string
    displayName?: string
    name?: string
    cost: number
    tokens: number
  }>
  costByModel?: CostByModelTimeSeries[]
  modelUsage?: Array<{ model: string; count: number; tokens: number; cost: number }>
  timeSeries?: {
    tokenUsage?: Array<{ timestamp: string | number; value: number }>
  }
}

export function useChargebackDashboard(timeRange: string = '30d') {
  return useAdminQuery<DashboardMetricsCostShape>(
    ['chargeback', 'dashboard', timeRange],
    `/api/admin/dashboard/metrics?timeRange=${encodeURIComponent(timeRange)}`,
    { staleTime: 60_000, refetchInterval: 120_000 },
  )
}

// ============================================================
// Format helpers
// ============================================================
export function fmtUsd(amount: number | undefined | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
  if (amount === 0) return '$0.00'
  if (Math.abs(amount) < 1) return `$${amount.toFixed(4)}`
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}

export function fmtCents(cents: number | undefined | null): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '—'
  return fmtUsd(cents / 100)
}

export function fmtNum(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

export function fmtPct(p: number | undefined | null): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return '—'
  return `${p.toFixed(1)}%`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return iso
  }
}

// Normalize "array OR { budgets: [] }" envelopes from the chargeback routes.
export function unwrapArray<T>(
  data: T[] | { budgets?: T[]; reports?: T[]; groups?: T[] } | undefined,
  key: 'budgets' | 'reports' | 'groups',
): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  return ((data as Record<string, T[] | undefined>)[key] ?? []) as T[]
}

export function budgetTone(pct: number | undefined): 'ok' | 'warn' | 'err' | 'default' {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'default'
  if (pct >= 90) return 'err'
  if (pct >= 75) return 'warn'
  return 'ok'
}
