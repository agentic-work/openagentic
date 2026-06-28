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
  useAdminAgents,
  useAdminAgentMetrics,
  useAdminAgentFleet,
  useAdminAgentExecutions,
  useAdminAgentExecutionStats,
  useAdminAgentLiveExecutions,
  useAdminAgentSkills,
  type AdminAgentRow,
  type AdminAgentExecutionRow,
} from '../hooks/useDashboardMetrics'
import {
  TAB_ITEMS,
  DETAIL_TABS,
  fmtUsd,
  fmtUsdFromCents,
  fmtTokens,
  fmtPct,
  agentEnabledDot,
  type AgentsTabId,
  type AgentExecStatusFilter,
  type AgentRegistryFilter,
  type AgentDetailTab,
} from './agents/types'
import { RegistryPane } from './agents/RegistryPane'
import { OpsPane } from './agents/OpsPane'
import { SkillsPane } from './agents/SkillsPane'
import { ExecutionsPane } from './agents/ExecutionsPane'
import { AgentDetail } from './agents/AgentDetail'
import { AgentModal } from './agents/AgentModal'
import { AgentTestModal } from './agents/AgentTestModal'
import { ConfirmInline } from './shared/ConfirmInline'

export interface AgentsHubPageProps {
  /** Sub-tab to land on. Drives the leaf-id routing in AdminPortalHostV3
   * — `agent-registry` opens registry, `agent-ops` opens ops, etc. */
  initialTab?: AgentsTabId
}

