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
  useLlmProviders,
  useLlmRegistry,
  useAuditLogs,
} from '../hooks/useDashboardMetrics'
import {
  type ModelRow,
  type StatusFilter,
  buildModelRows,
  computeAvgCostPer1k,
  fmtUsd,
} from './model-registry/types'
import { CatalogPane } from './model-registry/CatalogPane'
import { CapabilitiesPane } from './model-registry/CapabilitiesPane'
import { PricingPane } from './model-registry/PricingPane'
import { UsagePane } from './model-registry/UsagePane'
import { PlaygroundPane } from './model-registry/PlaygroundPane'
import { ModelDetail } from './model-registry/ModelDetail'
import { ModelModal } from './model-registry/ModelModal'
import { ModelBrowseModal } from './model-registry/ModelBrowseModal'
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
  { id: 'catalog',      label: 'catalog' },
  { id: 'capabilities', label: 'capabilities' },
  { id: 'pricing',      label: 'pricing' },
  { id: 'usage',        label: 'live usage' },
  { id: 'playground',   label: 'playground' },
]

const DETAIL_TABS = [
  { id: 'overview',     label: 'overview' },
  { id: 'capabilities', label: 'caps' },
  { id: 'pricing',      label: 'pricing' },
  { id: 'usage',        label: 'usage 24h' },
  { id: 'logs',         label: 'logs' },
]

