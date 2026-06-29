import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  EmptyInline,
} from '../primitives-v3'
import {
  TABS,
  TAB_ORDER,
  leafToTab,
  fmtNum,
  type FlowsExtrasTab,
} from './flows-extras/types'
import {
  useWorkflowSecrets,
  useWorkflowGovernance,
  useFlowsKpiDashboard,
  useTeamsList,
  type KpiWindow,
} from './flows-extras/hooks'
import { CredentialsPane, type SecretScopeFilter } from './flows-extras/CredentialsPane'
import { GovernancePane } from './flows-extras/GovernancePane'
import { KpiDashboardPane } from './flows-extras/KpiDashboardPane'
import { TeamsPane, type TeamActiveFilter } from './flows-extras/TeamsPane'

export interface FlowsExtrasHubPageProps {
  /** Sub-tab to land on. Mapped from leaf id by AdminPortalHostV3. */
  initialTab?: FlowsExtrasTab | string
}

export const FlowsExtrasHubPage: React.FC<FlowsExtrasHubPageProps> = ({ initialTab }) => {
  const safeInitial = leafToTab(initialTab as string | undefined)
  const [tab, setTab] = React.useState<FlowsExtrasTab>(safeInitial)

  // Honor leaf-driven re-mounts: the host re-renders this page whenever
  // the operator clicks a different flow-extras leaf in the sidebar.
  React.useEffect(() => {
    setTab(leafToTab(initialTab as string | undefined))
  }, [initialTab])

  // Pane-level filter state lives at the hub so switching tabs and
  // returning preserves the operator's chips/search.
  const [credSearch, setCredSearch] = React.useState('')
  const [credScope, setCredScope] = React.useState<SecretScopeFilter>('all')
  const [teamsSearch, setTeamsSearch] = React.useState('')
  const [teamsActive, setTeamsActive] = React.useState<TeamActiveFilter>('all')
  const [kpiWindow, setKpiWindow] = React.useState<KpiWindow>('24h')

  // Page-level data — drives the meta line and the KPI grid. Each pane
  // would also fetch its own data, but we lift the queries here so the
  // hub KPI strip is filled even on a tab the operator hasn't visited
  // yet. React Query dedupes the request between hub + pane.
  const credsQ = useWorkflowSecrets()
  const govQ = useWorkflowGovernance()
  const kpisQ = useFlowsKpiDashboard(kpiWindow)
  const teamsQ = useTeamsList()

  const secrets = credsQ.data?.secrets ?? []
  const teams = teamsQ.data?.teams ?? []
  const kpis = kpisQ.data

  // Governance "violation count" is intentionally derived only from
  // surfaces the API actually exposes. The settings endpoint hands back
  // current org defaults — there's no `violations` channel — so we
  // surface a single read-only signal: the number of node types the org
  // has globally disabled. That maps to the "policy is restricting
  // something" idea without lying about runtime violations.
  const disabledNodes = Array.isArray(govQ.data?.disabledNodeTypes)
    ? (govQ.data!.disabledNodeTypes as string[]).length
    : 0
  const govLoaded = !govQ.isLoading && !govQ.isError && govQ.data != null

  const failingNodes = kpis?.top_failing_nodes?.length ?? 0
  const totalExecs = kpis?.total_executions ?? 0

  const isLoadingAny =
    credsQ.isLoading || govQ.isLoading || kpisQ.isLoading || teamsQ.isLoading

  const metaLine = isLoadingAny
    ? 'loading…'
    : `${secrets.length} secrets · ${disabledNodes} disabled node types · ${fmtNum(totalExecs)} runs (${kpiWindow}) · ${teams.length} teams`

  const onRefresh = () => {
    credsQ.refetch?.()
    govQ.refetch?.()
    kpisQ.refetch?.()
    teamsQ.refetch?.()
  }

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? "Flow Operations"}
        meta={metaLine}
        actions={
          <Btn variant="ghost" onClick={onRefresh}>
            refresh
          </Btn>
        }
      />
      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as FlowsExtrasTab)} />

      <Banner level="info" label="read-only">
        Flow Operations renders live config + KPI data. Mutations route through the v2
        fallback (<span className="accent">?v3=0</span>) until v3 wires the write paths.
      </Banner>

      <KpiGrid cols={4}>
        <Kpi
          label="credentials stored"
          value={credsQ.isLoading ? '…' : String(secrets.length)}
          sub={
            credsQ.data?.secrets
              ? `${secrets.filter((s) => s.scope === 'global').length} global · ${secrets.filter((s) => s.scope === 'workflow').length} flow · ${secrets.filter((s) => s.scope === 'group').length} group`
              : 'no secrets registered'
          }
        />
        <Kpi
          label="governance violations"
          value={govQ.isLoading ? '…' : govLoaded ? String(failingNodes) : '—'}
          tone={failingNodes > 0 ? 'warn' : 'default'}
          sub={
            govLoaded
              ? `${disabledNodes} node types disabled · ${kpiWindow} window`
              : 'governance config unavailable'
          }
        />
        <Kpi
          label="kpi snapshots"
          value={kpisQ.isLoading ? '…' : fmtNum(totalExecs)}
          sub={
            kpis?.success_rate != null
              ? `${kpis.success_rate.toFixed(1)}% success · ${kpiWindow}`
              : `window ${kpiWindow}`
          }
          tone={
            kpis?.success_rate == null
              ? 'default'
              : kpis.success_rate >= 95
                ? 'ok'
                : kpis.success_rate >= 80
                  ? 'warn'
                  : 'err'
          }
        />
        <Kpi
          label="teams"
          value={teamsQ.isLoading ? '…' : String(teams.length)}
          sub={
            teamsQ.data?.teams
              ? `${teams.filter((t) => t.is_active).length} active · ${teams.reduce((n, t) => n + (t.member_count ?? 0), 0)} members`
              : 'no teams configured'
          }
        />
      </KpiGrid>

      {tab === 'credentials' && (
        <CredentialsPane
          rows={secrets}
          isLoading={credsQ.isLoading}
          isError={credsQ.isError}
          search={credSearch}
          onSearch={setCredSearch}
          scope={credScope}
          onScope={setCredScope}
        />
      )}
      {tab === 'governance' && (
        <GovernancePane
          data={govQ.data ?? null}
          isLoading={govQ.isLoading}
          isError={govQ.isError}
        />
      )}
      {tab === 'kpis' && (
        <KpiDashboardPane
          data={kpis ?? null}
          isLoading={kpisQ.isLoading}
          isError={kpisQ.isError}
          window={kpiWindow}
          onWindow={setKpiWindow}
        />
      )}
      {tab === 'teams' && (
        <TeamsPane
          rows={teams}
          isLoading={teamsQ.isLoading}
          isError={teamsQ.isError}
          search={teamsSearch}
          onSearch={setTeamsSearch}
          active={teamsActive}
          onActive={setTeamsActive}
        />
      )}
      {!TAB_ORDER.includes(tab) && (
        <EmptyInline pad>unknown sub-tab: {String(tab)}</EmptyInline>
      )}
    </>
  )
}

export default FlowsExtrasHubPage
