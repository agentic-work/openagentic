import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  EmptyInline,
  StatusDot,
  type Status,
  Banner,
} from '../../primitives-v3'
import {
  useOllamaHosts,
  type OllamaHostRow,
} from '../../hooks/useDashboardMetrics'

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'never'
  const dms = Date.now() - t
  if (dms < 60_000) return `${Math.round(dms / 1000)}s ago`
  if (dms < 3_600_000) return `${Math.round(dms / 60_000)}m ago`
  if (dms < 86_400_000) return `${Math.round(dms / 3_600_000)}h ago`
  return `${Math.round(dms / 86_400_000)}d ago`
}

function statusToken(s: string): Status {
  switch (s) {
    case 'connected': return 'ok'
    case 'disconnected': return 'err'
    default: return 'idle'
  }
}

export interface OllamaHostsPaneProps {
  /** Used in the empty-state copy; raised on mutation attempts in the parent. */
  onStub?: (label: string) => void
}

export const OllamaHostsPane: React.FC<OllamaHostsPaneProps> = () => {
  const q = useOllamaHosts()
  const rows = q.data?.hosts ?? []

  const cols: DtCol<OllamaHostRow>[] = [
    {
      key: 'status',
      label: 'Status',
      width: '110px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={statusToken(r.status)} />
          <span className="mono" style={{ color: r.status === 'connected' ? 'var(--ok)' : r.status === 'disconnected' ? 'var(--err)' : 'var(--fg-3)' }}>
            {r.status}
          </span>
        </span>
      ),
    },
    {
      key: 'name',
      label: 'Host',
      className: 'name',
      render: (r) => (
        <>
          {r.displayName || r.name}
          <span className="sub mono"> {r.host}</span>
        </>
      ),
    },
    {
      key: 'models',
      label: 'Models',
      align: 'right',
      width: '80px',
      className: 'num',
      render: (r) => r.modelCount.toLocaleString(),
    },
    {
      key: 'running',
      label: 'Running',
      align: 'right',
      width: '90px',
      className: 'num',
      render: (r) => (
        <span style={{ color: r.runningCount > 0 ? 'var(--ok)' : 'var(--fg-3)' }}>
          {r.runningCount.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'chatModel',
      label: 'Chat Model',
      className: 'mono',
      render: (r) => r.chatModel ?? <span style={{ color: 'var(--fg-3)' }}>auto</span>,
    },
    {
      key: 'priority',
      label: 'Pri',
      align: 'right',
      width: '50px',
      className: 'num',
      render: (r) => (typeof r.priority === 'number' ? String(r.priority) : '—'),
    },
    {
      key: 'lastSync',
      label: 'Last Sync',
      width: '110px',
      render: (r) => (
        <span style={{ color: r.lastSync ? 'var(--fg-1)' : 'var(--fg-3)' }}>
          {fmtAgo(r.lastSync)}
        </span>
      ),
    },
    {
      key: 'error',
      label: 'Error',
      render: (r) =>
        r.error ? (
          <span className="mono" style={{ color: 'var(--err)' }} title={r.error}>
            {r.error.length > 60 ? `${r.error.slice(0, 60)}…` : r.error}
          </span>
        ) : (
          <span style={{ color: 'var(--fg-3)' }}>—</span>
        ),
    },
  ]

  return (
    <>
      {q.isError && (
        <Banner level="warn" label="warn">
          failed to load <span className="accent">/api/admin/ollama/hosts</span> — list may be stale
        </Banner>
      )}
      <Panel>
        <PanelHead
          title="ollama hosts"
          count={
            q.isLoading
              ? '…'
              : `${rows.length} host${rows.length === 1 ? '' : 's'} · ${rows.filter((r) => r.status === 'connected').length} connected`
          }
          right={
            <span style={{ color: 'var(--fg-3)' }}>
              live probe per row · auto-refresh 60s
            </span>
          }
        />
        {q.isLoading && rows.length === 0 ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : rows.length === 0 ? (
          <EmptyInline pad>
            no Ollama providers registered — add one in{' '}
            <span className="accent">Provider Management</span> with{' '}
            <span className="accent">type=ollama</span> to get started
          </EmptyInline>
        ) : (
          <Dt<OllamaHostRow>
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            rowDataAttrs={(r) => ({
              'provider-type': 'ollama',
              status: r.enabled === false ? 'idle'
                : r.status === 'connected' ? 'ok'
                : r.status === 'disconnected' ? 'err'
                : 'idle',
            })}
          />
        )}
      </Panel>
    </>
  )
}
