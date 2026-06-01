/**
 * ApprovalAuditLogPage — read-only, append-only viewer of the tool-call
 * audit log. GET /api/admin/audit-log (singular) from routes/admin-audit-log.ts.
 * Distinct from AuditLogsPage.tsx (plural /audit-logs activity feed).
 * All colors come from theme ColorTokens (no literals).
 */
import * as React from 'react'
import {
  PageHead,
  Panel,
  PanelHead,
  FilterRow,
  Chip,
  Feed,
  FeedRow,
  EmptyInline,
  Btn,
  StatusDot,
  type Status,
} from '../primitives-v3'
import { useAdminQuery } from '../hooks/useAdminQuery'

// ---- types mirror prisma tool_call_audit_log (snake_case) ----
interface AuditRow {
  id: string
  tool_name: string
  server_name: string | null
  args: unknown
  preview: string | null
  classification: 'READ' | 'MUTATING' | string
  decision: 'auto' | 'pending' | 'approved' | 'denied' | 'timed_out' | string
  decided_by: string | null
  decided_at: string | null
  user_id: string | null
  session_id: string | null
  origin: string
  created_at: string
}
interface AuditResponse {
  data: AuditRow[]
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean }
}

type DecisionFilter = 'all' | 'auto' | 'approved' | 'denied' | 'timed_out' | 'pending'

const DECISIONS: DecisionFilter[] = ['all', 'auto', 'approved', 'denied', 'timed_out', 'pending']

function decisionStatus(d: string): Status {
  switch (d) {
    case 'approved': return 'ok'
    case 'denied':   return 'err'
    case 'timed_out':return 'warn'
    case 'pending':  return 'info'
    case 'auto':     return 'idle'
    default:         return 'idle'
  }
}
function fmtTs(ts: string): string {
  try { return new Date(ts).toLocaleString() } catch { return ts }
}

const PAGE_SIZE = 50

export const ApprovalAuditLogPage: React.FC = () => {
  const [page, setPage] = React.useState(1)
  const [decision, setDecision] = React.useState<DecisionFilter>('all')

  const endpoint = React.useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (decision !== 'all') qs.set('decision', decision)
    return `/api/admin/audit-log?${qs.toString()}`
  }, [page, decision])

  const { data, isLoading, isError, refetch, isFetching } = useAdminQuery<AuditResponse>(
    ['approval-audit', String(page), decision],
    endpoint,
    { staleTime: 10_000 },
  )

  const rows = data?.data ?? []
  const pg = data?.pagination

  return (
    <>
      <PageHead
        title="Approval Audit Log"
        meta="append-only · read-only"
        secondaryActions={<Btn variant="ghost" onClick={() => refetch()}>refresh</Btn>}
      />

      <FilterRow>
        {DECISIONS.map(d => (
          <Chip
            key={d}
            label="decision"
            value={d}
            on={decision === d}
            onClick={() => { setDecision(d); setPage(1) }}
          />
        ))}
      </FilterRow>

      <Panel>
        <PanelHead
          title="Tool-call decisions"
          count={pg ? pg.total : undefined}
          right={isFetching ? <StatusDot status="info" /> : undefined}
        />

        {isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : isError ? (
          <EmptyInline pad>failed to load audit log</EmptyInline>
        ) : rows.length === 0 ? (
          <EmptyInline pad>no audit rows</EmptyInline>
        ) : (
          <Feed>
            {rows.map(r => (
              <FeedRow
                key={r.id}
                ts={fmtTs(r.created_at)}
                status={decisionStatus(r.decision)}
                who={r.decided_by || r.user_id || '—'}
                act={
                  <>
                    <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-1)' }}>
                      {r.tool_name}
                    </span>
                    {r.server_name && (
                      <span style={{ color: 'var(--fg-3)' }}> · {r.server_name}</span>
                    )}
                    <span style={{ color: 'var(--fg-3)' }}>
                      {' · '}{r.classification === 'MUTATING' ? 'mutating' : 'read'}
                    </span>
                  </>
                }
                right={
                  <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-2)' }}>
                    {r.decision}
                  </span>
                }
              />
            ))}
          </Feed>
        )}

        {/* Pagination (Btn-based; hidden under one page) */}
        {pg && pg.totalPages > 1 && (
          <FilterRow
            right={
              <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
                page {pg.page} of {pg.totalPages} · {pg.total} rows
              </span>
            }
          >
            <Btn disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ prev</Btn>
            <Btn disabled={!pg.hasMore} onClick={() => setPage(p => p + 1)}>next ›</Btn>
          </FilterRow>
        )}
      </Panel>
    </>
  )
}

export default ApprovalAuditLogPage
