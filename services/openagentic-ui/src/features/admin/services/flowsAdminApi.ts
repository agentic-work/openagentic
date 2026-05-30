/**
 * flowsAdminApi — fetch helpers for KPI + audit-log endpoints.
 *
 * Endpoints (backed by commit family ~b0820fc4):
 *   GET /api/admin/flows/kpis?window=...
 *   GET /api/admin/flows/:id/kpis?window=...
 *   GET /api/admin/flows/audit-logs?action=...&actor=...&from=...&to=...&limit=N
 *   GET /api/admin/flows/audit-logs.csv?...
 */

import { apiRequest } from '@/utils/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KpiWindow = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';

export interface FailingNode {
  nodeId: string;
  nodeType: string;
  failureCount: number;
}

export interface ExpensiveFlow {
  flowId: string;
  flowName: string;
  totalCostUsd: number;
}

export interface FlowsKpiData {
  window: KpiWindow;
  total_executions: number;
  success_rate: number;          // 0-100 percent
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  total_cost_usd: number;
  avg_cost_per_execution_usd: number;
  top_failing_nodes: FailingNode[];
  top_expensive_flows: ExpensiveFlow[];
  // Optional time-series arrays for charts
  executions_over_time?: number[];
  cost_over_time?: number[];
  time_labels?: string[];
  // Delta vs previous window (percentage change, may be absent if no prev data)
  delta?: {
    total_executions?: number;
    success_rate?: number;
    avg_cost_per_execution_usd?: number;
    latency_p95_ms?: number;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  outcome: 'success' | 'denied' | 'error';
  metadata: Record<string, unknown>;
}

export interface AuditLogsResponse {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditLogFilters {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  outcome?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetch aggregate KPIs for all flows.
 */
export async function fetchKpis(window: KpiWindow = '24h'): Promise<FlowsKpiData> {
  const res = await apiRequest(`/admin/flows/kpis${buildQuery({ window })}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fetchKpis failed: ${res.status}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
}

/**
 * Fetch per-flow KPI drill-down.
 */
export async function fetchFlowKpi(flowId: string, window: KpiWindow = '24h'): Promise<FlowsKpiData> {
  if (!flowId) throw new Error('fetchFlowKpi: flowId is required');
  const res = await apiRequest(`/admin/flows/${encodeURIComponent(flowId)}/kpis${buildQuery({ window })}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fetchFlowKpi failed: ${res.status}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
}

/**
 * Fetch paginated, filtered audit log entries.
 */
export async function fetchAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogsResponse> {
  const query = buildQuery({
    action: filters.action,
    actor: filters.actor,
    from: filters.from,
    to: filters.to,
    outcome: filters.outcome,
    limit: filters.limit ?? 50,
    offset: filters.offset ?? 0,
  });
  const res = await apiRequest(`/admin/flows/audit-logs${query}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fetchAuditLogs failed: ${res.status}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
}

/**
 * Trigger CSV export download. Opens the URL so the browser handles the file.
 * Returns the URL that was opened (useful for testing).
 */
export function exportAuditCsv(filters: Omit<AuditLogFilters, 'limit' | 'offset'> = {}): string {
  const query = buildQuery({
    action: filters.action,
    actor: filters.actor,
    from: filters.from,
    to: filters.to,
    outcome: filters.outcome,
  });
  const url = `/api/admin/flows/audit-logs.csv${query}`;
  // Trigger download: create a temporary <a> and click it so the browser
  // respects Content-Disposition without leaving the page.
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return url;
}
