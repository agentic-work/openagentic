import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  EmptyInline,
  SidePanel,
} from '../primitives-v3'
import { OverviewPane } from './chargeback/OverviewPane'
import { BudgetsPane } from './chargeback/BudgetsPane'
import { ReportsPane } from './chargeback/ReportsPane'
import { InsightsPane } from './chargeback/InsightsPane'
import { ReportDetail } from './chargeback/ReportDetail'
import { BudgetModal, type BudgetModalMode, type BudgetPayload } from './chargeback/BudgetModal'
import { GenerateReportModal, type GenerateReportPayload } from './chargeback/GenerateReportModal'
import { apiRequest } from '@/utils/api'
import {
  useChargebackBudgets,
  useChargebackReports,
  useChargebackGroups,
  useChargebackUsage,
  useChargebackDashboard,
  unwrapArray,
  fmtUsd,
  fmtPct,
  budgetTone,
  type CostBudgetRow,
  type ChargebackReportRow,
  type ChargebackGroupRow,
} from './chargeback/hooks'

export type ChargebackTab = 'overview' | 'budgets' | 'reports' | 'insights'

const TAB_ORDER: ChargebackTab[] = ['overview', 'budgets', 'reports', 'insights']

const TABS = [
  { id: 'overview', label: 'overview' },
  { id: 'budgets', label: 'budgets' },
  { id: 'reports', label: 'reports' },
  { id: 'insights', label: 'insights' },
]

export interface ChargebackPageProps {
  initialTab?: ChargebackTab | string
}

