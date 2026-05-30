import type { Status } from '../../primitives-v3'

// ============================================================
// Tab vocabulary
// ============================================================
export type IntegrationsHubTab = 'slack' | 'ms-teams' | 'logs'

export const TAB_ORDER: IntegrationsHubTab[] = ['slack', 'ms-teams', 'logs']

export const TABS: { id: IntegrationsHubTab; label: string }[] = [
  { id: 'slack',    label: 'slack' },
  { id: 'ms-teams', label: 'microsoft teams' },
  { id: 'logs',     label: 'logs' },
]

/** Map a leaf id to the corresponding hub tab. */
export function leafToTab(s: string | undefined): IntegrationsHubTab {
  if (!s) return 'slack'
  if (s === 'slack' || s === 'slack-integration') return 'slack'
  if (s === 'ms-teams' || s === 'teams-integration') return 'ms-teams'
  if (s === 'logs' || s === 'integration-logs') return 'logs'
  return 'slack'
}

// ============================================================
// /api/admin/integrations — list + detail shape
// ============================================================
export type IntegrationPlatform = 'slack' | 'teams'
export type IntegrationStatus = 'active' | 'inactive' | 'error' | 'pending'

export interface SlackConfigShape {
  botToken?: string
  signingSecret?: string
  appId?: string
  // /admin/integrations list endpoint omits secrets — be defensive.
  [key: string]: unknown
}

export interface TeamsConfigShape {
  appId?: string
  appPassword?: string
  tenantId?: string
  [key: string]: unknown
}

export interface IntegrationRow {
  id: string
  name: string
  platform: IntegrationPlatform
  status: IntegrationStatus
  webhookUrl: string
  config: SlackConfigShape | TeamsConfigShape | null
  channels: string[]
  workflowIds: string[]
  channelCount: number
  workflowCount: number
  lastActivity: string | null
  createdAt: string
  updatedAt: string
}

export interface IntegrationsResponse {
  integrations?: IntegrationRow[]
  messagesToday?: number
  workflowsTriggered?: number
}

// ============================================================
// /api/admin/integrations/:id/logs
// ============================================================
export type LogStatus = 'success' | 'error' | 'dropped'
export type LogDirection = 'inbound' | 'outbound'

export interface IntegrationLogEntry {
  id: string
  timestamp: string
  direction: LogDirection
  channel: string
  user: string
  status: LogStatus
  messagePreview: string
  // Backend may also attach an integrationId for cross-integration views.
  integrationId?: string
  integrationName?: string
  platform?: IntegrationPlatform
}

export interface IntegrationLogsResponse {
  logs?: IntegrationLogEntry[]
}

// ============================================================
// Status helpers
// ============================================================
export function integrationStatusDot(status?: string): Status {
  const s = String(status ?? '').toLowerCase()
  if (s === 'active') return 'ok'
  if (s === 'inactive') return 'idle'
  if (s === 'pending') return 'info'
  if (s === 'error') return 'err'
  return 'idle'
}

export function logStatusDot(status?: string): Status {
  const s = String(status ?? '').toLowerCase()
  if (s === 'success') return 'ok'
  if (s === 'dropped') return 'warn'
  if (s === 'error') return 'err'
  return 'idle'
}

// ============================================================
// Mask + format helpers
// ============================================================
export function maskSecret(value?: string | null): string {
  if (!value) return '—'
  if (value.length < 8) return '********'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
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

export function fmtClock(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}

export function fmtNum(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}
