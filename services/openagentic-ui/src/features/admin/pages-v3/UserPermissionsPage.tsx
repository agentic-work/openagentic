import * as React from 'react'
import {
  PageHead,
  KpiGrid,
  Kpi,
  Banner,
  Btn,
  EmptyInline,
} from '../primitives-v3'
import {
  useUserManagement,
  useUserTokens,
  asUsers,
  type ApiUser,
} from '../hooks/useUserManagement'
import { ListPanel } from './users/ListPanel'
import { DetailPanel, type DetailTab } from './users/DetailPanel'
import { InviteUserModal } from './users/InviteUserModal'
import { isActiveInLastDays, statusOf, roleOf, type UserStatus, type UserRole } from './users/helpers'

interface UserPermissionsPageProps {
  /**
   * Both `users` and `permissions` sidebar leaves render this page.
   * The permissions leaf opens directly on the Permissions sub-tab so
   * the operator's intent is honored without requiring an extra click.
   */
  initialTab?: DetailTab
}

/**
 * Top-level page. Owns the selected user + active sub-tab; ListPanel
 * mutates the selection; DetailPanel mutates the sub-tab. All data
 * fetching lives in hooks (useUserManagement.ts).
 */
export const UserPermissionsPage: React.FC<UserPermissionsPageProps> = ({ initialTab = 'profile' }) => {
  const list = useUserManagement()
  const users = React.useMemo(() => asUsers(list.data), [list.data])

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<DetailTab>(initialTab)

  // Default to the first user once data lands so the right pane isn't
  // a giant empty rectangle on first paint. We only do this when the
  // operator hasn't picked someone yet.
  React.useEffect(() => {
    if (selectedId == null && users.length > 0) {
      setSelectedId(users[0].id)
    }
  }, [users, selectedId])

  // Honor `initialTab` — when the leaf flips between `users` and
  // `permissions` the parent re-mounts with a new `initialTab` prop;
  // sync once on mount (already handled by initial state) and again
  // whenever the prop changes so back/forward nav lands on the right
  // sub-tab.
  React.useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const [search, setSearch] = React.useState('')
  const [roleFilter, setRoleFilter] = React.useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = React.useState<UserStatus | 'all'>('all')
  const [inviteOpen, setInviteOpen] = React.useState(false)

  const selected: ApiUser | null = React.useMemo(
    () => (selectedId ? users.find((u) => u.id === selectedId) ?? null : null),
    [users, selectedId],
  )

  // KPI: total tokens issued is a *roll-up* across users — there is no
  // single GET that returns this number, so we settle for the
  // selected user's count (or 0 when nothing is selected). This is
  // honest: we label it as "selected user" so admins know it's not
  // platform-wide.
  const tokensQ = useUserTokens(selected?.id ?? null)

  const kpis = React.useMemo(() => {
    const total = users.length
    const active = users.filter((u) => isActiveInLastDays(u, 7)).length
    const admins = users.filter((u) => roleOf(u) === 'admin').length
    const locked = users.filter((u) => statusOf(u) === 'locked').length
    return { total, active, admins, locked }
  }, [users])

  return (
    <>
      <PageHead
        title="Identity & Access"
        meta={
          list.isLoading
            ? 'loading…'
            : `${kpis.total} users · ${kpis.active} active in last 7d`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={() => list.refetch()}>refresh</Btn>
            <Btn variant="primary" onClick={() => setInviteOpen(true)}>+ invite user</Btn>
          </>
        }
      />

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      {list.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/user-management</span> — values below may be stale
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="total users"
          value={list.isLoading ? '…' : String(kpis.total)}
          sub={kpis.locked > 0 ? `${kpis.locked} locked` : 'directory · live'}
          tone={kpis.locked > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="active 7d"
          value={list.isLoading ? '…' : String(kpis.active)}
          sub={kpis.total > 0 ? `${Math.round((kpis.active / kpis.total) * 100)}% of directory` : '—'}
        />
        <Kpi
          label="admins"
          value={list.isLoading ? '…' : String(kpis.admins)}
          sub="full portal access"
          tone="dim"
        />
        <Kpi
          label="tokens issued"
          value={tokensQ.isLoading ? '…' : selected ? String(tokensQ.data?.count ?? tokensQ.data?.tokens?.length ?? 0) : '—'}
          sub={selected ? `for ${selected.email.split('@')[0]}` : 'select a user'}
          tone="dim"
        />
      </KpiGrid>

      {/* List + detail: 40 / 60 split. We intentionally use a flex
          row instead of the Grid primitive — Grid's c2 is 50/50 and
          adding a c2-40-60 variant would be primitive-creep. The
          detail pane is wider since it carries the sub-tabs +
          tables. Both columns scroll independently. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(380px, 2fr) minmax(0, 3fr)',
          gap: 1,
          background: 'var(--line-1)',
          borderBottom: '1px solid var(--line-1)',
          minHeight: 0,
        }}
      >
        <div style={{ background: 'transparent', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ListPanel
            users={users}
            isLoading={list.isLoading}
            isError={list.isError}
            selectedId={selectedId}
            onSelect={(u) => {
              setSelectedId(u.id)
              // Don't reset tab on selection — admins typically want to
              // compare the same dimension (e.g. tokens) across users.
            }}
            search={search}
            onSearch={setSearch}
            roleFilter={roleFilter}
            onRoleFilter={setRoleFilter}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
          />
        </div>

        <div style={{ background: 'transparent', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {selected ? (
            <DetailPanel user={selected} tab={tab} onTabChange={setTab} />
          ) : (
            <EmptyInline pad>
              {list.isLoading ? 'loading users…' : 'select a user from the left to see details'}
            </EmptyInline>
          )}
        </div>
      </div>
    </>
  )
}

export default UserPermissionsPage