export const AgentsHubPage: React.FC<AgentsHubPageProps> = ({ initialTab = 'registry' }) => {
  const [tab, setTab] = React.useState<AgentsTabId>(initialTab)
  React.useEffect(() => setTab(initialTab), [initialTab])

  // Registry-tab state
  const [search, setSearch] = React.useState('')
  const [regFilter, setRegFilter] = React.useState<AgentRegistryFilter>('all')

  // Skills-tab state
  const [skillSearch, setSkillSearch] = React.useState('')
  const [skillType, setSkillType] = React.useState<string>('all')

  // Executions-tab state
  const [execSearch, setExecSearch] = React.useState('')
  const [execStatusFilter, setExecStatusFilter] = React.useState<AgentExecStatusFilter>('all')

  // Side panel
  const [detail, setDetail] = React.useState<AdminAgentRow | null>(null)
  const [pinnedExec, setPinnedExec] = React.useState<AdminAgentExecutionRow | undefined>(undefined)
  const [detailTab, setDetailTab] = React.useState<AgentDetailTab>('overview')

  // Mutation surfaces
  const [actionNotice, setActionNotice] = React.useState<string | null>(null)
  const [actionLevel, setActionLevel] = React.useState<'info' | 'ok' | 'warn' | 'err'>('info')
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingRow, setEditingRow] = React.useState<AdminAgentRow | null>(null)
  const [testingAgent, setTestingAgent] = React.useState<AdminAgentRow | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)

  const flash = React.useCallback((label: string, level: 'info' | 'ok' | 'warn' | 'err' = 'ok') => {
    setActionNotice(label)
    setActionLevel(level)
    window.setTimeout(() => setActionNotice(null), 4000)
  }, [])

  // ============================================================
  // Hooks — every data source is real; nothing is mocked. Loading,
  // empty, and error states are wired through the panes.
  // ============================================================
  const dash = useDashboardMetrics('24h')
  const agents = useAdminAgents()
  const agentMetrics = useAdminAgentMetrics()
  const fleet = useAdminAgentFleet()
  const execStats = useAdminAgentExecutionStats()
  const liveExecs = useAdminAgentLiveExecutions()
  const skills = useAdminAgentSkills()
  const executions = useAdminAgentExecutions({
    status: execStatusFilter === 'all' ? undefined : execStatusFilter,
    limit: 50,
  })

  const summary = dash.data?.summary
  const list = agents.data?.agents ?? []
  const skillRows = skills.data?.skills ?? []
  const execRows = executions.data?.executions ?? []
  const fleetRows = fleet.data?.agents ?? []
  const liveRows = liveExecs.data?.executions ?? []

  // ============================================================
  // KPI strip — 5 cells. `Agents` from agent-metrics fallback to
  // the registry length; `Active` from execStats; `Executions /
  // Tokens / Cost` from the dashboard 24h roll-up so they match
  // the global Overview dashboard.
  // ============================================================
  const totalAgents =
    agentMetrics.data?.totalAgents ?? list.length
  const activeAgents = execStats.data?.activeAgents ?? 0
  const fleetCostCents24h = fleetRows.reduce((acc, a) => acc + a.totalCostCents, 0)
  const fleetRuns24h = fleetRows.reduce((acc, a) => acc + a.runCount24h, 0)

  // Open helpers
  const openAgent = React.useCallback(
    (row: AdminAgentRow, dtab: AgentDetailTab = 'overview', exec?: AdminAgentExecutionRow) => {
      setDetail(row)
      setDetailTab(dtab)
      setPinnedExec(exec)
    },
    [],
  )

  const openExecution = React.useCallback(
    (e: AdminAgentExecutionRow) => {
      const owner = list.find(
        (a) => a.id === e.loop_id || a.name === e.agent?.name || a.agent_type === e.agent?.agent_type,
      )
      const row: AdminAgentRow =
        owner ?? {
          id: e.loop_id ?? e.id,
          display_name: e.agent?.name ?? e.agent?.agent_type ?? 'unknown',
          agent_type: e.agent?.agent_type ?? '—',
          enabled: true,
        }
      openAgent(row, 'runs', e)
    },
    [list, openAgent],
  )

  const openAgentByFleetId = React.useCallback(
    (agentId: string) => {
      const owner = list.find((a) => a.id === agentId || a.name === agentId)
      if (owner) openAgent(owner, 'overview')
    },
    [list, openAgent],
  )

  const openSkillAgents = React.useCallback(
    (skillId: string, who: AdminAgentRow[]) => {
      // For skills drill-in we open the first agent that uses the skill,
      // pinned on its Skills tab. If no agent uses it the panel doesn't
      // open and the click is a no-op (the row still highlights).
      if (who.length === 0) {
        setActionNotice(`no agents currently reference skill "${skillId}".`)
        return
      }
      openAgent(who[0], 'skills')
    },
    [openAgent],
  )

  const detailFleetRow = React.useMemo(() => {
    if (!detail) return undefined
    return fleetRows.find(
      (f) => f.agentId === detail.id || f.agentName === detail.display_name || f.agentName === detail.name,
    )
  }, [detail, fleetRows])

  // ============================================================
  // Mutations — toggle enabled / delete soft-disable. The Modal
  // handles create + edit. Test goes through AgentTestModal.
  // ============================================================
  const toggleM = useAdminMutation<unknown, { id: string; enabled: boolean }>(
    (vars) => `/api/admin/agents/${encodeURIComponent(vars.id)}`,
    {
      method: 'PUT',
      bodyOf: ({ enabled }) => ({ enabled }),
      invalidateKeys: [['admin-agents'], ['admin-agents-metrics']],
      onSuccess: (_d, vars) => flash(`agent ${vars.enabled ? 'enabled' : 'disabled'}`, 'ok'),
      onError: (err) => flash(err.message, 'err'),
    },
  )

  const deleteM = useAdminMutation<unknown, { id: string }>(
    (vars) => `/api/admin/agents/${encodeURIComponent(vars.id)}`,
    {
      method: 'DELETE',
      invalidateKeys: [['admin-agents'], ['admin-agents-metrics']],
      onSuccess: () => {
        setConfirmDeleteId(null)
        setDetail(null)
        flash('agent deleted (soft — disabled)', 'ok')
      },
      onError: (err) => flash(err.message, 'err'),
    },
  )

  const onRegister = React.useCallback(() => {
    setEditingRow(null)
    setModalOpen(true)
  }, [])
  const onEdit = React.useCallback((row: AdminAgentRow) => {
    setEditingRow(row)
    setModalOpen(true)
  }, [])
  const onToggle = React.useCallback(
    (row: AdminAgentRow) => {
      const next = !(row.enabled !== false)
      toggleM.mutate({ id: row.id, enabled: next })
    },
    [toggleM],
  )
  const onDelete = React.useCallback((row: AdminAgentRow) => {
    setConfirmDeleteId(row.id)
  }, [])
  const onTest = React.useCallback((row: AdminAgentRow) => {
    setTestingAgent(row)
  }, [])

  // SidePanel detail "stub" buttons route to the same mutations
  // so the detail surface and the row actions stay in sync.
  const onDetailStub = React.useCallback(
    (label: string) => {
      if (!detail) return
      if (label === 'edit agent') onEdit(detail)
      else if (label === 'test agent') onTest(detail)
      else if (label === 'delete agent') onDelete(detail)
      else if (label === 'enable agent') onToggle(detail)
      else if (label === 'disable agent') onToggle(detail)
      else flash(`${label}: not yet wired`, 'info')
    },
    [detail, onEdit, onTest, onDelete, onToggle, flash],
  )

  return (
    <>
      <PageHead
        title={TAB_ITEMS.find((t) => t.id === tab)?.label ?? "Agents"}
        meta={
          <>
            <StatusDot status={agentEnabledDot(!agents.isError)} />
            <span style={{ marginLeft: 6 }}>
              {agents.isLoading
                ? 'loading…'
                : `${totalAgents.toLocaleString()} registered · ${(summary?.totalAgentExecutions ?? 0).toLocaleString()} executions (24h) · ${fmtUsd(summary?.agentTotalCost)} spent`}
            </span>
          </>
        }
        actions={
          <Btn variant="primary" onClick={onRegister}>
            + register agent
          </Btn>
        }
      />

      {actionNotice && (
        <Banner level={actionLevel} label={actionLevel === 'err' ? 'error' : actionLevel}>
          {actionNotice}
        </Banner>
      )}
      {confirmDeleteId && (
        <ConfirmInline
          level="err"
          confirmLabel="disable agent"
          busy={deleteM.isPending}
          label={
            <>
              soft-delete agent{' '}
              <span className="accent">
                {list.find((a) => a.id === confirmDeleteId)?.display_name ??
                  list.find((a) => a.id === confirmDeleteId)?.name ??
                  confirmDeleteId.slice(0, 8)}
              </span>? sets enabled=false; runtime resolvers stop returning it.
            </>
          }
          onConfirm={() => deleteM.mutate({ id: confirmDeleteId })}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      <KpiStrip
        totalAgents={totalAgents}
        activeAgents={activeAgents}
        executions24h={summary?.totalAgentExecutions ?? fleetRuns24h}
        tokens24h={summary?.agentTotalTokens}
        cost24h={summary?.agentTotalCost}
        fleetCostCents24h={fleetCostCents24h}
        successRate7d={execStats.data?.successRate}
        loading={agents.isLoading || agentMetrics.isLoading}
      />

      <Subtabs items={TAB_ITEMS} active={tab} onChange={(id) => setTab(id as AgentsTabId)} />

      {tab === 'registry' && (
        <RegistryPane
          rows={list}
          isLoading={agents.isLoading}
          isError={agents.isError}
          total={list.length}
          search={search}
          onSearch={setSearch}
          filter={regFilter}
          onFilter={setRegFilter}
          selectedKey={detail?.id}
          onPick={(row) => openAgent(row, 'overview')}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onAdd={onRegister}
        />
      )}
      {tab === 'ops' && (
        <OpsPane
          stats={execStats.data}
          statsLoading={execStats.isLoading}
          statsError={execStats.isError}
          live={liveRows}
          liveLoading={liveExecs.isLoading}
          liveError={liveExecs.isError}
          fleet={fleetRows}
          fleetLoading={fleet.isLoading}
          fleetError={fleet.isError}
          timeSeries={dash.data?.timeSeries}
          onPickAgentId={openAgentByFleetId}
        />
      )}
      {tab === 'skills' && (
        <SkillsPane
          rows={skillRows}
          isLoading={skills.isLoading}
          isError={skills.isError}
          agents={list}
          search={skillSearch}
          onSearch={setSkillSearch}
          typeFilter={skillType}
          onTypeFilter={setSkillType}
          onPickSkillAgents={openSkillAgents}
        />
      )}
      {tab === 'executions' && (
        <ExecutionsPane
          rows={execRows}
          isLoading={executions.isLoading}
          isError={executions.isError}
          total={execRows.length}
          search={execSearch}
          onSearch={setExecSearch}
          statusFilter={execStatusFilter}
          onStatusFilter={setExecStatusFilter}
          onPickExecution={openExecution}
        />
      )}

      <SidePanel
        open={detail != null}
        onClose={() => {
          setDetail(null)
          setPinnedExec(undefined)
        }}
        title={detail?.display_name ?? detail?.name ?? ''}
        meta={
          detail
            ? `${detail.agent_type ?? '—'} · ${(detail.skills?.length ?? 0)} skills · ${(detail.tools_whitelist?.length ?? 0)} tools`
            : undefined
        }
        tabs={DETAIL_TABS.map((t) => ({ id: t.id, label: t.label }))}
        activeTab={detailTab}
        onTabChange={(id) => setDetailTab(id as AgentDetailTab)}
      >
        {detail && (
          <AgentDetail
            row={detail}
            tab={detailTab}
            pinnedExecution={pinnedExec}
            skills={skillRows}
            executions={execRows}
            fleet={detailFleetRow}
            onStub={onDetailStub}
          />
        )}
      </SidePanel>

      <AgentModal
        open={modalOpen}
        editing={editingRow}
        skills={skillRows}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          flash('agent saved', 'ok')
          agents.refetch?.()
        }}
      />
      <AgentTestModal
        open={!!testingAgent}
        agent={testingAgent}
        onClose={() => setTestingAgent(null)}
      />
    </>
  )
}

