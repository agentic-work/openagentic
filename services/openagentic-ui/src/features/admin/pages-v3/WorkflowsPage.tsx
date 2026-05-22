import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  SidePanel,
  StatusDot,
} from '../primitives-v3'
import { useAdminMutation } from '../hooks/useAdminQuery'
import {
  useDashboardMetrics,
  type DashboardSummary,
} from '../hooks/useDashboardMetrics'
import {
  useAdminWorkflows,
  useAdminWorkflowStats,
  useAdminWorkflowExecutions,
  useFlowsKpis,
  useFlowAuditLogs,
  type AdminWorkflowRow,
  type AdminWorkflowExecution,
} from '../hooks/useWorkflows'
import {
  TAB_ITEMS,
  type WorkflowsTabId,
  type ExecStatusFilter,
  type WorkflowStatusFilter,
  fmtPct,
  fmtUsd,
  workflowStatusDot,
} from './workflows/types'
import { ListPane } from './workflows/ListPane'
import { ExecutionsPane } from './workflows/ExecutionsPane'
import { CostsPane } from './workflows/CostsPane'
import { FailuresPane } from './workflows/FailuresPane'
import { AuditPane } from './workflows/AuditPane'
import {
  WorkflowDetail,
  type WorkflowDetailTab,
} from './workflows/WorkflowDetail'
import { WorkflowModal } from './workflows/WorkflowModal'
import { ConfirmInline } from './shared/ConfirmInline'

const DETAIL_TABS = [
  { id: 'overview', label: 'overview' },
  { id: 'runs',     label: 'runs' },
  { id: 'cost',     label: 'cost' },
  { id: 'audit',    label: 'audit' },
]

export interface WorkflowsPageProps {
  /** Sub-tab to land on. Drives the hash-route mapping in
   * AdminPortalHostV3 — `executions` and `flow-costs` leaves both
   * render this page with the matching initial tab. */
  initialTab?: WorkflowsTabId
}