export const ModelRegistryPage: React.FC = () => {
  // Phase B-7 wire-up: filter state lives in the URL via useUrlFilter so
  // bookmarks / share links / back-button work. Local setStatus/setProvider/
  // setCapability/setSearch handlers proxy through filter.set().
  const filter = useUrlFilter('model-registry')
  const [pane, setPane] = React.useState<string>('catalog')
  const search = filter.filters.q ?? ''
  const setSearch = (v: string) => filter.set('q', v)
  const statusFilter = (filter.filters.status as StatusFilter | undefined) ?? 'all'
  const setStatusFilter = (v: StatusFilter) =>
    filter.set('status', v === 'all' ? null : v)
  const providerFilter = filter.filters.provider ?? null
  const setProviderFilter = (v: string | null) => filter.set('provider', v)
  const capabilityFilter = filter.filters.cap ?? null
  const setCapabilityFilter = (v: string | null) => filter.set('cap', v)
  const [detail, setDetail] = React.useState<ModelRow | null>(null)
  const [detailTab, setDetailTab] = React.useState('overview')

  const [modal, setModal] = React.useState<{ row: ModelRow | null } | null>(null)
  // Add-from-catalog modal — browse provider SDK and one-click add.
  // Edit still uses ModelModal (registry-row PATCH path).
  const [browseOpen, setBrowseOpen] = React.useState(false)

  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useAdminInvalidate()

  const registryQ = useLlmRegistry(false)
  const providersQ = useLlmProviders()
  const metrics = useDashboardMetrics('24h')
  const auditLogs = useAuditLogs(50)

  const rows: ModelRow[] = React.useMemo(
    () => buildModelRows(registryQ.data, providersQ.data?.providers),
    [registryQ.data, providersQ.data],
  )

  const totals = React.useMemo(() => {
    const total = rows.length
    const enabled = rows.filter((r) => r.enabled).length
    const providers = new Set(rows.map((r) => r.provider)).size
    const avgCost = computeAvgCostPer1k(rows)
    return { total, enabled, providers, avgCost }
  }, [rows])

  React.useEffect(() => {
    if (detail) setDetailTab('overview')
  }, [detail?.id])

  // -----------------------------------------------------------
  // Mutation handlers
  // -----------------------------------------------------------
  // Add now opens the browse-catalog modal so admins pick from the live
  // provider SDK (full Bedrock / Vertex / AIF / Ollama catalog, sortable by
  // capability/context/tier) instead of typing model IDs from memory.
  // Restores v1 admin UX; backed by /admin/llm-providers/:name/discover-models.
  const onAdd = () => setBrowseOpen(true)
  const onEdit = (row: ModelRow) => setModal({ row })

  const onDelete = (row: ModelRow) => {
    confirm.ask(
      `delete model "${row.model}" from "${row.providerDisplay}"? this removes it from chat / flows / agents routing.`,
      async () => {
        const out = await mutateRow({
          endpoint: `/api/admin/llm-providers/${encodeURIComponent(row.provider)}/models/${encodeURIComponent(row.model)}?force=true`,
          method: 'DELETE',
          toast,
          invalidate,
          invalidateKeys: [
            ['llm-registry', 'enabled'],
            ['llm-registry', 'all'],
            ['llm-providers'],
          ],
          successMessage: `removed "${row.model}"`,
          errorPrefix: 'delete failed',
        })
        if (out.ok && detail?.id === row.id) setDetail(null)
      },
    )
  }

  const onToggle = (row: ModelRow, next: boolean) => {
    void mutateRow({
      endpoint: `/api/admin/llm-providers/registry/${row.id}`,
      method: 'PATCH',
      body: { enabled: next },
      toast,
      invalidate,
      invalidateKeys: [['llm-registry', 'enabled'], ['llm-registry', 'all'], ['llm-providers']],
      successMessage: `${next ? 'enabled' : 'disabled'} "${row.model}"`,
      errorPrefix: 'toggle failed',
    })
  }

  const onRefresh = () => {
    registryQ.refetch?.()
    providersQ.refetch?.()
  }

  const onRefreshFromProviders = async () => {
    // Calls the bulk refresh-all endpoint which walks every enabled
    // provider, runs discoverModels() server-side, and merges results
    // into the registry. Idempotent — running twice gives the same
    // merged set.
    try {
      const { apiRequest } = await import('@/utils/api')
      const resp = await apiRequest('/api/admin/llm-providers/registry/refresh-all', {
        method: 'POST',
      })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`refresh-all failed: ${resp.status} ${txt}`)
      }
      const body = await resp.json().catch(() => null)
      const summary = body?.summary
      const errs = summary?.errors?.length ?? 0
      toast.show(
        errs > 0 ? 'warn' : 'ok',
        'refresh',
        summary
          ? `scanned ${summary.providersScanned} · +${summary.modelsAdded} added · ${summary.modelsUpdated} updated${
              errs > 0 ? ` · ${errs} errors` : ''
            }`
          : 'refresh complete',
      )
      onRefresh()
    } catch (err: any) {
      toast.show('err', 'refresh failed', err?.message ?? 'unknown error')
    }
  }

  const onRefreshOne = (row: ModelRow) => {
    void mutateRow({
      endpoint: `/api/admin/llm-providers/${encodeURIComponent(row.provider)}/models/${encodeURIComponent(row.model)}/refresh`,
      method: 'POST',
      toast,
      invalidate,
      invalidateKeys: [['llm-registry', 'enabled'], ['llm-registry', 'all']],
      successMessage: `refreshed "${row.model}"`,
      errorPrefix: 'refresh failed',
    })
  }

  const isLoading = registryQ.isLoading || providersQ.isLoading
  const isError = registryQ.isError

  return (
    <>
      <PageHead
        title="Models"
        meta={
          isLoading
            ? 'loading…'
            : `${totals.total} models · ${totals.enabled} enabled · ${totals.providers} providers · auto-refresh 60s`
        }
        actions={
          <>
            <Btn variant="ghost" onClick={onRefresh}>refresh</Btn>
            <Btn variant="ghost" onClick={onRefreshFromProviders}>refresh from providers</Btn>
            <Btn variant="primary" onClick={onAdd}>+ add model</Btn>
          </>
        }
      />
      <Subtabs items={TABS} active={pane} onChange={setPane} />

      <ToastStack api={toast} />
      <ConfirmBanner api={confirm} />

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/llm-providers/registry</span> — values
          may be stale
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="models in registry"
          value={isLoading ? '…' : String(totals.total)}
          sub={totals.total === 0 ? 'empty registry' : 'across all providers'}
        />
        <Kpi
          label="enabled"
          value={isLoading ? '…' : `${totals.enabled} / ${totals.total || 0}`}
          tone={totals.enabled === 0 && totals.total > 0 ? 'warn' : 'ok'}
          sub={
            totals.total - totals.enabled > 0
              ? `${totals.total - totals.enabled} disabled`
              : 'all enabled'
          }
        />
        <Kpi
          label="providers"
          value={isLoading ? '…' : String(totals.providers)}
          sub="distinct provider rows"
        />
        <Kpi
          label="avg cost / 1M tok"
          value={isLoading ? '…' : totals.avgCost == null ? '—' : fmtUsd(totals.avgCost * 1000)}
          sub={totals.avgCost == null ? 'no priced models' : 'input cost · across enabled'}
        />
      </KpiGrid>

      {pane === 'catalog' && (
        <CatalogPane
          rows={rows}
          isLoading={isLoading}
          search={search}
          onSearch={setSearch}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          providerFilter={providerFilter}
          onProviderFilter={setProviderFilter}
          capabilityFilter={capabilityFilter}
          onCapabilityFilter={setCapabilityFilter}
          onOpen={setDetail}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onAdd={onAdd}
          onBulkSetEnabled={(sel, next) => {
            // Fan out one PATCH per selected row. Toast aggregated
            // result so a single bulk action doesn't spam N notifs.
            Promise.all(
              sel.map((row) =>
                fetch(`/api/admin/llm-providers/registry/${row.id}`, {
                  method: 'PATCH',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: next }),
                }).then((r) => ({ ok: r.ok, model: row.model })),
              ),
            ).then((results) => {
              const failed = results.filter((r) => !r.ok)
              if (failed.length === 0) {
                toast.show('ok', 'bulk', `${next ? 'enabled' : 'disabled'} ${sel.length} model${sel.length === 1 ? '' : 's'}`)
              } else {
                toast.show('err', 'bulk', `${failed.length}/${sel.length} ops failed: ${failed.map((f) => f.model).join(', ')}`)
              }
              for (const k of [['llm-registry', 'enabled'], ['llm-registry', 'all'], ['llm-providers']]) {
                invalidate(k as string[])
              }
            })
          }}
          onBulkDelete={(sel) => {
            const preview = sel.slice(0, 5).map((r) => r.model).join(', ') + (sel.length > 5 ? '…' : '')
            confirm.ask(
              `Delete ${sel.length} model${sel.length === 1 ? '' : 's'}? (${preview})`,
              () => {
                Promise.all(
                  sel.map((row) =>
                    fetch(`/api/admin/llm-providers/registry/${row.id}`, {
                      method: 'DELETE',
                      credentials: 'include',
                    }).then((r) => ({ ok: r.ok, model: row.model })),
                  ),
                ).then((results) => {
                  const failed = results.filter((r) => !r.ok)
                  if (failed.length === 0) {
                    toast.show('ok', 'bulk', `deleted ${sel.length} model${sel.length === 1 ? '' : 's'}`)
                  } else {
                    toast.show('err', 'bulk', `${failed.length}/${sel.length} deletes failed: ${failed.map((f) => f.model).join(', ')}`)
                  }
                  for (const k of [['llm-registry', 'enabled'], ['llm-registry', 'all'], ['llm-providers']]) {
                    invalidate(k as string[])
                  }
                })
              },
            )
          }}
        />
      )}
      {pane === 'capabilities' && (
        <CapabilitiesPane rows={rows} isLoading={isLoading} />
      )}
      {pane === 'pricing' && (
        <PricingPane rows={rows} isLoading={isLoading} />
      )}
      {pane === 'usage' && (
        <UsagePane
          rows={rows}
          modelUsage={metrics.data?.modelUsage}
          isLoading={isLoading || metrics.isLoading}
        />
      )}
      {pane === 'playground' && (
        <PlaygroundPane
          providers={providersQ.data?.providers}
          isLoading={providersQ.isLoading}
        />
      )}

      <SidePanel
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail?.model ?? ''}
        meta={
          detail
            ? `${detail.providerDisplay} · ${detail.role}${detail.enabled ? '' : ' · disabled'}`
            : undefined
        }
        tabs={DETAIL_TABS}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        headActions={
          detail && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Btn variant="ghost" onClick={() => onRefreshOne(detail)}>refresh</Btn>
              <Btn variant="ghost" onClick={() => onEdit(detail)}>edit</Btn>
            </span>
          )
        }
      >
        {detail && (
          <ModelDetail
            row={detail}
            tab={detailTab}
            modelUsage={metrics.data?.modelUsage}
            auditLogs={auditLogs}
          />
        )}
      </SidePanel>

      <ModelModal
        open={modal != null}
        onClose={() => setModal(null)}
        editing={modal?.row ?? null}
        providers={providersQ.data?.providers}
        toast={toast}
      />
      <ModelBrowseModal
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        providers={providersQ.data?.providers}
        existingModels={rows.map((r) => ({ model: r.model, providerName: r.providerName }))}
        toast={toast}
      />
    </>
  )
}

export default ModelRegistryPage
