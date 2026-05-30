import type {
  LlmProviderRow,
  ProviderHealthEntry,
} from '../../hooks/useDashboardMetrics'

export type StatusFilter = 'all' | 'healthy' | 'degraded' | 'disabled'
export type ProviderStatus = 'healthy' | 'degraded' | 'disabled' | 'unknown'

export interface ProviderRow {
  id: string
  name: string
  displayName: string
  type: string
  region: string
  tier: string
  enabled: boolean
  status: ProviderStatus
  modelCount: number
  lastChecked?: string
  endpoint?: string
  error?: string
  raw: LlmProviderRow
  health?: ProviderHealthEntry
}

export const fmtUsd = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'
export const fmtNum = (n?: number): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
export const fmtRel = (iso?: string): string => {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
export const formatHourLabel = (ts: number): string =>
  Number.isFinite(ts)
    ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : ''

export const statusTone = (s: ProviderStatus): 'ok' | 'warn' | 'err' | 'idle' =>
  s === 'healthy' ? 'ok' : s === 'degraded' ? 'warn' : s === 'disabled' ? 'idle' : 'warn'

export const statusColor = (s: ProviderStatus): string =>
  s === 'healthy' ? 'var(--ok)' : s === 'degraded' ? 'var(--warn)' : 'var(--fg-3)'

function deriveStatus(
  p: LlmProviderRow,
  h?: ProviderHealthEntry,
): ProviderStatus {
  if (p.enabled === false) return 'disabled'
  if (h?.healthy === true || h?.status === 'healthy') return 'healthy'
  if (h?.healthy === false) return 'degraded'
  if (h?.status && h.status !== 'unknown') return 'degraded'
  return 'unknown'
}

export function buildProviderRows(
  providers: LlmProviderRow[] | undefined,
  health: ProviderHealthEntry[] | undefined,
): ProviderRow[] {
  const map = new Map<string, ProviderHealthEntry>()
  for (const h of health ?? []) {
    if (h.provider) map.set(h.provider, h)
  }
  return (providers ?? []).map<ProviderRow>((p) => {
    const h = map.get(p.name)
    return {
      id: p.id,
      name: p.name,
      displayName: p.displayName ?? p.name,
      type: p.type,
      region: p.config?.region ?? p.config?.deployment ?? '—',
      tier: p.priority != null ? `P${p.priority}` : '—',
      enabled: p.enabled !== false,
      status: deriveStatus(p, h),
      modelCount: p.models?.length ?? 0,
      lastChecked: h?.lastChecked,
      endpoint: h?.endpoint ?? p.config?.endpoint,
      error: h?.error,
      raw: p,
      health: h,
    }
  })
}

// ============================================================
// CapPill — small capability tag used in the model list and detail
// ============================================================
import * as React from 'react'

export const CapPill: React.FC<{
  tone: 'accent' | 'ok' | 'warn' | 'info'
  children: React.ReactNode
}> = ({ tone, children }) => (
  <span
    style={{
      fontFamily: 'var(--font-v3-mono)',
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      padding: '1px 5px',
      border: '1px solid var(--line-2)',
      color: `var(--${tone})`,
    }}
  >
    {children}
  </span>
)
