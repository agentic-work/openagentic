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
  useDashboardMetrics,
  useProviderHealth,
  useLlmProviders,
  useAuditLogs,
} from '../hooks/useDashboardMetrics'
import {
  type ProviderRow,
  type StatusFilter,
  buildProviderRows,
  fmtUsd,
} from './llm-providers/types'
import { OverviewPane } from './llm-providers/OverviewPane'
import { HealthPane } from './llm-providers/HealthPane'
import { ModelsPane } from './llm-providers/ModelsPane'
import { CostPane } from './llm-providers/CostPane'
import { ActivityPane } from './llm-providers/ActivityPane'
// B'-22: LLM Performance is now a sub-tab under Provider Management
// (was its own sidebar leaf). The standalone leaf still routes to
// the same component for backwards compat with deep links.
import { PerformancePane } from './llm-extras/PerformancePane'
import { ProviderDetail } from './llm-providers/ProviderDetail'
import { ProviderModal } from './llm-providers/ProviderModal'
import {
  useToast,
  useConfirm,
  ToastStack,
  ConfirmBanner,
  mutateRow,
} from './_shared/mutationHelpers'
import { useAdminInvalidate } from '../hooks/useAdminQuery'
import { useUrlFilter } from '../hooks/useUrlFilter'

const TABS = [
  { id: 'overview',    label: 'overview' },
  { id: 'health',      label: 'health' },
  { id: 'models',      label: 'models' },
  { id: 'performance', label: 'performance' },
  { id: 'cost',        label: 'cost' },
  { id: 'activity',    label: 'activity' },
]

const DETAIL_TABS = [
  { id: 'overview', label: 'overview' },
  { id: 'models',   label: 'models' },
  { id: 'auth',     label: 'auth' },
  { id: 'logs',     label: 'logs' },
  { id: 'cost',     label: 'cost' },
]