// ============================================================
// KpiStrip — page-level KPI row. Pulled out so the top-level
// component body stays under the 350-LOC budget while the JSX
// stays close to the data shapes it reads. 5 cells per spec.
// ============================================================
interface KpiStripProps {
  totalAgents: number
  activeAgents: number
  executions24h: number
  tokens24h?: number
  cost24h?: number
  fleetCostCents24h: number
  successRate7d?: number
  loading: boolean
}

function KpiStrip({
  totalAgents,
  activeAgents,
  executions24h,
  tokens24h,
  cost24h,
  fleetCostCents24h,
  successRate7d,
  loading,
}: KpiStripProps) {
  // Cost prefers the dashboard payload (whole dollars, agentTotalCost).
  // Fall back to the fleet roll-up (cents) when the dashboard hasn't
  // landed yet — keeps the tile non-empty during initial hydration.
  const costDisplay =
    cost24h != null
      ? fmtUsd(cost24h)
      : fmtUsdFromCents(fleetCostCents24h)

  return (
    <KpiGrid cols={5}>
      <Kpi
        label="agents"
        value={loading ? '…' : totalAgents.toLocaleString()}
        sub="registered"
      />
      <Kpi
        label="active (24h)"
        value={loading ? '…' : activeAgents.toLocaleString()}
        tone={activeAgents > 0 ? 'ok' : 'default'}
        sub={successRate7d != null ? `${fmtPct(successRate7d, 0)} succ (7d)` : ''}
      />
      <Kpi
        label="executions (24h)"
        value={loading ? '…' : executions24h.toLocaleString()}
        sub="agentRunLog rows"
      />
      <Kpi
        label="tokens (24h)"
        value={loading ? '…' : tokens24h != null ? fmtTokens(tokens24h) : '—'}
        sub="aggregate"
      />
      <Kpi
        label="cost (24h)"
        value={loading ? '…' : costDisplay}
        sub="dashboard roll-up"
      />
    </KpiGrid>
  )
}

export default AgentsHubPage
