import type { Status } from '../../primitives-v3'

export type AgentsTabId =
  | 'registry'
  | 'ops'
  | 'skills'
  | 'executions'

export type AgentExecStatusFilter =
  | 'all'
  | 'completed'
  | 'running'
  | 'failed'
  | 'pending'
  | 'cancelled'

export type AgentRegistryFilter = 'all' | 'platform' | 'background' | 'enabled' | 'disabled'

export const TAB_ITEMS: { id: AgentsTabId; label: string }[] = [
  { id: 'registry',   label: 'registry' },
  { id: 'ops',        label: 'ops' },
  { id: 'skills',     label: 'skills' },
  { id: 'executions', label: 'executions' },
]

// ============================================================
// Status normalization — keeps StatusDot vocabulary aligned
// with the rest of v3 (ok/warn/err/info/idle).
// ============================================================
export function execStatusDot(status?: string | null): Status {
  const s = String(status ?? '').toLowerCase()
  if (s === 'completed' || s === 'success') return 'ok'
  if (s === 'running') return 'info'
  if (s === 'failed' || s === 'error' || s === 'errored') return 'err'
  if (s === 'killed' || s === 'cancelled') return 'warn'
  return 'idle'
}

export function agentEnabledDot(enabled?: boolean | null): Status {
  if (enabled === false) return 'idle'
  return 'ok'
}

// ============================================================
// Formatting helpers — duplicated rather than imported from the
// Workflows pane so each tab folder is self-contained and can
// evolve independently when the API shape diverges.
// ============================================================
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

export function fmtClock(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}

export function fmtDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

// Cost values land in two flavors across the agent endpoints:
//   - executions live/list: total_cost_cents (cents)
//   - aggregate (dashboard): agentTotalCost (whole dollars)
// fmtUsdFromCents normalizes the cents path; fmtUsd handles dollars.
export function fmtUsdFromCents(cents?: number | string | null): string {
  if (cents == null) return '—'
  const n = typeof cents === 'string' ? Number.parseFloat(cents) : cents
  if (!Number.isFinite(n)) return '—'
  const d = n / 100
  if (d === 0) return '$0.00'
  if (d < 0.01) return '<$0.01'
  if (d < 100) return `$${d.toFixed(2)}`
  return `$${Math.round(d).toLocaleString()}`
}

export function fmtUsd(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  if (n < 1) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${Math.round(n).toLocaleString()}`
}

export function fmtTokens(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

// ============================================================
// Side-panel detail tabs
// ============================================================
export type AgentDetailTab = 'overview' | 'skills' | 'runs' | 'cost' | 'audit'

export const DETAIL_TABS: { id: AgentDetailTab; label: string }[] = [
  { id: 'overview', label: 'overview' },
  { id: 'skills',   label: 'skills' },
  { id: 'runs',     label: 'runs' },
  { id: 'cost',     label: 'cost' },
  { id: 'audit',    label: 'audit' },
]
