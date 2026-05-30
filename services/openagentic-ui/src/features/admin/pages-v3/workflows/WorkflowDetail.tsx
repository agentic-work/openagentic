import * as React from 'react'
import {
  SectionBar,
  Dt,
  type DtCol,
  StatusDot,
  Feed,
  FeedRow,
  Banner,
  EmptyInline,
  Kpi,
  KpiGrid,
  Btn,
  type Status,
} from '../../primitives-v3'
import {
  useAdminWorkflowRuns,
  useFlowsKpis,
  useFlowAuditLogs,
  type AdminWorkflowRow,
  type AdminWorkflowExecution,
  type FlowAuditLogEntry,
} from '../../hooks/useWorkflows'
import {
  fmtClock,
  fmtDuration,
  fmtRelative,
  fmtUsd,
  fmtPct,
  successRate,
  execStatusDot,
  workflowStatusDot,
} from './types'

export type WorkflowDetailTab = 'overview' | 'runs' | 'cost' | 'audit'

export interface WorkflowDetailProps {
  row: AdminWorkflowRow
  tab: WorkflowDetailTab
  /** When the panel was opened via an Executions-tab row, the parent
   * passes the originating execution so the Runs tab can highlight it
   * and scroll it into view. Optional. */
  pinnedExecution?: AdminWorkflowExecution
  onStub: (label: string) => void
}

export const WorkflowDetail: React.FC<WorkflowDetailProps> = ({
  row,
  tab,
  pinnedExecution,
  onStub,
}) => {
  if (tab === 'overview') return <OverviewTab row={row} onStub={onStub} />
  if (tab === 'runs')     return <RunsTab row={row} pinnedExecution={pinnedExecution} />
  if (tab === 'cost')     return <CostTab row={row} />
  if (tab === 'audit')    return <AuditTab row={row} />
  return null
}

// ============================================================
// Overview tab
// ============================================================
const OverviewTab: React.FC<{ row: AdminWorkflowRow; onStub: (l: string) => void }> = ({
  row,
  onStub,
}) => {
  const active = row.is_active !== false
  const sr = successRate(row.successfulExecutions, row.totalExecutions)
  const meta: Array<[string, React.ReactNode]> = [
    ['id', row.id],
    ['name', row.name],
    ['description', row.description ?? '—'],
    ['owner', row.user?.email ?? row.user?.name ?? row.user_id?.slice(0, 8) ?? '—'],
    ['visibility', String(row.visibility ?? 'private')],
    ['status', (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <StatusDot status={workflowStatusDot(active, row.status)} />
        <span>{active ? 'active' : 'disabled'}</span>
      </span>
    )],
    ['nodes', row.nodeCount ?? 0],
    ['runs (lifetime)', (row.totalExecutions ?? 0).toLocaleString()],
    ['successful', (row.successfulExecutions ?? 0).toLocaleString()],
    ['failed', (row.failedExecutions ?? 0).toLocaleString()],
    ['success rate', sr == null ? '—' : fmtPct(sr, 1)],
    ['created', fmtRelative(row.created_at)],
    ['updated', fmtRelative(row.updated_at)],
  ]

  return (
    <>
      <SectionBar
        title="metadata"
        right={
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Btn variant="ghost" onClick={() => onStub('open in canvas')}>open in canvas</Btn>
            <Btn variant="ghost" onClick={() => onStub('rename / edit')}>edit</Btn>
          </span>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '140px 1fr',
          rowGap: 6,
          columnGap: 12,
          padding: '8px 0 12px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
        }}
      >
        {meta.map(([k, v]) => (
          <React.Fragment key={k}>
            <div
              style={{
                color: 'var(--fg-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {k}
            </div>
            <div style={{ color: 'var(--fg-1)' }}>{v}</div>
          </React.Fragment>
        ))}
      </div>

      <Banner level="info" label="read-only">
        rename / visibility / delete mutations route through the v2 leaf for now —
        click <span className="accent">edit</span> to surface the wire-up notice.
      </Banner>
    </>
  )
}

// ============================================================
// Runs tab — last 50 executions for this workflow
// ============================================================
const RunsTab: React.FC<{
  row: AdminWorkflowRow
  pinnedExecution?: AdminWorkflowExecution
}> = ({ row, pinnedExecution }) => {
  const q = useAdminWorkflowRuns(row.id, 50)
  const runs = q.data?.executions ?? []
  // Merge in pinned execution if it's not already in the list (defensive
  // for older API builds that don't expose /workflows/:id/executions).
  const merged = React.useMemo(() => {
    if (!pinnedExecution) return runs
    if (runs.some((r) => r.id === pinnedExecution.id)) return runs
    return [pinnedExecution, ...runs]
  }, [runs, pinnedExecution])

  const cols: DtCol<AdminWorkflowExecution>[] = [
    {
      key: 'started',
      label: 'Started',
      width: '90px',
      className: 'mono',
      render: (r) => fmtClock(r.startedAt),
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={execStatusDot(r.status)} />
          <span>{(r.status ?? '').replace(/_/g, ' ') || '—'}</span>
        </span>
      ),
    },
    {
      key: 'nodes',
      label: 'Nodes',
      width: '70px',
      align: 'right',
      className: 'num',
      render: (r) => `${r.completedNodes}/${r.totalNodes}`,
    },
    {
      key: 'duration',
      label: 'Duration',
      width: '90px',
      align: 'right',
      className: 'mono',
      render: (r) => fmtDuration(r.executionTimeMs),
    },
    {
      key: 'cost',
      label: 'Cost',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => (r.cost != null && r.cost > 0 ? fmtUsd(r.cost) : <span style={{ color: 'var(--fg-3)' }}>—</span>),
    },
  ]

  return (
    <>
      <SectionBar title="recent runs" count={merged.length} />
      {q.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/workflows/{row.id}/executions</span>
        </Banner>
      )}
      {q.isLoading && merged.length === 0 ? (
        <EmptyInline pad>loading runs…</EmptyInline>
      ) : merged.length === 0 ? (
        <EmptyInline pad>no executions for this workflow yet.</EmptyInline>
      ) : (
        <Dt
          columns={cols}
          rows={merged}
          rowKey={(r) => r.id}
          selectedKey={pinnedExecution?.id}
        />
      )}
      {pinnedExecution?.error && (
        <Banner level="err" label="last error">
          {pinnedExecution.error}
        </Banner>
      )}
    </>
  )
}