export const WorkflowsPage: React.FC<WorkflowsPageProps> = ({
  initialTab = 'workflows',
}) => {
  const [tab, setTab] = React.useState<WorkflowsTabId>(initialTab)
  React.useEffect(() => setTab(initialTab), [initialTab])

  // Workflows-tab state
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<WorkflowStatusFilter>('all')

  // Executions-tab state
  const [execSearch, setExecSearch] = React.useState('')
  const [execStatusFilter, setExecStatusFilter] = React.useState<ExecStatusFilter>('all')

  // Side panel
  const [detail, setDetail] = React.useState<AdminWorkflowRow | null>(null)
  const [pinnedExec, setPinnedExec] = React.useState<AdminWorkflowExecution | undefined>(undefined)
  const [detailTab, setDetailTab] = React.useState<WorkflowDetailTab>('overview')

  // Mutation surfaces (modals + inline-confirm + flash-notice)
  const [actionNotice, setActionNotice] = React.useState<string | null>(null)
  const [actionLevel, setActionLevel] = React.useState<'info' | 'ok' | 'warn' | 'err'>('info')
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingRow, setEditingRow] = React.useState<AdminWorkflowRow | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)

  const flash = React.useCallback((label: string, level: 'info' | 'ok' | 'warn' | 'err' = 'ok') => {
    setActionNotice(label)
    setActionLevel(level)
    window.setTimeout(() => setActionNotice(null), 4000)
  }, [])

  // PATCH /api/admin/workflows/:id (toggle is_active) — admin route
  // doesn't expose this directly so we go through the user-scoped
  // PUT /api/workflows/:id which accepts is_active. Falls back to a
  // notice if the workflow isn't owned by the admin (403).
  const toggleM = useAdminMutation<unknown, { id: string; is_active: boolean }>(
    (vars) => `/api/workflows/${encodeURIComponent(vars.id)}`,
    {
      method: 'PUT',
      bodyOf: ({ is_active }) => ({ is_active }),
      invalidateKeys: [['admin-workflows'], ['admin-workflow-stats']],
      onSuccess: (_d, vars) => flash(`workflow ${vars.is_active ? 'enabled' : 'disabled'}`, 'ok'),
      onError: (err) => flash(err.message, 'err'),
    },
  )

  const deleteM = useAdminMutation<unknown, { id: string }>(
    (vars) => `/api/admin/workflows/${encodeURIComponent(vars.id)}`,
    {
      method: 'DELETE',
      invalidateKeys: [['admin-workflows'], ['admin-workflow-stats']],
      onSuccess: () => {
        setConfirmDeleteId(null)
        setDetail(null)
        flash('workflow deleted', 'ok')
      },
      onError: (err) => flash(err.message, 'err'),
    },
  )

  // Action handlers wired below into <ListPane> + <WorkflowDetail>.
  const onNewWorkflow = React.useCallback(() => {
    setEditingRow(null)
    setModalOpen(true)
  }, [])
  const onEditWorkflow = React.useCallback((row: AdminWorkflowRow) => {
    setEditingRow(row)
    setModalOpen(true)
  }, [])
  const onToggleWorkflow = React.useCallback(
    (row: AdminWorkflowRow) => {
      const next = !(row.is_active !== false)
      toggleM.mutate({ id: row.id, is_active: next })
    },
    [toggleM],
  )
  const onDeleteWorkflow = React.useCallback((row: AdminWorkflowRow) => {
    setConfirmDeleteId(row.id)
  }, [])
  const onOpenInCanvas = React.useCallback((row: AdminWorkflowRow) => {
    window.location.href = `/workflows/${encodeURIComponent(row.id)}`
  }, [])

  // Routes the WorkflowDetail / SidePanel "edit" button through the
  // modal too, so there's exactly one form path.
  const onDetailStub = React.useCallback(
    (label: string) => {
      if (!detail) return
      if (label.startsWith('open in canvas')) onOpenInCanvas(detail)
      else if (label === 'rename / edit') onEditWorkflow(detail)
      else flash(`${label}: not yet wired`, 'info')
    },
    [detail, onOpenInCanvas, onEditWorkflow, flash],
  )

  // ============================================================
  // Hooks — every data source is real; nothing is mocked. Loading,
  // empty, and error states are wired through the panes.
  // ============================================================
  const workflows = useAdminWorkflows({
    search,
    visibility: 'all',
    limit: 50,
  })
  const stats = useAdminWorkflowStats()
  const executions = useAdminWorkflowExecutions({
    status: execStatusFilter === 'all' ? undefined : execStatusFilter,
    limit: 50,
  })
  const dash = useDashboardMetrics('24h')
  const kpis = useFlowsKpis('24h')
  const audit = useFlowAuditLogs(50)

  const summary: Partial<DashboardSummary> = dash.data?.summary ?? {}
  const list = workflows.data?.workflows ?? []
  const total = workflows.data?.total ?? list.length

  // ============================================================
  // KPI strip — sourced from /admin/workflows/stats + /admin/flows/kpis
  // (24h window) + /admin/dashboard/metrics. Each tile honors the
  // loading state independently so the row never flashes "—".
  // ============================================================
  const kpisData = kpis.data
  const totalCost24h =
    kpisData?.total_cost_usd ??
    // Fallback: dashboard metrics doesn't break out workflow cost, so we
    // surface "—" rather than a misleading total.
    null

  const failingCount = (kpisData?.top_failing_nodes ?? []).reduce(
    (n, r) => n + (r.failureCount ?? 0),
    0,
  )

  const showFailureBanner =
    !kpis.isLoading && (kpisData?.top_failing_nodes?.length ?? 0) > 0

  // Open a workflow row in the side panel.
  const openWorkflow = React.useCallback(
    (row: AdminWorkflowRow, dtab: WorkflowDetailTab = 'overview', pin?: AdminWorkflowExecution) => {
      setDetail(row)
      setDetailTab(dtab)
      setPinnedExec(pin)
    },
    [],
  )

  // Open from the Executions tab — pin the execution on the Runs sub-tab
  // and synthesize a minimal AdminWorkflowRow so the panel header reads
  // sensibly even when we don't have the full workflow row in memory.
  const openExecution = React.useCallback(
    (exec: AdminWorkflowExecution) => {
      const wf = list.find((w) => w.id === exec.workflowId)
      const row: AdminWorkflowRow =
        wf ?? {
          id: exec.workflowId,
          name: exec.workflowName,
          user: exec.user,
        }
      openWorkflow(row, 'runs', exec)
    },
    [list, openWorkflow],
  )

  return (
    <>
      <PageHead
        title="Flows"
        meta={
          <>
            <StatusDot
              status={workflowStatusDot(true, workflows.isError ? 'error' : undefined)}
            />
            <span style={{ marginLeft: 6 }}>
              {stats.isLoading
                ? 'loading…'
                : `${(stats.data?.totalWorkflows ?? total).toLocaleString()} workflows · ${(stats.data?.activeWorkflows ?? 0).toLocaleString()} active · ${(kpisData?.total_executions ?? 0).toLocaleString()} executions (24h) · ${kpisData?.success_rate != null ? fmtPct(kpisData.success_rate, 1) : '—'} success`}
            </span>
          </>
        }
        actions={
          <>
            <Btn
              variant="ghost"
              onClick={() => {
                workflows.refetch?.()
                stats.refetch?.()
                kpis.refetch?.()
              }}
            >
              refresh
            </Btn>
            <Btn variant="primary" onClick={onNewWorkflow}>
              + new workflow
            </Btn>
          </>
        }
      />

      <Subtabs items={TAB_ITEMS} active={tab} onChange={(id) => setTab(id as WorkflowsTabId)} />

      {actionNotice && (
        <Banner level={actionLevel} label={actionLevel === 'err' ? 'error' : actionLevel}>
          {actionNotice}
        </Banner>
      )}
      {confirmDeleteId && (
        <ConfirmInline
          level="err"
          confirmLabel="delete workflow"
          busy={deleteM.isPending}
          label={
            <>
              delete workflow{' '}
              <span className="accent">
                {list.find((w) => w.id === confirmDeleteId)?.name ?? confirmDeleteId.slice(0, 8)}
              </span>
              ? this is a soft-delete; runs are preserved.
            </>
          }
          onConfirm={() => deleteM.mutate({ id: confirmDeleteId })}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {showFailureBanner && (
        <Banner level="warn" label="failures">
          {failingCount.toLocaleString()} node failure{failingCount === 1 ? '' : 's'} in the last
          24h across {(kpisData?.top_failing_nodes ?? []).length} distinct node
          {kpisData?.top_failing_nodes?.length === 1 ? '' : 's'} — see the Failures tab.
        </Banner>
      )}

      <KpiStrip
        stats={stats}
        kpis={kpis}
        total={total}
        summary={summary}
        totalCost24h={totalCost24h}
      />

      {tab === 'workflows' && (
        <ListPane
          rows={list}
          isLoading={workflows.isLoading}
          isError={workflows.isError}
          total={total}
          search={search}
          onSearch={setSearch}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          selectedKey={detail?.id}
          onPick={(row) => openWorkflow(row, 'overview')}
          onToggle={onToggleWorkflow}
          onEdit={onEditWorkflow}
          onDelete={onDeleteWorkflow}
          onAdd={onNewWorkflow}
        />
      )}
      {tab === 'executions' && (
        <ExecutionsPane
          query={executions}
          search={execSearch}
          onSearch={setExecSearch}
          statusFilter={execStatusFilter}
          onStatusFilter={setExecStatusFilter}
          onPickExecution={openExecution}
        />
      )}
      {tab === 'costs' && <CostsPane kpis={kpis} />}
      {tab === 'failures' && <FailuresPane kpis={kpis} />}
      {tab === 'audit' && <AuditPane query={audit} />}

      <SidePanel
        open={detail != null}
        onClose={() => {
          setDetail(null)
          setPinnedExec(undefined)
        }}
        title={detail?.name ?? ''}
        meta={
          detail
            ? `${(detail.totalExecutions ?? 0).toLocaleString()} runs · ${detail.nodeCount ?? 0} nodes · ${detail.user?.email ?? '—'}`
            : undefined
        }
        tabs={DETAIL_TABS}
        activeTab={detailTab}
        onTabChange={(id) => setDetailTab(id as WorkflowDetailTab)}
      >
        {detail && (
          <WorkflowDetail
            row={detail}
            tab={detailTab}
            pinnedExecution={pinnedExec}
            onStub={onDetailStub}
          />
        )}
      </SidePanel>

      <WorkflowModal
        open={modalOpen}
        editing={editingRow}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => {
          flash('workflow created — opening canvas', 'ok')
          // Hard-navigate to the canvas so React Flow boots cleanly.
          window.location.href = `/workflows/${encodeURIComponent(id)}`
        }}
        onSaved={() => {
          flash('workflow saved', 'ok')
          workflows.refetch?.()
        }}
      />
    </>
  )
}

