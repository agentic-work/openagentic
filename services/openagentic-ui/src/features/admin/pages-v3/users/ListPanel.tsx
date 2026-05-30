import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  FilterRow,
  Chip,
  StatusDot,
  EmptyInline,
} from '../../primitives-v3'
import type { ApiUser } from '../../hooks/useUserManagement'
import { initialsFor, relativeTimeShort, statusOf, roleOf, type UserStatus, type UserRole } from './helpers'

interface ListPanelProps {
  users: ApiUser[]
  isLoading: boolean
  isError: boolean
  selectedId: string | null
  onSelect: (user: ApiUser) => void
  search: string
  onSearch: (s: string) => void
  roleFilter: UserRole | 'all'
  onRoleFilter: (r: UserRole | 'all') => void
  statusFilter: UserStatus | 'all'
  onStatusFilter: (s: UserStatus | 'all') => void
}

export const ListPanel: React.FC<ListPanelProps> = ({
  users,
  isLoading,
  isError,
  selectedId,
  onSelect,
  search,
  onSearch,
  roleFilter,
  onRoleFilter,
  statusFilter,
  onStatusFilter,
}) => {
  // Filter pipeline — chip filters first, then text search.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter !== 'all' && roleOf(u) !== roleFilter) return false
      if (statusFilter !== 'all' && statusOf(u) !== statusFilter) return false
      if (q) {
        const hay = `${u.email} ${u.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [users, roleFilter, statusFilter, search])

  // Counts power the chip badges so admins see immediately how their
  // filter narrows the list. All sourced from the live `users` array.
  const roleCounts = React.useMemo(() => {
    const c = { admin: 0, user: 0 }
    for (const u of users) {
      const r = roleOf(u)
      if (r === 'admin') c.admin++
      else c.user++
    }
    return c
  }, [users])

  const statusCounts = React.useMemo(() => {
    const c = { active: 0, warned: 0, locked: 0 }
    for (const u of users) {
      const s = statusOf(u)
      c[s]++
    }
    return c
  }, [users])

  const cols: DtCol<ApiUser>[] = [
    {
      key: 'avatar',
      label: '',
      width: '40px',
      render: (row) => <Avatar initials={initialsFor(row)} />,
    },
    {
      key: 'name',
      label: 'name',
      className: 'name',
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{
            color: 'var(--fg-0)',
            fontSize: 'var(--v3-t-row, 12.5px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {row.name || row.email.split('@')[0]}
          </span>
          <span style={{
            color: 'var(--fg-3)',
            fontFamily: 'var(--font-v3-mono)',
            fontSize: 'var(--v3-t-meta, 11px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {row.email}
          </span>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'role',
      width: '70px',
      render: (row) => <RolePill role={roleOf(row)} />,
    },
    {
      key: 'lastSeen',
      label: 'last seen',
      className: 'mono',
      width: '80px',
      render: (row) => (
        <span style={{ color: 'var(--fg-3)' }}>
          {row.last_login_at ? relativeTimeShort(row.last_login_at) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'status',
      width: '100px',
      render: (row) => <StatusCell user={row} />,
    },
  ]

  const empty = (() => {
    if (isLoading) return <EmptyInline pad>loading…</EmptyInline>
    if (isError) return <EmptyInline pad>failed to load users — see console</EmptyInline>
    if (users.length === 0) return <EmptyInline pad>no users in directory</EmptyInline>
    return <EmptyInline pad>no users match your filter</EmptyInline>
  })()

  return (
    <Panel>
      <PanelHead
        title="Users"
        count={`${filtered.length} of ${users.length}`}
      />
      <FilterRow
        value={search}
        onSearch={onSearch}
        searchPlaceholder="search name or email…"
      >
        <Chip
          label="role"
          value="all"
          count={users.length}
          on={roleFilter === 'all'}
          onClick={() => onRoleFilter('all')}
        />
        <Chip
          label="role"
          value="admin"
          count={roleCounts.admin}
          on={roleFilter === 'admin'}
          onClick={() => onRoleFilter('admin')}
        />
        <Chip
          label="role"
          value="user"
          count={roleCounts.user}
          on={roleFilter === 'user'}
          onClick={() => onRoleFilter('user')}
        />
        <span style={{ width: 1, height: 16, background: 'var(--line-1)', margin: '0 4px' }} />
        <Chip
          label="status"
          value="all"
          on={statusFilter === 'all'}
          onClick={() => onStatusFilter('all')}
        />
        <Chip
          label="status"
          value="active"
          count={statusCounts.active}
          on={statusFilter === 'active'}
          onClick={() => onStatusFilter('active')}
        />
        <Chip
          label="status"
          value="warned"
          count={statusCounts.warned}
          on={statusFilter === 'warned'}
          onClick={() => onStatusFilter('warned')}
        />
        <Chip
          label="status"
          value="locked"
          count={statusCounts.locked}
          on={statusFilter === 'locked'}
          onClick={() => onStatusFilter('locked')}
        />
      </FilterRow>
      <Dt
        columns={cols}
        rows={filtered}
        rowKey={(u) => u.id}
        selectedKey={selectedId ?? undefined}
        onRowClick={(u) => onSelect(u)}
        empty={empty}
        rowDataAttrs={(u) => {
          const s = statusOf(u)
          return {
            status: s === 'locked' ? 'err'
              : s === 'warned' ? 'warn'
              : s === 'active' ? 'ok'
              : 'idle',
          }
        }}
      />
    </Panel>
  )
}

// ============================================================
// Tiny presentational atoms — local to ListPanel since they're
// only used here (and DetailPanel re-implements its own bigger
// avatar variant).
// ============================================================
const Avatar: React.FC<{ initials: string; size?: number }> = ({ initials, size = 24 }) => (
  <span
    aria-hidden
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'var(--bg-2)',
      border: '1px solid var(--line-1)',
      color: 'var(--fg-1)',
      fontFamily: 'var(--font-v3-mono)',
      fontSize: Math.max(9, Math.round(size * 0.42)),
      fontWeight: 600,
      letterSpacing: 0,
      textTransform: 'uppercase',
    }}
  >
    {initials}
  </span>
)

const RolePill: React.FC<{ role: UserRole }> = ({ role }) => {
  // Tokenized via accent for admin; muted for user. We do NOT hardcode
  // hex — admin tone leans on --accent so theme/accent swap repaints.
  const isAdmin = role === 'admin'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        fontFamily: 'var(--font-v3-mono)',
        fontSize: 'var(--v3-t-meta, 10px)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        border: '1px solid var(--line-1)',
        color: isAdmin ? 'var(--accent)' : 'var(--fg-2)',
        background: isAdmin ? 'var(--bg-2)' : 'transparent',
      }}
    >
      {role}
    </span>
  )
}

const StatusCell: React.FC<{ user: ApiUser }> = ({ user }) => {
  const s = statusOf(user)
  const map: Record<UserStatus, { dot: 'ok' | 'warn' | 'err'; label: string }> = {
    active: { dot: 'ok', label: 'active' },
    warned: { dot: 'warn', label: `warn ${user.scope_warning_count ?? 0}/3` },
    locked: { dot: 'err', label: 'locked' },
  }
  const v = map[s]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <StatusDot status={v.dot} />
      <span style={{
        fontFamily: 'var(--font-v3-mono)',
        fontSize: 'var(--v3-t-meta, 11px)',
        color: 'var(--fg-2)',
      }}>{v.label}</span>
    </span>
  )
}

export default ListPanel
