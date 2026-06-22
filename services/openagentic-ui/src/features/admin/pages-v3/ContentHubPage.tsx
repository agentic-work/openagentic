import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  EmptyInline,
  SidePanel,
} from '../primitives-v3'
import { SharedKBPane } from './content/SharedKBPane'
import { DataLayerPane } from './content/DataLayerPane'
import { UserMemoryPane } from './content/UserMemoryPane'
import {
  SharedKBDetail,
  UserMemoryDetail,
} from './content/Detail'
import { SharedKBModal, type SharedKBModalMode } from './content/SharedKBModal'
import {
  useSharedKBSources,
  useRedisMetrics,
  useMilvusMetrics,
  useVectorUsage,
  useUserContextOverview,
  normalizeUserContextUsers,
  fmtNum,
  type SharedKBSourceRow,
  type SharedKBType,
  type UserContextSummary,
} from './content/hooks'
import { apiRequest } from '@/utils/api'

export type ContentHubTab = 'shared-kb' | 'data-layer' | 'user-memory'

const TAB_ORDER: ContentHubTab[] = ['shared-kb', 'data-layer', 'user-memory']

const TABS = [
  { id: 'shared-kb', label: 'Knowledge Base' },
  { id: 'data-layer', label: 'Data Layer' },
  { id: 'user-memory', label: 'User Memory' },
]

function leafToTab(s: string | undefined): ContentHubTab {
  if (!s) return 'shared-kb'
  // Legacy 'templates' leaf falls through to KB now that Templates tab is ripped.
  if (s === 'templates') return 'shared-kb'
  if (s === 'shared-kb') return 'shared-kb'
  if (s === 'data-layer') return 'data-layer'
  if (s === 'user-memory' || s === 'user-context') return 'user-memory'
  return 'shared-kb'
}

export interface ContentHubPageProps {
  initialTab?: ContentHubTab | string
}

