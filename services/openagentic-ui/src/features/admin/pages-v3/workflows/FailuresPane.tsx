import * as React from 'react'
import {
  Dt,
  type DtCol,
  Banner,
  EmptyInline,
  SectionBar,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import type { FlowsKpiData } from '../../services/flowsAdminApi'

interface FailingNodeRow {
  nodeId: string
  nodeType: string
  failureCount: number
  lastSeen?: string | null
  workflowIdsCount?: number
}

interface FailingNodesResponse {
  success: boolean
  nodes?: FailingNodeRow[]
  count?: number
}

export interface FailuresPaneProps {
  kpis: {
    data?: FlowsKpiData
    isLoading: boolean
    isError: boolean
  }
}

function fmtLastSeen(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const dt = (Date.now() - t) / 1000
  if (dt < 0) return 'in future'
  if (dt < 60) return `${Math.max(0, Math.floor(dt))}s ago`
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`
  return `${Math.floor(dt / 86400)}d ago`
}

export const FailuresPane: React.FC<FailuresPaneProps> = ({ kpis }) => {
  // Try the dedicated endpoint first; fall back to kpis.top_failing_nodes
  // when it 404s or returns empty (older builds didn't ship the route).
  const failingQ = useAdminQuery<FailingNodesResponse>(
    ['flows-failing-nodes-lastseen'],
    '/api/admin/flows/failing-nodes?limit=20&window=24h&include=lastSeen',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const dedicatedRows = failingQ.data?.nodes ?? []
  const fallbackRows = (kpis.data?.top_failing_nodes ?? []).map<FailingNodeRow>((n) => ({
    nodeId: n.nodeId,
    nodeType: n.nodeType,
    failureCount: n.failureCount,
  }))
  const rows: FailingNodeRow[] = dedicatedRows.length > 0 ? dedicatedRows : fallbackRows
  const total = rows.reduce((n, r) => n + (r.failureCount ?? 0), 0)
  const sourceLabel = dedicatedRows.length > 0 ? 'flows/failing-nodes' : 'flows/kpis'

  const cols: DtCol<FailingNodeRow>[] = [
    {
      key: 'nodeId',
      label: 'Node',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.nodeId}</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
            {r.nodeType ?? 'unknown type'}
          </span>
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Failures',
      width: '120px',
      align: 'right',
      className: 'num',
      render: (r) => (
        <span style={{ color: 'var(--err)' }}>{r.failureCount.toLocaleString()}</span>
      ),
    },
    {
      key: 'pct',
      label: '% of failures',
      width: '120px',
      align: 'right',
      className: 'num',
      render: (r) => {
        if (total <= 0) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const p = (r.failureCount / total) * 100
        return `${p.toFixed(1)}%`
      },
    },
    {
      key: 'flows',
      label: 'Flows affected',
      width: '120px',
      align: 'right',
      className: 'num',
      render: (r) =>
        r.workflowIdsCount != null
          ? r.workflowIdsCount.toLocaleString()
          : <span style={{ color: 'var(--fg-3)' }}>—</span>,
    },
    {
      key: 'last',
      label: 'Last seen',
      width: '120px',
      className: 'mono',
      render: (r) => <span style={{ color: r.lastSeen ? 'var(--fg-2)' : 'var(--fg-3)' }}>{fmtLastSeen(r.lastSeen)}</span>,
    },
  ]

  const isLoading = failingQ.isLoading && kpis.isLoading
  const isError = failingQ.isError && kpis.isError

  return (
    <>
      <SectionBar
        title="top failing nodes"
        count={rows.length}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            window 24h · /api/admin/{sourceLabel}
          </span>
        }
      />
      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/flows/failing-nodes</span> and{' '}
          <span className="accent">/api/admin/flows/kpis</span>
        </Banner>
      )}
      {isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading failures…</EmptyInline>
      ) : rows.length === 0 ? (
        <EmptyInline pad>no node failures in the selected window — all green.</EmptyInline>
      ) : (
        <div style={{ padding: '4px 14px 12px' }}>
          <Dt columns={cols} rows={rows} rowKey={(r) => r.nodeId} />
        </div>
      )}
    </>
  )
}

export default FailuresPane