export const ChargebackPage: React.FC<ChargebackPageProps> = ({ initialTab = 'overview' }) => {
  const safeInitial: ChargebackTab = (TAB_ORDER as string[]).includes(initialTab as string)
    ? (initialTab as ChargebackTab)
    : 'overview'

  const [tab, setTab] = React.useState<ChargebackTab>(safeInitial)
  const [toast, setToast] = React.useState<{ level: 'ok' | 'err' | 'info'; msg: string } | null>(null)
  const [reportDetail, setReportDetail] = React.useState<ChargebackReportRow | null>(null)

  // Mutation state
  const [budgetModal, setBudgetModal] = React.useState<{ open: boolean; mode: BudgetModalMode; initial: CostBudgetRow | null }>(
    { open: false, mode: 'create', initial: null },
  )
  const [budgetBusy, setBudgetBusy] = React.useState(false)
  const [budgetError, setBudgetError] = React.useState<string | null>(null)
  const [reportModalOpen, setReportModalOpen] = React.useState(false)
  const [reportBusy, setReportBusy] = React.useState(false)
  const [reportError, setReportError] = React.useState<string | null>(null)
  const [actionBusy, setActionBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    setTab(safeInitial)
  }, [safeInitial])

  const showToast = React.useCallback((level: 'ok' | 'err' | 'info', msg: string) => {
    setToast({ level, msg })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  // Top-level queries — every pane reads from these via React Query
  // dedupe so we never double-fetch on tab switch.
  const budgetsQ = useChargebackBudgets()
  const reportsQ = useChargebackReports()
  const groupsQ = useChargebackGroups()
  const usageQ = useChargebackUsage()
  const dashboardQ = useChargebackDashboard('30d')

  const budgets: CostBudgetRow[] = React.useMemo(
    () => unwrapArray(budgetsQ.data, 'budgets'),
    [budgetsQ.data],
  )
  const reports: ChargebackReportRow[] = React.useMemo(
    () => unwrapArray(reportsQ.data, 'reports'),
    [reportsQ.data],
  )
  const groups: ChargebackGroupRow[] = React.useMemo(
    () => unwrapArray(groupsQ.data, 'groups'),
    [groupsQ.data],
  )

  const usage = usageQ.data
  const dashboard = dashboardQ.data

  // ------------------------------------------------------------
  // Cross-section KPIs
  // ------------------------------------------------------------

  // Total spend MTD = chargeback usage if available, else dashboard summary.
  const totalSpendMtd = React.useMemo(() => {
    if (typeof usage?.totalCost === 'number') return usage.totalCost
    if (typeof dashboard?.summary?.totalCost === 'number') return dashboard.summary.totalCost
    return 0
  }, [usage, dashboard])

  // Total spend last 24h — taken from chargeback/usage if scoped 24h,
  // else the dashboard summary (which we requested as 30d, so we treat
  // its totalCost as MTD too — we can't lie about a 24h-only number).
  // The KPI label clarifies "spend (mtd)" so operators don't conflate.
  const perUserAvg = React.useMemo(() => {
    const users = usage?.byUser ?? dashboard?.perUserUsage ?? []
    if (users.length === 0) return 0
    const sum = users.reduce<number>((a, u) => a + ((u as any).cost ?? 0), 0)
    return sum / users.length
  }, [usage, dashboard])

  const perTeamAvg = React.useMemo(() => {
    const list = usage?.byGroup ?? []
    if (list.length === 0) return 0
    const sum = list.reduce<number>((a, g) => a + (g.cost ?? 0), 0)
    return sum / list.length
  }, [usage])

  const topModel = React.useMemo<{ model: string; cost: number } | null>(() => {
    const map = usage?.byModel
    if (map && Object.keys(map).length > 0) {
      const sorted = Object.entries(map).sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
      return { model: sorted[0][0], cost: sorted[0][1] ?? 0 }
    }
    const arr = dashboard?.modelUsage
    if (arr && arr.length > 0) {
      const sorted = [...arr].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      return { model: sorted[0].model, cost: sorted[0].cost ?? 0 }
    }
    return null
  }, [usage, dashboard])

  // Budget remaining = sum of (limit - spend) across all budgets, in cents.
  const budgetRemaining = React.useMemo(() => {
    if (budgets.length === 0) return null
    const remCents = budgets.reduce<number>(
      (a, b) => a + Math.max(0, (b.limitCents ?? 0) - (b.currentSpendCents ?? 0)),
      0,
    )
    return remCents / 100
  }, [budgets])

  const avgBudgetUsage = React.useMemo(() => {
    if (budgets.length === 0) return null
    return (
      budgets.reduce<number>((a, b) => a + (b.usagePercent ?? 0), 0) / budgets.length
    )
  }, [budgets])

  const isLoadingAny =
    budgetsQ.isLoading ||
    reportsQ.isLoading ||
    groupsQ.isLoading ||
    usageQ.isLoading ||
    dashboardQ.isLoading

  const metaLine = isLoadingAny
    ? 'loading…'
    : `${fmtUsd(totalSpendMtd)} mtd · ${budgets.length} budgets · ${reports.length} reports · ${groups.length} groups`

  const onRefresh = () => {
    budgetsQ.refetch?.()
    reportsQ.refetch?.()
    groupsQ.refetch?.()
    usageQ.refetch?.()
    dashboardQ.refetch?.()
  }

  // ------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------
  const onBudgetSubmit = React.useCallback(
    async (payload: BudgetPayload, mode: BudgetModalMode) => {
      setBudgetBusy(true)
      setBudgetError(null)
      try {
        const url =
          mode === 'edit' && payload.id
            ? `/api/admin/chargeback/budgets/${encodeURIComponent(payload.id)}`
            : '/api/admin/chargeback/budgets'
        const resp = await apiRequest(url, {
          method: mode === 'edit' ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`${mode === 'edit' ? 'PUT' : 'POST'} failed: ${resp.status} ${txt}`)
        }
        showToast('ok', mode === 'edit' ? 'budget saved' : 'budget created')
        setBudgetModal({ open: false, mode: 'create', initial: null })
        budgetsQ.refetch?.()
      } catch (err: any) {
        setBudgetError(err?.message ?? 'submit failed')
      } finally {
        setBudgetBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onBudgetDelete = React.useCallback(
    async (row: CostBudgetRow) => {
      if (!confirm(`Delete budget ${row.id.slice(0, 8)}? Spend tracking continues but no limits will fire.`)) return
      setActionBusy(`bdg-del-${row.id}`)
      try {
        const resp = await apiRequest(
          `/api/admin/chargeback/budgets/${encodeURIComponent(row.id)}`,
          { method: 'DELETE' },
        )
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`DELETE failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `budget ${row.id.slice(0, 8)} deleted`)
        budgetsQ.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'delete failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onReportGenerate = React.useCallback(
    async (payload: GenerateReportPayload) => {
      setReportBusy(true)
      setReportError(null)
      try {
        const resp = await apiRequest('/api/admin/chargeback/reports/generate', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`generate failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `report for ${payload.report_period} generated`)
        setReportModalOpen(false)
        reportsQ.refetch?.()
      } catch (err: any) {
        setReportError(err?.message ?? 'generate failed')
      } finally {
        setReportBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onReportAdvanceStatus = React.useCallback(
    async (row: ChargebackReportRow) => {
      // The new server-side state machine accepts:
      //   pending → approved → paid   OR   pending → rejected
      // Map legacy DB statuses (draft/generated/finalized/exported) onto
      // 'pending' so the operator's "advance" button still moves the
      // report forward from any starting point. Terminal states block
      // further advances.
      const cur = row.status as string
      let next: 'approved' | 'paid' | 'rejected' | null = null
      if (cur === 'pending' || cur === 'draft' || cur === 'generated') {
        next = 'approved'
      } else if (cur === 'approved' || cur === 'finalized' || cur === 'exported') {
        next = 'paid'
      }
      if (!next) {
        showToast('err', `report already in terminal state "${cur}"`)
        return
      }
      if (!confirm(`Advance report ${row.id.slice(0, 8)} from ${cur} → ${next}?`)) return
      setActionBusy(`rpt-adv-${row.id}`)
      try {
        const resp = await apiRequest(`/api/admin/chargeback/reports/${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: next }),
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`PATCH failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `status → ${next}`)
        reportsQ.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'advance failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onExportCsv = React.useCallback(() => {
    // CSV export uses an anchor download — no API call needed.
    const url = '/api/admin/chargeback/usage?format=csv'
    const a = document.createElement('a')
    a.href = url
    a.download = `chargeback-usage-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    showToast('ok', 'csv export started')
  }, [showToast])

  const onExportReportPdf = React.useCallback(
    (row: ChargebackReportRow) => {
      // Server typically returns a generated PDF for download from the report
      // detail endpoint — anchor-based download keeps the browser in charge.
      const url = `/api/admin/chargeback/reports/${encodeURIComponent(row.id)}/export?format=pdf`
      const a = document.createElement('a')
      a.href = url
      a.download = `chargeback-${row.period}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      showToast('ok', 'pdf download started')
    },
    [showToast],
  )

  return (
    <>
      <PageHead
        title="Cost Management"
        meta={metaLine}
        actions={
          <>
            <Btn variant="ghost" onClick={onRefresh}>refresh</Btn>
            {tab === 'budgets' && (
              <Btn
                variant="primary"
                onClick={() => {
                  setBudgetError(null)
                  setBudgetModal({ open: true, mode: 'create', initial: null })
                }}
              >
                + new budget
              </Btn>
            )}
            {tab === 'reports' && (
              <Btn
                variant="primary"
                onClick={() => {
                  setReportError(null)
                  setReportModalOpen(true)
                }}
              >
                + generate report
              </Btn>
            )}
            <Btn variant="ghost" onClick={onExportCsv}>
              export csv
            </Btn>
          </>
        }
      />
      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as ChargebackTab)} />

      {toast && (
        <Banner level={toast.level} label={toast.level === 'err' ? 'error' : toast.level === 'ok' ? 'ok' : 'info'}>
          {toast.msg}
        </Banner>
      )}

      <KpiGrid cols={5}>
        <Kpi
          label="spend (mtd)"
          value={dashboardQ.isLoading || usageQ.isLoading ? '…' : fmtUsd(totalSpendMtd)}
          sub="month-to-date · usage + dashboard"
        />
        <Kpi
          label="per-user avg"
          value={
            dashboardQ.isLoading || usageQ.isLoading
              ? '…'
              : perUserAvg > 0
                ? fmtUsd(perUserAvg)
                : '—'
          }
          sub={`${(usage?.byUser ?? dashboard?.perUserUsage ?? []).length} users`}
        />
        <Kpi
          label="per-team avg"
          value={usageQ.isLoading ? '…' : perTeamAvg > 0 ? fmtUsd(perTeamAvg) : '—'}
          sub={`${(usage?.byGroup ?? []).length} groups`}
        />
        <Kpi
          label="top model"
          value={
            usageQ.isLoading || dashboardQ.isLoading
              ? '…'
              : topModel
                ? topModel.model.length > 18
                  ? `${topModel.model.slice(0, 17)}…`
                  : topModel.model
                : '—'
          }
          sub={topModel ? fmtUsd(topModel.cost) : 'no data'}
        />
        <Kpi
          label="budget remaining"
          value={
            budgetsQ.isLoading
              ? '…'
              : budgetRemaining === null
                ? '—'
                : fmtUsd(budgetRemaining)
          }
          sub={
            avgBudgetUsage === null
              ? 'no budgets configured'
              : `avg ${fmtPct(avgBudgetUsage)} used`
          }
          tone={budgetTone(avgBudgetUsage ?? undefined)}
        />
      </KpiGrid>

      {tab === 'overview' && (
        <OverviewPane
          usage={usage}
          usageLoading={usageQ.isLoading}
          usageError={usageQ.isError}
          dashboard={dashboard}
          dashboardLoading={dashboardQ.isLoading}
          dashboardError={dashboardQ.isError}
        />
      )}

      {tab === 'budgets' && (
        <BudgetsPane
          rows={budgets}
          isLoading={budgetsQ.isLoading}
          isError={budgetsQ.isError}
          onEdit={(r) => {
            setBudgetError(null)
            setBudgetModal({ open: true, mode: 'edit', initial: r })
          }}
          onDelete={onBudgetDelete}
          actionBusy={actionBusy}
        />
      )}

      {tab === 'reports' && (
        <ReportsPane
          rows={reports}
          isLoading={reportsQ.isLoading}
          isError={reportsQ.isError}
          onOpen={setReportDetail}
          selectedId={reportDetail?.id}
        />
      )}

      {tab === 'insights' && (
        <InsightsPane
          usage={usage}
          usageLoading={usageQ.isLoading}
          usageError={usageQ.isError}
          dashboard={dashboard}
          budgets={budgets}
          groups={groups}
        />
      )}

      {!TAB_ORDER.includes(tab) && (
        <EmptyInline pad>unknown sub-tab: {String(tab)}</EmptyInline>
      )}

      <SidePanel
        open={!!reportDetail}
        onClose={() => setReportDetail(null)}
        title={reportDetail ? `${reportDetail.period} report` : ''}
        meta={
          reportDetail
            ? `${reportDetail.status} · ${fmtUsd(reportDetail.totalCost)}`
            : ''
        }
        headActions={
          reportDetail ? (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <Btn variant="ghost" onClick={() => onExportReportPdf(reportDetail)}>
                pdf
              </Btn>
              {reportDetail.status !== 'paid' && (
                <Btn
                  variant="primary"
                  onClick={() => onReportAdvanceStatus(reportDetail)}
                  disabled={actionBusy === `rpt-adv-${reportDetail.id}`}
                >
                  {actionBusy === `rpt-adv-${reportDetail.id}` ? 'advancing…' : 'advance'}
                </Btn>
              )}
            </span>
          ) : null
        }
      >
        {reportDetail && <ReportDetail row={reportDetail} />}
      </SidePanel>

      <BudgetModal
        open={budgetModal.open}
        mode={budgetModal.mode}
        initial={budgetModal.initial}
        onClose={() => setBudgetModal({ open: false, mode: 'create', initial: null })}
        onSubmit={onBudgetSubmit}
        isSubmitting={budgetBusy}
        error={budgetError}
      />

      <GenerateReportModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        onSubmit={onReportGenerate}
        isSubmitting={reportBusy}
        error={reportError}
      />
    </>
  )
}

export default ChargebackPage