export const ContentHubPage: React.FC<ContentHubPageProps> = ({ initialTab }) => {
  const safeInitial = leafToTab(initialTab)
  const [tab, setTab] = React.useState<ContentHubTab>(safeInitial)
  const [toast, setToast] = React.useState<{ level: 'ok' | 'err' | 'info'; msg: string } | null>(null)

  // Honor leaf-driven re-mounts: AdminPortalHostV3 passes a fresh
  // initialTab when the operator clicks a different content leaf.
  React.useEffect(() => {
    setTab(leafToTab(initialTab))
  }, [initialTab])

  const showToast = React.useCallback((level: 'ok' | 'err' | 'info', msg: string) => {
    setToast({ level, msg })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  // Mutation modal state
  const [kbModal, setKbModal] = React.useState<{ open: boolean; mode: SharedKBModalMode; initial: SharedKBSourceRow | null }>(
    { open: false, mode: 'create', initial: null },
  )
  const [kbBusy, setKbBusy] = React.useState(false)
  const [kbError, setKbError] = React.useState<string | null>(null)
  const [actionBusy, setActionBusy] = React.useState<string | null>(null)

  // Per-pane state (kept at hub level so tab switching doesn't reset it).
  const [kbSearch, setKbSearch] = React.useState('')
  const [kbType, setKbType] = React.useState<'all' | SharedKBType>('all')
  const [memSearch, setMemSearch] = React.useState('')

  // Detail panel state
  const [kbDetail, setKbDetail] = React.useState<SharedKBSourceRow | null>(null)
  const [memDetail, setMemDetail] = React.useState<UserContextSummary | null>(null)

  // Hub-wide queries — drive the cross-section KPIs + meta line.
  const kbQ = useSharedKBSources()
  const redisQ = useRedisMetrics()
  const milvusQ = useMilvusMetrics()
  const vectorUsageQ = useVectorUsage()
  const userCtxQ = useUserContextOverview()

  const kbSources = kbQ.data?.sources ?? []
  const userOverview = userCtxQ.data?.overview
  const userRows = React.useMemo(
    () => normalizeUserContextUsers(userCtxQ.data?.users),
    [userCtxQ.data?.users],
  )

  // Cross-section KPIs.
  const totalKbDocs = kbSources.reduce<number>((a, s) => a + (s.doc_count ?? 0), 0)
  const totalKbChunks = kbSources.reduce<number>((a, s) => a + (s.chunk_count ?? 0), 0)
  const dataSourcesActive =
    (redisQ.data?.connected ? 1 : 0) +
    (milvusQ.data?.connected ? 1 : 0) +
    ((vectorUsageQ.data?.pgvectorTotals
      ? Object.values(vectorUsageQ.data.pgvectorTotals).some((v) => typeof v === 'number' && v > 0)
      : false)
      ? 1
      : 0)
  const memoryEntries = userOverview?.totalEntries ?? 0

  const isLoadingAny =
    kbQ.isLoading ||
    redisQ.isLoading ||
    milvusQ.isLoading ||
    vectorUsageQ.isLoading ||
    userCtxQ.isLoading

  const metaLine = isLoadingAny
    ? 'loading…'
    : `${kbSources.length} kb sources (${fmtNum(
        totalKbDocs,
      )} docs) · ${dataSourcesActive}/3 caches up · ${fmtNum(memoryEntries)} memory entries`

  const onRefresh = () => {
    kbQ.refetch?.()
    redisQ.refetch?.()
    milvusQ.refetch?.()
    vectorUsageQ.refetch?.()
    userCtxQ.refetch?.()
  }

  // ------------------------------------------------------------
  // Mutations — Shared KB
  // ------------------------------------------------------------
  const onKbSubmit = React.useCallback(
    async (
      payload: {
        id?: string
        name: string
        description: string
        type: SharedKBType
        config: Record<string, unknown>
        enabled: boolean
        schedule: string | null
      },
      mode: SharedKBModalMode,
    ) => {
      setKbBusy(true)
      setKbError(null)
      try {
        if (mode === 'edit' && payload.id) {
          const resp = await apiRequest(
            `/api/admin/shared-kb/sources/${encodeURIComponent(payload.id)}`,
            { method: 'PATCH', body: JSON.stringify(payload) },
          )
          if (!resp.ok) {
            const txt = await resp.text()
            throw new Error(`PATCH failed: ${resp.status} ${txt}`)
          }
          showToast('ok', `KB source "${payload.name}" saved`)
        } else {
          const resp = await apiRequest('/api/admin/shared-kb/sources', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
          if (!resp.ok) {
            const txt = await resp.text()
            throw new Error(`POST failed: ${resp.status} ${txt}`)
          }
          showToast('ok', `KB source "${payload.name}" added`)
        }
        setKbModal({ open: false, mode: 'create', initial: null })
        setKbDetail(null)
        kbQ.refetch?.()
      } catch (err: any) {
        setKbError(err?.message ?? 'submit failed')
      } finally {
        setKbBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onKbIngest = React.useCallback(
    async (row: SharedKBSourceRow) => {
      setActionBusy(`kb-ingest-${row.id}`)
      try {
        const resp = await apiRequest(
          `/api/admin/shared-kb/sources/${encodeURIComponent(row.id)}/ingest`,
          { method: 'POST' },
        )
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`ingest failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `ingest started for "${row.name}"`)
        kbQ.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'ingest failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onKbDelete = React.useCallback(
    async (row: SharedKBSourceRow) => {
      if (!confirm(`Delete KB source "${row.name}"? Documents and chunks will be removed.`)) return
      setActionBusy(`kb-del-${row.id}`)
      try {
        const resp = await apiRequest(
          `/api/admin/shared-kb/sources/${encodeURIComponent(row.id)}`,
          { method: 'DELETE' },
        )
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`DELETE failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `KB source "${row.name}" deleted`)
        setKbDetail(null)
        kbQ.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'delete failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onKbToggle = React.useCallback(
    async (row: SharedKBSourceRow) => {
      setActionBusy(`kb-toggle-${row.id}`)
      try {
        const resp = await apiRequest(
          `/api/admin/shared-kb/sources/${encodeURIComponent(row.id)}`,
          { method: 'PATCH', body: JSON.stringify({ enabled: !row.enabled }) },
        )
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`PATCH failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `${!row.enabled ? 'enabled' : 'disabled'} "${row.name}"`)
        kbQ.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'toggle failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  // ------------------------------------------------------------
  // Mutations — User memory
  // ------------------------------------------------------------
  const onPurgeUserMemory = React.useCallback(
    async (row: UserContextSummary) => {
      if (
        !confirm(
          `Purge ALL memory for ${row.email}? ${fmtNum(row.totalEntries)} entries will be deleted.\nThis cannot be undone.`,
        )
      )
        return
      setActionBusy(`mem-purge-${row.userId}`)
      try {
        const resp = await apiRequest(
          `/api/admin/user-context/${encodeURIComponent(row.userId)}`,
          { method: 'DELETE' },
        )
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`purge failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `purged memory for ${row.email}`)
        setMemDetail(null)
        userCtxQ.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'purge failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? 'Content & Data'}
        meta={metaLine}
        actions={
          <>
            <Btn variant="ghost" onClick={onRefresh}>
              refresh
            </Btn>
            {tab === 'shared-kb' && (
              <Btn
                variant="primary"
                onClick={() => {
                  setKbError(null)
                  setKbModal({ open: true, mode: 'create', initial: null })
                }}
              >
                + add source
              </Btn>
            )}
          </>
        }
      />
      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as ContentHubTab)} />

      {toast && (
        <Banner level={toast.level} label={toast.level === 'err' ? 'error' : toast.level === 'ok' ? 'ok' : 'info'}>
          {toast.msg}
        </Banner>
      )}

      <KpiGrid cols={3}>
        <Kpi
          label="kb articles"
          value={kbQ.isLoading ? '…' : fmtNum(totalKbDocs)}
          sub={`${kbSources.length} sources · ${fmtNum(totalKbChunks)} chunks`}
        />
        <Kpi
          label="data sources"
          value={
            redisQ.isLoading || milvusQ.isLoading || vectorUsageQ.isLoading
              ? '…'
              : `${dataSourcesActive}/3`
          }
          sub="redis · pgvector · milvus"
          tone={dataSourcesActive === 3 ? 'ok' : dataSourcesActive >= 1 ? 'warn' : 'err'}
        />
        <Kpi
          label="user memories"
          value={userCtxQ.isLoading ? '…' : fmtNum(memoryEntries)}
          sub={`${fmtNum(userOverview?.totalUsers)} users with context`}
        />
      </KpiGrid>

      {tab === 'shared-kb' && (
        <SharedKBPane
          rows={kbSources}
          isLoading={kbQ.isLoading}
          isError={kbQ.isError}
          search={kbSearch}
          onSearch={setKbSearch}
          typeFilter={kbType}
          onTypeFilter={setKbType}
          onOpen={setKbDetail}
          selectedId={kbDetail?.id}
        />
      )}

      {tab === 'data-layer' && (
        <DataLayerPane
          redis={redisQ.data}
          redisLoading={redisQ.isLoading}
          redisError={redisQ.isError}
          milvus={milvusQ.data}
          milvusLoading={milvusQ.isLoading}
          milvusError={milvusQ.isError}
          vectorUsage={vectorUsageQ.data}
          vectorUsageLoading={vectorUsageQ.isLoading}
          vectorUsageError={vectorUsageQ.isError}
        />
      )}

      {tab === 'user-memory' && (
        <UserMemoryPane
          overview={userOverview}
          users={userRows}
          isLoading={userCtxQ.isLoading}
          isError={userCtxQ.isError}
          search={memSearch}
          onSearch={setMemSearch}
          onOpen={setMemDetail}
          selectedId={memDetail?.userId}
        />
      )}

      {!TAB_ORDER.includes(tab) && (
        <EmptyInline pad>unknown sub-tab: {String(tab)}</EmptyInline>
      )}

      {/* Shared KB detail */}
      <SidePanel
        open={!!kbDetail}
        onClose={() => setKbDetail(null)}
        title={kbDetail?.name ?? ''}
        meta={
          kbDetail
            ? `${kbDetail.type} · ${fmtNum(kbDetail.doc_count)} docs · ${
                kbDetail.enabled ? 'enabled' : 'disabled'
              }`
            : ''
        }
        headActions={
          kbDetail ? (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <Btn variant="ghost" onClick={() => onKbToggle(kbDetail)} disabled={actionBusy === `kb-toggle-${kbDetail.id}`}>
                {kbDetail.enabled ? 'disable' : 'enable'}
              </Btn>
              <Btn variant="ghost" onClick={() => onKbIngest(kbDetail)} disabled={actionBusy === `kb-ingest-${kbDetail.id}`}>
                {actionBusy === `kb-ingest-${kbDetail.id}` ? 'ingesting…' : 'ingest'}
              </Btn>
              <Btn variant="ghost" onClick={() => onKbDelete(kbDetail)} disabled={actionBusy === `kb-del-${kbDetail.id}`}>
                delete
              </Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setKbError(null)
                  setKbModal({ open: true, mode: 'edit', initial: kbDetail })
                }}
              >
                edit
              </Btn>
            </span>
          ) : null
        }
      >
        {kbDetail && <SharedKBDetail row={kbDetail} />}
      </SidePanel>

      {/* User Memory detail */}
      <SidePanel
        open={!!memDetail}
        onClose={() => setMemDetail(null)}
        title={memDetail?.name ?? ''}
        meta={
          memDetail
            ? `${fmtNum(memDetail.totalEntries)} entries · ${memDetail.email}`
            : ''
        }
        headActions={
          memDetail ? (
            <Btn
              variant="ghost"
              onClick={() => onPurgeUserMemory(memDetail)}
              disabled={actionBusy === `mem-purge-${memDetail.userId}`}
            >
              {actionBusy === `mem-purge-${memDetail.userId}` ? 'purging…' : 'purge'}
            </Btn>
          ) : null
        }
      >
        {memDetail && (
          <UserMemoryDetail
            row={memDetail}
            storageBytes={userOverview?.storageBytes}
          />
        )}
      </SidePanel>

      <SharedKBModal
        open={kbModal.open}
        mode={kbModal.mode}
        initial={kbModal.initial}
        onClose={() => setKbModal({ open: false, mode: 'create', initial: null })}
        onSubmit={onKbSubmit}
        isSubmitting={kbBusy}
        error={kbError}
      />
    </>
  )
}

export default ContentHubPage
