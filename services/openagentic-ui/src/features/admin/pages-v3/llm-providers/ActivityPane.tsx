import * as React from 'react'
import { Panel, PanelHead, Dt, type DtCol, EmptyInline, Banner } from '../../primitives-v3'
import { fmtRel } from './types'
import {
  useAuditLogs,
  useScopedAuditLogs,
  type AuditLogEntry,
} from '../../hooks/useDashboardMetrics'

export interface ActivityPaneProps {
  /** Kept on the prop signature for backwards-compat with parent — the
   *  pane now sources its own scoped feed from /audit-logs?resourceType=
   *  rather than client-filtering the global feed. */
  auditLogs: ReturnType<typeof useAuditLogs>
}

export const ActivityPane: React.FC<ActivityPaneProps> = () => {
  // Server-side filter on resourceType = LLMProvider; much wider window
  // than the global useAuditLogs(50) and won't go empty just because the
  // most-recent admin actions don't happen to mention a provider.
  const scoped = useScopedAuditLogs({ resourceType: 'LLMProvider', limit: 200 })
  const filtered = scoped.data?.logs ?? []
  const auditLogs = scoped // alias keeps the loading/error checks below intact

  const cols: DtCol<AuditLogEntry>[] = [
    {
      key: 'ts',
      label: 'When',
      width: '110px',
      className: 'mono',
      render: (e) => <span style={{ color: 'var(--fg-3)' }}>{fmtRel(e.timestamp)}</span>,
    },
    {
      key: 'who',
      label: 'Actor',
      className: 'name',
      render: (e) => e.userName ?? e.userEmail ?? '—',
    },
    { key: 'action', label: 'Action', render: (e) => e.action ?? e.intent ?? '—' },
    {
      key: 'resource',
      label: 'Resource',
      className: 'mono',
      render: (e) => e.resourceId ?? '—',
    },
    {
      key: 'success',
      label: 'Result',
      width: '90px',
      render: (e) => (
        <span style={{ color: e.success === false ? 'var(--err)' : 'var(--ok)' }}>
          {e.success === false ? 'fail' : 'ok'}
        </span>
      ),
    },
  ]

  return (
    <Panel>
      <PanelHead
        title="Provider Activity"
        count={`${filtered.length} of ${auditLogs.data?.logs?.length ?? 0} events`}
      />
      {auditLogs.isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : auditLogs.isError ? (
        <Banner level="err" label="error">
          failed to fetch /api/admin/audit-logs
        </Banner>
      ) : filtered.length === 0 ? (
        <EmptyInline pad>
          no provider-related audit-log entries across the full history.
        </EmptyInline>
      ) : (
        <Dt<AuditLogEntry> columns={cols} rows={filtered} rowKey={(e) => e.id} />
      )}
    </Panel>
  )
}
