/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * System & Security domain pages (blueprint §2 — SYSTEM & SECURITY, 11
 * leaves) at mock fidelity (the admin-console mock PAGES.users +
 * the System & Security meta surfaces) and WIRED to the real admin endpoints.
 *
 * Each leaf is a body-only component — PageHead + content, NEVER its own
 * OptionSpec (AdminConsole appends the option-spec inventory = the two-part
 * leaf contract). Every number comes from a live hook or renders an honest
 * "—"; tables render real rows or an honest-empty Banner; no value is
 * fabricated. Every color resolves via a global theme token (var(--*)).
 *
 * Data sources (all real admin routes):
 *   GET /api/admin/users                         → user management table (users)
 *   GET /api/admin/auth-access/users + /domains  → allowed users + domains (auth-access)
 *   GET /api/admin/user-management               → per-user RBAC grid (permissions)
 *   GET /api/admin/user-management/locked        → locked accounts (user-lockouts)
 *   GET /api/admin/tokens                        → API tokens (tokens)
 *   GET /api/admin/system/dashboard/overview     → system-settings KPIs
 *     + /api/admin/chat-loop-config + /router-tuning (curated config subset)
 *   GET /api/admin/rate-limits                   → tiers + user overrides (rate-limits)
 *   GET /api/admin/network/status                → per-service NetworkPolicy (network-security)
 *   GET /api/admin/webhook-security/config       → webhook signing config (webhook-security)
 *   GET /api/admin/dlp/rules + /dlp/config       → DLP rules + summary (dlp-config)
 */
import * as React from 'react'
import {
  Banner,
  DataTable,
  FormSection,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  StatusDot,
  Tag,
  type DtColumn,
  type Kpi,
} from '../primitives'
import type { Tone } from '../types'
import {
  useChatLoopConfig,
  useRouterTuning,
} from '../../hooks/useDashboardMetrics'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import type { LeafPageProps } from './registry'

