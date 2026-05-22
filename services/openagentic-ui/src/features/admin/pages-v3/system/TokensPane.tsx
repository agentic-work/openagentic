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
import { IssueTokenModal } from './IssueTokenModal'

interface ApiTokenRow {
  id: string
  userId: string
  userName: string
  userEmail: string
  isAdmin?: boolean
  name: string
  lastUsedAt: string | null
  expiresAt: string | null
  isActive: boolean
  isExpired: boolean
  createdAt: string
  rateLimitTier?: string
}

const fmtTs = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

const tokenStatus = (r: ApiTokenRow): Status => {
  if (!r.isActive) return 'idle'
  if (r.isExpired) return 'err'
  return 'ok'
}

const tokenLabel = (r: ApiTokenRow): string => {
  if (!r.isActive) return 'revoked'
  if (r.isExpired) return 'expired'
  return 'active'
}

export const TokensPane: React.FC = () => {
  const q = useAdminQuery<{ tokens?: ApiTokenRow[]; count?: number }>(
    ['tokens', 'list'],
    '/api/admin/tokens',
    { staleTime: 60_000 },
  )
  const invalidate = useAdminInvalidate()

  const [issueOpen, setIssueOpen] = React.useState(false)
  const [pendingRevokeId, setPendingRevokeId] = React.useState<string | null>(null)
  const [revokeErr, setRevokeErr] = React.useState<string | null>(null)

  const revoke = async (tokenId: string) => {
    setRevokeErr(null)
    setPendingRevokeId(tokenId)
    try {
      const res = await apiRequest(`/api/admin/tokens/${tokenId}`, { method: 'DELETE' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${res.status} - ${text}`)
      }
      // Bust both the system-pane cache and the user-detail tokens cache.
      invalidate(['tokens'])
    } catch (err: any) {
      setRevokeErr(err?.message ?? 'failed to revoke')
    } finally {
      setPendingRevokeId(null)
    }
  }

  const tokens = q.data?.tokens ?? []
  const active = tokens.filter((t) => t.isActive && !t.isExpired)
  const cols: DtCol<ApiTokenRow>[] = [
    { key: 'name', label: 'name', className: 'name', render: (r) => r.name },
    {
      key: 'owner',
      label: 'owner',
      className: 'dim',
      render: (r) => r.userEmail || r.userName || '—',
    },
    {
      key: 'tier',
      label: 'tier',
      render: (r) => r.rateLimitTier ?? '—',
    },
    {
      key: 'status',
      label: 'status',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={tokenStatus(r)} />
          {tokenLabel(r)}
        </span>
      ),
    },
    {
      key: 'lastUsed',
      label: 'last used',
      className: 'dim',
      render: (r) => fmtTs(r.lastUsedAt),
    },
    {
      key: 'expires',
      label: 'expires',
      className: 'dim',
      render: (r) => fmtTs(r.expiresAt),
    },
    {
      key: 'revoke',
      label: 'revoke',
      className: 'r-actions',
      render: (r) => (
        r.isActive && !r.isExpired ? (
          <Btn
            variant="ghost"
            disabled={pendingRevokeId === r.id}
            onClick={() => {
              if (window.confirm(`Revoke token "${r.name}" for ${r.userEmail}?`)) {
                revoke(r.id)
              }
            }}
          >
            {pendingRevokeId === r.id ? 'revoking…' : 'revoke'}
          </Btn>
        ) : (
          <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>—</span>
        )
      ),
    },
  ]

  return (
    <>
      <IssueTokenModal open={issueOpen} onClose={() => setIssueOpen(false)} />

      {q.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/tokens</span>
        </Banner>
      )}
      {revokeErr && (
        <Banner level="err" label="error">{revokeErr}</Banner>
      )}

      <SectionBar
        title="api tokens"
        count={tokens.length}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--fg-2)' }}>
              {active.length} active · {tokens.length - active.length} inactive
            </span>
            <Btn variant="primary" onClick={() => setIssueOpen(true)}>+ issue token</Btn>
          </span>
        }
      />
      <Panel>
        <PanelHead title="tokens" count={tokens.length} />
        {q.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : q.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : tokens.length === 0 ? (
          <EmptyInline pad>no api tokens issued</EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={tokens}
            rowKey={(r) => r.id}
            rowDataAttrs={(r: any) => {
              const exp = r.expiresAt ? new Date(r.expiresAt).getTime() : null
              const now = Date.now()
              const expired = exp !== null && exp < now
              const expiringSoon = exp !== null && !expired && exp - now < 7 * 24 * 60 * 60 * 1000
              return {
                status: r.revokedAt ? 'idle'
                  : expired ? 'err'
                  : expiringSoon ? 'warn'
                  : 'ok',
              }
            }}
          />
        )}
      </Panel>
    </>
  )
}

export default TokensPane
