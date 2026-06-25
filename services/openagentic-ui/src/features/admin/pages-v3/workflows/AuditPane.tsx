import * as React from 'react'
import {
  Feed,
  FeedRow,
  EmptyInline,
  SectionBar,
  Banner,
  type Status,
} from '../../primitives-v3'
import { fmtClock, fmtRelative } from './types'
import type {
  FlowAuditLogEntry,
  FlowAuditLogsResponse,
} from '../../hooks/useWorkflows'

export interface AuditPaneProps {
  query: {
    data?: FlowAuditLogsResponse
    isLoading: boolean
    isError: boolean
  }
}

function outcomeStatus(o?: string): Status {
  const s = String(o ?? '').toLowerCase()
  if (s === 'success') return 'ok'
  if (s === 'denied') return 'warn'
  if (s === 'error' || s === 'fail' || s === 'failed') return 'err'
  return 'idle'
}

export const AuditPane: React.FC<AuditPaneProps> = ({ query }) => {
  const rows: FlowAuditLogEntry[] = query.data?.logs ?? []

  return (
    <>
      <SectionBar
        title="workflow audit log"
        count={rows.length}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            /api/admin/flows/audit-logs · last 50
          </span>
        }
      />
      {query.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/flows/audit-logs</span> — endpoint
          may be unavailable on this api build
        </Banner>
      )}
      {query.isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading audit log…</EmptyInline>
      ) : rows.length === 0 ? (
        <EmptyInline pad>no workflow audit entries in the recent window.</EmptyInline>
      ) : (
        <Feed>
          {rows.map((e) => (
            <FeedRow
              key={e.id}
              ts={fmtClock(e.timestamp)}
              status={outcomeStatus(e.outcome)}
              who={e.actor ?? 'system'}
              act={
                <>
                  <span className="accent">{e.action ?? 'unknown'}</span>
                  {e.target_type && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--fg-2)' }}>
                        {e.target_type}
                        {e.target_id ? ` ${e.target_id.slice(0, 8)}` : ''}
                      </span>
                    </>
                  )}
                </>
              }
              right={fmtRelative(e.timestamp)}
            />
          ))}
        </Feed>
      )}
    </>
  )
}

export default AuditPane
