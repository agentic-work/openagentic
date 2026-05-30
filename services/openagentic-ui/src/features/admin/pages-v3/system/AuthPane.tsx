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
  type Status,
} from '../../primitives-v3'
import { useAdminQuery, useAdminInvalidate } from '../../hooks/useAdminQuery'
import { apiRequest } from '@/utils/api'
import { EditAuthPolicyModal } from './EditAuthPolicyModal'

interface AllowedUser {
  id: string
  email: string
  is_admin: boolean
  display_name: string | null
  is_active: boolean
  created_at: string
}

interface AllowedDomain {
  id: string
  domain: string
  is_admin_domain: boolean
  is_active: boolean
  created_at: string
}

interface AccessRequest {
  id: string
  email: string
  name: string | null
  hosted_domain: string | null
  status: 'pending' | 'approved' | 'denied'
  created_at: string
}

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return '—'
  }
}

const reqStatus = (s: string): Status =>
  s === 'pending' ? 'warn' : s === 'approved' ? 'ok' : s === 'denied' ? 'err' : 'idle'

export const AuthPane: React.FC = () => {
  const usersQ = useAdminQuery<{ users?: AllowedUser[] }>(
    ['auth', 'users'],
    '/api/admin/auth/users',
    { staleTime: 60_000 },
  )
  const domainsQ = useAdminQuery<{ domains?: AllowedDomain[] }>(
    ['auth', 'domains'],
    '/api/admin/auth/domains',
    { staleTime: 60_000 },
  )
  const requestsQ = useAdminQuery<{ requests?: AccessRequest[] }>(
    ['auth', 'access-requests'],
    '/api/admin/auth/access-requests',
    { staleTime: 30_000 },
  )

  const users = usersQ.data?.users ?? []
  const domains = domainsQ.data?.domains ?? []
  const requests = requestsQ.data?.requests ?? []
  const pending = requests.filter((r) => r.status === 'pending')

  const invalidate = useAdminInvalidate()
  const [addModal, setAddModal] = React.useState<'user' | 'domain' | null>(null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [errMsg, setErrMsg] = React.useState<string | null>(null)

  const callMutation = async (
    method: 'POST' | 'DELETE',
    path: string,
    body?: any,
    invalidateKey: string[] = ['auth'],
  ) => {
    setErrMsg(null)
    try {
      const res = await apiRequest(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${method} ${path} → ${res.status} ${text}`)
      }
      invalidate(invalidateKey)
    } catch (err: any) {
      setErrMsg(err?.message ?? 'mutation failed')
    } finally {
      setPendingId(null)
    }
  }

  const removeUser = async (id: string, email: string) => {
    if (!window.confirm(`Remove ${email} from the auth allow-list?`)) return
    setPendingId(id)
    await callMutation('DELETE', `/api/admin/auth/users/${id}`, undefined, ['auth', 'users'])
  }

  const removeDomain = async (id: string, domain: string) => {
    if (!window.confirm(`Remove @${domain} from the allowed-domain list?`)) return
    setPendingId(id)
    await callMutation('DELETE', `/api/admin/auth/domains/${id}`, undefined, ['auth', 'domains'])
  }

  const approveRequest = async (id: string, email: string, isAdmin: boolean) => {
    setPendingId(id)
    await callMutation('POST', `/api/admin/auth/access-requests/${id}/approve`, { is_admin: isAdmin }, ['auth'])
  }

  const denyRequest = async (id: string, email: string) => {
    if (!window.confirm(`Deny access request from ${email}?`)) return
    setPendingId(id)
    await callMutation('POST', `/api/admin/auth/access-requests/${id}/deny`, {}, ['auth'])
  }

  const userCols: DtCol<AllowedUser>[] = [
    { key: 'email', label: 'email', className: 'name', render: (r) => r.email },
    {
      key: 'name',
      label: 'display name',
      className: 'dim',
      render: (r) => r.display_name ?? '—',
    },
    {
      key: 'role',
      label: 'role',
      render: (r) => (r.is_admin ? <span className="accent">admin</span> : 'user'),
    },
    {
      key: 'status',
      label: 'status',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={r.is_active ? 'ok' : 'err'} />
          {r.is_active ? 'active' : 'inactive'}
        </span>
      ),
    },
    {
      key: 'added',
      label: 'added',
      className: 'dim',
      render: (r) => fmtDate(r.created_at),
    },
    {
      key: 'remove',
      label: 'remove',
      className: 'r-actions',
      render: (r) => (
        <Btn
          variant="ghost"
          disabled={pendingId === r.id}
          onClick={() => removeUser(r.id, r.email)}
        >
          {pendingId === r.id ? '…' : 'remove'}
        </Btn>
      ),
    },
  ]

  const domainCols: DtCol<AllowedDomain>[] = [
    {
      key: 'domain',
      label: 'domain',
      className: 'mono',
      render: (r) => `@${r.domain}`,
    },
    {
      key: 'admin',
      label: 'admin domain',
      render: (r) =>
        r.is_admin_domain ? <span className="accent">all admins</span> : 'users only',
    },
    {
      key: 'status',
      label: 'status',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={r.is_active ? 'ok' : 'err'} />
          {r.is_active ? 'active' : 'inactive'}
        </span>
      ),
    },
    {
      key: 'added',
      label: 'added',
      className: 'dim',
      render: (r) => fmtDate(r.created_at),
    },
    {
      key: 'remove',
      label: 'remove',
      className: 'r-actions',
      render: (r) => (
        <Btn
          variant="ghost"
          disabled={pendingId === r.id}
          onClick={() => removeDomain(r.id, r.domain)}
        >
          {pendingId === r.id ? '…' : 'remove'}
        </Btn>
      ),
    },
  ]

  const reqCols: DtCol<AccessRequest>[] = [
    { key: 'email', label: 'email', className: 'name', render: (r) => r.email },
    { key: 'name', label: 'name', className: 'dim', render: (r) => r.name ?? '—' },
    {
      key: 'domain',
      label: 'domain',
      className: 'mono',
      render: (r) => r.hosted_domain ?? '—',
    },
    {
      key: 'status',
      label: 'status',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={reqStatus(r.status)} />
          {r.status}
        </span>
      ),
    },
    {
      key: 'requested',
      label: 'requested',
      className: 'dim',
      render: (r) => fmtDate(r.created_at),
    },
    {
      key: 'actions',
      label: 'actions',
      className: 'r-actions',
      render: (r) => (
        r.status === 'pending' ? (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Btn
              variant="primary"
              disabled={pendingId === r.id}
              onClick={() => approveRequest(r.id, r.email, false)}
            >
              {pendingId === r.id ? '…' : 'approve'}
            </Btn>
            <Btn
              variant="ghost"
              disabled={pendingId === r.id}
              onClick={() => denyRequest(r.id, r.email)}
            >
              deny
            </Btn>
          </span>
        ) : (
          <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>—</span>
        )
      ),
    },
  ]

  return (
    <>
      <EditAuthPolicyModal
        open={addModal !== null}
        mode={addModal ?? 'user'}
        onClose={() => setAddModal(null)}
      />

      {(usersQ.isError || domainsQ.isError || requestsQ.isError) && (
        <Banner level="warn" label="warn">
          one or more <span className="accent">/api/admin/auth/*</span> endpoints unreachable —
          rows shown reflect partial data
        </Banner>
      )}
      {errMsg && (
        <Banner level="err" label="error">{errMsg}</Banner>
      )}

      <SectionBar
        title="allowed users"
        count={users.length}
        right={<Btn variant="primary" onClick={() => setAddModal('user')}>+ add user</Btn>}
      />
      <Panel>
        <PanelHead title="users" count={users.length} />
        {usersQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : usersQ.isError ? (
          <EmptyInline pad>failed to fetch /api/admin/auth/users</EmptyInline>
        ) : users.length === 0 ? (
          <EmptyInline pad>no allowed users configured</EmptyInline>
        ) : (
          <Dt columns={userCols} rows={users} rowKey={(r) => r.id} />
        )}
      </Panel>

      <SectionBar
        title="allowed domains"
        count={domains.length}
        right={<Btn variant="primary" onClick={() => setAddModal('domain')}>+ add domain</Btn>}
      />
      <Panel>
        <PanelHead title="domains" count={domains.length} />
        {domainsQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : domainsQ.isError ? (
          <EmptyInline pad>failed to fetch /api/admin/auth/domains</EmptyInline>
        ) : domains.length === 0 ? (
          <EmptyInline pad>no allowed domains configured</EmptyInline>
        ) : (
          <Dt columns={domainCols} rows={domains} rowKey={(r) => r.id} />
        )}
      </Panel>

      <SectionBar title="access requests" count={pending.length} />
      <Panel>
        <PanelHead
          title="requests"
          count={`${pending.length} pending · ${requests.length} total`}
        />
        {requestsQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : requestsQ.isError ? (
          <EmptyInline pad>failed to fetch /api/admin/auth/access-requests</EmptyInline>
        ) : requests.length === 0 ? (
          <EmptyInline pad>no access requests on file</EmptyInline>
        ) : (
          <Dt columns={reqCols} rows={requests} rowKey={(r) => r.id} />
        )}
      </Panel>
    </>
  )
}

export default AuthPane
