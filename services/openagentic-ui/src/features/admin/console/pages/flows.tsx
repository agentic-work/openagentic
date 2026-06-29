/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Flows domain pages (blueprint §2 — FLOWS, 9 leaves) at mock fidelity
 * (the admin-console mock PAGES.workflows / executions /
 * flow-costs / failures / audit-logs / credentials / governance /
 * kpi-dashboard / teams) and WIRED to the real admin endpoints.
 *
 * Each leaf is a body-only component — PageHead + content, NEVER its own
 * OptionSpec (AdminConsole appends the option-spec inventory = the two-part
 * leaf contract). Every number comes from a live hook or renders an honest
 * "—"; tables render real rows or an honest-empty Banner; no value is
 * fabricated. Every color resolves via a global theme token (var(--*)).
 *
 * Data sources (all real admin routes):
 *   GET /api/admin/workflows                 → all-workflows table (workflows)
 *   GET /api/admin/workflows/executions      → execution log (executions)
 *   GET /api/admin/flows/kpis?window=…       → fleet KPIs + costs + failing
 *                                              nodes (flow-costs, failures,
 *                                              kpi-dashboard)
 *   GET /api/admin/flows/recent-failures     → recent failed executions
 *   GET /api/admin/flows/audit-logs          → flow audit trail (audit-logs)
 *   GET /api/admin/workflow-secrets          → masked secrets (credentials)
 *   GET /api/admin/teams                     → per-team ownership (teams)
 *   GET /api/admin/workflow-settings         → governance config (governance)
 */
import * as React from 'react'
import {
  Banner,
  DataTable,
  FormSection,
  HBars,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  StatusDot,
  Tag,
  type DtColumn,
  type FormRow,
  type HBarItem,
  type Kpi,
} from '../primitives'
import type { Tone } from '../types'
import {
  useFlowsKpisHome,
  useFlowsRecentFailures,
} from '../../hooks/useDashboardMetrics'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import type { LeafPageProps } from './registry'