// ============================================================
// KpiStrip — page-level KPI row. Pulled out so the top-level
// component body stays under the 300-LOC budget while the JSX
// stays close to the data shapes it reads.
// ============================================================
interface KpiStripProps {
  stats: ReturnType<typeof useAdminWorkflowStats>
  kpis: ReturnType<typeof useFlowsKpis>
  total: number
  summary: Partial<DashboardSummary>
  totalCost24h: number | null
}

function KpiStrip({ stats, kpis, total, summary, totalCost24h }: KpiStripProps) {
  const k = kpis.data
  const successTone =
    k?.success_rate == null
      ? 'default'
      : k.success_rate >= 95
        ? 'ok'
        : k.success_rate >= 80
          ? 'warn'
          : 'err'
  return (
    <KpiGrid cols={5}>
      <Kpi
        label="workflows"
        value={stats.isLoading ? '…' : (stats.data?.totalWorkflows ?? total).toLocaleString()}
        sub={`${(summary.totalWorkflows ?? 0).toLocaleString()} via dashboard`}
      />
      <Kpi
        label="active"
        value={stats.isLoading ? '…' : (stats.data?.activeWorkflows ?? 0).toLocaleString()}
        sub={`${(stats.data?.publicWorkflows ?? 0).toLocaleString()} public`}
        tone="ok"
      />
      <Kpi
        label="executions (24h)"
        value={kpis.isLoading ? '…' : (k?.total_executions ?? 0).toLocaleString()}
        sub={`${(stats.data?.runningExecutions ?? 0).toLocaleString()} running now`}
      />
      <Kpi
        label="success rate"
        value={kpis.isLoading ? '…' : k?.success_rate != null ? fmtPct(k.success_rate, 1) : '—'}
        tone={successTone}
        sub={`${(stats.data?.failedExecutions ?? 0).toLocaleString()} failed (lifetime)`}
      />
      <Kpi
        label="total cost (24h)"
        value={kpis.isLoading ? '…' : fmtUsd(totalCost24h)}
        sub={
          k?.avg_cost_per_execution_usd != null
            ? `avg ${fmtUsd(k.avg_cost_per_execution_usd)} / run`
            : ''
        }
      />
    </KpiGrid>
  )
}

export default WorkflowsPage
