import * as React from 'react'
import {
  PageHead,
  Subtabs,
  KpiGrid,
  Kpi,
  Btn,
  StatusDot,
  type Status,
} from '../primitives-v3'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { AuthPane } from './system/AuthPane'
import { LockoutsPane } from './system/LockoutsPane'
import { TokensPane } from './system/TokensPane'
import { SettingsPane } from './system/SettingsPane'
import { RateLimitsPane } from './system/RateLimitsPane'
import { NetworkPane } from './system/NetworkPane'
import { WebhooksPane } from './system/WebhooksPane'
import { DlpPane } from './system/DlpPane'

// ============================================================
// Tab vocabulary
// ============================================================
export type SystemHubTab =
  | 'auth'
  | 'lockouts'
  | 'tokens'
  | 'settings'
  | 'rate-limits'
  | 'network'
  | 'webhooks'
  | 'dlp'

const TAB_ORDER: SystemHubTab[] = [
  'auth',
  'lockouts',
  'tokens',
  'settings',
  'rate-limits',
  'network',
  'webhooks',
  'dlp',
]

const TABS = [
  { id: 'auth',        label: 'Auth Access' },
  { id: 'lockouts',    label: 'Lockouts' },
  { id: 'tokens',      label: 'API Tokens' },
  { id: 'settings',    label: 'System Settings' },
  { id: 'rate-limits', label: 'Rate Limits' },
  { id: 'network',     label: 'Network Security' },
  { id: 'webhooks',    label: 'Webhook Security' },
  { id: 'dlp',         label: 'DLP Configuration' },
]

// ============================================================
// Page-level KPI source shapes — only the fields we actually read
// ============================================================
interface LockedUserShape {
  is_locked?: boolean
  scope_warning_count?: number
}

interface TokenRowShape {
  isActive?: boolean
  isExpired?: boolean
}

interface NetworkStatusShape {
  available?: boolean
  services?: Array<{ status?: string }>
}

interface WebhookStatsShape {
  summary?: { totalRequests?: number; accepted?: number; rejected?: number }
}

interface DLPAuditEventShape {
  action?: string
}

// ============================================================
// Helpers
// ============================================================
function normalizeLocked(data: unknown): LockedUserShape[] {
  if (Array.isArray(data)) return data as LockedUserShape[]
  if (data && typeof data === 'object' && 'users' in data) {
    const u = (data as { users?: unknown }).users
    if (Array.isArray(u)) return u as LockedUserShape[]
  }
  return []
}

// ============================================================
// Props
// ============================================================
export interface SystemSettingsHubPageProps {
  /** Sub-tab to land on. Mapped from leaf id by AdminPortalHostV3. */
  initialTab?: SystemHubTab | string
}

