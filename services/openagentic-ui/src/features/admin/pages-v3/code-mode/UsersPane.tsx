import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  StatusDot,
  SidePanel,
  Banner,
  EmptyInline,
  SectionBar,
  Btn,
} from '../../primitives-v3'
import {
  useCodeModeSessions,
  type CodeModeSessionRow,
} from '../../hooks/useDashboardMetrics'
import { useAdminMutation } from '../../hooks/useAdminQuery'
import { ConfirmInline } from '../shared/ConfirmInline'

interface DerivedUser {
  userId: string
  name: string
  email: string
  sessions: number
  tokens: number
  lastActivity: string
}

function deriveUsers(sessions: CodeModeSessionRow[]): DerivedUser[] {
  const m = new Map<string, DerivedUser>()
  for (const s of sessions) {
    const ex = m.get(s.userId)
    if (ex) {
      ex.sessions += 1
      ex.tokens += s.tokenCount ?? 0
      if ((s.lastActivity ?? '') > ex.lastActivity) ex.lastActivity = s.lastActivity ?? ''
    } else {
      m.set(s.userId, {
        userId: s.userId,
        name: s.userName ?? s.userEmail ?? s.userId,
        email: s.userEmail ?? '',
        sessions: 1,
        tokens: s.tokenCount ?? 0,
        lastActivity: s.lastActivity ?? '',
      })
    }
  }
  return Array.from(m.values()).sort((a, b) => b.sessions - a.sessions)
}

const fmtRel = (iso: string | undefined): string => {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return iso
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}
const fmtNum = (n: number | undefined): string =>
  typeof n !== 'number' ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)

export interface UsersPaneProps {
  onStub: (label: string) => void
}

