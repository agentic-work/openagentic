/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  OpenAgentic Enterprise — Runtime Identity Directory (SSO) registry
 *  Copyright © Agenticwork™ LLC. All rights reserved.
 *
 *  ENTERPRISE SOFTWARE — licensed ONLY under the OpenAgentic Enterprise License
 *  (/ee/LICENSE), NOT the repository's Apache-2.0 license. A paid Agenticwork LLC
 *  subscription is required to use this in production. Reading the source grants no
 *  license. Using, selling, hosting as a service, redistributing, or modifying it
 *  without a subscription — or removing the license gate — is a breach of
 *  /ee/LICENSE §4 and an infringement of Agenticwork's copyright.
 *  Licensing: licensing@agenticwork.io
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import * as React from 'react'
import {
  PageHead,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  SidePanel,
  Panel,
  Dt,
  type DtCol,
  Chip,
  FilterRow,
  Pill,
  Toggle,
  EmptyInline,
} from '../../primitives-v3'
import { EmptyState } from '../../primitives-v3/EmptyState'
import { useAdminQuery, useAdminInvalidate } from '../../hooks/useAdminQuery'
import {
  type DirectoryRow,
  type DirectoryListResponse,
  type DirectoryTypeFilter,
  DIRECTORY_TYPE_META,
  buildDirectoryRows,
  fmtRel,
  normalizeType,
  statusTone,
} from './types'
import { DirectoryDetail } from './DirectoryDetail'
import { DirectoryModal } from './DirectoryModal'
import {
  useToast,
  useConfirm,
  ToastStack,
  ConfirmBanner,
  mutateRow,
} from '../_shared/mutationHelpers'

const DETAIL_TABS = [
  { id: 'overview', label: 'overview' },
  { id: 'groups', label: 'groups' },
  { id: 'discovery', label: 'discovery' },
]

