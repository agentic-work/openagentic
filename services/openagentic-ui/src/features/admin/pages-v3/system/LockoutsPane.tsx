import * as React from 'react'
import {
  Banner,
  Btn,
  Dt,
  type DtCol,
  EmptyInline,
  Panel,
  PanelHead,
  SectionBar,
  StatusDot,
} from '../../primitives-v3'
import { useAdminQuery, useAdminInvalidate } from '../../hooks/useAdminQuery'
import { apiRequest } from '@/utils/api'

interface LockedUser {
  id: string
  email: string
  name: string | null
  is_locked: boolean
  scope_warning_count: number
  locked_at: string | null
  locked_reason: string | null
  last_login_at: string | null
  created_at: string
}

const fmtTs = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

/**
 * The legacy endpoint sometimes returns a bare array, sometimes a
 * `{ users }` envelope (the v2 view tolerates both). Replicate that.
 */
function normalize(data: unknown): LockedUser[] {
  if (Array.isArray(data)) return data as LockedUser[]
  if (data && typeof data === 'object' && 'users' in data) {
    const u = (data as { users?: unknown }).users
    if (Array.isArray(u)) return u as LockedUser[]
  }
  return []
}

export const LockoutsPane: React.FC = () => {
  const q = useAdminQuery<unknown>(
    ['user-management', 'locked'],
    '/api/admin/user-management/locked',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
  const invalidate = useAdminInvalidate()

  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<'unlock' | 'reset' | null>(null)
  const [errMsg, setErrMsg] = React.useState<string | null>(null)

  const callMutation = async (
    userId: string,
    action: 'unlock' | 'reset-warnings',
    label: 'unlock' | 'reset',
  ) => {
    setErrMsg(null)
    setPendingId(userId)
    setPendingAction(label)
    try {
      const res = await apiRequest(`/api/admin/user-management/${userId}/${action}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${res.status} - ${text}`)
      }
      invalidate(['user-management'])
    } catch (err: any) {
      setErrMsg(err?.message ?? 'mutation failed')
    } finally {
      setPendingId(null)
      setPendingAction(null)
    }
  }

  const all = normalize(q.data)
  const locked = all.filter((u) => u.is_locked)
  const warnings = all.filter((u) => !u.is_locked && (u.scope_warning_count ?? 0) > 0)

  const lockedCols: DtCol<LockedUser>[] = [
    {
      key: 'email',
      label: 'email',
      className: 'name',
      render: (r) => r.email,
    },
    {
      key: 'name',
      label: 'name',
      className: 'dim',
      render: (r) => r.name ?? '—',
    },
    {
      key: 'reason',
      label: 'reason',
      render: (r) => r.locked_reason ?? '—',
    },
    {
      key: 'lockedAt',
      label: 'locked at',
      className: 'dim',
      render: (r) => fmtTs(r.locked_at),
    },
    {
      key: 'warnings',
      label: 'warnings',
      align: 'right',
      className: 'num',
      render: (r) => String(r.scope_warning_count ?? 0),
    },
    {
      key: 'unlock',
      label: 'unlock',
      className: 'r-actions',
      render: (r) => (
        <Btn
          variant="primary"
          disabled={pendingId === r.id}
          onClick={() => {
            if (window.confirm(`Unlock ${r.email}? This also resets the warning count.`)) {
              callMutation(r.id, 'unlock', 'unlock')
            }
          }}
        >
          {pendingId === r.id && pendingAction === 'unlock' ? 'unlocking…' : 'unlock'}
        </Btn>
      ),
    },
  ]

  const warnCols: DtCol<LockedUser>[] = [
    { key: 'email', label: 'email', className: 'name', render: (r) => r.email },
    { key: 'name', label: 'name', className: 'dim', render: (r) => r.name ?? '—' },
    {
      key: 'count',
      label: 'warnings',
      align: 'right',
      className: 'num',
      render: (r) => String(r.scope_warning_count ?? 0),
    },
    {
      key: 'lastLogin',
      label: 'last login',
      className: 'dim',
      render: (r) => fmtTs(r.last_login_at),
    },
    {
      key: 'reset',
      label: 'reset',
      className: 'r-actions',
      render: (r) => (
        <Btn
          variant="ghost"
          disabled={pendingId === r.id}
          onClick={() => {
            if (window.confirm(`Reset ${r.scope_warning_count ?? 0} warning(s) for ${r.email}?`)) {
              callMutation(r.id, 'reset-warnings', 'reset')
            }
          }}
        >
          {pendingId === r.id && pendingAction === 'reset' ? 'resetting…' : 'reset'}
        </Btn>
      ),
    },
  ]

  return (
    <div data-density="compact">
      {q.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/user-management/locked</span>
        </Banner>
      )}
      {errMsg && (
        <Banner level="err" label="error">{errMsg}</Banner>
      )}

      <SectionBar title="locked accounts" count={locked.length} />
      <Panel>
        <PanelHead
          title="locked"
          count={locked.length}
          right={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={locked.length > 0 ? 'err' : 'ok'} />
              {locked.length > 0 ? 'attention required' : 'clear'}
            </span>
          }
        />
        {q.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : q.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : locked.length === 0 ? (
          <EmptyInline pad>no locked accounts</EmptyInline>
        ) : (
          <Dt
            columns={lockedCols}
            rows={locked}
            rowKey={(r) => r.id}
            rowDataAttrs={() => ({ status: 'err' })}
          />
        )}
      </Panel>

      <SectionBar title="active warnings" count={warnings.length} />
      <Panel>
        <PanelHead title="warnings" count={warnings.length} />
        {q.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : q.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : warnings.length === 0 ? (
          <EmptyInline pad>no users carrying scope warnings</EmptyInline>
        ) : (
          <Dt
            columns={warnCols}
            rows={warnings}
            rowKey={(r) => r.id}
            rowDataAttrs={() => ({ status: 'warn' })}
          />
        )}
      </Panel>
    </div>
  )
}

export default LockoutsPane