export const LLMProvidersPage: React.FC = () => {
  const [pane, setPane] = React.useState<string>('overview')
  // B-7 wire: filter state in URL via useUrlFilter so bookmarks /
  // share-links / back-button preserve the operator's view.
  const filter = useUrlFilter('llm-providers')
  const statusFilter = (filter.filters.status as StatusFilter | undefined) ?? 'all'
  const setStatusFilter = (v: StatusFilter) =>
    filter.set('status', v === 'all' ? null : v)
  const search = filter.filters.q ?? ''
  const setSearch = (v: string) => filter.set('q', v)
  const [detail, setDetail] = React.useState<ProviderRow | null>(null)
  const [detailTab, setDetailTab] = React.useState('overview')

  // Modal state — null means closed; an object means open (edit if .row, add otherwise)
  const [modal, setModal] = React.useState<{ row: ProviderRow | null } | null>(null)

  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useAdminInvalidate()

  const llmProviders = useLlmProviders()
  const providerHealth = useProviderHealth()
  const metrics = useDashboardMetrics('24h')
  const auditLogs = useAuditLogs(50)

  const rows = React.useMemo(
    () => buildProviderRows(llmProviders.data?.providers, providerHealth.data?.providers),
    [llmProviders.data, providerHealth.data],
  )
  const totals = React.useMemo(() => {
    const total = rows.length
    const healthy = rows.filter((r) => r.status === 'healthy').length
    const degraded = rows.filter((r) => r.status === 'degraded').length
    const disabled = rows.filter((r) => r.status === 'disabled').length
    const modelCount = rows.reduce((n, r) => n + r.modelCount, 0)
    return { total, healthy, degraded, disabled, modelCount }
  }, [rows])

  const summary = metrics.data?.summary
  const period = metrics.data?.period
  const isLoading = llmProviders.isLoading
  const isError = llmProviders.isError

  React.useEffect(() => {
    if (detail) setDetailTab('overview')
  }, [detail?.id])

  // -----------------------------------------------------------
  // Mutation handlers
  // -----------------------------------------------------------
  const onAdd = () => setModal({ row: null })
  const onEdit = (row: ProviderRow) => setModal({ row })
  const onDelete = (row: ProviderRow) => {
    confirm.ask(
      `delete provider "${row.displayName}"? this disables every model attached to it.`,
      async () => {
        const out = await mutateRow({
          endpoint: `/api/admin/llm-providers/${row.id}?force=true`,
          method: 'DELETE',
          toast,
          invalidate,
          invalidateKeys: [['llm-providers'], ['provider-health'], ['llm-registry', 'enabled'], ['llm-registry', 'all']],
          successMessage: `deleted "${row.displayName}"`,
          errorPrefix: 'delete failed',
        })
        if (out.ok && detail?.id === row.id) setDetail(null)
      },
    )
  }

  const onToggle = (row: ProviderRow, next: boolean) => {
    void mutateRow({
      endpoint: `/api/admin/llm-providers/${row.id}`,
      method: 'PUT',
      body: { enabled: next, version: (row.raw as any).version ?? 1 },
      toast,
      invalidate,
      invalidateKeys: [['llm-providers'], ['provider-health']],
      successMessage: `${next ? 'enabled' : 'disabled'} "${row.displayName}"`,
      errorPrefix: 'toggle failed',
    })
  }

  const onHealthCheck = (row: ProviderRow) => {
    void mutateRow({
      endpoint: `/api/admin/llm-providers/${row.name}/test`,
      method: 'POST',
      body: { testType: 'basic' },
      toast,
      invalidate,
      invalidateKeys: [['provider-health'], ['llm-providers']],
      successMessage: `re-probed "${row.displayName}"`,
      errorPrefix: 'health check failed',
    })
  }

  const onRefresh = () => {
    llmProviders.refetch?.()
    providerHealth.refetch?.()
  }

  return (
    <>
      <PageHead
        title="Providers"
        meta={
          isLoading
            ? 'loading…'
            : `${totals.total} registered · ${totals.healthy} healthy · ${totals.modelCount} models · auto-refresh 30s`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={onRefresh}>refresh</Btn>
            <Btn variant="primary" onClick={onAdd}>+ add provider</Btn>
          </>
        }
      />
      <Subtabs items={TABS} active={pane} onChange={setPane} />

      <ToastStack api={toast} />
      <ConfirmBanner api={confirm} />

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/llm-providers</span> — values may be stale
        </Banner>
      )}
      {!isError && totals.degraded > 0 && (
        <Banner level="warn" label="degraded">
          {totals.degraded} provider{totals.degraded === 1 ? '' : 's'} unhealthy —{' '}
          {rows.filter((r) => r.status === 'degraded').map((r) => r.displayName).join(', ')}
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="total providers"
          value={isLoading ? '…' : String(totals.total)}
          sub={isLoading ? '' : `${totals.disabled} disabled`}
        />
        <Kpi
          label="healthy"
          value={isLoading ? '…' : `${totals.healthy} / ${totals.total || 0}`}
          tone={totals.degraded > 0 ? 'warn' : 'ok'}
          sub={totals.degraded > 0 ? `${totals.degraded} degraded` : 'all green'}
        />
        <Kpi
          label="models registered"
          value={isLoading ? '…' : String(totals.modelCount)}
          sub={`across ${totals.total} provider${totals.total === 1 ? '' : 's'}`}
        />
        <Kpi
          label="spend (24h)"
          value={metrics.isLoading ? '…' : fmtUsd(summary?.totalCost)}
          sub={
            period
              ? `${new Date(period.start).toLocaleDateString()} → ${new Date(period.end).toLocaleDateString()}`
              : ''
          }
        />
      </KpiGrid>

      {pane === 'overview' && (
        <OverviewPane
          rows={rows}
          isLoading={isLoading}
          search={search}
          onSearch={setSearch}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onOpen={setDetail}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onAdd={onAdd}
          onBulkSetEnabled={(sel, next) => {
            Promise.all(
              sel.map((row) =>
                fetch(`/api/admin/llm-providers/${row.id}`, {
                  method: 'PUT',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: next }),
                }).then((r) => ({ ok: r.ok, name: row.name })),
              ),
            ).then((results) => {
              const failed = results.filter((r) => !r.ok)
              if (failed.length === 0) {
                toast.show('ok', 'bulk', `${next ? 'enabled' : 'disabled'} ${sel.length} provider${sel.length === 1 ? '' : 's'}`)
              } else {
                toast.show('err', 'bulk', `${failed.length}/${sel.length} ops failed: ${failed.map((f) => f.name).join(', ')}`)
              }
              for (const k of [['llm-providers'], ['llm-providers', 'enabled']]) {
                invalidate(k as string[])
              }
            })
          }}
          onBulkDelete={(sel) => {
            const preview = sel.slice(0, 5).map((r) => r.name).join(', ') + (sel.length > 5 ? '…' : '')
            confirm.ask(
              `Delete ${sel.length} provider${sel.length === 1 ? '' : 's'}? (${preview})`,
              () => {
                Promise.all(
                  sel.map((row) =>
                    fetch(`/api/admin/llm-providers/${row.id}?force=true`, {
                      method: 'DELETE',
                      credentials: 'include',
                    }).then((r) => ({ ok: r.ok, name: row.name })),
                  ),
                ).then((results) => {
                  const failed = results.filter((r) => !r.ok)
                  if (failed.length === 0) {
                    toast.show('ok', 'bulk', `deleted ${sel.length} provider${sel.length === 1 ? '' : 's'}`)
                  } else {
                    toast.show('err', 'bulk', `${failed.length}/${sel.length} deletes failed: ${failed.map((f) => f.name).join(', ')}`)
                  }
                  for (const k of [['llm-providers'], ['llm-providers', 'enabled']]) {
                    invalidate(k as string[])
                  }
                })
              },
            )
          }}
        />
      )}
      {pane === 'health' && (
        <HealthPane rows={rows} isLoading={isLoading} metrics={metrics} onOpen={setDetail} />
      )}
      {pane === 'models' && (
        <ModelsPane rows={rows} isLoading={isLoading} />
      )}
      {pane === 'performance' && (
        <PerformancePane />
      )}
      {pane === 'cost' && (
        <CostPane rows={rows} metrics={metrics} />
      )}
      {pane === 'activity' && (
        <ActivityPane auditLogs={auditLogs} />
      )}

      <SidePanel
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail?.displayName ?? ''}
        meta={detail ? `${detail.type} · ${detail.region} · ${detail.modelCount} models` : undefined}
        tabs={DETAIL_TABS.map((t) =>
          t.id === 'models' ? { ...t, count: detail?.modelCount ?? 0 } : t,
        )}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        headActions={
          detail && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Btn variant="ghost" onClick={() => onHealthCheck(detail)}>re-probe</Btn>
              <Btn variant="ghost" onClick={() => onEdit(detail)}>edit</Btn>
            </span>
          )
        }
      >
        {detail && (
          <ProviderDetail row={detail} tab={detailTab} metrics={metrics} auditLogs={auditLogs} />
        )}
      </SidePanel>

      <ProviderModal
        open={modal != null}
        onClose={() => setModal(null)}
        editing={modal?.row?.raw ?? null}
        toast={toast}
      />
    </>
  )
}

export default LLMProvidersPage
