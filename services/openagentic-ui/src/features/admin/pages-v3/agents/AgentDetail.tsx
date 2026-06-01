import * as React from 'react'
import {
  Btn,
  EmptyInline,
  Mini,
  MiniGrid,
  SectionBar,
  Banner,
  Dt,
  type DtCol,
  StatusDot,
  Feed,
  FeedRow,
  Chip,
} from '../../primitives-v3'
import {
  fmtRelative,
  fmtClock,
  fmtDuration,
  fmtUsdFromCents,
  fmtTokens,
  fmtPct,
  execStatusDot,
  agentEnabledDot,
  type AgentDetailTab,
} from './types'
import type {
  AdminAgentRow,
  AdminAgentSkillRow,
  AdminAgentExecutionRow,
  FleetMetricsAgent,
} from '../../hooks/useDashboardMetrics'

export interface AgentDetailProps {
  row: AdminAgentRow
  tab: AgentDetailTab
  /** Pinned execution from the Executions tab — opens Runs tab on it. */
  pinnedExecution?: AdminAgentExecutionRow
  /** All skills, used to resolve skill ids → display names. */
  skills: AdminAgentSkillRow[]
  /** All executions (recent slice). Filtered by agent inside the pane. */
  executions: AdminAgentExecutionRow[]
  /** Fleet 24h metric for this agent, if present. */
  fleet?: FleetMetricsAgent
  onStub: (label: string) => void
}

// ============================================================
// Overview — identity card + a 4-cell mini-grid for at-a-glance
// fleet metrics + action stubs.
// ============================================================
function Overview({ row, fleet, onStub }: {
  row: AdminAgentRow
  fleet?: FleetMetricsAgent
  onStub: (l: string) => void
}) {
  const enabled = row.enabled !== false
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <StatusDot status={agentEnabledDot(enabled)} />
          <span style={{ color: 'var(--fg-2)', fontSize: 'var(--v3-t-meta)' }}>
            {enabled ? 'active' : 'disabled'}
          </span>
          {row.background && (
            <Chip label="kind" value="background" />
          )}
        </div>
        {row.description && (
          <div style={{ color: 'var(--fg-2)', marginBottom: 8, lineHeight: 1.4 }}>
            {row.description}
          </div>
        )}
      </div>

      <SectionBar title="identity" />
      <Dl
        rows={[
          ['id', row.id],
          ['name', row.name ?? '—'],
          ['type', row.agent_type ?? '—'],
          ['category', row.category ?? '—'],
          ['model', row.model_config?.primaryModel ?? 'auto'],
          ['fallback', row.model_config?.fallbackModel ?? '—'],
          ['prompt strategy', row.prompt_strategy ?? 'composite'],
          ['created', row.created_at ? fmtRelative(row.created_at) : '—'],
          ['created by', row.created_by ?? '—'],
        ]}
      />

      <SectionBar title="fleet · last 24h" />
      <MiniGrid cols={4}>
        <Mini label="runs 24h" value={(fleet?.runCount24h ?? 0).toLocaleString()} />
        <Mini
          label="success"
          value={
            fleet && fleet.runCount24h > 0
              ? fmtPct(fleet.successRate * 100, 0)
              : '—'
          }
          tone={
            fleet == null || fleet.runCount24h === 0
              ? 'default'
              : fleet.successRate >= 0.95
                ? 'ok'
                : fleet.successRate >= 0.75
                  ? 'warn'
                  : 'err'
          }
        />
        <Mini label="p50" value={fmtDuration(fleet?.p50DurationMs)} />
        <Mini label="cost" value={fmtUsdFromCents(fleet?.totalCostCents)} />
      </MiniGrid>

      <SectionBar title="actions" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn onClick={() => onStub('test agent')}>test</Btn>
        <Btn onClick={() => onStub('edit agent')}>edit</Btn>
        <Btn onClick={() => onStub(enabled ? 'disable agent' : 'enable agent')}>
          {enabled ? 'disable' : 'enable'}
        </Btn>
        <Btn onClick={() => onStub('delete agent')}>delete</Btn>
      </div>
    </>
  )
}