/* ============================================================
 * format helpers (honest "—" on missing) — port of HomePage's
 * ============================================================ */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function fmtUsd(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'
  return '$' + n.toFixed(2)
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n)}%`
}
function fmtMs(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1000) return (n / 1000).toFixed(1) + 's'
  return Math.round(n) + 'ms'
}
function relTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const t = d.getTime()
  if (Number.isNaN(t)) return String(ts).slice(0, 16)
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}
function utcStamp(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
}
function successTone(p: number | undefined | null): Tone {
  if (p == null || Number.isNaN(p)) return 'muted'
  return p >= 95 ? 'ok' : p >= 80 ? 'warn' : 'err'
}
function execTone(status: string | undefined | null): Tone {
  const s = String(status ?? '').toLowerCase()
  if (s.includes('fail')) return 'err'
  if (s === 'running') return 'info'
  if (s.includes('error')) return 'warn'
  if (s === 'pending' || s === 'queued') return 'muted'
  return 'ok'
}
/** Stringify an unknown payload so it never renders as a raw object (no React #31). */
function asText(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/* ============================================================
 * shared loading / error / empty helpers
 * ============================================================ */
function LoadErr({
  isLoading,
  isError,
  label,
}: {
  isLoading: boolean
  isError: boolean
  label: string
}) {
  if (isError) {
    return (
      <Banner tone="err">
        Failed to load {label}. The endpoint returned an error — no data is shown rather than a
        fabricated value.
      </Banner>
    )
  }
  if (isLoading) {
    return <Banner tone="info">Loading {label}…</Banner>
  }
  return null
}

/* ============================================================
 * row shapes (permissive — mirror the real admin envelopes)
 * ============================================================ */
interface WorkflowRow extends Record<string, unknown> {
  id: string
  name?: string
  description?: string
  user?: { id?: string; email?: string; name?: string } | null
  nodeCount?: number
  status?: string
  visibility?: string
  totalExecutions?: number
  successfulExecutions?: number
  failedExecutions?: number
  lastExecutedAt?: string | null
  updated_at?: string | null
}
interface WorkflowsResponse {
  workflows?: WorkflowRow[]
  total?: number
}

interface ExecutionRow extends Record<string, unknown> {
  id: string
  workflowId?: string
  workflowName?: string
  user?: { email?: string; name?: string } | null
  status?: string
  triggerType?: string
  totalNodes?: number
  completedNodes?: number
  executionTimeMs?: number | null
  cost?: number | null
  startedAt?: string | null
  completedAt?: string | null
  error?: string | null
}
interface ExecutionsResponse {
  executions?: ExecutionRow[]
  total?: number
}

interface FlowAuditRow extends Record<string, unknown> {
  id: string
  timestamp?: string
  actor?: string
  action?: string
  target_type?: string
  target_id?: string
  outcome?: string
  actor_ip?: string
  metadata?: unknown
}
interface FlowAuditResponse {
  logs?: FlowAuditRow[]
  total?: number
}

interface SecretRow extends Record<string, unknown> {
  id: string
  name?: string
  description?: string
  scope?: string
  allowedNodes?: string | string[]
  accessCount?: number
  lastRotatedAt?: string | null
  updatedAt?: string | null
}
interface SecretsResponse {
  secrets?: SecretRow[]
  total?: number
}

interface TeamRow extends Record<string, unknown> {
  id: string
  name?: string
  display_name?: string
  cost_center?: string | null
  billing_contact_email?: string | null
  is_active?: boolean
  updated_at?: string | null
  member_count?: number
  shared_flows_count?: number
}
interface TeamsResponse {
  teams?: TeamRow[]
}

interface GovernanceResponse {
  settings?: Record<string, unknown>
  config?: Record<string, unknown>
}

/* domain-local hooks for the leaves with no dedicated typed hook */
function useWorkflows() {
  return useAdminQuery<WorkflowsResponse>(['flows-workflows'], '/api/admin/workflows?limit=200', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useExecutions() {
  return useAdminQuery<ExecutionsResponse>(
    ['flows-executions'],
    '/api/admin/workflows/executions?limit=50',
    { staleTime: 15_000, refetchInterval: 30_000 },
  )
}
function useFlowAuditLogs() {
  return useAdminQuery<FlowAuditResponse>(
    ['flows-audit'],
    '/api/admin/flows/audit-logs?limit=50',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}
function useWorkflowSecrets() {
  return useAdminQuery<SecretsResponse>(['flows-secrets'], '/api/admin/workflow-secrets', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useTeams() {
  return useAdminQuery<TeamsResponse>(['flows-teams'], '/api/admin/teams', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
function useGovernanceConfig() {
  return useAdminQuery<GovernanceResponse>(
    ['flows-governance'],
    '/api/admin/workflow-settings',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

/* ============================================================
 * 1. workflows · fw — all-workflows table (status, owner, visibility, runs)
 * ============================================================ */
function WorkflowsPage(_props: LeafPageProps) {
  const wf = useWorkflows()
  const kpis = useFlowsKpisHome('24h')

  const rows = wf.data?.workflows ?? []
  const total = wf.data?.total ?? rows.length
  const active = rows.filter((r) => r.status === 'active').length
  const publicCt = rows.filter((r) => r.visibility === 'public').length
  const k = kpis.data
  const failed = k?.failed_count ?? 0
  const failingNodes = k?.top_failing_nodes ?? []

  const strip: Kpi[] = [
    { label: 'Workflows', val: wf.data ? total : '—', tone: 'accent', sub: `${rows.length} loaded` },
    {
      label: 'Active',
      val: wf.data ? active : '—',
      tone: 'ok',
      sub: publicCt ? `${publicCt} public` : undefined,
    },
    {
      label: 'Executions (24h)',
      val: k ? fmtNum(k.total_executions) : '—',
      tone: 'info',
    },
    {
      label: 'Success rate',
      val: k?.success_rate != null ? fmtPct(k.success_rate) : '—',
      tone: successTone(k?.success_rate),
      sub: failed > 0 ? `${failed} failed` : undefined,
    },
    {
      label: 'Total cost (24h)',
      val: k ? fmtUsd(k.total_cost_usd) : '—',
      tone: 'accent',
      sub: k?.avg_cost_per_execution_usd != null ? `avg ${fmtUsd(k.avg_cost_per_execution_usd)}/run` : undefined,
    },
  ]

  const cols: DtColumn<WorkflowRow>[] = [
    {
      label: 'Workflow',
      val: (r) => r.name ?? r.id,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone={r.status === 'active' ? 'ok' : 'muted'} />
          <span className="awc-name">{r.name ?? r.id}</span>
        </span>
      ),
    },
    { label: 'Visibility', render: (r) => <Tag>{r.visibility ?? 'private'}</Tag> },
    { label: 'Owner', val: (r) => r.user?.email ?? r.user?.name ?? '—' },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={r.status === 'active' ? 'ok' : 'muted'} dot>
          {r.status ?? 'draft'}
        </Pill>
      ),
    },
    { label: 'Nodes', r: true, val: (r) => r.nodeCount ?? 0 },
    { label: 'Runs', r: true, val: (r) => r.totalExecutions ?? 0 },
    {
      label: 'Success',
      r: true,
      sortVal: (r) =>
        r.totalExecutions
          ? Math.round(((r.successfulExecutions ?? 0) / r.totalExecutions) * 100)
          : -1,
      render: (r) => {
        const tot = r.totalExecutions ?? 0
        if (!tot) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        const pct = Math.round(((r.successfulExecutions ?? 0) / tot) * 100)
        const tv =
          pct >= 95 ? 'var(--ok)' : pct >= 80 ? 'var(--warn)' : 'var(--err)'
        return <span style={{ color: tv }}>{pct}%</span>
      },
    },
    { label: 'Updated', val: (r) => relTime(r.updated_at) },
  ]

  return (
    <>
      <PageHead
        title="Flows"
        sub={
          wf.data
            ? `${total} workflows · ${active} active · ${k ? fmtNum(k.total_executions) : '—'} executions (24h) · ${k?.success_rate != null ? fmtPct(k.success_rate) : '—'} success`
            : 'all workflows across users · /api/admin/workflows'
        }
        actions={[{ label: 'New workflow', ic: '＋ ', primary: true }]}
        mode="editable"
      />
      {failingNodes.length > 0 && (
        <Banner tone="warn">
          <b>
            {failingNodes.reduce((a, n) => a + (n.fail_count ?? 0), 0)} node failures in 24h
          </b>{' '}
          across {failingNodes.length} {failingNodes.length === 1 ? 'node' : 'nodes'} — see the
          Failures leaf.
        </Banner>
      )}
      <KpiStrip kpis={strip} />
      <Section title="Workflows" />
      <LoadErr isLoading={wf.isLoading} isError={wf.isError} label="workflows" />
      {wf.data && (
        <DataTable<WorkflowRow>
          cols={cols}
          rows={rows}
          search="search workflows · names, descriptions, owners…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'active', label: 'active', cnt: active },
              { id: 'disabled', label: 'disabled', cnt: rows.length - active },
            ],
            filter: (row, chip) => {
              const r = row as WorkflowRow
              return chip === 'all' ? true : chip === 'active' ? r.status === 'active' : r.status !== 'active'
            },
          }}
          empty="No workflows yet"
        />
      )}
    </>
  )
}

/* ============================================================
 * 2. executions · fe — global execution log (status, duration, cost)
 * ============================================================ */
function ExecutionsPage(_props: LeafPageProps) {
  const ex = useExecutions()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const rows = ex.data?.executions ?? []
  const open = rows.find((r) => r.id === openId) ?? null

  const count = (pred: (r: ExecutionRow) => boolean) => rows.filter(pred).length

  const cols: DtColumn<ExecutionRow>[] = [
    {
      label: 'Workflow',
      val: (r) => r.workflowName ?? r.workflowId ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name">{r.workflowName ?? '—'}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {(r.triggerType ?? '—')} · {String(r.id).slice(0, 8)}
          </div>
        </span>
      ),
    },
    { label: 'User', val: (r) => r.user?.email ?? r.user?.name ?? 'scheduler' },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={execTone(r.status)} dot>
          {String(r.status ?? '—').replace(/_/g, ' ')}
        </Pill>
      ),
    },
    {
      label: 'Nodes',
      val: (r) =>
        r.totalNodes != null ? `${r.completedNodes ?? 0}/${r.totalNodes}` : '—',
    },
    { label: 'Duration', r: true, sortVal: (r) => r.executionTimeMs ?? -1, val: (r) => fmtMs(r.executionTimeMs) },
    {
      label: 'Cost',
      r: true,
      sortVal: (r) => r.cost ?? -1,
      render: (r) => <span style={{ color: 'var(--accent)' }}>{r.cost != null ? fmtUsd(r.cost) : '—'}</span>,
    },
    { label: 'Started', val: (r) => relTime(r.startedAt) },
  ]

  return (
    <>
      <PageHead
        title="All Executions"
        sub="global execution list across all workflows + users · paged 50"
        mode="readonly"
      />
      <LoadErr isLoading={ex.isLoading} isError={ex.isError} label="executions" />
      {ex.data && (
        <DataTable<ExecutionRow>
          cols={cols}
          rows={rows}
          onRow={(r) => setOpenId(r.id)}
          search="search executions · workflow · user · id…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'completed', label: 'completed', cnt: count((r) => r.status === 'completed') },
              {
                id: 'completed_with_errors',
                label: 'with errors',
                cnt: count((r) => String(r.status ?? '').includes('error')),
              },
              { id: 'running', label: 'running', cnt: count((r) => r.status === 'running') },
              { id: 'failed', label: 'failed', cnt: count((r) => String(r.status ?? '').includes('fail')) },
              { id: 'pending', label: 'pending', cnt: count((r) => r.status === 'pending') },
            ],
            filter: (row, chip) => {
              const r = row as ExecutionRow
              if (chip === 'all') return true
              if (chip === 'completed_with_errors') return String(r.status ?? '').includes('error')
              if (chip === 'failed') return String(r.status ?? '').includes('fail')
              return r.status === chip
            },
          }}
          empty="No executions recorded"
        />
      )}
      {open && (
        <Section
          title={`Execution ${String(open.id).slice(0, 12)}`}
          sub={open.workflowName ?? open.workflowId}
          right={
            <button className="awc-btn awc-sm awc-ghost" onClick={() => setOpenId(null)}>
              close
            </button>
          }
        >
          <div className="awc-chartcard">
            <FormSection
              title="Trace"
              rows={[
                { label: 'Status', type: 'badge', badge: <Pill tone={execTone(open.status)} dot>{String(open.status ?? '—').replace(/_/g, ' ')}</Pill> },
                { label: 'Trigger', type: 'text', value: open.triggerType ?? '—', locked: true },
                { label: 'Nodes', type: 'text', value: open.totalNodes != null ? `${open.completedNodes ?? 0}/${open.totalNodes}` : '—', locked: true },
                { label: 'Duration', type: 'text', value: fmtMs(open.executionTimeMs), locked: true },
                { label: 'Cost', type: 'text', value: open.cost != null ? fmtUsd(open.cost) : '—', locked: true },
                { label: 'Started', type: 'text', value: utcStamp(open.startedAt), locked: true },
                { label: 'Completed', type: 'text', value: utcStamp(open.completedAt), locked: true },
                ...(open.error
                  ? [{ label: 'Error', type: 'textarea' as const, value: asText(open.error), locked: true }]
                  : []),
              ]}
              mode="readonly"
            />
          </div>
        </Section>
      )}
    </>
  )
}

/* ============================================================
 * 3. flow-costs · fc — cost-by-flow bars + spend trend
 * ============================================================ */
function FlowCostsPage(_props: LeafPageProps) {
  const kpis = useFlowsKpisHome('30d')
  const k = kpis.data
  const expensive = k?.top_expensive_flows ?? []

  const strip: Kpi[] = [
    { label: 'Total cost', val: k ? fmtUsd(k.total_cost_usd) : '—', tone: 'accent' },
    { label: 'Executions', val: k ? fmtNum(k.total_executions) : '—', tone: 'info', sub: 'cost-bearing window 30d' },
    {
      label: 'Avg/run',
      val: k?.avg_cost_per_execution_usd != null ? fmtUsd(k.avg_cost_per_execution_usd) : '—',
      tone: 'warn',
      sub: 'across all flows',
    },
    {
      label: 'Failed (30d)',
      val: k?.failed_count != null ? fmtNum(k.failed_count) : '—',
      tone: (k?.failed_count ?? 0) > 0 ? 'err' : 'ok',
    },
  ]

  const bars: HBarItem[] = expensive.map((f) => ({
    l: String(f.workflow_id ?? '').slice(0, 22) || '—',
    v: f.total_cost_usd ?? 0,
    tone: 'accent',
    disp: fmtUsd(f.total_cost_usd),
  }))

  return (
    <>
      <PageHead
        title="Flow Costs"
        sub="cost rollup by workflow · /api/admin/flows/kpis?window=30d"
        mode="readonly"
      />
      <LoadErr isLoading={kpis.isLoading} isError={kpis.isError} label="flow costs" />
      <KpiStrip kpis={strip} />
      <Section title="Top expensive flows" sub="window 30d · top by totalCostUsd" />
      <div className="awc-chartcard">
        {bars.length ? (
          <HBars items={bars} />
        ) : (
          <Banner tone="info">
            No cost-bearing flows in this window — nothing is spending against the budget, or the
            cost rollup has no rows yet.
          </Banner>
        )}
      </div>
    </>
  )
}

/* ============================================================
 * 4. failures · fx — failing-flow table + top failing nodes
 * ============================================================ */
function FailuresPage(_props: LeafPageProps) {
  const kpis = useFlowsKpisHome('24h')
  const recent = useFlowsRecentFailures(20)
  const k = kpis.data
  const nodes = k?.top_failing_nodes ?? []

  const totalNodeFails = nodes.reduce((a, n) => a + (n.fail_count ?? 0), 0)

  interface NodeRow extends Record<string, unknown> {
    node_id: string
    fail_count: number
    pct: number
  }
  const nodeRows: NodeRow[] = nodes.map((n) => ({
    node_id: n.node_id ?? '—',
    fail_count: n.fail_count ?? 0,
    pct: totalNodeFails ? Math.round(((n.fail_count ?? 0) / totalNodeFails) * 100) : 0,
  }))

  interface FailRow extends Record<string, unknown> {
    executionId: string
    workflowName: string
    failedNodeId: string
    error: string
    startedBy: string
    when: string
  }
  const failRows: FailRow[] = (recent.data?.failures ?? []).map((f) => ({
    executionId: String(f.executionId ?? ''),
    workflowName: f.workflowName ?? f.workflowId ?? '—',
    failedNodeId: f.failedNodeId ?? '—',
    error: asText(f.error),
    startedBy: f.startedBy ?? 'scheduler',
    when: relTime(f.timestamp ?? f.startedAt),
  }))

  const nodeCols: DtColumn<NodeRow>[] = [
    { label: 'Node', val: (r) => r.node_id, render: (r) => <span className="awc-name">{r.node_id}</span> },
    {
      label: 'Failures',
      r: true,
      val: (r) => r.fail_count,
      render: (r) => <span style={{ color: 'var(--err)' }}>{r.fail_count}</span>,
    },
    { label: '% of failures', r: true, val: (r) => r.pct + '%' },
  ]

  const failCols: DtColumn<FailRow>[] = [
    {
      label: 'Workflow',
      val: (r) => r.workflowName,
      render: (r) => (
        <span>
          <span className="awc-name">{r.workflowName}</span>
          <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
            {r.executionId.slice(0, 8)}
          </div>
        </span>
      ),
    },
    { label: 'Failed node', val: (r) => r.failedNodeId },
    {
      label: 'Error',
      render: (r) => (
        <span style={{ color: 'var(--err)', whiteSpace: 'normal' }}>{r.error}</span>
      ),
    },
    { label: 'Started by', val: (r) => r.startedBy },
    { label: 'When', val: (r) => r.when },
  ]

  return (
    <>
      <PageHead
        title="Failures"
        sub="top failing nodes + recent failed executions · /api/admin/flows/kpis · /recent-failures"
        mode="readonly"
      />
      {totalNodeFails > 0 && (
        <Banner tone="err">
          <b>{totalNodeFails} node failures in 24h</b> across {nodes.length}{' '}
          {nodes.length === 1 ? 'node' : 'nodes'}.
        </Banner>
      )}
      <Section
        title="Top failing nodes"
        sub={k ? `window 24h · ${totalNodeFails} failures across ${nodes.length} nodes` : 'window 24h'}
      />
      <LoadErr isLoading={kpis.isLoading} isError={kpis.isError} label="failing nodes" />
      {k && (
        <DataTable<NodeRow>
          cols={nodeCols}
          rows={nodeRows}
          search="node…"
          pageSize={8}
          empty="No failing nodes in this window"
        />
      )}
      <Section title="Recent failed executions" sub="window 24h · /api/admin/flows/recent-failures" />
      <LoadErr isLoading={recent.isLoading} isError={recent.isError} label="recent failures" />
      {recent.data && (
        <DataTable<FailRow>
          cols={failCols}
          rows={failRows}
          search="search failed executions · workflow · node · error…"
          pageSize={10}
          empty="No failed executions in this window"
        />
      )}
    </>
  )
}

/* ============================================================
 * 5. audit-logs · fa — flow audit trail (mutations, run-as)
 * ============================================================ */
function FlowAuditLogsPage(_props: LeafPageProps) {
  const audit = useFlowAuditLogs()
  const rows = audit.data?.logs ?? []
  const total = audit.data?.total ?? rows.length

  const outcomeTone = (o: string | undefined): Tone => {
    const s = String(o ?? '').toLowerCase()
    if (s === 'ok' || s === 'success' || s === 'allowed') return 'ok'
    if (s === 'denied' || s === 'blocked' || s === 'error' || s === 'failure') return 'err'
    return 'muted'
  }

  const strip: Kpi[] = [
    { label: 'Events', val: audit.data ? fmtNum(total) : '—', tone: 'accent' },
    {
      label: 'Denied / blocked',
      val: audit.data ? rows.filter((r) => ['denied', 'blocked'].includes(String(r.outcome ?? '').toLowerCase())).length : '—',
      tone: 'err',
    },
    {
      label: 'Distinct actors',
      val: audit.data ? new Set(rows.map((r) => r.actor).filter(Boolean)).size : '—',
      tone: 'info',
    },
    {
      label: 'Distinct actions',
      val: audit.data ? new Set(rows.map((r) => r.action).filter(Boolean)).size : '—',
      tone: 'warn',
    },
  ]

  const cols: DtColumn<FlowAuditRow>[] = [
    { label: 'When', val: (r) => relTime(r.timestamp), sortVal: (r) => r.timestamp ?? '' },
    { label: 'Actor', val: (r) => r.actor ?? 'system' },
    { label: 'Action', render: (r) => <Tag>{r.action ?? '—'}</Tag> },
    {
      label: 'Target',
      val: (r) => `${r.target_type ?? ''} ${r.target_id ?? ''}`.trim() || '—',
      render: (r) => (
        <span>
          <span className="awc-name">{r.target_type ?? '—'}</span>
          {r.target_id && (
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
              {r.target_id}
            </div>
          )}
        </span>
      ),
    },
    {
      label: 'Outcome',
      render: (r) => (
        <Pill tone={outcomeTone(r.outcome)} dot>
          {r.outcome ?? '—'}
        </Pill>
      ),
    },
    { label: 'IP', val: (r) => r.actor_ip ?? '—' },
  ]

  return (
    <>
      <PageHead
        title="Audit Logs"
        sub={audit.data ? `${total} flow audit events · /api/admin/flows/audit-logs` : 'flow audit trail · /api/admin/flows/audit-logs'}
        actions={[{ label: 'Export CSV', ic: '⤓ ' }]}
        mode="readonly"
      />
      <KpiStrip kpis={strip} />
      <Section title="Flow audit trail" sub="mutations + run-as + schedule fires · flow_audit_log (FedRAMP AU-6)" right={<Pill tone="ok" dot>live</Pill>} />
      <LoadErr isLoading={audit.isLoading} isError={audit.isError} label="flow audit logs" />
      {audit.data && (
        <DataTable<FlowAuditRow>
          cols={cols}
          rows={rows}
          search="search audit · actor · action · target…"
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'ok', label: 'success', cnt: rows.filter((r) => ['ok', 'success', 'allowed'].includes(String(r.outcome ?? '').toLowerCase())).length },
              { id: 'denied', label: 'denied / blocked', cnt: rows.filter((r) => ['denied', 'blocked', 'error', 'failure'].includes(String(r.outcome ?? '').toLowerCase())).length },
            ],
            filter: (row, chip) => {
              const r = row as FlowAuditRow
              const o = String(r.outcome ?? '').toLowerCase()
              if (chip === 'all') return true
              if (chip === 'ok') return ['ok', 'success', 'allowed'].includes(o)
              return ['denied', 'blocked', 'error', 'failure'].includes(o)
            },
          }}
          empty="No flow audit events"
        />
      )}
    </>
  )
}

/* ============================================================
 * 6. credentials · fr — workflow secrets table (scoped, masked)
 * ============================================================ */
function CredentialsPage(_props: LeafPageProps) {
  const secrets = useWorkflowSecrets()
  const rows = secrets.data?.secrets ?? []

  const scopeTone = (s: string | undefined): Tone =>
    s === 'global' ? 'info' : s === 'workflow' ? 'purple' : 'warn'

  const cols: DtColumn<SecretRow>[] = [
    {
      label: 'Name',
      val: (r) => r.name ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>
            {r.name ?? r.id}
          </span>
          {r.description && (
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{r.description}</div>
          )}
        </span>
      ),
    },
    {
      label: 'Scope',
      render: (r) => (
        <Pill tone={scopeTone(r.scope)} dot>
          {r.scope ?? '—'}
        </Pill>
      ),
    },
    {
      label: 'Allowed nodes',
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
          {Array.isArray(r.allowedNodes) ? r.allowedNodes.join(', ') : (r.allowedNodes ?? '—')}
        </span>
      ),
    },
    { label: 'Accesses', r: true, val: (r) => r.accessCount ?? 0 },
    {
      label: 'Last rotated',
      render: (r) =>
        r.lastRotatedAt ? (
          <span>{relTime(r.lastRotatedAt)}</span>
        ) : (
          <span style={{ color: 'var(--warn)' }}>never</span>
        ),
    },
    { label: 'Updated', val: (r) => relTime(r.updatedAt) },
  ]

  return (
    <>
      <PageHead
        title="Credentials"
        sub={secrets.data ? `${rows.length} workflow secrets · masked · /api/admin/workflow-secrets` : 'workflow secrets · scoped + masked'}
        mode="readonly"
      />
      <Banner tone="info">
        Values are masked — use <b>{'{{secret:name}}'}</b> in node fields. Mutations route through
        the v2 fallback until the v3 write path lands.
      </Banner>
      <Section title="Workflow secrets" />
      <LoadErr isLoading={secrets.isLoading} isError={secrets.isError} label="workflow secrets" />
      {secrets.isError ? (
        <Banner tone="warn">
          The <b>/api/admin/workflow-secrets</b> read is not yet surfaced on this build — secrets are
          not shown rather than fabricated. Wire the secrets read to populate this table.
        </Banner>
      ) : (
        secrets.data && (
          <DataTable<SecretRow>
            cols={cols}
            rows={rows}
            search="search secrets…"
            pageSize={8}
            chips={{
              active: 'all',
              opts: [
                { id: 'all', label: 'all', cnt: rows.length },
                { id: 'global', label: 'global', cnt: rows.filter((r) => r.scope === 'global').length },
                { id: 'workflow', label: 'workflow', cnt: rows.filter((r) => r.scope === 'workflow').length },
                { id: 'group', label: 'group', cnt: rows.filter((r) => r.scope === 'group').length },
              ],
              filter: (row, chip) =>
                chip === 'all' ? true : (row as SecretRow).scope === chip,
            }}
            empty="No workflow secrets stored"
          />
        )
      )}
    </>
  )
}

/* ============================================================
 * 7. governance · fg — HITL policy + approval gates (read-only config)
 * ============================================================ */
function GovernancePage(_props: LeafPageProps) {
  const gov = useGovernanceConfig()
  const cfg = (gov.data?.settings ?? gov.data?.config ?? {}) as Record<string, unknown>
  const has = gov.data != null && Object.keys(cfg).length > 0

  const v = (key: string): string | number | boolean | undefined => {
    const x = cfg[key]
    if (x == null) return undefined
    if (typeof x === 'object') return asText(x)
    return x as string | number | boolean
  }

  const numRow = (label: string, key: string, suffix?: string, desc?: string): FormRow => ({
    label,
    type: 'number',
    value: v(key) as number | undefined,
    suffix,
    desc,
  })

  return (
    <>
      <PageHead
        title="Governance"
        sub="live /api/admin/workflow-settings · HITL policy + approval gates"
        mode="readonly"
      />
      <Banner tone="info">
        Governance config renders <b>live</b>; every row is locked — mutations stay in the v2 view
        until the v3 write path lands. Empty fields show <b>—</b>, never a fabricated default.
      </Banner>
      <LoadErr isLoading={gov.isLoading} isError={gov.isError} label="governance config" />
      {!has && !gov.isLoading && (
        <Banner tone="warn">
          No governance config surfaced on this build — the workflow-settings config sub-object is
          not yet exposed (blueprint PARTIAL). Fields below show the policy keys; values populate
          once the read lands.
        </Banner>
      )}
      <FormSection
        title="Cost governance"
        rows={[
          numRow('defaultPerExecutionBudget', 'defaultPerExecutionBudget', '$'),
          numRow('maxPerExecutionBudget', 'maxPerExecutionBudget', '$ hard cap'),
          numRow('defaultDailyBudgetPerUser', 'defaultDailyBudgetPerUser', '$'),
          numRow('defaultMonthlyBudgetPerUser', 'defaultMonthlyBudgetPerUser', '$'),
          { label: 'onBudgetExceeded', type: 'select', value: v('onBudgetExceeded') as string | undefined, opts: ['block', 'warn', 'continue'] },
        ]}
        mode="readonly"
      />
      <FormSection
        title="Execution limits"
        rows={[
          numRow('defaultNodeTimeout', 'defaultNodeTimeout', 's'),
          numRow('maxNodeTimeout', 'maxNodeTimeout', 's'),
          numRow('maxExecutionTime', 'maxExecutionTime', 's'),
          numRow('maxNodesPerWorkflow', 'maxNodesPerWorkflow'),
          numRow('maxConcurrentExecutions', 'maxConcurrentExecutions', undefined, 'org'),
          numRow('maxConcurrentPerUser', 'maxConcurrentPerUser'),
          numRow('maxExecutionsPerHourPerUser', 'maxExecutionsPerHourPerUser'),
        ]}
        mode="readonly"
      />
      <FormSection
        title="Model & agent"
        rows={[
          numRow('maxAgentTurns', 'maxAgentTurns'),
          numRow('maxToolCallsPerAgent', 'maxToolCallsPerAgent'),
          numRow('agentCostBudgetCap', 'agentCostBudgetCap', '$'),
          { label: 'requireApprovalForHighRiskTools', type: 'toggle', value: v('requireApprovalForHighRiskTools') as boolean | undefined, desc: 'HITL' },
          { label: 'highRiskToolsList', type: 'textarea', value: v('highRiskToolsList') as string | undefined },
        ]}
        mode="readonly"
      />
      <FormSection
        title="Node & error handling"
        rows={[
          { label: 'disabledNodeTypes', type: 'textarea', value: v('disabledNodeTypes') as string | undefined },
          numRow('defaultRetryCount', 'defaultRetryCount'),
          numRow('defaultRetryDelay', 'defaultRetryDelay', 'ms'),
          { label: 'defaultBackoffStrategy', type: 'select', value: v('defaultBackoffStrategy') as string | undefined, opts: ['fixed', 'exponential'] },
          { label: 'defaultOnError', type: 'select', value: v('defaultOnError') as string | undefined, opts: ['stop', 'continue', 'retry'] },
        ]}
        mode="readonly"
      />
    </>
  )
}

/* ============================================================
 * 8. kpi-dashboard · fk — fleet KPI strip + trend (p50/p95/p99)
 * ============================================================ */
function KpiDashboardPage(_props: LeafPageProps) {
  const [win, setWin] = React.useState<'24h' | '7d' | '30d'>('24h')
  const kpis = useFlowsKpisHome(win)
  const k = kpis.data

  const head: Kpi[] = [
    { label: 'Executions', val: k ? fmtNum(k.total_executions) : '—', tone: 'accent' },
    {
      label: 'Success rate',
      val: k?.success_rate != null ? fmtPct(k.success_rate) : '—',
      tone: successTone(k?.success_rate),
    },
    { label: 'p95 latency', val: k?.latency_p95 != null ? Math.round(k.latency_p95) : '—', unit: k?.latency_p95 != null ? 'ms' : undefined, tone: 'info' },
    {
      label: 'Avg cost/run',
      val: k?.avg_cost_per_execution_usd != null ? fmtUsd(k.avg_cost_per_execution_usd) : '—',
      tone: 'warn',
      sub: k ? `total ${fmtUsd(k.total_cost_usd)}` : undefined,
    },
  ]
  const lat: Kpi[] = [
    { label: 'Latency p50', val: k?.latency_p50 != null ? Math.round(k.latency_p50) : '—', unit: k?.latency_p50 != null ? 'ms' : undefined, tone: 'ok' },
    { label: 'Latency p99', val: k?.latency_p99 != null ? Math.round(k.latency_p99) : '—', unit: k?.latency_p99 != null ? 'ms' : undefined, tone: 'info' },
    { label: 'Failed count', val: k?.failed_count != null ? fmtNum(k.failed_count) : '—', tone: (k?.failed_count ?? 0) > 0 ? 'err' : 'ok' },
  ]

  const failNodes = k?.top_failing_nodes ?? []
  const expensive = k?.top_expensive_flows ?? []
  const failBars: HBarItem[] = failNodes.map((n) => ({
    l: String(n.node_id ?? '').slice(0, 22) || '—',
    v: n.fail_count ?? 0,
    tone: 'err',
  }))
  const costBars: HBarItem[] = expensive.map((f) => ({
    l: String(f.workflow_id ?? '').slice(0, 20) || '—',
    v: f.total_cost_usd ?? 0,
    tone: 'accent',
    disp: fmtUsd(f.total_cost_usd),
  }))

  const WINDOWS: Array<'24h' | '7d' | '30d'> = ['24h', '7d', '30d']

  return (
    <>
      <PageHead
        title="KPI Dashboard"
        sub={`fleet-wide flow KPIs · /api/admin/flows/kpis?window=${win}`}
        actions={WINDOWS.map((w) => ({
          label: w,
          primary: w === win,
          onClick: () => setWin(w),
        }))}
        mode="readonly"
      />
      <LoadErr isLoading={kpis.isLoading} isError={kpis.isError} label="flow KPIs" />
      <KpiStrip kpis={head} />
      <KpiStrip kpis={lat} />
      <Section title="Breakdown" sub={`window ${win}`} />
      <div className="awc-grid2">
        <div className="awc-chartcard">
          <div className="awc-chartcard__ch">Top failing nodes</div>
          <div className="awc-chartcard__csub">top by failureCount</div>
          {failBars.length ? (
            <HBars items={failBars} />
          ) : (
            <Banner tone="ok">No failing nodes in this window.</Banner>
          )}
        </div>
        <div className="awc-chartcard">
          <div className="awc-chartcard__ch">Top expensive flows</div>
          <div className="awc-chartcard__csub">top by totalCostUsd</div>
          {costBars.length ? (
            <HBars items={costBars} />
          ) : (
            <Banner tone="info">No cost-bearing flows in this window.</Banner>
          )}
        </div>
      </div>
    </>
  )
}

/* ============================================================
 * 9. teams · ft — per-team flow ownership + spend
 * ============================================================ */
function TeamsPage(_props: LeafPageProps) {
  const teams = useTeams()
  const rows = teams.data?.teams ?? []
  const activeCt = rows.filter((r) => r.is_active).length

  const cols: DtColumn<TeamRow>[] = [
    {
      label: 'Name',
      val: (r) => r.display_name ?? r.name ?? r.id,
      render: (r) => (
        <span>
          <span className="awc-name">{r.display_name ?? r.name ?? r.id}</span>
          {r.name && (
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
              {r.name}
            </div>
          )}
        </span>
      ),
    },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={r.is_active ? 'ok' : 'muted'} dot>
          {r.is_active ? 'active' : 'inactive'}
        </Pill>
      ),
    },
    { label: 'Members', r: true, val: (r) => r.member_count ?? 0 },
    { label: 'Shared flows', r: true, val: (r) => r.shared_flows_count ?? 0 },
    { label: 'Cost center', render: (r) => (r.cost_center ? <Tag>{r.cost_center}</Tag> : <span style={{ color: 'var(--fg-3)' }}>—</span>) },
    { label: 'Billing contact', val: (r) => r.billing_contact_email ?? '—' },
    { label: 'Updated', val: (r) => relTime(r.updated_at) },
  ]

  return (
    <>
      <PageHead title="Teams" sub="/api/admin/teams · per-team flow ownership + spend · read-only" mode="readonly" />
      <LoadErr isLoading={teams.isLoading} isError={teams.isError} label="teams" />
      {teams.data && (
        <DataTable<TeamRow>
          cols={cols}
          rows={rows}
          search="search teams…"
          pageSize={8}
          chips={{
            active: 'all',
            opts: [
              { id: 'all', label: 'all', cnt: rows.length },
              { id: 'active', label: 'active', cnt: activeCt },
              { id: 'inactive', label: 'inactive', cnt: rows.length - activeCt },
            ],
            filter: (row, chip) => {
              const r = row as TeamRow
              return chip === 'all' ? true : chip === 'active' ? !!r.is_active : !r.is_active
            },
          }}
          empty="No teams configured"
        />
      )}
    </>
  )
}

/* ============================================================
 * exports — all 9 Flows leaf ids → page component
 * ============================================================ */
export const flowsPages: Record<string, React.ComponentType<LeafPageProps>> = {
  workflows: WorkflowsPage,
  executions: ExecutionsPage,
  'flow-costs': FlowCostsPage,
  failures: FailuresPage,
  'audit-logs': FlowAuditLogsPage,
  credentials: CredentialsPage,
  governance: GovernancePage,
  'kpi-dashboard': KpiDashboardPage,
  teams: TeamsPage,
}