export const SystemSettingsHubPage: React.FC<SystemSettingsHubPageProps> = ({
  initialTab = 'auth',
}) => {
  const safeInitial: SystemHubTab = (TAB_ORDER as string[]).includes(initialTab as string)
    ? (initialTab as SystemHubTab)
    : 'auth'

  const [tab, setTab] = React.useState<SystemHubTab>(safeInitial)

  // Honor leaf-driven re-mounts: AdminPortalHostV3 passes a fresh
  // initialTab when the operator clicks a different system leaf.
  React.useEffect(() => {
    setTab(safeInitial)
  }, [safeInitial])

  // ============================================================
  // Page-level KPI data — pulled at the page level so the strip stays
  // consistent across tab switches. React Query dedupes against the
  // pane queries that share the same key, so no double-fetch.
  // ============================================================
  const lockedQ = useAdminQuery<unknown>(
    ['user-management', 'locked'],
    '/api/admin/user-management/locked',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const tokensQ = useAdminQuery<{ tokens?: TokenRowShape[] }>(
    ['tokens', 'list'],
    '/api/admin/tokens',
    { staleTime: 60_000 },
  )
  const webhookStatsQ = useAdminQuery<WebhookStatsShape>(
    ['webhook-security', 'stats'],
    '/api/admin/webhook-security/stats?hours=24',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const dlpAuditQ = useAdminQuery<{ events?: DLPAuditEventShape[] }>(
    ['dlp', 'audit-log'],
    '/api/admin/dlp/audit-log?hours=24&limit=50',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const networkStatusQ = useAdminQuery<NetworkStatusShape>(
    ['network', 'status'],
    '/api/admin/network/status',
    { staleTime: 30_000 },
  )

  // ============================================================
  // Derived KPI values
  // ============================================================
  const lockedAll = normalizeLocked(lockedQ.data)
  const lockedActive = lockedAll.filter((u) => u.is_locked).length

  const allTokens = tokensQ.data?.tokens ?? []
  const tokensActive = allTokens.filter((t) => t.isActive && !t.isExpired).length

  const summary = webhookStatsQ.data?.summary ?? {}
  const totalRequests = summary.totalRequests ?? 0
  const acceptedRequests = summary.accepted ?? 0
  const deliveryRate = totalRequests > 0 ? (acceptedRequests / totalRequests) * 100 : null

  const dlpEvents = dlpAuditQ.data?.events ?? []
  const dlpRedactions24h = dlpEvents.filter((e) => e.action === 'redact').length
  const dlpBlocks24h = dlpEvents.filter((e) => e.action === 'block').length

  // Health = OK if every page-level query succeeded with non-error.
  // Network "available=false" downgrades to warn; an error from any
  // query downgrades to err.
  const errorCount =
    (lockedQ.isError ? 1 : 0) +
    (tokensQ.isError ? 1 : 0) +
    (webhookStatsQ.isError ? 1 : 0) +
    (dlpAuditQ.isError ? 1 : 0) +
    (networkStatusQ.isError ? 1 : 0)
  const networkAvailable = networkStatusQ.data?.available !== false
  const isLoadingHealth =
    lockedQ.isLoading ||
    tokensQ.isLoading ||
    webhookStatsQ.isLoading ||
    dlpAuditQ.isLoading ||
    networkStatusQ.isLoading

  const healthStatus: Status =
    isLoadingHealth
      ? 'idle'
      : errorCount > 0
        ? 'err'
        : !networkAvailable || lockedActive > 0
          ? 'warn'
          : 'ok'

  const healthLabel =
    isLoadingHealth
      ? '…'
      : errorCount > 0
        ? `${errorCount} probe error${errorCount === 1 ? '' : 's'}`
        : !networkAvailable
          ? 'network degraded'
          : lockedActive > 0
            ? `${lockedActive} locked`
            : 'healthy'

  const onRefresh = React.useCallback(() => {
    lockedQ.refetch?.()
    tokensQ.refetch?.()
    webhookStatsQ.refetch?.()
    dlpAuditQ.refetch?.()
    networkStatusQ.refetch?.()
  }, [lockedQ, tokensQ, webhookStatsQ, dlpAuditQ, networkStatusQ])

  // ============================================================
  // Meta line — env / region / admin-tools tag
  // ============================================================
  const env =
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
      ? 'prod'
      : 'dev')
  const region =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'local'

  const meta = (
    <>
      <span style={{ marginRight: 8 }}>{env}</span>
      <span style={{ color: 'var(--fg-3)' }}>·</span>
      <span style={{ margin: '0 8px' }}>{region}</span>
      <span style={{ color: 'var(--fg-3)' }}>·</span>
      <span style={{ marginLeft: 8 }}>admin tools</span>
    </>
  )

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? "System"}
        meta={meta}
        actions={<Btn variant="ghost" onClick={onRefresh}>refresh</Btn>}
      />

      <Subtabs
        items={TABS}
        active={tab}
        onChange={(id) => setTab(id as SystemHubTab)}
      />

      <KpiGrid cols={5}>
        <Kpi
          label="lockouts"
          value={lockedQ.isLoading ? '…' : String(lockedActive)}
          sub="active"
          tone={lockedActive > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="tokens"
          value={tokensQ.isLoading ? '…' : String(tokensActive)}
          sub={`active · ${allTokens.length} total`}
        />
        <Kpi
          label="webhook delivery"
          value={
            webhookStatsQ.isLoading
              ? '…'
              : deliveryRate === null
                ? '—'
                : `${deliveryRate.toFixed(1)}%`
          }
          sub={
            totalRequests > 0
              ? `${acceptedRequests.toLocaleString()} / ${totalRequests.toLocaleString()} (24h)`
              : 'no traffic (24h)'
          }
          tone={
            deliveryRate === null
              ? 'default'
              : deliveryRate >= 95
                ? 'ok'
                : deliveryRate >= 80
                  ? 'warn'
                  : 'err'
          }
        />
        <Kpi
          label="dlp redactions"
          value={dlpAuditQ.isLoading ? '…' : String(dlpRedactions24h)}
          sub={`${dlpBlocks24h} blocks · 24h`}
          tone={dlpBlocks24h > 0 ? 'err' : dlpRedactions24h > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="health"
          value={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={healthStatus} />
              {healthLabel}
            </span>
          }
          sub={
            errorCount > 0
              ? 'one or more probes failed'
              : !networkAvailable
                ? 'network controller unreachable'
                : 'all probes ok'
          }
          tone={healthStatus === 'err' ? 'err' : healthStatus === 'warn' ? 'warn' : 'default'}
        />
      </KpiGrid>

      {tab === 'auth'        && <AuthPane />}
      {tab === 'lockouts'    && <LockoutsPane />}
      {tab === 'tokens'      && <TokensPane />}
      {tab === 'settings'    && <SettingsPane />}
      {tab === 'rate-limits' && <RateLimitsPane />}
      {tab === 'network'     && <NetworkPane />}
      {tab === 'webhooks'    && <WebhooksPane />}
      {tab === 'dlp'         && <DlpPane />}
    </>
  )
}

export default SystemSettingsHubPage