// ============================================================
// Skills — resolve skill ids against the registry.
// ============================================================
function Skills({ row, skills }: { row: AdminAgentRow; skills: AdminAgentSkillRow[] }) {
  const ids = row.skills ?? []
  if (ids.length === 0) {
    return <EmptyInline pad>this agent has no skills assigned.</EmptyInline>
  }
  const cols: DtCol<{ id: string; resolved?: AdminAgentSkillRow }>[] = [
    {
      key: 'name',
      label: 'Skill',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>
            {r.resolved?.display_name ?? r.resolved?.name ?? r.id}
          </span>
          {r.resolved?.description && (
            <span
              style={{
                color: 'var(--fg-3)',
                fontSize: 'var(--v3-t-meta)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 280,
              }}
            >
              {r.resolved.description}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '120px',
      className: 'mono',
      render: (r) => r.resolved?.type ?? '—',
    },
    {
      key: 'source',
      label: 'Source',
      width: '100px',
      className: 'dim',
      render: (r) => r.resolved?.source ?? '—',
    },
  ]
  const resolved = ids.map((id) => ({
    id,
    resolved: skills.find((s) => s.id === id || s.name === id),
  }))
  return (
    <>
      <SectionBar title="assigned skills" count={resolved.length} />
      <Dt columns={cols} rows={resolved} rowKey={(r) => r.id} />
    </>
  )
}

// ============================================================
// Runs — per-agent slice of the global executions feed. The
// agentRunLog has loop_id (FK to Agent), so we filter by that
// or by the agent's id when API surfaces it that way.
// ============================================================
function Runs({
  row,
  executions,
  pinnedExecution,
}: {
  row: AdminAgentRow
  executions: AdminAgentExecutionRow[]
  pinnedExecution?: AdminAgentExecutionRow
}) {
  const list = React.useMemo(() => {
    const own = executions.filter(
      (e) => e.loop_id === row.id || e.agent?.name === row.name || e.agent?.agent_type === row.agent_type,
    )
    if (pinnedExecution && !own.find((o) => o.id === pinnedExecution.id)) {
      return [pinnedExecution, ...own]
    }
    return own
  }, [executions, row, pinnedExecution])

  if (list.length === 0) {
    return <EmptyInline pad>no executions for this agent in the recent window.</EmptyInline>
  }

  const cols: DtCol<AdminAgentExecutionRow>[] = [
    {
      key: 'when',
      label: 'When',
      width: '110px',
      className: 'mono',
      render: (r) => fmtClock(r.started_at),
    },
    {
      key: 'status',
      label: 'Status',
      width: '110px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={execStatusDot(r.status)} />
          <span>{r.status}</span>
        </span>
      ),
    },
    {
      key: 'model',
      label: 'Model',
      width: '140px',
      className: 'mono',
      render: (r) => r.model_used ?? '—',
    },
    {
      key: 'duration',
      label: 'Dur',
      width: '70px',
      align: 'right',
      className: 'mono',
      render: (r) => fmtDuration(r.duration_ms ?? null),
    },
    {
      key: 'tokens',
      label: 'Tok',
      width: '70px',
      align: 'right',
      className: 'num',
      render: (r) => fmtTokens(r.total_tokens ?? null),
    },
  ]

  return (
    <>
      <SectionBar title="recent runs" count={list.length} />
      <Dt columns={cols} rows={list} rowKey={(r) => r.id} />
    </>
  )
}

// ============================================================
// Cost — read fleet aggregate; no per-agent cost time-series
// endpoint exists today, so we surface what's available + a
// pointer to the missing endpoint.
// ============================================================
function Cost({ fleet }: { fleet?: FleetMetricsAgent }) {
  if (!fleet || fleet.runCount24h === 0) {
    return (
      <>
        <SectionBar title="cost · 24h" />
        <EmptyInline pad>no cost activity for this agent in the last 24h.</EmptyInline>
      </>
    )
  }
  const avgCents = fleet.runCount24h > 0 ? fleet.totalCostCents / fleet.runCount24h : 0
  return (
    <>
      <SectionBar title="cost · 24h" />
      <MiniGrid cols={3}>
        <Mini label="total" value={fmtUsdFromCents(fleet.totalCostCents)} />
        <Mini label="runs" value={fleet.runCount24h.toLocaleString()} />
        <Mini label="avg / run" value={fmtUsdFromCents(avgCents)} />
      </MiniGrid>
      <Banner level="info" label="todo">
        per-agent cost time-series endpoint not yet exposed
        (<span className="accent">/api/admin/agents/cost-report</span> is fleet-wide, not per
        agent).
      </Banner>
    </>
  )
}

// ============================================================
// Audit — placeholder; the agent audit endpoint is admin-only
// and currently routes through /audit/export which returns a CSV
// stream rather than JSON. Real-time feed is deferred.
// ============================================================
function Audit() {
  return (
    <>
      <SectionBar title="audit" />
      <Banner level="info" label="todo">
        agent audit JSON feed not yet exposed
        (<span className="accent">/api/admin/agents/audit/export</span> returns CSV only).
      </Banner>
      <Feed>
        <FeedRow ts="—" status="idle" act="audit feed wire-up pending" />
      </Feed>
    </>
  )
}

// ============================================================
// Top-level switcher — keeps the SidePanel body code small.
// ============================================================
export const AgentDetail: React.FC<AgentDetailProps> = ({
  row,
  tab,
  pinnedExecution,
  skills,
  executions,
  fleet,
  onStub,
}) => {
  if (tab === 'overview') return <Overview row={row} fleet={fleet} onStub={onStub} />
  if (tab === 'skills')   return <Skills row={row} skills={skills} />
  if (tab === 'runs')     return <Runs row={row} executions={executions} pinnedExecution={pinnedExecution} />
  if (tab === 'cost')     return <Cost fleet={fleet} />
  return <Audit />
}

// ============================================================
// Local Dl — definition-list-style key/value rows. Kept inline so
// it doesn't pollute primitives-v3; use the same vocabulary if it
// crops up in another leaf.
// ============================================================
function Dl({ rows }: { rows: Array<[label: string, value: React.ReactNode]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, columnGap: 12, marginBottom: 14 }}>
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {k}
          </span>
          <span style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-mono)' }}>{v}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

export default AgentDetail
