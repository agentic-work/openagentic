import type { Status } from '../../primitives-v3'

export type WorkflowsTabId =
  | 'workflows'
  | 'executions'
  | 'costs'
  | 'failures'
  | 'audit'

export type ExecStatusFilter =
  | 'all'
  | 'completed'
  | 'completed_with_errors'
  | 'running'
  | 'failed'
  | 'pending'

export type WorkflowStatusFilter = 'all' | 'active' | 'disabled'

export const TAB_ITEMS: { id: WorkflowsTabId; label: string }[] = [
  { id: 'workflows',  label: 'workflows' },
  { id: 'executions', label: 'executions' },
  { id: 'costs',      label: 'costs' },
  { id: 'failures',   label: 'failures' },
  { id: 'audit',      label: 'audit' },
]

// ============================================================
// Status normalization — keeps the StatusDot vocabulary
// consistent with the rest of v3 (ok/warn/err/idle).
// ============================================================
export function execStatusDot(status?: string | null): Status {
  const s = String(status ?? '').toLowerCase()
  if (s === 'completed') return 'ok'
  if (s === 'completed_with_errors') return 'warn'
  if (s === 'running') return 'info'
  if (s === 'failed' || s === 'error' || s === 'errored') return 'err'
  return 'idle'
}

export function workflowStatusDot(active?: boolean | null, status?: string | null): Status {
  if (active === false) return 'idle'
  const s = String(status ?? '').toLowerCase()
  if (s === 'disabled' || s === 'paused') return 'idle'
  if (s === 'error' || s === 'failed') return 'err'
  return 'ok'
}

// ============================================================
// Formatting helpers
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
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
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

export function fmtTokens(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ============================================================
// Success-rate calculation for a workflow row.
// successfulExecutions / totalExecutions; null when totals are 0
// so the UI can render an em-dash instead of a misleading 0%.
// ============================================================
export function successRate(succ?: number, total?: number): number | null {
  const t = total ?? 0
  if (t <= 0) return null
  const s = succ ?? 0
  return (s / t) * 100
}
