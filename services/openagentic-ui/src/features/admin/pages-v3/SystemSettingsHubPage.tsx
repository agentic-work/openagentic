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

// ============================================================
// Tab vocabulary
// ============================================================
export type SystemHubTab =
  | 'auth'
  | 'lockouts'
  | 'tokens'
  | 'settings'

const TAB_ORDER: SystemHubTab[] = [
  'auth',
  'lockouts',
  'tokens',
  'settings',
]

const TABS = [
  { id: 'auth',        label: 'Auth Access' },
  { id: 'lockouts',    label: 'Lockouts' },
  { id: 'tokens',      label: 'API Tokens' },
  { id: 'settings',    label: 'System Settings' },
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

  // ============================================================
  // Derived KPI values
  // ============================================================
  const lockedAll = normalizeLocked(lockedQ.data)
  const lockedActive = lockedAll.filter((u) => u.is_locked).length

  const allTokens = tokensQ.data?.tokens ?? []
  const tokensActive = allTokens.filter((t) => t.isActive && !t.isExpired).length

  // Health = OK if every page-level query succeeded with non-error.
  const errorCount =
    (lockedQ.isError ? 1 : 0) +
    (tokensQ.isError ? 1 : 0)
  const isLoadingHealth =
    lockedQ.isLoading ||
    tokensQ.isLoading

  const healthStatus: Status =
    isLoadingHealth
      ? 'idle'
      : errorCount > 0
        ? 'err'
        : lockedActive > 0
          ? 'warn'
          : 'ok'

  const healthLabel =
    isLoadingHealth
      ? '…'
      : errorCount > 0
        ? `${errorCount} probe error${errorCount === 1 ? '' : 's'}`
        : lockedActive > 0
          ? `${lockedActive} locked`
          : 'healthy'

  const onRefresh = React.useCallback(() => {
    lockedQ.refetch?.()
    tokensQ.refetch?.()
  }, [lockedQ, tokensQ])

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

      <KpiGrid cols={3}>
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
              : 'all probes ok'
          }
          tone={healthStatus === 'err' ? 'err' : healthStatus === 'warn' ? 'warn' : 'default'}
        />
      </KpiGrid>

      {tab === 'auth'        && <AuthPane />}
      {tab === 'lockouts'    && <LockoutsPane />}
      {tab === 'tokens'      && <TokensPane />}
      {tab === 'settings'    && <SettingsPane />}
    </>
  )
}

export default SystemSettingsHubPage