export const IdentityDirectoriesPage: React.FC = () => {
  const [search, setSearch] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<DirectoryTypeFilter>('all')
  const [detail, setDetail] = React.useState<DirectoryRow | null>(null)
  const [detailTab, setDetailTab] = React.useState('overview')
  // null = closed; { row } = open (edit if .row, add otherwise)
  const [modal, setModal] = React.useState<{ row: DirectoryRow | null } | null>(null)

  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useAdminInvalidate()

  const query = useAdminQuery<DirectoryListResponse>(
    ['identity-directories'],
    '/api/admin/identity-directories',
    { refetchInterval: 30_000 },
  )

  const rows = React.useMemo(
    () => buildDirectoryRows(query.data?.directories),
    [query.data],
  )

  const totals = React.useMemo(() => {
    const total = rows.length
    const active = rows.filter((r) => r.status === 'active').length
    const disabled = rows.filter((r) => !r.enabled).length
    const azure = rows.filter((r) => normalizeType(r.type) === 'azure-ad').length
    const google = rows.filter((r) => normalizeType(r.type) === 'google-oidc').length
    const oidc = rows.filter((r) => normalizeType(r.type) === 'generic-oidc').length
    return { total, active, disabled, azure, google, oidc }
  }, [rows])

  const counts = React.useMemo(
    () => ({
      all: rows.length,
      'azure-ad': totals.azure,
      'google-oidc': totals.google,
      'generic-oidc': totals.oidc,
    }),
    [rows, totals],
  )

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (typeFilter !== 'all' && normalizeType(r.type) !== typeFilter) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        (r.tenantId ?? '').toLowerCase().includes(q) ||
        (r.issuer ?? '').toLowerCase().includes(q)
      )
    })
  }, [rows, typeFilter, search])

  const isLoading = query.isLoading
  const isError = query.isError

  // Enterprise license state (from the API). Default to licensed while loading so
  // we never flash a scary banner; the banner only shows once we have a verdict.
  const enterprise = query.data?.enterprise
  const licensed = enterprise ? enterprise.licensed : true

  React.useEffect(() => {
    if (detail) setDetailTab('overview')
  }, [detail?.id])

  // -----------------------------------------------------------
  // Mutation handlers
  // -----------------------------------------------------------
  const onAdd = () => setModal({ row: null })
  const onEdit = (row: DirectoryRow) => setModal({ row })
  const onDelete = (row: DirectoryRow) => {
    confirm.ask(
      `delete directory "${row.displayName}"? users will no longer be able to sign in through it.`,
      async () => {
        const out = await mutateRow({
          endpoint: `/api/admin/identity-directories/${row.id}`,
          method: 'DELETE',
          toast,
          invalidate,
          invalidateKeys: [['identity-directories']],
          successMessage: `deleted "${row.displayName}"`,
          errorPrefix: 'delete failed',
        })
        if (out.ok && detail?.id === row.id) setDetail(null)
      },
    )
  }

  const onToggle = (row: DirectoryRow, next: boolean) => {
    void mutateRow({
      endpoint: `/api/admin/identity-directories/${row.id}`,
      method: 'PATCH',
      body: { enabled: next },
      toast,
      invalidate,
      invalidateKeys: [['identity-directories']],
      successMessage: `${next ? 'enabled' : 'disabled'} "${row.displayName}"`,
      errorPrefix: 'toggle failed',
    })
  }

  const onRefresh = () => query.refetch?.()

  const cols: DtCol<DirectoryRow>[] = [
    {
      key: 'directory',
      label: 'Directory',
      className: 'name',
      render: (r) => {
        const meta = DIRECTORY_TYPE_META[normalizeType(r.type)]
        const endpoint = r.tenantId || r.issuer || r.authority || ''
        const epShort = endpoint.length > 40 ? endpoint.slice(0, 37) + '…' : endpoint
        return (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{r.displayName}</span>
            <span className="sub mono">
              {meta.label}
              {epShort ? <span style={{ color: 'var(--fg-3)' }}> · {epShort}</span> : null}
            </span>
          </div>
        )
      },
    },
    {
      key: 'priority',
      label: 'Order',
      width: '60px',
      className: 'num',
      align: 'right',
      render: (r) => r.priority,
    },
    {
      key: 'secret',
      label: 'Secret',
      width: '80px',
      render: (r) => (
        <span style={{ color: r.hasSecret ? 'var(--ok)' : 'var(--warn)' }}>
          {r.hasSecret ? 'set' : 'missing'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      render: (r) => {
        if (!r.enabled) return <Pill tone="idle">off</Pill>
        const tone = statusTone(r.status)
        return <Pill tone={tone === 'idle' ? 'info' : tone}>{r.status}</Pill>
      },
    },
    {
      key: 'updated',
      label: 'Updated',
      width: '110px',
      className: 'mono',
      render: (r) => <span style={{ color: 'var(--fg-3)' }}>{fmtRel(r.updated_at)}</span>,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: '80px',
      render: (r) => (
        <Toggle on={r.enabled} onChange={(next) => onToggle(r, next)} label={`toggle ${r.name}`} />
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '120px',
      className: 'r-actions',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); onEdit(r) }} aria-label="edit directory">edit</Btn>
          <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); onDelete(r) }} aria-label="delete directory">del</Btn>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Identity / Directories"
        meta={
          isLoading
            ? 'loading…'
            : `${totals.total} directories · ${totals.active} active · ${totals.disabled} disabled · auto-refresh 30s`
        }
        actions={
          <>
            <Pill tone={licensed ? 'info' : 'warn'}>
              {licensed
                ? `Enterprise${enterprise?.licensee ? ` · ${enterprise.licensee}` : ' · licensed'}`
                : 'Enterprise · unlicensed'}
            </Pill>
            <Btn variant="ghost" onClick={onRefresh}>refresh</Btn>
            <Btn variant="primary" onClick={onAdd} disabled={!licensed}>+ add directory</Btn>
          </>
        }
      />

      <ToastStack api={toast} />
      <ConfirmBanner api={confirm} />

      {enterprise && !licensed && (
        <Banner level="warn" label="enterprise feature — license required">
          {enterprise.message}
        </Banner>
      )}
      {enterprise && licensed && (
        <Banner level="info" label="enterprise">
          OpenAgentic Enterprise feature
          {enterprise.licensee ? <> · licensed to <span className="accent">{enterprise.licensee}</span></> : ' · licensed'}
          {' — commercial terms in '}<span className="accent">/ee/LICENSE</span>.
        </Banner>
      )}

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/identity-directories</span> — values may be stale
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="directories"
          value={isLoading ? '…' : String(totals.total)}
          sub={isLoading ? '' : `${totals.disabled} disabled`}
        />
        <Kpi
          label="active"
          value={isLoading ? '…' : `${totals.active} / ${totals.total || 0}`}
          tone={totals.total > 0 && totals.active === 0 ? 'warn' : 'ok'}
          sub={totals.total === 0 ? 'none configured' : 'enabled + healthy'}
        />
        <Kpi
          label="azure / google"
          value={isLoading ? '…' : `${totals.azure} / ${totals.google}`}
          sub="entra · workspace"
        />
        <Kpi
          label="generic oidc"
          value={isLoading ? '…' : String(totals.oidc)}
          sub="okta · auth0 · keycloak"
        />
      </KpiGrid>

      <Panel>
        <FilterRow value={search} onSearch={setSearch} searchPlaceholder="directory, tenant, issuer…">
          <Chip label="type" value="all" count={counts.all} on={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
          <Chip label="azure" count={counts['azure-ad']} on={typeFilter === 'azure-ad'} onClick={() => setTypeFilter('azure-ad')} />
          <Chip label="google" count={counts['google-oidc']} on={typeFilter === 'google-oidc'} onClick={() => setTypeFilter('google-oidc')} />
          <Chip label="oidc" count={counts['generic-oidc']} on={typeFilter === 'generic-oidc'} onClick={() => setTypeFilter('generic-oidc')} />
        </FilterRow>
        {isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : filtered.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState
              title="No identity directories configured"
              body={
                <>
                  Add an Azure AD (Entra ID), Google Workspace, or generic OIDC
                  directory to let users sign in with SSO. Each enabled directory
                  becomes a button on the login page — no client ID is ever shipped
                  to the browser.
                </>
              }
              ctaLabel="+ add directory"
              onCtaClick={onAdd}
            />
          ) : (
            <EmptyInline pad>no directories match the current filter</EmptyInline>
          )
        ) : (
          <Dt<DirectoryRow>
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowDoubleClick={(r) => setDetail(r)}
            isRowDisabled={(r) => !r.enabled}
            rowDataAttrs={(r) => ({
              status: r.status === 'active' ? 'ok' : r.status === 'error' ? 'err' : 'idle',
            })}
          />
        )}
      </Panel>

      <SidePanel
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail?.displayName ?? ''}
        meta={detail ? DIRECTORY_TYPE_META[normalizeType(detail.type)].label : undefined}
        tabs={DETAIL_TABS}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        headActions={
          detail && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Btn variant="ghost" onClick={() => onEdit(detail)}>edit</Btn>
            </span>
          )
        }
      >
        {detail && <DirectoryDetail row={detail} tab={detailTab} />}
      </SidePanel>

      <DirectoryModal
        open={modal != null}
        onClose={() => setModal(null)}
        editing={modal?.row ?? null}
        toast={toast}
      />
    </>
  )
}

export default IdentityDirectoriesPage
