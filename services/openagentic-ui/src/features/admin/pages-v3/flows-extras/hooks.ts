import { useAdminQuery } from '../../hooks/useAdminQuery'
import {
  type WorkflowSecretsResponse,
  type WorkflowSettings,
  type TeamsResponse,
} from './types'
import type { FlowsKpiData } from '../../services/flowsAdminApi'

// ============================================================
// Credentials — /api/admin/workflow-secrets
// ============================================================
export function useWorkflowSecrets() {
  return useAdminQuery<WorkflowSecretsResponse>(
    ['workflow-secrets'],
    '/api/admin/workflow-secrets',
    { staleTime: 60_000 },
  )
}

// ============================================================
// Governance — /api/admin/workflow-settings
// ============================================================
export function useWorkflowGovernance() {
  return useAdminQuery<WorkflowSettings>(
    ['workflow-settings'],
    '/api/admin/workflow-settings',
    { staleTime: 60_000 },
  )
}

// ============================================================
// KPI Dashboard — /api/admin/flows/kpis?window=...
// ============================================================
export type KpiWindow = '1h' | '6h' | '24h' | '7d' | '30d' | '90d'

export function useFlowsKpiDashboard(window: KpiWindow = '24h') {
  return useAdminQuery<FlowsKpiData>(
    ['flows-kpis', window],
    `/api/admin/flows/kpis?window=${window}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// Teams — /api/admin/teams
// ============================================================
export function useTeamsList() {
  return useAdminQuery<TeamsResponse>(
    ['teams'],
    '/api/admin/teams',
    { staleTime: 60_000 },
  )
}
