import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  SidePanel,
} from '../primitives-v3'
import {
  useAdminQuery,
  useAdminInvalidate,
} from '../hooks/useAdminQuery'
import {
  useDashboardMetrics,
  useLlmRegistry,
} from '../hooks/useDashboardMetrics'
import {
  type RoleRow,
  type RoleKey,
  type DefaultModelsResponse,
  type DefaultModels,
  buildRoleRows,
  fmtUsd,
  fmtNum,
  ROLE_KEYS,
} from './default-models/types'
import { RolesPane } from './default-models/RolesPane'
import { UseCasePane } from './default-models/UseCasePane'
import { ConflictsPane } from './default-models/ConflictsPane'
import { RoleDetail } from './default-models/RoleDetail'
import { RoleAssignModal } from './default-models/RoleAssignModal'
import {
  useToast,
  useConfirm,
  ToastStack,
  ConfirmBanner,
  mutateRow,
} from './_shared/mutationHelpers'

const TABS = [
  { id: 'roles',       label: 'roles' },
  { id: 'use-case',    label: 'by use case' },
  { id: 'conflicts',   label: 'conflicts' },
]

const DETAIL_TABS = [
  { id: 'overview',   label: 'overview' },
  { id: 'alternates', label: 'alternates' },
  { id: 'usage',      label: 'usage' },
]

export const DefaultModelsPage: React.FC = () => {
  const [pane, setPane] = React.useState<string>('roles')
  const [detail, setDetail] = React.useState<RoleRow | null>(null)
  const [detailTab, setDetailTab] = React.useState('overview')
  const [modal, setModal] = React.useState<{ role: RoleKey | null; preselect: string | null } | null>(null)

  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useAdminInvalidate()

  const defaultsQ = useAdminQuery<DefaultModelsResponse>(
    ['default-models'],
    '/api/admin/llm-providers/default-models',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const registryQ = useLlmRegistry(true)
  const metrics = useDashboardMetrics('24h')

  const defaults: DefaultModels | null = defaultsQ.data?.defaults ?? null
  const registryRows = registryQ.data
  const modelUsage = metrics.data?.modelUsage

  const rows: RoleRow[] = React.useMemo(
    () => buildRoleRows(defaults, registryRows, modelUsage),
    [defaults, registryRows, modelUsage],
  )

  const totals = React.useMemo(() => {
    const configured = rows.filter((r) => r.assignedModel != null).length
    const stale = rows.filter((r) => r.isStale).length
    const totalReq = rows.reduce((acc, r) => acc + (r.usage?.count ?? 0), 0)
    const totalCost = rows.reduce((acc, r) => acc + (r.usage?.cost ?? 0), 0)
    return {
      configured,
      stale,
      totalRoles: ROLE_KEYS.length,
      modelCount: registryRows?.length ?? 0,
      totalReq,
      totalCost,
    }
  }, [rows, registryRows])

  React.useEffect(() => {
    if (detail) setDetailTab('overview')
  }, [detail?.key])

  // -----------------------------------------------------------
  // Mutation handlers
  // -----------------------------------------------------------
  const onAssignRole = () => setModal({ role: null, preselect: null })
  const onSwitchTo = (model: string) => {
    if (!detail) return
    setModal({ role: detail.key, preselect: model })
  }
  const onEditRole = (row: RoleRow) => {
    setModal({ role: row.key, preselect: row.assignedModel })
  }

  const onReset = () => {
    confirm.ask(
      'reset all role defaults to the helm seed values? this overwrites every per-role assignment.',
      async () => {
        await mutateRow({
          endpoint: '/api/admin/llm-providers/default-models/reset',
          method: 'POST',
          toast,
          invalidate,
          invalidateKeys: [['default-models']],
          successMessage: 'reset to helm seed',
          errorPrefix: 'reset failed',
        })
      },
    )
  }

  const onRefresh = () => {
    defaultsQ.refetch?.()
    registryQ.refetch?.()
  }

  const isLoading = defaultsQ.isLoading || registryQ.isLoading
  const isError = defaultsQ.isError

  return (
    <>
      <PageHead
        title="Default Models"
        meta={
          isLoading
            ? 'loading…'
            : `${totals.configured} / ${totals.totalRoles} roles configured · ${totals.modelCount} models registered · auto-refresh 60s`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={onRefresh}>refresh</Btn>
            <Btn variant="ghost" onClick={onReset}>reset</Btn>
            <Btn variant="primary" onClick={onAssignRole}>+ assign role</Btn>
          </>
        }
      />
      <Subtabs items={TABS} active={pane} onChange={setPane} />

      <ToastStack api={toast} />
      <ConfirmBanner api={confirm} />

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/llm-providers/default-models</span>
          {' '}— assignments below may be stale
        </Banner>
      )}
      {!isError && totals.stale > 0 && (
        <Banner level="warn" label="stale">
          {totals.stale} role{totals.stale === 1 ? '' : 's'} pinned to a model no longer in
          the registry — chat fallback will catch them, but pick a real default before that
          happens
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="roles configured"
          value={isLoading ? '…' : `${totals.configured} / ${totals.totalRoles}`}
          tone={totals.stale > 0 ? 'warn' : totals.configured === totals.totalRoles ? 'ok' : 'default'}
          sub={totals.stale > 0 ? `${totals.stale} stale` : 'all assignments healthy'}
        />
        <Kpi
          label="models in registry"
          value={isLoading ? '…' : String(totals.modelCount)}
          sub={registryRows?.length === 0 ? 'no enabled models' : 'enabled only'}
        />
        <Kpi
          label="total req (24h)"
          value={metrics.isLoading ? '…' : fmtNum(totals.totalReq)}
          sub="across roles with usage"
        />
        <Kpi
          label="total cost (24h)"
          value={metrics.isLoading ? '…' : fmtUsd(totals.totalCost)}
          sub={metrics.data?.period?.start ? `since ${new Date(metrics.data.period.start).toLocaleDateString()}` : ''}
        />
      </KpiGrid>

      {pane === 'roles' && (
        <RolesPane
          rows={rows}
          isLoading={isLoading}
          isError={isError}
          onOpen={setDetail}
        />
      )}
      {pane === 'use-case' && (
        <UseCasePane
          rows={rows}
          isLoading={isLoading}
          isError={isError}
          onOpen={setDetail}
        />
      )}
      {pane === 'conflicts' && (
        <ConflictsPane
          rows={rows}
          isLoading={isLoading}
          isError={isError}
        />
      )}

      <SidePanel
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? `Role · ${detail.meta.label}` : ''}
        meta={
          detail
            ? `${detail.meta.useCase} · ${detail.assignedModel ?? 'unset'}${detail.isStale ? ' · stale' : ''}`
            : undefined
        }
        tabs={DETAIL_TABS}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        headActions={
          detail && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Btn variant="ghost" onClick={() => onEditRole(detail)}>edit</Btn>
            </span>
          )
        }
      >
        {detail && (
          <RoleDetail
            row={detail}
            tab={detailTab}
            registry={registryRows}
            onSwitchTo={onSwitchTo}
          />
        )}
      </SidePanel>

      <RoleAssignModal
        open={modal != null}
        onClose={() => setModal(null)}
        role={modal?.role ?? null}
        preselectModel={modal?.preselect ?? null}
        defaults={defaults}
        registry={registryRows}
        toast={toast}
      />
    </>
  )
}

export default DefaultModelsPage
