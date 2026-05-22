import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  EmptyInline,
  Banner,
  BarFill,
  StatusDot,
  Btn,
} from '../../primitives-v3'
import {
  type CostBudgetRow,
  fmtCents,
  fmtPct,
  budgetTone,
} from './hooks'

export interface BudgetsPaneProps {
  rows: CostBudgetRow[]
  isLoading: boolean
  isError: boolean
  onEdit?: (r: CostBudgetRow) => void
  onDelete?: (r: CostBudgetRow) => void
  actionBusy?: string | null
}

function targetOf(b: CostBudgetRow): string {
  if (b.userName) return b.userName
  if (b.userEmail) return b.userEmail
  if (b.userId) return `user:${b.userId.slice(0, 8)}`
  if (b.groupName) return b.groupName
  if (b.groupId) return `group:${b.groupId.slice(0, 8)}`
  return 'global'
}

function targetTypeOf(b: CostBudgetRow): string {
  if (b.userId || b.userName || b.userEmail) return 'user'
  if (b.groupId || b.groupName) return 'group'
  return 'global'
}

export const BudgetsPane: React.FC<BudgetsPaneProps> = ({
  rows,
  isLoading,
  isError,
  onEdit,
  onDelete,
  actionBusy,
}) => {
  const cols: DtCol<CostBudgetRow>[] = [
    {
      key: 'target',
      label: 'TARGET',
      className: 'name',
      render: (r) => (
        <>
          <div style={{ color: 'var(--fg-0)' }}>{targetOf(r)}</div>
          <div style={{ color: 'var(--fg-3)', fontSize: 10, fontFamily: 'var(--font-v3-mono)' }}>
            {targetTypeOf(r)}
          </div>
        </>
      ),
    },
    {
      key: 'period',
      label: 'PERIOD',
      className: 'mono',
      render: (r) => r.budgetType,
    },
    {
      key: 'limit',
      label: 'LIMIT',
      className: 'num',
      render: (r) => fmtCents(r.limitCents),
    },
    {
      key: 'spend',
      label: 'SPEND',
      className: 'num',
      render: (r) => fmtCents(r.currentSpendCents),
    },
    {
      key: 'usage',
      label: 'USAGE',
      width: '180px',
      render: (r) => (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 160,
            fontFamily: 'var(--font-v3-mono)',
            fontSize: 11,
          }}
        >
          <BarFill percent={r.usagePercent ?? 0} />
          <span
            style={{
              color:
                budgetTone(r.usagePercent) === 'err'
                  ? 'var(--err)'
                  : budgetTone(r.usagePercent) === 'warn'
                    ? 'var(--warn)'
                    : 'var(--fg-1)',
            }}
          >
            {fmtPct(r.usagePercent)}
          </span>
        </div>
      ),
    },
    {
      key: 'action',
      label: 'ON LIMIT',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot
            status={r.actionOnLimit === 'block' ? 'err' : r.actionOnLimit === 'throttle' ? 'warn' : 'info'}
          />
          <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
            {r.actionOnLimit}
          </span>
        </span>
      ),
    },
    ...(onEdit || onDelete
      ? ([
          {
            key: 'actions',
            label: '',
            width: '160px',
            align: 'right' as const,
            className: 'r-actions',
            render: (r: CostBudgetRow) => (
              <span
                style={{ display: 'inline-flex', gap: 4 }}
                onClick={(e) => e.stopPropagation()}
              >
                {onEdit && (
                  <Btn variant="ghost" onClick={() => onEdit(r)}>
                    edit
                  </Btn>
                )}
                {onDelete && (
                  <Btn variant="ghost" disabled={actionBusy === `bdg-del-${r.id}`} onClick={() => onDelete(r)}>
                    {actionBusy === `bdg-del-${r.id}` ? '…' : 'delete'}
                  </Btn>
                )}
              </span>
            ),
          },
        ] as DtCol<CostBudgetRow>[])
      : []),
  ]

  return (
    <>
      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/chargeback/budgets</span>
        </Banner>
      )}

      <Panel>
        <PanelHead title="cost budgets" count={isLoading ? '…' : rows.length} />
        {isLoading ? (
          <EmptyInline pad>loading /api/admin/chargeback/budgets…</EmptyInline>
        ) : rows.length === 0 ? (
          <EmptyInline pad>no budgets configured</EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            rowDataAttrs={(r: any) => {
              const spent = Number(r.spentUsd ?? r.spent ?? 0)
              const limit = Number(r.limitUsd ?? r.limit ?? 0)
              const ratio = limit > 0 ? spent / limit : 0
              return {
                status: ratio > 1 ? 'err' : ratio > 0.8 ? 'warn' : ratio > 0 ? 'ok' : 'idle',
              }
            }}
          />
        )}
      </Panel>
    </>
  )
}