export const UsersPane: React.FC<UsersPaneProps> = ({ onStub: _onStub }) => {
  const q = useCodeModeSessions()
  const sessions: CodeModeSessionRow[] = q.data?.sessions ?? []
  const users = React.useMemo(() => deriveUsers(sessions), [sessions])

  const [detailId, setDetailId] = React.useState<string | null>(null)
  const detail = React.useMemo(
    () => (detailId ? sessions.find((s) => s.id === detailId) ?? null : null),
    [detailId, sessions],
  )
  const [confirmKill, setConfirmKill] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // DELETE /api/admin/code/sessions/:sessionId — graceful kill of a
  // running code-mode session. The /api/admin/code/sessions/:id/kill
  // path the spec referred to doesn't exist on this build; the canonical
  // route is the DELETE verb on the same resource.
  const killM = useAdminMutation<unknown, { id: string }>(
    (vars) => `/api/admin/code/sessions/${encodeURIComponent(vars.id)}`,
    {
      method: 'DELETE',
      invalidateKeys: [['code-mode-sessions']],
      onSuccess: () => {
        setConfirmKill(null)
        setDetailId(null)
        setError(null)
      },
      onError: (err) => setError(err.message),
    },
  )

  const sessionCols: DtCol<CodeModeSessionRow>[] = [
    {
      key: 'status',
      label: '',
      width: '24px',
      render: (r) => (
        <StatusDot
          status={
            r.status === 'running'
              ? 'ok'
              : r.status === 'error'
                ? 'err'
                : r.status === 'idle'
                  ? 'info'
                  : 'idle'
          }
        />
      ),
    },
    {
      key: 'id',
      label: 'Session',
      width: '110px',
      className: 'mono',
      render: (r) => r.id.slice(0, 8),
    },
    {
      key: 'user',
      label: 'User',
      className: 'name',
      render: (r) => r.userName ?? r.userEmail ?? r.userId,
    },
    {
      key: 'model',
      label: 'Model',
      className: 'mono',
      render: (r) => r.model ?? '—',
    },
    {
      key: 'tokens',
      label: 'Tokens',
      width: '90px',
      className: 'num',
      render: (r) => fmtNum(r.tokenCount),
    },
    {
      key: 'msgs',
      label: 'Msgs',
      width: '70px',
      className: 'num',
      render: (r) => fmtNum(r.messageCount),
    },
    {
      key: 'act',
      label: 'Last activity',
      width: '110px',
      className: 'dim',
      render: (r) => fmtRel(r.lastActivity),
    },
  ]

  const userCols: DtCol<DerivedUser>[] = [
    {
      key: 'name',
      label: 'User',
      className: 'name',
      render: (r) => (
        <>
          <div>{r.name}</div>
          {r.email && (
            <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
              {r.email}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'sessions',
      label: 'Sessions',
      width: '90px',
      className: 'num',
      render: (r) => String(r.sessions),
    },
    {
      key: 'tokens',
      label: 'Tokens',
      width: '90px',
      className: 'num',
      render: (r) => fmtNum(r.tokens),
    },
    {
      key: 'last',
      label: 'Last seen',
      width: '110px',
      className: 'dim',
      render: (r) => fmtRel(r.lastActivity),
    },
  ]

  return (
    <>
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      {confirmKill && (
        <ConfirmInline
          level="warn"
          confirmLabel="kill session"
          busy={killM.isPending}
          label={
            <>
              kill code-mode session{' '}
              <span className="accent">{confirmKill.slice(0, 8)}</span>?
              the running pod is terminated and the user is bounced back
              to the session picker.
            </>
          }
          onConfirm={() => killM.mutate({ id: confirmKill })}
          onCancel={() => setConfirmKill(null)}
        />
      )}
      <SectionBar
        title="active sessions"
        count={sessions.length}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            click a session for detail · /api/admin/code/sessions
          </span>
        }
      />
      <Panel>
        <PanelHead
          title="Sessions"
          count={`${sessions.filter((s) => s.status === 'running').length} running · ${sessions.length} total`}
        />
        {q.isLoading ? (
          <EmptyInline pad>loading /api/admin/code/sessions…</EmptyInline>
        ) : q.isError ? (
          <Banner level="err" label="error">
            failed to load <span className="accent">/api/admin/code/sessions</span>
          </Banner>
        ) : sessions.length === 0 ? (
          <EmptyInline pad>no active sessions</EmptyInline>
        ) : (
          <Dt<CodeModeSessionRow>
            columns={sessionCols}
            rows={sessions}
            rowKey={(r) => r.id}
            selectedKey={detailId ?? undefined}
            onRowClick={(r) => setDetailId(r.id)}
            rowDataAttrs={(r: any) => {
              const status = String(r.status ?? '').toLowerCase()
              return {
                status: status === 'failed' || status === 'error' ? 'err'
                  : status === 'running' || status === 'active' ? 'ok'
                  : status === 'pending' ? 'warn'
                  : 'idle',
              }
            }}
          />
        )}
      </Panel>

      <SectionBar title="per-user usage" count={users.length} />
      <Panel>
        <PanelHead title="Users" count={`${users.length} unique`} />
        {q.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : users.length === 0 ? (
          <EmptyInline pad>no users with sessions in this window</EmptyInline>
        ) : (
          <Dt<DerivedUser> columns={userCols} rows={users} rowKey={(r) => r.userId} />
        )}
      </Panel>

      <SidePanel
        open={!!detail}
        onClose={() => setDetailId(null)}
        title={detail ? `session ${detail.id.slice(0, 8)}` : ''}
        meta={detail ? `${detail.userName ?? detail.userEmail ?? detail.userId} · ${detail.model ?? '—'}` : ''}
        headActions={
          detail ? (
            <Btn variant="ghost" onClick={() => setConfirmKill(detail.id)}>
              kill
            </Btn>
          ) : null
        }
      >
        {detail && (
          <div style={{ display: 'grid', gap: 12 }}>
            <KV label="status" value={detail.status} />
            <KV label="model" value={detail.model ?? '—'} mono />
            <KV label="user" value={detail.userName ?? detail.userEmail ?? detail.userId} />
            <KV label="email" value={detail.userEmail ?? '—'} mono />
            <KV label="created" value={detail.createdAt ? new Date(detail.createdAt).toUTCString() : '—'} mono />
            <KV label="last activity" value={detail.lastActivity ? new Date(detail.lastActivity).toUTCString() : '—'} mono />
            <KV label="tokens" value={fmtNum(detail.tokenCount)} />
            <KV label="messages" value={fmtNum(detail.messageCount)} />
            <KV label="storage" value={typeof detail.storageMB === 'number' ? `${detail.storageMB.toFixed(1)} MB` : '—'} />
          </div>
        )}
      </SidePanel>
    </>
  )
}

const KV: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
    <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {label}
    </span>
    <span
      style={{
        color: 'var(--fg-1)',
        fontFamily: mono ? 'var(--font-v3-mono)' : undefined,
        textAlign: 'right',
        wordBreak: 'break-all',
      }}
    >
      {value}
    </span>
  </div>
)