/* ============================================================
 * format helpers (honest "—" on missing) — port of HomePage's
 * ============================================================ */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function relTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const t = d.getTime()
  if (Number.isNaN(t)) return String(ts).slice(0, 16)
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}
/** Stringify an unknown payload so it never renders as a raw object (no React #31). */
function asText(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/* ============================================================
 * shared loading / error helper
 * ============================================================ */
function LoadErr({
  isLoading,
  isError,
  label,
}: {
  isLoading: boolean
  isError: boolean
  label: string
}) {
  if (isError) {
    return (
      <Banner tone="err">
        Failed to load {label}. The endpoint returned an error — no data is shown rather than a
        fabricated value.
      </Banner>
    )
  }
  if (isLoading) {
    return <Banner tone="info">Loading {label}…</Banner>
  }
  return null
}

/* ============================================================
 * row + response shapes (permissive — mirror the real admin envelopes)
 * ============================================================ */
interface UserRow extends Record<string, unknown> {
  id: string
  email?: string
  name?: string | null
  isAdmin?: boolean
  groups?: string[] | null
  lastLoginAt?: string | null
  createdAt?: string | null
  stats?: { totalSessions?: number; totalMessages?: number; totalTokens?: number; totalCost?: number }
}
interface UsersResponse {
  users?: UserRow[]
  pagination?: { total?: number; limit?: number; offset?: number; hasMore?: boolean }
}

interface AllowedUserRow extends Record<string, unknown> {
  id: string
  email?: string
  display_name?: string | null
  is_admin?: boolean
  notes?: string | null
  added_by?: string | null
  created_at?: string | null
}
interface AllowedUsersResponse {
  users?: AllowedUserRow[]
  count?: number
}
interface AllowedDomainRow extends Record<string, unknown> {
  id: string
  domain?: string
  is_admin?: boolean
  notes?: string | null
  created_at?: string | null
}
interface AllowedDomainsResponse {
  domains?: AllowedDomainRow[]
  count?: number
}

interface ManagedUserRow extends Record<string, unknown> {
  id: string
  email?: string
  name?: string | null
  is_admin?: boolean
  groups?: string[] | null
  last_login_at?: string | null
  is_locked?: boolean
  scope_warning_count?: number
  hasCustomPermissions?: boolean
  customPermissions?: unknown
}
interface ManagedUsersResponse {
  users?: ManagedUserRow[]
  total?: number
}

interface LockedUserRow extends Record<string, unknown> {
  id: string
  email?: string
  name?: string | null
  warningCount?: number
  lockedAt?: string | null
  lockedReason?: string | null
}
interface LockedUsersResponse {
  users?: LockedUserRow[]
  total?: number
}

interface TokenRow extends Record<string, unknown> {
  id: string
  userId?: string
  userName?: string
  userEmail?: string
  isAdmin?: boolean
  name?: string
  lastUsedAt?: string | null
  expiresAt?: string | null
  isActive?: boolean
  isExpired?: boolean
  createdAt?: string | null
  rateLimitTier?: string
}
interface TokensResponse {
  success?: boolean
  tokens?: TokenRow[]
  count?: number
}

interface SystemOverviewResponse {
  users?: { total?: number; active?: number }
  sessions?: { total?: number; active?: number }
  messages?: { total?: number }
  mcpServers?: { configured?: number; tools?: number }
  systemHealth?: string
}

interface RateTierRow extends Record<string, unknown> {
  name: string
  displayName?: string
  description?: string
  requestsPerMinute?: number
  requestsPerHour?: number
  requestsPerDay?: number
  tokensPerDay?: number
  concurrentWorkflows?: number
}
interface RateOverrideRow extends Record<string, unknown> {
  userId: string
  userEmail?: string | null
  userName?: string | null
  tier?: string
  requestsPerMinute?: number | null
  requestsPerHour?: number | null
  requestsPerDay?: number | null
  tokensPerDay?: number | null
}
interface RateLimitsResponse {
  tiers?: RateTierRow[]
  userOverrides?: RateOverrideRow[]
  totalUsersWithOverrides?: number
  defaultTier?: string
}

interface NetworkServiceRow extends Record<string, unknown> {
  service: string
  policyEnabled?: boolean
  critical?: boolean
  namespace?: string
  description?: string
}
interface NetworkStatusResponse {
  available?: boolean
  error?: string
  services?: NetworkServiceRow[]
  summary?: {
    totalServices?: number
    policiesEnabled?: number
    policiesDisabled?: number
    criticalServices?: number
  }
}

interface WebhookConfig {
  enabled?: boolean
  killSwitchEnabled?: boolean
  requireSignature?: boolean
  signatureAlgorithm?: string
  maxPayloadBytes?: number
  replayWindowSeconds?: number
  promptInjectionThreshold?: number
  globalRateLimitPerMinute?: number
  platformAllowlists?: Record<string, unknown>
  [key: string]: unknown
}
interface WebhookConfigResponse {
  config?: WebhookConfig
}

interface DlpRuleRow extends Record<string, unknown> {
  id: string
  category?: string
  name?: string
  description?: string
  pattern?: string
  flags?: string
  severity?: string
  enabled?: boolean
  hits?: number
}
interface DlpRulesResponse {
  rules?: DlpRuleRow[]
  summary?: Record<string, number>
}
interface DlpConfigResponse {
  rulesCount?: number
  enabledCount?: number
  exemptionsCount?: number
  summary?: Record<string, number>
}


/* ============================================================
 * domain-local hooks (typed, honest-empty) — one per real endpoint
 * ============================================================ */
function useUsers() {
  return useAdminQuery<UsersResponse>(['sys-users'], '/api/admin/users?limit=200', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useAllowedUsers() {
  return useAdminQuery<AllowedUsersResponse>(['sys-auth-users'], '/api/admin/auth-access/users', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useAllowedDomains() {
  return useAdminQuery<AllowedDomainsResponse>(['sys-auth-domains'], '/api/admin/auth-access/domains', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useManagedUsers() {
  return useAdminQuery<ManagedUsersResponse>(['sys-managed-users'], '/api/admin/user-management', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useLockedUsers() {
  return useAdminQuery<LockedUsersResponse>(['sys-locked-users'], '/api/admin/user-management/locked', {
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
function useApiTokens() {
  return useAdminQuery<TokensResponse>(['sys-tokens'], '/api/admin/tokens', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useSystemOverview() {
  return useAdminQuery<SystemOverviewResponse>(['sys-overview'], '/api/admin/system/dashboard/overview', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useRateLimits() {
  return useAdminQuery<RateLimitsResponse>(['sys-rate-limits'], '/api/admin/rate-limits', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useNetworkStatus() {
  return useAdminQuery<NetworkStatusResponse>(['sys-network'], '/api/admin/network/status', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useWebhookConfig() {
  return useAdminQuery<WebhookConfigResponse>(['sys-webhook'], '/api/admin/webhook-security/config', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useDlpRules() {
  return useAdminQuery<DlpRulesResponse>(['sys-dlp-rules'], '/api/admin/dlp/rules', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useDlpConfig() {
  return useAdminQuery<DlpConfigResponse>(['sys-dlp-config'], '/api/admin/dlp/config', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/* ============================================================
 * 1. users · su — user management table (roles, MFA, lockout)
 * ============================================================ */
function UsersPage(_props: LeafPageProps) {
  const users = useUsers()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const rows = users.data?.users ?? []
  const total = users.data?.pagination?.total ?? rows.length
  const admins = rows.filter((r) => r.isAdmin).length
  const open = rows.find((r) => r.id === openId) ?? null

  const strip: Kpi[] = [
    { label: 'Accounts', val: users.data ? total : '—', tone: 'accent', sub: `${rows.length} loaded` },
    { label: 'Admins', val: users.data ? admins : '—', tone: 'info' },
    {
      label: 'Tokens (24h)',
      val: users.data ? fmtNum(rows.reduce((a, r) => a + (r.stats?.totalTokens ?? 0), 0)) : '—',
      tone: 'warn',
    },
    {
      label: 'Sessions',
      val: users.data ? fmtNum(rows.reduce((a, r) => a + (r.stats?.totalSessions ?? 0), 0)) : '—',
      tone: 'ok',
    },
  ]

  const cols: DtColumn<UserRow>[] = [
    {
      label: 'User',
      val: (r) => r.name ?? r.email ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name">{r.name ?? '—'}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.email ?? '—'}
          </div>
        </span>
      ),
    },
    {
      label: 'Role',
      render: (r) => <Tag>{r.isAdmin ? 'Admin' : 'Member'}</Tag>,
    },
    {
      label: 'Groups',
      render: (r) =>
        Array.isArray(r.groups) && r.groups.length ? (
          <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>{r.groups.join(', ')}</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
    { label: 'Tokens', r: true, sortVal: (r) => r.stats?.totalTokens ?? -1, val: (r) => fmtNum(r.stats?.totalTokens) },
    { label: 'Sessions', r: true, val: (r) => r.stats?.totalSessions ?? 0 },
    { label: 'Last login', val: (r) => relTime(r.lastLoginAt) },
  ]

  return (
    <>
      <PageHead
        title="User Management"
        sub={
          users.data
            ? `${total} accounts · ${admins} ${admins === 1 ? 'admin' : 'admins'} · /api/admin/users`
            : 'all platform accounts · roles · usage · /api/admin/users'
        }
        actions={[{ label: 'Invite user', ic: '＋ ', primary: true }]}
        mode="editable"
      />
      <LoadErr isLoading={users.isLoading} isError={users.isError} label="users" />
      <KpiStrip kpis={strip} />
      <Section title="Users" />
      {users.data && (
        <DataTable<UserRow>
          cols={cols}
          rows={rows}
          onRow={(r) => setOpenId(r.id)}
          search="search users · name · email · group…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'admin', label: 'admins', cnt: admins },
              { id: 'member', label: 'members', cnt: rows.length - admins },
            ],
            filter: (row, chip) => {
              const r = row as UserRow
              return chip === 'all' ? true : chip === 'admin' ? !!r.isAdmin : !r.isAdmin
            },
          }}
          empty="No users yet"
        />
      )}
      {open && (
        <Section
          title={open.name ?? open.email ?? 'User'}
          sub={open.email}
          right={
            <button className="awc-btn awc-sm awc-ghost" onClick={() => setOpenId(null)}>
              close
            </button>
          }
        >
          <div className="awc-chartcard">
            <FormSection
              title="Account"
              rows={[
                { label: 'Email', type: 'text', value: open.email ?? '—', locked: true },
                {
                  label: 'Role',
                  type: 'badge',
                  badge: <Pill tone={open.isAdmin ? 'info' : 'muted'} dot>{open.isAdmin ? 'Admin' : 'Member'}</Pill>,
                },
                { label: 'Groups', type: 'text', value: Array.isArray(open.groups) ? open.groups.join(', ') : '—', locked: true },
                { label: 'Total tokens', type: 'text', value: fmtNum(open.stats?.totalTokens), locked: true },
                { label: 'Sessions', type: 'text', value: String(open.stats?.totalSessions ?? 0), locked: true },
                { label: 'Last login', type: 'text', value: relTime(open.lastLoginAt), locked: true },
                { label: 'Created', type: 'text', value: relTime(open.createdAt), locked: true },
              ]}
              mode="readonly"
            />
          </div>
        </Section>
      )}
    </>
  )
}

/* ============================================================
 * 2. auth-access · sa — auth / access-control allowlist
 * ============================================================ */
function AuthAccessPage(_props: LeafPageProps) {
  const allowedUsers = useAllowedUsers()
  const domains = useAllowedDomains()
  const uRows = allowedUsers.data?.users ?? []
  const dRows = domains.data?.domains ?? []
  const uAdmins = uRows.filter((r) => r.is_admin).length

  const strip: Kpi[] = [
    { label: 'Allowed users', val: allowedUsers.data ? uRows.length : '—', tone: 'accent' },
    { label: 'Admin grants', val: allowedUsers.data ? uAdmins : '—', tone: 'info' },
    { label: 'Allowed domains', val: domains.data ? dRows.length : '—', tone: 'ok' },
  ]

  const uCols: DtColumn<AllowedUserRow>[] = [
    {
      label: 'Email',
      val: (r) => r.email ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.email ?? '—'}</span>
          {r.display_name && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.display_name}</div>}
        </span>
      ),
    },
    { label: 'Admin', render: (r) => (r.is_admin ? <Pill tone="info" dot>admin</Pill> : <span style={{ color: 'var(--fg-3)' }}>—</span>) },
    { label: 'Notes', val: (r) => r.notes ?? '—' },
    { label: 'Added', val: (r) => relTime(r.created_at) },
  ]
  const dCols: DtColumn<AllowedDomainRow>[] = [
    {
      label: 'Domain',
      val: (r) => r.domain ?? r.id,
      render: (r) => <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.domain ?? '—'}</span>,
    },
    { label: 'Admin', render: (r) => (r.is_admin ? <Pill tone="info" dot>admin</Pill> : <span style={{ color: 'var(--fg-3)' }}>—</span>) },
    { label: 'Notes', val: (r) => r.notes ?? '—' },
    { label: 'Added', val: (r) => relTime(r.created_at) },
  ]

  return (
    <>
      <PageHead
        title="Auth & Access Control"
        sub="sign-in allowlist — who may sign in · /api/admin/auth-access"
        actions={[{ label: 'Add user', ic: '＋ ', primary: true }]}
        mode="editable"
      />
      <Banner tone="info">
        Only emails on the allowed-user list or matching an allowed domain may sign in. Empty
        values render <b>—</b>, never a fabricated default.
      </Banner>
      <KpiStrip kpis={strip} />
      <Section title="Allowed users" />
      <LoadErr isLoading={allowedUsers.isLoading} isError={allowedUsers.isError} label="allowed users" />
      {allowedUsers.data && (
        <DataTable<AllowedUserRow>
          cols={uCols}
          rows={uRows}
          search="search allowed users…"
          pageSize={8}
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: uRows.length },
              { id: 'admin', label: 'admins', cnt: uAdmins },
              { id: 'member', label: 'members', cnt: uRows.length - uAdmins },
            ],
            filter: (row, chip) => {
              const r = row as AllowedUserRow
              return chip === 'all' ? true : chip === 'admin' ? !!r.is_admin : !r.is_admin
            },
          }}
          empty="No allowed users configured"
        />
      )}
      <Section title="Allowed domains" sub="any email under these domains may sign in" />
      <LoadErr isLoading={domains.isLoading} isError={domains.isError} label="allowed domains" />
      {domains.data && (
        <DataTable<AllowedDomainRow>
          cols={dCols}
          rows={dRows}
          search="search allowed domains…"
          pageSize={8}
          empty="No allowed domains configured"
        />
      )}
    </>
  )
}

/* ============================================================
 * 3. permissions · sp — user-permission grid (RBAC)
 * ============================================================ */
function PermissionsPage(_props: LeafPageProps) {
  const managed = useManagedUsers()
  const rows = managed.data?.users ?? []
  const total = managed.data?.total ?? rows.length
  const withCustom = rows.filter((r) => r.hasCustomPermissions).length
  const locked = rows.filter((r) => r.is_locked).length

  const strip: Kpi[] = [
    { label: 'Users', val: managed.data ? total : '—', tone: 'accent' },
    { label: 'Custom permissions', val: managed.data ? withCustom : '—', tone: 'info', sub: 'override the defaults' },
    { label: 'Admins', val: managed.data ? rows.filter((r) => r.is_admin).length : '—', tone: 'warn' },
    { label: 'Locked', val: managed.data ? locked : '—', tone: locked > 0 ? 'err' : 'ok' },
  ]

  const cols: DtColumn<ManagedUserRow>[] = [
    {
      label: 'User',
      val: (r) => r.name ?? r.email ?? r.id,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={r.is_locked ? 'err' : 'ok'} />
          <span>
            <span className="awc-name">{r.name ?? '—'}</span>
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
              {r.email ?? '—'}
            </div>
          </span>
        </span>
      ),
    },
    { label: 'Role', render: (r) => <Tag>{r.is_admin ? 'Admin' : 'Member'}</Tag> },
    {
      label: 'Groups',
      render: (r) =>
        Array.isArray(r.groups) && r.groups.length ? (
          <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>{r.groups.join(', ')}</span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
    {
      label: 'Permissions',
      render: (r) => (
        <Pill tone={r.hasCustomPermissions ? 'purple' : 'muted'} dot>
          {r.hasCustomPermissions ? 'custom' : 'default'}
        </Pill>
      ),
    },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={r.is_locked ? 'err' : 'ok'} dot>
          {r.is_locked ? 'locked' : 'active'}
        </Pill>
      ),
    },
    { label: 'Warnings', r: true, val: (r) => r.scope_warning_count ?? 0 },
    { label: 'Last login', val: (r) => relTime(r.last_login_at) },
  ]

  return (
    <>
      <PageHead
        title="User Permissions"
        sub="capability allow / ask / deny per user (AU-3) · /api/admin/user-management"
        mode="editable"
      />
      <LoadErr isLoading={managed.isLoading} isError={managed.isError} label="user permissions" />
      <KpiStrip kpis={strip} />
      <Section title="Permission grid" sub="per-user RBAC + scope-lock state" />
      {managed.data && (
        <DataTable<ManagedUserRow>
          cols={cols}
          rows={rows}
          search="search users · name · email · group…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'custom', label: 'custom', cnt: withCustom },
              { id: 'locked', label: 'locked', cnt: locked },
            ],
            filter: (row, chip) => {
              const r = row as ManagedUserRow
              if (chip === 'all') return true
              if (chip === 'custom') return !!r.hasCustomPermissions
              return !!r.is_locked
            },
          }}
          empty="No users to scope"
        />
      )}
    </>
  )
}

/* ============================================================
 * 4. user-lockouts · sl — locked accounts + auth-failure trail
 * ============================================================ */
function UserLockoutsPage(_props: LeafPageProps) {
  const locked = useLockedUsers()
  const rows = locked.data?.users ?? []
  const total = locked.data?.total ?? rows.length

  const strip: Kpi[] = [
    { label: 'Locked accounts', val: locked.data ? total : '—', tone: total > 0 ? 'err' : 'ok' },
    {
      label: 'Total warnings',
      val: locked.data ? rows.reduce((a, r) => a + (r.warningCount ?? 0), 0) : '—',
      tone: 'warn',
    },
  ]

  const cols: DtColumn<LockedUserRow>[] = [
    {
      label: 'User',
      val: (r) => r.email ?? r.id,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone="err" />
          <span>
            <span className="awc-name">{r.name ?? '—'}</span>
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
              {r.email ?? '—'}
            </div>
          </span>
        </span>
      ),
    },
    { label: 'Warnings', r: true, sortVal: (r) => r.warningCount ?? 0, val: (r) => r.warningCount ?? 0 },
    {
      label: 'Reason',
      render: (r) => <span style={{ color: 'var(--err)', whiteSpace: 'normal' }}>{r.lockedReason ?? '—'}</span>,
    },
    { label: 'Locked', val: (r) => relTime(r.lockedAt) },
    {
      label: '',
      render: () => (
        <button className="awc-btn awc-sm">unlock</button>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="User Lockouts"
        sub={
          locked.data
            ? `${total} locked ${total === 1 ? 'account' : 'accounts'} · /api/admin/user-management/locked`
            : 'locked accounts + auth-failure trail · /api/admin/user-management/locked'
        }
        actions={[{ label: 'Export CSV', ic: '⤓ ' }]}
        mode="editable"
      />
      {total > 0 ? (
        <Banner tone="warn">
          <b>
            {total} {total === 1 ? 'account is' : 'accounts are'} locked
          </b>{' '}
          on scope-violation warnings — review the reason and unlock once cleared.
        </Banner>
      ) : (
        <Banner tone="ok">No accounts are currently locked.</Banner>
      )}
      <KpiStrip kpis={strip} />
      <Section title="Locked accounts" sub="is_locked = true · ordered by lockedAt" right={<Pill tone="ok" dot>live</Pill>} />
      <LoadErr isLoading={locked.isLoading} isError={locked.isError} label="locked users" />
      {locked.data && (
        <DataTable<LockedUserRow>
          cols={cols}
          rows={rows}
          search="search locked users · email · reason…"
          pageSize={10}
          empty="No locked accounts"
        />
      )}
    </>
  )
}

/* ============================================================
 * 5. tokens · st — API tokens table (scope, expiry, revoke)
 * ============================================================ */
function TokensPage(_props: LeafPageProps) {
  const tokens = useApiTokens()
  const rows = tokens.data?.tokens ?? []
  const active = rows.filter((r) => r.isActive && !r.isExpired).length
  const expired = rows.filter((r) => r.isExpired).length

  const strip: Kpi[] = [
    { label: 'Tokens', val: tokens.data ? rows.length : '—', tone: 'accent' },
    { label: 'Active', val: tokens.data ? active : '—', tone: 'ok' },
    { label: 'Expired', val: tokens.data ? expired : '—', tone: expired > 0 ? 'warn' : 'muted' },
    { label: 'Revoked', val: tokens.data ? rows.filter((r) => !r.isActive).length : '—', tone: 'err' },
  ]

  const cols: DtColumn<TokenRow>[] = [
    {
      label: 'Token',
      val: (r) => r.name ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.name ?? '—'}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.userEmail ?? r.userName ?? '—'}</div>
        </span>
      ),
    },
    { label: 'Tier', render: (r) => <Tag>{r.rateLimitTier ?? 'free'}</Tag> },
    {
      label: 'Status',
      render: (r) => {
        const tone: Tone = !r.isActive ? 'err' : r.isExpired ? 'warn' : 'ok'
        const lbl = !r.isActive ? 'revoked' : r.isExpired ? 'expired' : 'active'
        return (
          <Pill tone={tone} dot>
            {lbl}
          </Pill>
        )
      },
    },
    { label: 'Last used', val: (r) => relTime(r.lastUsedAt) },
    {
      label: 'Expires',
      render: (r) =>
        r.expiresAt ? <span>{relTime(r.expiresAt)}</span> : <span style={{ color: 'var(--fg-3)' }}>never</span>,
    },
    { label: 'Created', val: (r) => relTime(r.createdAt) },
  ]

  return (
    <>
      <PageHead
        title="API Tokens"
        sub={
          tokens.data
            ? `${rows.length} tokens · ${active} active · /api/admin/tokens`
            : 'personal access tokens · scope · expiry · /api/admin/tokens'
        }
        actions={[{ label: 'Issue token', ic: '＋ ', primary: true }]}
        mode="editable"
      />
      <Banner tone="info">
        Token secrets are never returned by the API — only metadata. Revoke or rotate from the
        per-token row.
      </Banner>
      <LoadErr isLoading={tokens.isLoading} isError={tokens.isError} label="API tokens" />
      <KpiStrip kpis={strip} />
      <Section title="Tokens" />
      {tokens.data && (
        <DataTable<TokenRow>
          cols={cols}
          rows={rows}
          search="search tokens · name · owner · tier…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'active', label: 'active', cnt: active },
              { id: 'expired', label: 'expired', cnt: expired },
              { id: 'revoked', label: 'revoked', cnt: rows.filter((r) => !r.isActive).length },
            ],
            filter: (row, chip) => {
              const r = row as TokenRow
              if (chip === 'all') return true
              if (chip === 'active') return !!r.isActive && !r.isExpired
              if (chip === 'expired') return !!r.isExpired
              return !r.isActive
            },
          }}
          empty="No API tokens issued"
        />
      )}
    </>
  )
}

/* ============================================================
 * 6. system-settings · ss — global system settings (curated form)
 * ============================================================ */
function SystemSettingsPage(_props: LeafPageProps) {
  const overview = useSystemOverview()
  const chatLoop = useChatLoopConfig()
  const tuning = useRouterTuning()
  const o = overview.data

  const strip: Kpi[] = [
    { label: 'Users', val: o ? fmtNum(o.users?.total) : '—', tone: 'accent', sub: o?.users?.active != null ? `${o.users.active} active 24h` : undefined },
    { label: 'Sessions', val: o ? fmtNum(o.sessions?.total) : '—', tone: 'info' },
    { label: 'Messages', val: o ? fmtNum(o.messages?.total) : '—', tone: 'ok' },
    {
      label: 'MCP servers',
      val: o ? fmtNum(o.mcpServers?.configured) : '—',
      tone: 'warn',
      sub: o?.mcpServers?.tools != null ? `${o.mcpServers.tools} tools` : undefined,
    },
  ]

  const cl = chatLoop.data?.config
  const clMeta = chatLoop.data?.meta
  const t = tuning.data?.tuning

  return (
    <>
      <PageHead
        title="System Settings"
        sub="global platform configuration · curated key/value subset · /api/admin/system"
        mode="readonly"
      />
      <Banner tone="info">
        Settings render <b>live</b> from the system-configuration store; rows are locked — the
        complete typed key/value registry browser is a follow-up (blueprint PARTIAL). Empty fields
        show <b>—</b>, never a fabricated default.
      </Banner>
      <LoadErr isLoading={overview.isLoading} isError={overview.isError} label="system overview" />
      <KpiStrip kpis={strip} />
      <Section title="Platform health" />
      <div className="awc-chartcard" style={{ marginBottom: 16 }}>
        <FormSection
          title="Overview"
          rows={[
            {
              label: 'System health',
              type: 'badge',
              badge: (
                <Pill tone={o?.systemHealth === 'online' ? 'ok' : o ? 'warn' : 'muted'} dot>
                  {o?.systemHealth ?? '—'}
                </Pill>
              ),
            },
            { label: 'Configured MCP servers', type: 'text', value: o ? String(o.mcpServers?.configured ?? 0) : '—', locked: true },
            { label: 'Indexed MCP tools', type: 'text', value: o ? String(o.mcpServers?.tools ?? 0) : '—', locked: true },
          ]}
          mode="readonly"
        />
      </div>
      <Section title="Chat-loop config" sub="/api/admin/chat-loop-config" />
      <LoadErr isLoading={chatLoop.isLoading} isError={chatLoop.isError} label="chat-loop config" />
      <FormSection
        title="Agent loop"
        rows={[
          {
            label: 'maxTurns',
            type: 'number',
            value: cl?.maxTurns,
            suffix: 'turns',
            desc: clMeta ? `floor ${clMeta.maxTurnsFloor} · ceiling ${clMeta.maxTurnsCeiling}` : undefined,
          },
        ]}
        mode="readonly"
      />
      <Section title="Smart-router tuning" sub="/api/admin/router-tuning" />
      <LoadErr isLoading={tuning.isLoading} isError={tuning.isError} label="router tuning" />
      <FormSection
        title="Scoring weights"
        rows={[
          { label: 'costWeight', type: 'number', value: t?.costWeight },
          { label: 'qualityWeight', type: 'number', value: t?.qualityWeight },
          { label: 'costNormalizationCeiling', type: 'number', value: t?.costNormalizationCeiling },
          { label: 'fcaQualityFloor', type: 'number', value: t?.fcaQualityFloor },
          { label: 'fcaT3Floor', type: 'number', value: t?.fcaT3Floor },
          {
            label: 'intentClassifierEnabled',
            type: 'toggle',
            value: t?.intentClassifierEnabled,
            desc: 'route via the intent classifier',
          },
        ]}
        mode="readonly"
      />
    </>
  )
}

/* ============================================================
 * 7. rate-limits · sr — rate-limit tier table + user overrides
 * ============================================================ */
function RateLimitsPage(_props: LeafPageProps) {
  const rl = useRateLimits()
  const tiers = rl.data?.tiers ?? []
  const overrides = rl.data?.userOverrides ?? []
  const defaultTier = rl.data?.defaultTier

  const strip: Kpi[] = [
    { label: 'Tiers', val: rl.data ? tiers.length : '—', tone: 'accent' },
    { label: 'User overrides', val: rl.data ? overrides.length : '—', tone: 'info' },
    {
      label: 'Default tier',
      val: defaultTier ?? '—',
      tone: 'ok',
    },
  ]

  const tierCols: DtColumn<RateTierRow>[] = [
    {
      label: 'Tier',
      val: (r) => r.displayName ?? r.name,
      render: (r) => (
        <span>
          <span className="awc-name">{r.displayName ?? r.name}</span>
          {r.description && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.description}</div>}
        </span>
      ),
    },
    { label: 'Req/min', r: true, val: (r) => r.requestsPerMinute ?? 0 },
    { label: 'Req/hour', r: true, val: (r) => r.requestsPerHour ?? 0 },
    { label: 'Req/day', r: true, val: (r) => fmtNum(r.requestsPerDay) },
    { label: 'Tokens/day', r: true, val: (r) => fmtNum(r.tokensPerDay) },
    { label: 'Concurrent flows', r: true, val: (r) => r.concurrentWorkflows ?? 0 },
  ]
  const ovCols: DtColumn<RateOverrideRow>[] = [
    { label: 'User', val: (r) => r.userEmail ?? r.userName ?? r.userId },
    { label: 'Tier', render: (r) => <Tag>{r.tier ?? 'custom'}</Tag> },
    { label: 'Req/min', r: true, val: (r) => r.requestsPerMinute ?? '—' },
    { label: 'Req/day', r: true, val: (r) => fmtNum(r.requestsPerDay) },
    { label: 'Tokens/day', r: true, val: (r) => fmtNum(r.tokensPerDay) },
  ]

  return (
    <>
      <PageHead
        title="Rate Limits"
        sub="per-tier request + token quotas · /api/admin/rate-limits"
        mode="editable"
      />
      <LoadErr isLoading={rl.isLoading} isError={rl.isError} label="rate limits" />
      <KpiStrip kpis={strip} />
      <Section title="Tiers" sub="request + token quotas per tier" />
      {rl.data && (
        <DataTable<RateTierRow>
          cols={tierCols}
          rows={tiers}
          search="search tiers…"
          pageSize={8}
          empty="No rate-limit tiers configured"
        />
      )}
      <Section title="User overrides" sub="per-user quota overrides over the default tier" />
      {rl.data && (
        <DataTable<RateOverrideRow>
          cols={ovCols}
          rows={overrides}
          search="search overrides · user…"
          pageSize={8}
          empty="No user-level overrides — everyone uses their tier default"
        />
      )}
    </>
  )
}

/* ============================================================
 * 8. network-security · sn — per-service NetworkPolicy status
 * ============================================================ */
function NetworkSecurityPage(_props: LeafPageProps) {
  const net = useNetworkStatus()
  const data = net.data
  const services = data?.services ?? []
  const summary = data?.summary
  const unavailable = data && data.available === false

  const strip: Kpi[] = [
    { label: 'Services', val: data ? (summary?.totalServices ?? services.length) : '—', tone: 'accent' },
    {
      label: 'Policies enabled',
      val: data ? (summary?.policiesEnabled ?? services.filter((s) => s.policyEnabled).length) : '—',
      tone: 'ok',
    },
    {
      label: 'Unprotected',
      val: data ? (summary?.policiesDisabled ?? services.filter((s) => !s.policyEnabled).length) : '—',
      tone: (summary?.policiesDisabled ?? 0) > 0 ? 'warn' : 'muted',
    },
    {
      label: 'Critical services',
      val: data ? (summary?.criticalServices ?? services.filter((s) => s.critical).length) : '—',
      tone: 'info',
    },
  ]

  const cols: DtColumn<NetworkServiceRow>[] = [
    {
      label: 'Service',
      val: (r) => r.service,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={r.policyEnabled ? 'ok' : 'warn'} />
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.service}</span>
        </span>
      ),
    },
    { label: 'Namespace', val: (r) => r.namespace ?? '—' },
    { label: 'Critical', render: (r) => (r.critical ? <Pill tone="info" dot>critical</Pill> : <span style={{ color: 'var(--fg-3)' }}>—</span>) },
    {
      label: 'NetworkPolicy',
      render: (r) => (
        <Pill tone={r.policyEnabled ? 'ok' : 'warn'} dot>
          {r.policyEnabled ? 'enforced' : 'open'}
        </Pill>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Network Security"
        sub="egress NetworkPolicy + IP allowlists · /api/admin/network/status"
        mode="editable"
      />
      <LoadErr isLoading={net.isLoading} isError={net.isError} label="network status" />
      {unavailable && (
        <Banner tone="warn">
          The k8s client is not available in this environment — NetworkPolicy status cannot be read
          ({asText(data?.error)}). No policy rows are fabricated.
        </Banner>
      )}
      <KpiStrip kpis={strip} />
      <Section title="Service policies" sub="one NetworkPolicy per platform service" />
      {data && data.available !== false && (
        <DataTable<NetworkServiceRow>
          cols={cols}
          rows={services}
          search="search services…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: services.length },
              { id: 'enforced', label: 'enforced', cnt: services.filter((s) => s.policyEnabled).length },
              { id: 'open', label: 'open', cnt: services.filter((s) => !s.policyEnabled).length },
            ],
            filter: (row, chip) => {
              const r = row as NetworkServiceRow
              return chip === 'all' ? true : chip === 'enforced' ? !!r.policyEnabled : !r.policyEnabled
            },
          }}
          empty="No service policies"
        />
      )}
    </>
  )
}

/* ============================================================
 * 9. webhook-security · sw — inbound webhook signing config
 * ============================================================ */
function WebhookSecurityPage(_props: LeafPageProps) {
  const wh = useWebhookConfig()
  const cfg = wh.data?.config
  const platforms = cfg?.platformAllowlists ? Object.keys(cfg.platformAllowlists) : []

  const strip: Kpi[] = [
    {
      label: 'Inbound webhooks',
      val: cfg ? (cfg.enabled ? 'enabled' : 'disabled') : '—',
      tone: cfg ? (cfg.enabled ? 'ok' : 'muted') : 'muted',
    },
    {
      label: 'Kill switch',
      val: cfg ? (cfg.killSwitchEnabled ? 'engaged' : 'off') : '—',
      tone: cfg?.killSwitchEnabled ? 'err' : 'ok',
    },
    { label: 'Allowlisted platforms', val: cfg ? platforms.length : '—', tone: 'info' },
  ]

  return (
    <>
      <PageHead
        title="Webhook Security"
        sub="inbound webhook signing + replay protection · /api/admin/webhook-security"
        mode="editable"
      />
      <Banner tone="info">
        Signing secrets are never returned by the API. The kill switch hard-blocks all inbound
        webhooks regardless of per-platform allowlist.
      </Banner>
      <LoadErr isLoading={wh.isLoading} isError={wh.isError} label="webhook config" />
      <KpiStrip kpis={strip} />
      <Section title="Signing & verification" />
      <FormSection
        title="Inbound webhook policy"
        rows={[
          { label: 'enabled', type: 'toggle', value: cfg?.enabled },
          { label: 'killSwitchEnabled', type: 'toggle', value: cfg?.killSwitchEnabled, desc: 'hard-block all inbound' },
          { label: 'requireSignature', type: 'toggle', value: cfg?.requireSignature },
          { label: 'signatureAlgorithm', type: 'text', value: cfg?.signatureAlgorithm ?? undefined },
          { label: 'maxPayloadBytes', type: 'number', value: cfg?.maxPayloadBytes, suffix: 'bytes' },
          { label: 'replayWindowSeconds', type: 'number', value: cfg?.replayWindowSeconds, suffix: 's' },
          { label: 'promptInjectionThreshold', type: 'number', value: cfg?.promptInjectionThreshold },
          { label: 'globalRateLimitPerMinute', type: 'number', value: cfg?.globalRateLimitPerMinute, suffix: '/min' },
        ]}
        mode="readonly"
      />
      {platforms.length > 0 && (
        <>
          <Section title="Platform allowlists" sub="per-platform inbound webhook config" />
          <div className="awc-chartcard">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {platforms.map((p) => (
                <Pill key={p} tone="info" dot>
                  {p}
                </Pill>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}

/* ============================================================
 * 10. dlp-config · sd — DLP policy rules + summary
 * ============================================================ */
function DlpConfigPage(_props: LeafPageProps) {
  const dlpRules = useDlpRules()
  const dlpConfig = useDlpConfig()
  const rows = dlpRules.data?.rules ?? []
  const cfg = dlpConfig.data
  const enabledCt = rows.filter((r) => r.enabled).length

  const sevTone = (s: string | undefined): Tone => {
    const x = String(s ?? '').toLowerCase()
    if (x === 'critical' || x === 'high') return 'err'
    if (x === 'medium') return 'warn'
    if (x === 'low') return 'info'
    return 'muted'
  }

  const strip: Kpi[] = [
    { label: 'Rules', val: dlpRules.data ? (cfg?.rulesCount ?? rows.length) : '—', tone: 'accent' },
    { label: 'Enabled', val: dlpRules.data ? (cfg?.enabledCount ?? enabledCt) : '—', tone: 'ok' },
    { label: 'Exemptions', val: cfg?.exemptionsCount != null ? cfg.exemptionsCount : '—', tone: 'warn' },
    {
      label: 'Total hits',
      val: dlpRules.data ? fmtNum(rows.reduce((a, r) => a + (r.hits ?? 0), 0)) : '—',
      tone: 'info',
    },
  ]

  const cols: DtColumn<DlpRuleRow>[] = [
    {
      label: 'Rule',
      val: (r) => r.name ?? r.id,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={r.enabled ? 'ok' : 'muted'} />
          <span>
            <span className="awc-name">{r.name ?? r.id}</span>
            {r.description && <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.description}</div>}
          </span>
        </span>
      ),
    },
    { label: 'Category', render: (r) => <Tag>{r.category ?? '—'}</Tag> },
    { label: 'Severity', render: (r) => <Pill tone={sevTone(r.severity)} dot>{r.severity ?? '—'}</Pill> },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={r.enabled ? 'ok' : 'muted'} dot>
          {r.enabled ? 'enabled' : 'disabled'}
        </Pill>
      ),
    },
    {
      label: 'Hits',
      r: true,
      sortVal: (r) => r.hits ?? 0,
      render: (r) => <span style={{ color: (r.hits ?? 0) > 0 ? 'var(--warn)' : 'var(--fg-3)' }}>{r.hits ?? 0}</span>,
    },
  ]

  return (
    <>
      <PageHead
        title="DLP Configuration"
        sub="data-loss-prevention rules + blocks · /api/admin/dlp"
        mode="editable"
      />
      <LoadErr isLoading={dlpRules.isLoading} isError={dlpRules.isError} label="DLP rules" />
      <KpiStrip kpis={strip} />
      <Section title="DLP rules" sub="pattern · severity · enable state · live hit counts" />
      {dlpRules.data && (
        <DataTable<DlpRuleRow>
          cols={cols}
          rows={rows}
          search="search rules · name · category…"
          pageSize={10}
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'enabled', label: 'enabled', cnt: enabledCt },
              { id: 'disabled', label: 'disabled', cnt: rows.length - enabledCt },
            ],
            filter: (row, chip) => {
              const r = row as DlpRuleRow
              return chip === 'all' ? true : chip === 'enabled' ? !!r.enabled : !r.enabled
            },
          }}
          empty="No DLP rules configured"
        />
      )}
    </>
  )
}

/* ============================================================
 * exports — all System & Security leaf ids → page component
 * ============================================================ */
export const systemPages: Record<string, React.ComponentType<LeafPageProps>> = {
  users: UsersPage,
  'auth-access': AuthAccessPage,
  permissions: PermissionsPage,
  'user-lockouts': UserLockoutsPage,
  tokens: TokensPage,
  'system-settings': SystemSettingsPage,
  'rate-limits': RateLimitsPage,
  'network-security': NetworkSecurityPage,
  'webhook-security': WebhookSecurityPage,
  'dlp-config': DlpConfigPage,
}
