import type { Status } from '../../primitives-v3'

// ============================================================
// Tab vocabulary
// ============================================================
export type FlowsExtrasTab = 'credentials' | 'governance' | 'kpis' | 'teams'

export const TAB_ORDER: FlowsExtrasTab[] = ['credentials', 'governance', 'kpis', 'teams']

export const TABS: { id: FlowsExtrasTab; label: string }[] = [
  { id: 'credentials', label: 'credentials' },
  { id: 'governance',  label: 'governance' },
  { id: 'kpis',        label: 'kpi dashboard' },
  { id: 'teams',       label: 'teams' },
]

/** Map a leaf id (or partial slug) to the corresponding hub tab. */
export function leafToTab(s: string | undefined): FlowsExtrasTab {
  if (!s) return 'credentials'
  if (s === 'credentials' || s === 'native-workflow-credentials') return 'credentials'
  if (s === 'governance' || s === 'native-workflow-settings') return 'governance'
  if (s === 'kpi-dashboard' || s === 'flows-kpis' || s === 'kpis') return 'kpis'
  if (s === 'teams') return 'teams'
  return 'credentials'
}

// ============================================================
// /api/admin/workflow-secrets — credentials list shape
// ============================================================
export interface WorkflowSecretRow {
  id: string
  name: string
  description: string | null
  scope: 'global' | 'group' | 'workflow'
  workflow_id: string | null
  group_id: string | null
  allowed_node_types: string[]
  access_count: number
  last_accessed_at: string | null
  last_rotated_at: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface WorkflowSecretsResponse {
  secrets?: WorkflowSecretRow[]
}

// ============================================================
// /api/admin/workflow-settings — governance shape
//
// The endpoint returns a partial — every field is optional and the v2
// view layers DEFAULT_SETTINGS on top to render. We keep the wire shape
// loose (Record) so the v3 pane can render whatever the api hands us
// without lying about defaults the operator never set.
// ============================================================
export type WorkflowSettings = Record<string, unknown>

// ============================================================
// /api/admin/teams — teams list shape (mirrors teamsAdminApi)
// ============================================================
export interface TeamRow {
  id: string
  name: string
  display_name: string
  description: string | null
  parent_group_id: string | null
  cost_center: string | null
  billing_contact_email: string | null
  metadata: Record<string, unknown>
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  member_count: number
  shared_flows_count: number
}

export interface TeamsResponse {
  teams?: TeamRow[]
}

// ============================================================
// Status mapping helpers
// ============================================================
export function scopeStatusDot(scope?: string): Status {
  const s = String(scope ?? '').toLowerCase()
  if (s === 'global') return 'info'
  if (s === 'workflow') return 'ok'
  if (s === 'group') return 'warn'
  return 'idle'
}

export function teamStatusDot(active?: boolean | null): Status {
  return active === false ? 'idle' : 'ok'
}

// ============================================================
// Formatting helpers
// ============================================================
export function fmtNum(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function fmtUsd(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  if (n < 1) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${Math.round(n).toLocaleString()}`
}

export function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const dt = (Date.now() - t) / 1000
  if (dt < 0) return 'in the future'
  if (dt < 60) return `${Math.max(0, Math.floor(dt))}s ago`
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`
  return `${Math.floor(dt / 86400)}d ago`
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