// ============================================================
// Cost tab — per-run cost trend reuses lifetime totals.
// True per-run series needs /api/admin/workflows/:id/cost which is
// not yet exposed; pane surfaces a TODO marker.
// ============================================================
const CostTab: React.FC<{ row: AdminWorkflowRow }> = ({ row }) => {
  const q = useAdminWorkflowRuns(row.id, 50)
  const runs = q.data?.executions ?? []
  const cost = runs.reduce((n, r) => n + (r.cost ?? 0), 0)
  const samples = runs.filter((r) => r.cost != null && r.cost > 0).length
  const avg = samples > 0 ? cost / samples : 0

  return (
    <>
      <SectionBar title="cost · last 50 runs" />
      <KpiGrid cols={3}>
        <Kpi label="total" value={fmtUsd(cost)} sub={`across ${runs.length} runs`} />
        <Kpi label="cost-bearing" value={samples.toLocaleString()} sub="runs with $ > 0" />
        <Kpi label="avg / run" value={fmtUsd(avg)} sub="of cost-bearing only" />
      </KpiGrid>

      <Banner level="info" label="todo">
        per-run cost trend chart needs{' '}
        <span className="accent">
          /api/admin/workflows/{row.id}/cost?window=30d&groupBy=day
        </span>
        {' '}— wire-up pending server-side.
      </Banner>
    </>
  )
}

// ============================================================
// Audit tab — filter the workflow audit log to this workflow.
// /api/admin/flows/audit-logs supports `target_id` filter; we apply
// it client-side as a fallback because not every build supports the
// server-side filter yet.
// ============================================================
function outcomeStatus(o?: string): Status {
  const s = String(o ?? '').toLowerCase()
  if (s === 'success') return 'ok'
  if (s === 'denied') return 'warn'
  if (s === 'error' || s === 'fail' || s === 'failed') return 'err'
  return 'idle'
}

const AuditTab: React.FC<{ row: AdminWorkflowRow }> = ({ row }) => {
  const q = useFlowAuditLogs(100)
  const all: FlowAuditLogEntry[] = q.data?.logs ?? []
  const rows = all.filter(
    (e) =>
      e.target_id === row.id ||
      (e.metadata && (e.metadata as any).workflowId === row.id) ||
      (e.metadata && (e.metadata as any).workflow_id === row.id),
  )

  return (
    <>
      <SectionBar title="audit · this workflow" count={rows.length} />
      {q.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/flows/audit-logs</span>
        </Banner>
      )}
      {q.isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading audit…</EmptyInline>
      ) : rows.length === 0 ? (
        <EmptyInline pad>no audit entries reference this workflow.</EmptyInline>
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

// Use this hook reference so the bundler keeps useFlowsKpis if a future
// version of the Cost tab pulls it in. Keeps the import surface stable.
void useFlowsKpis

export default WorkflowDetail
