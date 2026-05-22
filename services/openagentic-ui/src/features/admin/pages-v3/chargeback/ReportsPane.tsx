import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  EmptyInline,
  Banner,
  StatusDot,
  type Status,
} from '../../primitives-v3'
import {
  type ChargebackReportRow,
  type ReportStatus,
  fmtUsd,
  fmtNum,
  fmtDate,
} from './hooks'

function statusToDot(s: ReportStatus): Status {
  switch (s) {
    case 'paid':
      return 'ok'
    case 'finalized':
    case 'exported':
      return 'info'
    case 'draft':
      return 'idle'
    default:
      return 'idle'
  }
}

function targetLabel(r: ChargebackReportRow): string {
  if (r.userName) return r.userName
  if (r.userEmail) return r.userEmail
  if (r.userId) return `user:${r.userId.slice(0, 8)}`
  if (r.groupName) return r.groupName
  if (r.groupId) return `group:${r.groupId.slice(0, 8)}`
  return 'all'
}

export interface ReportsPaneProps {
  rows: ChargebackReportRow[]
  isLoading: boolean
  isError: boolean
  onOpen: (row: ChargebackReportRow) => void
  selectedId?: string
}

export const ReportsPane: React.FC<ReportsPaneProps> = ({
  rows,
  isLoading,
  isError,
  onOpen,
  selectedId,
}) => {
  const cols: DtCol<ChargebackReportRow>[] = [
    {
      key: 'period',
      label: 'PERIOD',
      className: 'mono',
      render: (r) => r.period,
    },
    {
      key: 'target',
      label: 'TARGET',
      className: 'name',
      render: (r) => targetLabel(r),
    },
    {
      key: 'status',
      label: 'STATUS',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={statusToDot(r.status)} />
          <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>{r.status}</span>
        </span>
      ),
    },
    {
      key: 'req',
      label: 'REQUESTS',
      className: 'num',
      render: (r) => fmtNum(r.requestCount),
    },
    {
      key: 'tokens',
      label: 'TOKENS',
      className: 'num',
      render: (r) =>
        fmtNum(
          (r.totalInputTokens ?? 0) +
            (r.totalOutputTokens ?? 0) +
            (r.totalCachedTokens ?? 0) +
            (r.totalThinkingTokens ?? 0),
        ),
    },
    {
      key: 'cost',
      label: 'COST',
      className: 'num',
      render: (r) => fmtUsd(r.totalCost),
    },
    {
      key: 'created',
      label: 'CREATED',
      className: 'dim',
      render: (r) => fmtDate(r.createdAt),
    },
  ]

  return (
    <>
      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/chargeback/reports</span>
        </Banner>
      )}

      <Panel>
        <PanelHead
          title="chargeback reports"
          count={isLoading ? '…' : rows.length}
          right={
            <span style={{ color: 'var(--fg-3)' }}>
              double-click for breakdown · pdf export pending
            </span>
          }
        />
        {isLoading ? (
          <EmptyInline pad>loading /api/admin/chargeback/reports…</EmptyInline>
        ) : rows.length === 0 ? (
          <EmptyInline pad>no chargeback reports generated yet</EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            selectedKey={selectedId}
            onRowClick={onOpen}
            onRowDoubleClick={onOpen}
            rowDataAttrs={(r: any) => {
              const status = String(r.status ?? '').toLowerCase()
              return {
                status: status === 'failed' || status === 'error' ? 'err'
                  : status === 'pending' || status === 'generating' ? 'warn'
                  : status === 'completed' || status === 'ready' ? 'ok'
                  : 'idle',
              }
            }}
          />
        )}
      </Panel>
    </>
  )
}
