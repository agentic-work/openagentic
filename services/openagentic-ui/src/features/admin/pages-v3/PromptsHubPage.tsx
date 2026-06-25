import * as React from 'react'
import {
  PageHead,
  Subtabs,
  KpiGrid,
  Kpi,
  Btn,
  EmptyInline,
} from '../primitives-v3'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { PipelinePane } from './prompts/PipelinePane'
import { EffectivenessPane } from './prompts/EffectivenessPane'
import { RbacTemplatesPane } from './prompts/RbacTemplatesPane'
import { ServicePromptsPane } from './prompts/ServicePromptsPane'

export type PromptsHubTab = 'pipeline' | 'effectiveness' | 'rbac' | 'service'

const TAB_ORDER: PromptsHubTab[] = ['pipeline', 'effectiveness', 'rbac', 'service']

const TABS = [
  { id: 'pipeline', label: 'Pipeline Settings' },
  { id: 'effectiveness', label: 'Effectiveness' },
  { id: 'rbac', label: 'RBAC Templates' },
  { id: 'service', label: 'Service Prompts' },
]

/**
 * Map a sidebar leaf id (or partial slug) to a hub tab. Legacy
 * `prompt-modules`, `prompt-effectiveness`, `prompt-metrics` fall through
 * to `rbac` since those panes are ripped (Phase E.6 + Phase W).
 */
function leafToTab(s: string | undefined): PromptsHubTab {
  if (!s) return 'rbac'
  if (s === 'pipeline-settings' || s === 'pipeline') return 'pipeline'
  if (s === 'rbac-system-prompts' || s === 'rbac' || s === 'rbac-templates') return 'rbac'
  if (s === 'prompt-modules' || s === 'modules') return 'rbac'
  if (s === 'prompt-effectiveness' || s === 'effectiveness') return 'effectiveness'
  if (s === 'prompt-metrics' || s === 'metrics') return 'rbac'
  if (s === 'service-prompts' || s === 'service') return 'service'
  return 'rbac'
}

export interface PromptsHubPageProps {
  initialTab?: PromptsHubTab | string
}

export const PromptsHubPage: React.FC<PromptsHubPageProps> = ({ initialTab }) => {
  const safeInitial = leafToTab(initialTab)

  const [tab, setTab] = React.useState<PromptsHubTab>(safeInitial)

  React.useEffect(() => {
    setTab(leafToTab(initialTab))
  }, [initialTab])

  // KPI data from the two alive-wired endpoints.
  const rbacQ = useAdminQuery<{ roles?: Array<{ role_key: string; active_version: number | null }> }>(
    ['prompts', 'rbac-summary'],
    '/api/admin/rbac-system-prompts',
    { staleTime: 60_000 },
  )
  const serviceQ = useAdminQuery<{ prompts?: Array<{ prompt_key: string }> }>(
    ['prompts', 'service-summary'],
    '/api/admin/service-prompts',
    { staleTime: 60_000 },
  )

  const rbacActiveCount = (rbacQ.data?.roles ?? []).filter((r) => r.active_version != null).length
  const serviceKeyCount = (serviceQ.data?.prompts ?? []).length

  const isLoadingAny = rbacQ.isLoading || serviceQ.isLoading

  const metaLine = isLoadingAny
    ? 'loading…'
    : `${rbacActiveCount} rbac roles active · ${serviceKeyCount} service prompt keys`

  const onRefresh = () => {
    rbacQ.refetch?.()
    serviceQ.refetch?.()
  }

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? 'Prompt Engineering'}
        meta={`prompt engineering · ${metaLine}`}
        actions={
          <Btn variant="ghost" onClick={onRefresh}>refresh</Btn>
        }
      />
      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as PromptsHubTab)} />

      <KpiGrid cols={2}>
        <Kpi
          label="rbac active versions"
          value={rbacQ.isLoading ? '…' : String(rbacActiveCount)}
          sub={`of ${(rbacQ.data?.roles ?? []).length} role keys seeded`}
          tone={rbacActiveCount > 0 ? 'ok' : 'warn'}
        />
        <Kpi
          label="service prompt keys"
          value={serviceQ.isLoading ? '…' : String(serviceKeyCount)}
          sub="slack · title-gen · codemode · memory"
          tone={serviceKeyCount > 0 ? 'ok' : 'warn'}
        />
      </KpiGrid>

      {tab === 'pipeline' && <PipelinePane />}
      {tab === 'effectiveness' && <EffectivenessPane />}
      {tab === 'rbac' && <RbacTemplatesPane />}
      {tab === 'service' && <ServicePromptsPane />}
      {!TAB_ORDER.includes(tab) && (
        <EmptyInline pad>unknown sub-tab: {String(tab)}</EmptyInline>
      )}
    </>
  )
}

export default PromptsHubPage

// Re-export the tab type so the host can import it without reaching into
// internal modules.
export type { PromptsHubTab as PromptsTab }
